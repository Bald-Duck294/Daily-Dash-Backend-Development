import { getMessaging } from "firebase-admin/messaging";
import { getApps } from "firebase-admin/app";
import prisma from "../config/prismaClient.mjs";
import { resolveEffectiveWashroomSLA } from "./slaConfigurationService.js";
import { DEFAULT_ESCALATION_LEVELS } from "../constant/slaDefaults.js";

/**
 * Helper to dispatch push notifications to target users via Firebase Admin
 */
async function sendEscalationPushNotification({
    locationId,
    locationName,
    companyId,
    score,
    threshold,
    level,
    targetRole = "cleaner",
    escalationId,
    reviewId,
    notificationType = "sla_breach_level_1",
    title,
    body
}) {
    try {
        if (getApps().length === 0) {
            console.warn("⚠️ [SLA ESCALATION] Firebase Admin is not initialized. Skipping push notification.");
            return { sent: false, reason: "Firebase Admin not initialized" };
        }

        const locIdBigInt = BigInt(locationId);

        // Find staff assigned to this washroom
        const assignments = await prisma.cleaner_assignments.findMany({
            where: { location_id: locIdBigInt },
            include: {
                cleaner_user: {
                    select: { id: true, name: true, fcm_token: true }
                },
                supervisor: {
                    select: { id: true, name: true, fcm_token: true }
                }
            }
        });

        const targetUserIds = new Set();
        const fallbackTokens = new Set();
        const roleLower = String(targetRole || "").toLowerCase();

        for (const a of assignments) {
            if (roleLower.includes("cleaner") && a.cleaner_user?.id) {
                targetUserIds.add(a.cleaner_user.id);
                if (a.cleaner_user.fcm_token) fallbackTokens.add(a.cleaner_user.fcm_token);
            }
            if ((roleLower.includes("supervisor") || roleLower.includes("supv") || roleLower.includes("facility_supv")) && a.supervisor?.id) {
                targetUserIds.add(a.supervisor.id);
                if (a.supervisor.fcm_token) fallbackTokens.add(a.supervisor.fcm_token);
            }
        }

        // If target role is admin/super_admin/facility_admin, collect company admin user IDs
        if ((roleLower.includes("admin") || roleLower.includes("facility_admin") || roleLower.includes("super_admin")) && companyId) {
            const adminUsers = await prisma.users.findMany({
                where: {
                    company_id: BigInt(companyId),
                    role: { name: { in: ["admin", "super_admin", "Admin", "Super Admin", "facility_admin", "Facility Admin"] } }
                },
                select: { id: true, fcm_token: true }
            });
            adminUsers.forEach(u => {
                targetUserIds.add(u.id);
                if (u.fcm_token) fallbackTokens.add(u.fcm_token);
            });
        }

        const targetTokens = new Set();

        // Query multi-device user_fcm_tokens table for all target user IDs
        if (targetUserIds.size > 0) {
            const activeTokenRecords = await prisma.user_fcm_tokens.findMany({
                where: {
                    user_id: { in: Array.from(targetUserIds) },
                    is_active: true
                },
                select: { fcm_token: true }
            });
            activeTokenRecords.forEach(r => {
                if (r.fcm_token) targetTokens.add(r.fcm_token);
            });
        }

        // Add fallback legacy tokens if not already present
        fallbackTokens.forEach(t => {
            if (t) targetTokens.add(t);
        });

        if (targetTokens.size === 0) {
            console.log(`ℹ️ [SLA ESCALATION] No active FCM tokens found for target role "${targetRole}" on washroom "${locationName}".`);
            return { sent: false, reason: "No FCM tokens registered" };
        }

        const defaultTitle = `🚨 SLA Level ${level} Alert - ${locationName}`;
        const defaultBody = `Washroom "${locationName}" failed SLA with score ${score.toFixed(1)}/10 (Threshold: ${threshold}/10). Action required!`;

        const messaging = getMessaging();
        let successCount = 0;

        for (const token of targetTokens) {
            try {
                const message = {
                    token,
                    data: {
                        title: title || defaultTitle,
                        body: body || defaultBody,
                        type: notificationType,
                        escalationId: escalationId ? escalationId.toString() : "",
                        reviewId: reviewId ? reviewId.toString() : "",
                        locationId: locIdBigInt.toString(),
                        level: String(level),
                        score: score.toString(),
                        threshold: threshold.toString()
                    }
                };

                await messaging.send(message);
                successCount++;
            } catch (fcmError) {
                console.error(`❌ [SLA ESCALATION] Failed sending push to token (${token.slice(0, 10)}...):`, fcmError.message);

                // Auto-deactivate dead/invalid tokens
                if (
                    fcmError.code === "messaging/registration-token-not-registered" ||
                    fcmError.code === "messaging/invalid-registration-token" ||
                    fcmError.message?.includes("not registered")
                ) {
                    await prisma.user_fcm_tokens.updateMany({
                        where: { fcm_token: token },
                        data: { is_active: false }
                    }).catch(() => {});
                }
            }
        }

        console.log(`✅ [SLA ESCALATION] Sent ${successCount}/${targetTokens.size} push notifications for Level ${level} to role "${targetRole}".`);
        return { sent: true, count: successCount };
    } catch (error) {
        console.error("❌ [SLA ESCALATION] Error in sendEscalationPushNotification:", error);
        return { sent: false, error: error.message };
    }
}

/**
 * Creates a new SLA Escalation record in the database when an SLA breach occurs.
 */
export const createSlaEscalation = async ({
    review,
    effectiveSla,
    score,
    threshold
}) => {
    try {
        const levels = Array.isArray(effectiveSla.configuration?.escalation?.levels) && effectiveSla.configuration.escalation.levels.length > 0
            ? effectiveSla.configuration.escalation.levels
            : DEFAULT_ESCALATION_LEVELS;

        const maxLevel = levels.length;
        const now = new Date();

        // Calculate due_at for Level 2 (if exists) from inception
        let dueAt = null;
        if (levels.length > 1) {
            const nextLevelDelayMinutes = Number(levels[1]?.delay_minutes ?? 120);
            dueAt = new Date(now.getTime() + (nextLevelDelayMinutes * 60 * 1000));
        }

        console.log(`\n🚨 [SLA BREACH DETECTED] Creating Escalation Record for Review #${review.id}`);
        console.log(`   Location ID: ${review.location_id} | Score: ${score}/${threshold}`);
        console.log(`   Hierarchy Levels: ${maxLevel} | Level 2 Due At: ${dueAt ? dueAt.toISOString() : "None"}`);

        // 1. Create sla_escalations record
        const escalation = await prisma.sla_escalations.create({
            data: {
                company_id: review.company_id,
                location_id: review.location_id,
                triggered_by_review_id: review.id,
                current_level: 1,
                max_level: maxLevel,
                state: "OPEN",
                snapshot_hierarchy: levels,
                due_at: dueAt,
                created_at: now,
                updated_at: now
            }
        });

        // 2. Link cleaner_review back to this escalation
        await prisma.cleaner_review.update({
            where: { id: review.id },
            data: { escalation_id: escalation.id }
        });

        // 3. Dispatch Level 1 Notification to assigned Cleaner
        const level1Config = levels[0] || { target_role: "cleaner", send_notification: true };
        if (level1Config.send_notification !== false) {
            await sendEscalationPushNotification({
                locationId: review.location_id,
                locationName: effectiveSla.location_name || "Washroom",
                companyId: review.company_id,
                score,
                threshold,
                level: 1,
                targetRole: level1Config.target_role || "cleaner",
                escalationId: escalation.id,
                reviewId: review.id,
                notificationType: "sla_breach_level_1",
                title: `🚨 Washroom Cleaning SLA Alert - Level 1`,
                body: `Washroom score dropped to ${score.toFixed(1)}/10 (Threshold: ${threshold}/10). Corrective cleaning required immediately.`
            });
        }

        console.log(`✅ [SLA ESCALATION CREATED] Record ID #${escalation.id} is now OPEN at Level 1.\n`);
        return escalation;
    } catch (error) {
        console.error("❌ [SLA ESCALATION] Error creating escalation record:", error);
        throw error;
    }
};

/**
 * Resolves an active SLA Escalation when a corrective retry passes the threshold.
 */
export const resolveSlaEscalation = async ({
    escalationId,
    retryReviewId,
    locationName = "Washroom",
    companyId = null,
    score = 0
}) => {
    try {
        const escIdBigInt = BigInt(escalationId);
        const resolvedAt = new Date();

        const updated = await prisma.sla_escalations.update({
            where: { id: escIdBigInt },
            data: {
                state: "RESOLVED",
                resolved_by_review_id: BigInt(retryReviewId),
                resolved_at: resolvedAt,
                due_at: null // Stops cron timer
            }
        });

        console.log(`🎉 [SLA RESTORED] Escalation #${escalationId} marked as RESOLVED by Review #${retryReviewId}`);

        // Notify Cleaner & Supervisor of resolution
        await sendEscalationPushNotification({
            locationId: updated.location_id,
            locationName,
            companyId: companyId || updated.company_id,
            score,
            threshold: 0,
            level: updated.current_level,
            targetRole: "cleaner",
            escalationId: updated.id,
            reviewId: retryReviewId,
            notificationType: "sla_restored",
            title: `✅ Washroom SLA Restored!`,
            body: `Corrective cleaning passed with score ${score.toFixed(1)}/10. SLA breach on "${locationName}" is now resolved.`
        });

        return updated;
    } catch (error) {
        console.error(`❌ [SLA RESOLUTION] Error resolving escalation #${escalationId}:`, error);
        throw error;
    }
};

/**
 * Marks an escalation as EXHAUSTED when max retries have been attempted without passing.
 */
export const exhaustSlaEscalation = async ({
    escalationId,
    locationName = "Washroom",
    companyId = null,
    score = 0
}) => {
    try {
        const escIdBigInt = BigInt(escalationId);

        const updated = await prisma.sla_escalations.update({
            where: { id: escIdBigInt },
            data: {
                state: "EXHAUSTED",
                due_at: null
            }
        });

        console.log(`⚠️ [SLA EXHAUSTED] Escalation #${escalationId} permanently failed. Retries exhausted.`);

        // Critical failure alert to Admin / Supervisor
        await sendEscalationPushNotification({
            locationId: updated.location_id,
            locationName,
            companyId: companyId || updated.company_id,
            score,
            threshold: 0,
            level: updated.current_level,
            targetRole: "admin",
            escalationId: updated.id,
            notificationType: "sla_exhausted",
            title: `⛔ SLA Breached - Max Retries Exhausted`,
            body: `Washroom "${locationName}" failed all corrective cleaning attempts (Score: ${score.toFixed(1)}/10). Escalation closed as EXHAUSTED.`
        });

        return updated;
    } catch (error) {
        console.error(`❌ [SLA EXHAUSTION] Error exhausting escalation #${escalationId}:`, error);
        throw error;
    }
};

/**
 * Advances an escalation to the next tier (called by background cron worker).
 */
export const advanceEscalationLevel = async (escalationId) => {
    try {
        const escIdBigInt = BigInt(escalationId);

        const escalation = await prisma.sla_escalations.findUnique({
            where: { id: escIdBigInt },
            include: {
                location: { select: { id: true, name: true } }
            }
        });

        if (!escalation || escalation.state !== "OPEN") {
            return { advanced: false, reason: "Escalation not found or not OPEN" };
        }

        const levels = Array.isArray(escalation.snapshot_hierarchy) ? escalation.snapshot_hierarchy : [];
        const currentLevel = escalation.current_level;
        const maxLevel = escalation.max_level || levels.length;

        if (currentLevel >= maxLevel) {
            // Already at max level, clear due_at to stop polling
            await prisma.sla_escalations.update({
                where: { id: escIdBigInt },
                data: { due_at: null }
            });
            console.log(`ℹ️ [SLA ESCALATION] Escalation #${escalationId} reached max level (${maxLevel}). Timer stopped.`);
            return { advanced: false, reason: "MAX_LEVEL_REACHED" };
        }

        const nextLevel = currentLevel + 1;
        const nextLevelConfig = levels[nextLevel - 1] || {};
        const nextTargetRole = nextLevelConfig.target_role || "supervisor";

        // Calculate due_at for the subsequent level (if any) from created_at
        let nextDueAt = null;
        if (nextLevel < maxLevel && levels[nextLevel]) {
            const subsequentDelayMinutes = Number(levels[nextLevel]?.delay_minutes ?? (nextLevel * 120));
            const createdAtTime = new Date(escalation.created_at).getTime();
            nextDueAt = new Date(createdAtTime + (subsequentDelayMinutes * 60 * 1000));
        }

        const updated = await prisma.sla_escalations.update({
            where: { id: escIdBigInt },
            data: {
                current_level: nextLevel,
                due_at: nextDueAt,
                updated_at: new Date()
            }
        });

        console.log(`⚡ [SLA ESCALATION ADVANCED] Escalation #${escalationId}: Level ${currentLevel} ➔ Level ${nextLevel} (Role: ${nextTargetRole})`);

        // Dispatch Tier notification
        if (nextLevelConfig.send_notification !== false) {
            await sendEscalationPushNotification({
                locationId: escalation.location_id,
                locationName: escalation.location?.name || "Washroom",
                companyId: escalation.company_id,
                score: 0,
                threshold: 0,
                level: nextLevel,
                targetRole: nextTargetRole,
                escalationId: escalation.id,
                reviewId: escalation.triggered_by_review_id,
                notificationType: `sla_breach_level_${nextLevel}`,
                title: `🚨 SLA Escalation Level ${nextLevel} - ${escalation.location?.name || "Washroom"}`,
                body: `Unresolved cleaning breach on "${escalation.location?.name || "Washroom"}". Escalated to Level ${nextLevel} (${nextTargetRole}).`
            });
        }

        return { advanced: true, newLevel: nextLevel, escalation: updated };
    } catch (error) {
        console.error(`❌ [SLA ESCALATION] Error advancing escalation #${escalationId}:`, error);
        throw error;
    }
};

/**
 * Main evaluation entrypoint after AI hygiene scoring.
 */
export const evaluateReviewSla = async ({
    reviewId,
    locationId,
    companyId = null,
    score
}) => {
    try {
        if (!reviewId || !locationId || score === undefined || score === null) {
            return { evaluated: false, reason: "Missing required arguments" };
        }

        const reviewIdBigInt = BigInt(reviewId);
        const locIdBigInt = BigInt(locationId);
        const numericScore = Number(score);

        if (isNaN(numericScore)) {
            return { evaluated: false, reason: "Invalid numeric score" };
        }

        // 1. Fetch review details
        const review = await prisma.cleaner_review.findUnique({
            where: { id: reviewIdBigInt },
            select: {
                id: true,
                company_id: true,
                location_id: true,
                score: true,
                review_type: true,
                attempt_no: true,
                escalation_id: true,
                parent_review_id: true
            }
        });

        if (!review) {
            return { evaluated: false, reason: "Review record not found" };
        }

        const effectiveCompanyId = companyId || review.company_id;

        // 2. Resolve effective washroom SLA (checks Company Master Switch & Washroom overrides)
        const effectiveSla = await resolveEffectiveWashroomSLA(locIdBigInt, effectiveCompanyId);

        if (!effectiveSla || !effectiveSla.enabled) {
            console.log(`ℹ️ [SLA EVALUATION] SLA is inactive for location #${locIdBigInt} (${effectiveSla?.reason || "DISABLED"}).`);
            return { evaluated: true, breached: false, reason: effectiveSla?.reason || "SLA_DISABLED" };
        }

        const threshold = Number(effectiveSla.threshold ?? 8.0);
        const maxRetries = Number(effectiveSla.configuration?.max_retry_attempts ?? 2);
        const reviewType = (review.review_type || "ORIGINAL").toUpperCase();

        console.log(`\n🔍 [SLA EVALUATION] Review #${reviewIdBigInt} (${reviewType}) | Score: ${numericScore.toFixed(1)} / Threshold: ${threshold}`);

        // =========================================================================
        // CASE A: ORIGINAL REVIEW
        // =========================================================================
        if (reviewType === "ORIGINAL") {
            if (numericScore >= threshold) {
                console.log(`✅ [SLA PASS] Review #${reviewIdBigInt} meets threshold (${numericScore.toFixed(1)} >= ${threshold}).`);
                
                // If this review was linked to an open escalation, resolve it
                if (review.escalation_id) {
                    const openEsc = await prisma.sla_escalations.findUnique({
                        where: { id: review.escalation_id }
                    });
                    if (openEsc && openEsc.state === "OPEN") {
                        await resolveSlaEscalation({
                            escalationId: openEsc.id,
                            retryReviewId: review.id,
                            locationName: effectiveSla.location_name || "Washroom",
                            companyId: effectiveCompanyId,
                            score: numericScore
                        });
                        return {
                            evaluated: true,
                            breached: false,
                            status: "RESOLVED",
                            escalationId: openEsc.id.toString()
                        };
                    }
                }

                return { evaluated: true, breached: false, status: "PASS", score: numericScore, threshold };
            }

            // SLA BREACH OCCURRED
            // Check if an active OPEN escalation already exists for this washroom
            const existingOpenEscalation = await prisma.sla_escalations.findFirst({
                where: {
                    location_id: locIdBigInt,
                    state: "OPEN"
                }
            });

            if (existingOpenEscalation) {
                console.log(`ℹ️ [SLA NOTICE] Washroom #${locIdBigInt} already has an active OPEN escalation (#${existingOpenEscalation.id}). Linking review without creating duplicate.`);
                await prisma.cleaner_review.update({
                    where: { id: reviewIdBigInt },
                    data: { escalation_id: existingOpenEscalation.id }
                });
                return {
                    evaluated: true,
                    breached: true,
                    status: "EXISTING_OPEN_ESCALATION",
                    escalationId: existingOpenEscalation.id.toString()
                };
            }

            // Create new escalation
            const newEscalation = await createSlaEscalation({
                review,
                effectiveSla,
                score: numericScore,
                threshold
            });

            return {
                evaluated: true,
                breached: true,
                status: "ESCALATION_CREATED",
                escalationId: newEscalation.id.toString()
            };
        }

        // =========================================================================
        // CASE B: CORRECTIVE RETRY REVIEW (review_type === "RETRY")
        // =========================================================================
        if (reviewType === "RETRY") {
            const activeEscalationId = review.escalation_id;

            if (!activeEscalationId) {
                console.warn(`⚠️ [SLA RETRY] Review #${reviewIdBigInt} marked as RETRY but has no escalation_id.`);
                return { evaluated: true, breached: numericScore < threshold, status: "RETRY_NO_ESCALATION_LINK" };
            }

            // Path A: Retry Score Passed!
            if (numericScore >= threshold) {
                await resolveSlaEscalation({
                    escalationId: activeEscalationId,
                    retryReviewId: review.id,
                    locationName: effectiveSla.location_name || "Washroom",
                    companyId: effectiveCompanyId,
                    score: numericScore
                });

                return {
                    evaluated: true,
                    breached: false,
                    status: "RESOLVED",
                    escalationId: activeEscalationId.toString()
                };
            }

            // Path B: Retry Score Still Below Threshold
            const attemptNo = Number(review.attempt_no || 2);
            console.log(`⚠️ [SLA RETRY FAILED] Attempt ${attemptNo}/${maxRetries} failed with score ${numericScore.toFixed(1)} < ${threshold}`);

            if (attemptNo >= maxRetries) {
                // Max retries exhausted
                await exhaustSlaEscalation({
                    escalationId: activeEscalationId,
                    locationName: effectiveSla.location_name || "Washroom",
                    companyId: effectiveCompanyId,
                    score: numericScore
                });

                return {
                    evaluated: true,
                    breached: true,
                    status: "EXHAUSTED",
                    escalationId: activeEscalationId.toString()
                };
            }

            // Retries still remain: escalation stays OPEN for another attempt
            return {
                evaluated: true,
                breached: true,
                status: "RETRY_FAILED_STILL_OPEN",
                escalationId: activeEscalationId.toString()
            };
        }

        return { evaluated: true, status: "UNKNOWN_REVIEW_TYPE" };
    } catch (error) {
        console.error("❌ [SLA EVALUATION ERROR]:", error);
        return { evaluated: false, error: error.message };
    }
};
