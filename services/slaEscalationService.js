import { getMessaging } from "firebase-admin/messaging";
import { getApps } from "firebase-admin/app";
import prisma from "../config/prismaClient.mjs";
import { resolveEffectiveWashroomSLA } from "./slaConfigurationService.js";
import { DEFAULT_ESCALATION_LEVELS, SLA_EVENT_TYPES } from "../constant/slaDefaults.js";
import { logEscalationEvent } from "./slaAuditLogService.js";

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
    cleanerUserId = null,
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
        const targetUserIds = new Set();
        const fallbackTokens = new Set();
        const roleLower = String(targetRole || "").toLowerCase();

        // 1. Level 1 Cleaner Targeting: Target ONLY the specific cleaner who caused the breach / submitted review
        if (roleLower.includes("cleaner")) {
            if (cleanerUserId) {
                targetUserIds.add(BigInt(cleanerUserId));
                const cUser = await prisma.users.findUnique({
                    where: { id: BigInt(cleanerUserId) },
                    select: { id: true, fcm_token: true }
                });
                if (cUser?.fcm_token) fallbackTokens.add(cUser.fcm_token);
            }
        }

        // 2. Supervisor / Admin / All Role Targeting
        if (roleLower.includes("supervisor") || roleLower.includes("supv") || roleLower.includes("all")) {
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

            for (const a of assignments) {
                if (a.supervisor?.id) {
                    targetUserIds.add(a.supervisor.id);
                    if (a.supervisor.fcm_token) fallbackTokens.add(a.supervisor.fcm_token);
                }
            }
        }

        // 3. Company Admin Targeting (for Level 3 / admin roles)
        if ((roleLower.includes("admin") || roleLower.includes("facility_admin") || roleLower.includes("all")) && companyId) {
            const adminUsers = await prisma.users.findMany({
                where: {
                    company_id: BigInt(companyId),
                    OR: [
                        { role_id: 2 },
                        { role_id: 8 },
                        { role: { name: { in: ["admin", "super_admin", "Admin", "Super Admin", "facility_admin", "Facility Admin"] } } }
                    ]
                },
                select: { id: true, fcm_token: true }
            });
            adminUsers.forEach(u => {
                targetUserIds.add(u.id);
                if (u.fcm_token) fallbackTokens.add(u.fcm_token);
            });
        }

        // 4. Super Admin Targeting: ONLY notify Super Admins at Level 4 or when explicitly targetRole includes "super_admin" or "all"
        if (roleLower.includes("super_admin") || roleLower.includes("superadmin") || roleLower.includes("all") || level >= 4) {
            const superAdmins = await prisma.users.findMany({
                where: {
                    OR: [
                        { role_id: 1 },
                        { role: { name: { in: ["super_admin", "Super Admin", "superadmin", "SUPER_ADMIN"] } } }
                    ]
                },
                select: { id: true, fcm_token: true }
            });
            superAdmins.forEach(sa => {
                targetUserIds.add(sa.id);
                if (sa.fcm_token) fallbackTokens.add(sa.fcm_token);
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
            console.log(`ℹ️ [SLA ESCALATION] No active FCM tokens found for target role "${targetRole}" or superadmins on washroom "${locationName}".`);
            return { sent: false, reason: "No FCM tokens registered" };
        }

        const defaultTitle = `Cleaning Alert - ${locationName}`;
        const defaultBody = `Cleanliness score for ${locationName} is ${score !== undefined && score !== null ? Number(score).toFixed(1) : "0"}/10 (Target: ${threshold}/10). Action required.`;
        const notificationTitle = title || defaultTitle;
        const notificationBody = body || defaultBody;

        const messaging = getMessaging();
        let successCount = 0;

        for (const token of targetTokens) {
            try {
                const message = {
                    token,
                    notification: {
                        title: notificationTitle,
                        body: notificationBody,
                    },
                    data: {
                        title: notificationTitle,
                        body: notificationBody,
                        type: notificationType,
                        escalationId: escalationId ? escalationId.toString() : "",
                        reviewId: reviewId ? reviewId.toString() : "",
                        locationId: locIdBigInt.toString(),
                        level: String(level || 1),
                        score: score !== undefined && score !== null ? score.toString() : "0",
                        threshold: threshold ? threshold.toString() : "0"
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

        // Record NOTIFICATION_SENT in SLA audit logs
        if (escalationId && successCount > 0) {
            await logEscalationEvent({
                escalationId,
                reviewId,
                eventType: SLA_EVENT_TYPES.NOTIFICATION_SENT,
                level,
                score,
                metadata: {
                    targetRole,
                    notificationType,
                    title: notificationTitle,
                    recipientsCount: successCount
                }
            });
        }

        return { sent: true, count: successCount };
    } catch (error) {
        console.error("❌ [SLA ESCALATION] Error in sendEscalationPushNotification:", error);
        return { sent: false, error: error.message };
    }
}

/**
 * Creates a new SLA Escalation record when an initial SLA breach occurs.
 */
export const createSlaEscalation = async ({
    review,
    effectiveSla,
    score,
    threshold,
    cleanerUserId,
    businessDate
}) => {
    try {
        const levels = Array.isArray(effectiveSla.configuration?.escalation?.levels) && effectiveSla.configuration.escalation.levels.length > 0
            ? effectiveSla.configuration.escalation.levels
            : DEFAULT_ESCALATION_LEVELS;

        const maxLevel = levels.length;
        const maxRetries = Number(effectiveSla.configuration?.max_retry_attempts ?? 2);
        const now = new Date();

        // Calculate due_at for Level 2 (if exists) from inception
        let dueAt = null;
        if (levels.length > 1) {
            const nextLevelDelayMinutes = Number(levels[1]?.delay_minutes ?? 120);
            dueAt = new Date(now.getTime() + (nextLevelDelayMinutes * 60 * 1000));
        }

        console.log(`\n🚨 [SLA BREACH DETECTED] Creating Escalation Record for Review #${review.id}`);
        console.log(`   Cleaner ID: ${cleanerUserId} | Location ID: ${review.location_id} | Score: ${score}/${threshold}`);
        console.log(`   Business Date: ${businessDate?.toISOString().slice(0, 10)} | Max Retries: ${maxRetries}`);

        // 1. Create sla_escalations record
        const escalation = await prisma.sla_escalations.create({
            data: {
                company_id: review.company_id,
                location_id: review.location_id,
                cleaner_user_id: BigInt(cleanerUserId),
                business_date: businessDate,
                triggered_by_review_id: review.id,
                current_level: 1,
                max_level: maxLevel,
                state: "OPEN",
                snapshot_hierarchy: levels,
                retry_count: 0,
                max_retries: maxRetries,
                due_at: dueAt,
                created_at: now,
                updated_at: now
            }
        });

        // 2. Link cleaner_review back to this escalation and mark is_latest: true
        await prisma.cleaner_review.update({
            where: { id: review.id },
            data: {
                escalation_id: escalation.id,
                review_type: "ORIGINAL",
                attempt_no: 1,
                is_latest: true
            }
        });

        // 3. Log initial SLA_BREACH in audit logs
        await logEscalationEvent({
            escalationId: escalation.id,
            reviewId: review.id,
            actorUserId: cleanerUserId,
            eventType: SLA_EVENT_TYPES.SLA_BREACH,
            level: 1,
            score,
            metadata: {
                threshold,
                maxRetries,
                businessDate: businessDate?.toISOString().slice(0, 10)
            }
        });

        // 4. Dispatch Level 1 Notification to assigned Cleaner
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
                cleanerUserId: cleanerUserId,
                escalationId: escalation.id,
                reviewId: review.id,
                notificationType: "sla_breach_level_1",
                title: `Cleaning Alert - ${effectiveSla.location_name || "Washroom"}`,
                body: `Cleanliness score for ${effectiveSla.location_name || "Washroom"} dropped to ${score.toFixed(1)}/10 (Target: ${threshold}/10). Immediate cleaning required.`
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
    score = 0,
    actorUserId = null
}) => {
    try {
        const escIdBigInt = BigInt(escalationId);
        const retryReviewIdBigInt = BigInt(retryReviewId);
        const resolvedAt = new Date();

        // 1. Mark escalation as RESOLVED
        const updated = await prisma.sla_escalations.update({
            where: { id: escIdBigInt },
            data: {
                state: "RESOLVED",
                resolved_by_review_id: retryReviewIdBigInt,
                resolved_at: resolvedAt,
                due_at: null // Stops cron timer
            }
        });

        // 2. Mark this passing review as is_latest: true, and older reviews in chain as false
        await prisma.cleaner_review.updateMany({
            where: {
                OR: [
                    { escalation_id: escIdBigInt },
                    { id: updated.triggered_by_review_id }
                ],
                id: { not: retryReviewIdBigInt }
            },
            data: { is_latest: false }
        });

        await prisma.cleaner_review.update({
            where: { id: retryReviewIdBigInt },
            data: { is_latest: true }
        });

        console.log(`🎉 [SLA RESTORED] Escalation #${escalationId} marked as RESOLVED by Review #${retryReviewId}`);

        // 3. Log RETRY_PASSED and SLA_RESOLVED audit logs
        await logEscalationEvent({
            escalationId: updated.id,
            reviewId: retryReviewIdBigInt,
            actorUserId,
            eventType: SLA_EVENT_TYPES.RETRY_PASSED,
            level: updated.current_level,
            score,
            metadata: { resolvedAt: resolvedAt.toISOString() }
        });

        await logEscalationEvent({
            escalationId: updated.id,
            reviewId: retryReviewIdBigInt,
            actorUserId,
            eventType: SLA_EVENT_TYPES.SLA_RESOLVED,
            level: updated.current_level,
            score,
            metadata: { resolvedAt: resolvedAt.toISOString() }
        });

        // 4. Notify Cleaner, Supervisor, Admin, and Super Admin of resolution
        await sendEscalationPushNotification({
            locationId: updated.location_id,
            locationName,
            companyId: companyId || updated.company_id,
            score,
            threshold: 0,
            level: updated.current_level,
            targetRole: "all",
            escalationId: updated.id,
            reviewId: retryReviewIdBigInt,
            notificationType: "sla_restored",
            title: `Cleaning Completed - ${locationName}`,
            body: `${locationName} has been cleaned and inspected with score ${score.toFixed(1)}/10.`
        });

        return updated;
    } catch (error) {
        console.error(`❌ [SLA RESOLUTION] Error resolving escalation #${escalationId}:`, error);
        throw error;
    }
};

/**
 * Marks an escalation as EXHAUSTED when max retries have been attempted without passing.
 * Selects the highest scoring review in the chain as is_latest = true.
 */
export const exhaustSlaEscalation = async ({
    escalationId,
    locationName = "Washroom",
    companyId = null,
    score = 0,
    actorUserId = null
}) => {
    try {
        const escIdBigInt = BigInt(escalationId);

        const escalation = await prisma.sla_escalations.findUnique({
            where: { id: escIdBigInt }
        });

        if (!escalation) {
            throw new Error(`Escalation #${escalationId} not found`);
        }

        const updated = await prisma.sla_escalations.update({
            where: { id: escIdBigInt },
            data: {
                state: "EXHAUSTED",
                due_at: null
            }
        });

        console.log(`⚠️ [SLA EXHAUSTED] Escalation #${escalationId} permanently failed. Retries exhausted.`);

        // --- HIGHEST SCORE SELECTION ON EXHAUSTION ---
        // Fetch all reviews belonging to this escalation chain
        const allChainReviews = await prisma.cleaner_review.findMany({
            where: {
                OR: [
                    { escalation_id: escIdBigInt },
                    { id: escalation.triggered_by_review_id }
                ]
            },
            select: { id: true, score: true }
        });

        if (allChainReviews.length > 0) {
            // Find review with the highest numeric score
            let highestReview = allChainReviews[0];
            for (const r of allChainReviews) {
                const rScore = Number(r.score ?? 0);
                const maxScore = Number(highestReview.score ?? 0);
                if (rScore > maxScore) {
                    highestReview = r;
                }
            }

            // Designate the highest scoring review as is_latest: true
            await prisma.cleaner_review.updateMany({
                where: {
                    OR: [
                        { escalation_id: escIdBigInt },
                        { id: escalation.triggered_by_review_id }
                    ],
                    id: { not: highestReview.id }
                },
                data: { is_latest: false }
            });

            await prisma.cleaner_review.update({
                where: { id: highestReview.id },
                data: { is_latest: true }
            });

            console.log(`🏆 [SLA EXHAUSTION] Set highest scoring Review #${highestReview.id} (Score: ${highestReview.score}) as is_latest = true.`);
        }

        // Log audit events
        await logEscalationEvent({
            escalationId: updated.id,
            actorUserId,
            eventType: SLA_EVENT_TYPES.RETRY_FAILED,
            level: updated.current_level,
            score,
            metadata: { reason: "Max retries reached without passing threshold" }
        });

        await logEscalationEvent({
            escalationId: updated.id,
            actorUserId,
            eventType: SLA_EVENT_TYPES.SLA_EXHAUSTED,
            level: updated.current_level,
            score,
            metadata: { retryCount: updated.retry_count, maxRetries: updated.max_retries }
        });

        // Critical failure alert to Cleaner, Supervisor, Admin, and Super Admin
        await sendEscalationPushNotification({
            locationId: updated.location_id,
            locationName,
            companyId: companyId || updated.company_id,
            score,
            threshold: 0,
            level: updated.current_level,
            targetRole: "all",
            escalationId: updated.id,
            notificationType: "sla_exhausted",
            title: `Critical Alert - ${locationName}`,
            body: `${locationName} failed inspection after multiple cleaning attempts (Score: ${score.toFixed(1)}/10). Management intervention required.`
        });

        return updated;
    } catch (error) {
        console.error(`❌ [SLA EXHAUSTION] Error exhausting escalation #${escalationId}:`, error);
        throw error;
    }
};

/**
 * Handles a retry inspection review when an active OPEN escalation exists.
 */
export const handleSlaRetry = async ({
    review,
    activeEscalation,
    effectiveSla,
    score,
    threshold,
    cleanerUserId
}) => {
    try {
        const numericScore = Number(score);
        const activeEscalationId = activeEscalation.id;
        const currentRetryCount = Number(activeEscalation.retry_count || 0);
        const newRetryCount = currentRetryCount + 1;
        const maxRetries = Number(activeEscalation.max_retries ?? 2);
        const attemptNo = newRetryCount + 1; // 1 is original, 2 is retry 1, etc.

        console.log(`\n🔄 [SLA RETRY SUBMISSION] Review #${review.id} for Escalation #${activeEscalationId}`);
        console.log(`   Attempt: ${attemptNo} | Retry Count: ${newRetryCount}/${maxRetries} | Score: ${numericScore.toFixed(1)} / Target: ${threshold}`);

        // 1. Mark previous reviews in chain as is_latest = false, link current review as is_latest = true
        await prisma.cleaner_review.updateMany({
            where: {
                OR: [
                    { escalation_id: activeEscalationId },
                    { id: activeEscalation.triggered_by_review_id }
                ],
                id: { not: review.id }
            },
            data: { is_latest: false }
        });

        await prisma.cleaner_review.update({
            where: { id: review.id },
            data: {
                review_type: "RETRY",
                attempt_no: attemptNo,
                parent_review_id: activeEscalation.triggered_by_review_id,
                escalation_id: activeEscalationId,
                is_latest: true
            }
        });

        // 2. Increment retry_count on the escalation
        await prisma.sla_escalations.update({
            where: { id: activeEscalationId },
            data: {
                retry_count: newRetryCount,
                updated_at: new Date()
            }
        });

        // 3. Log RETRY_ATTEMPT audit event
        await logEscalationEvent({
            escalationId: activeEscalationId,
            reviewId: review.id,
            actorUserId: cleanerUserId,
            eventType: SLA_EVENT_TYPES.RETRY_ATTEMPT,
            level: activeEscalation.current_level,
            score: numericScore,
            metadata: {
                attemptNo,
                retryCount: newRetryCount,
                maxRetries,
                threshold
            }
        });

        // =========================================================================
        // PATH A: RETRY PASSED (Score >= Threshold)
        // =========================================================================
        if (numericScore >= threshold) {
            await resolveSlaEscalation({
                escalationId: activeEscalationId,
                retryReviewId: review.id,
                locationName: effectiveSla.location_name || "Washroom",
                companyId: review.company_id,
                score: numericScore,
                actorUserId: cleanerUserId
            });

            return {
                evaluated: true,
                breached: false,
                status: "RESOLVED",
                escalationId: activeEscalationId.toString()
            };
        }

        // =========================================================================
        // PATH B: RETRY FAILED (Score < Threshold)
        // =========================================================================
        console.log(`⚠️ [SLA RETRY FAILED] Attempt ${attemptNo} failed with score ${numericScore.toFixed(1)} < ${threshold}`);

        if (newRetryCount >= maxRetries) {
            // Max allowed retries reached -> EXHAUST escalation
            await exhaustSlaEscalation({
                escalationId: activeEscalationId,
                locationName: effectiveSla.location_name || "Washroom",
                companyId: review.company_id,
                score: numericScore,
                actorUserId: cleanerUserId
            });

            return {
                evaluated: true,
                breached: true,
                status: "EXHAUSTED",
                escalationId: activeEscalationId.toString()
            };
        }

        // Retries still remain: log failure, notify cleaner, keep escalation OPEN
        await logEscalationEvent({
            escalationId: activeEscalationId,
            reviewId: review.id,
            actorUserId: cleanerUserId,
            eventType: SLA_EVENT_TYPES.RETRY_FAILED,
            level: activeEscalation.current_level,
            score: numericScore,
            metadata: {
                attemptNo,
                retryCount: newRetryCount,
                maxRetries,
                remainingRetries: maxRetries - newRetryCount
            }
        });

        // Send retry failure notice to cleaner
        await sendEscalationPushNotification({
            locationId: review.location_id,
            locationName: effectiveSla.location_name || "Washroom",
            companyId: review.company_id,
            score: numericScore,
            threshold,
            level: activeEscalation.current_level,
            targetRole: "cleaner",
            cleanerUserId: cleanerUserId,
            escalationId: activeEscalationId,
            reviewId: review.id,
            notificationType: "sla_retry_failed",
            title: `Retry Incomplete - ${effectiveSla.location_name || "Washroom"}`,
            body: `Score is ${numericScore.toFixed(1)}/10 (Target: ${threshold}/10). ${maxRetries - newRetryCount} retry attempt(s) remaining.`
        });

        return {
            evaluated: true,
            breached: true,
            status: "RETRY_FAILED_STILL_OPEN",
            escalationId: activeEscalationId.toString()
        };
    } catch (error) {
        console.error("❌ [SLA RETRY ERROR]:", error);
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

        // Log ESCALATION_ADVANCED audit event
        await logEscalationEvent({
            escalationId: updated.id,
            eventType: SLA_EVENT_TYPES.ESCALATION_ADVANCED,
            level: nextLevel,
            metadata: {
                previousLevel: currentLevel,
                targetRole: nextTargetRole
            }
        });

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
                title: `Urgent Cleaning Required - ${escalation.location?.name || "Washroom"}`,
                body: `Cleaning for ${escalation.location?.name || "Washroom"} remains pending and requires immediate attention.`
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
 * Enforces cleaner identity guard clause, calculates business_date in IST,
 * and auto-correlates reviews to active OPEN escalations.
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
                cleaner_user_id: true,
                created_at: true,
                score: true,
                review_type: true,
                attempt_no: true,
                escalation_id: true,
                parent_review_id: true,
                is_latest: true
            }
        });

        if (!review) {
            return { evaluated: false, reason: "Review record not found" };
        }

        // =========================================================================
        // FOUNDATIONAL RULE: CLEANER IDENTITY GUARD CLAUSE
        // =========================================================================
        if (!review.cleaner_user_id) {
            console.warn(`⚠️ [SLA] Review #${reviewIdBigInt} has no cleaner_user_id. Skipping SLA evaluation (anonymous/unattributed review).`);
            return { evaluated: false, reason: "NO_CLEANER_USER_ID" };
        }

        const cleanerUserId = review.cleaner_user_id;
        const effectiveCompanyId = companyId || review.company_id;

        // 2. Resolve effective washroom SLA
        const effectiveSla = await resolveEffectiveWashroomSLA(locIdBigInt, effectiveCompanyId);

        if (!effectiveSla || !effectiveSla.enabled) {
            return { evaluated: true, breached: false, reason: effectiveSla?.reason || "SLA_DISABLED" };
        }

        const threshold = Number(effectiveSla.threshold ?? 8.0);

        // 3. Compute business_date in Indian Standard Time (UTC+5:30)
        const reviewCreatedAt = review.created_at ? new Date(review.created_at) : new Date();
        const istOffsetMs = 5.5 * 60 * 60 * 1000;
        const istDate = new Date(reviewCreatedAt.getTime() + istOffsetMs);
        const businessDate = new Date(Date.UTC(istDate.getUTCFullYear(), istDate.getUTCMonth(), istDate.getUTCDate()));

        console.log(`\n🔍 [SLA EVALUATION] Review #${reviewIdBigInt} | Cleaner #${cleanerUserId} | Location #${locIdBigInt}`);
        console.log(`   Business Date (IST): ${businessDate.toISOString().slice(0, 10)} | Score: ${numericScore.toFixed(1)} / Threshold: ${threshold}`);

        // 4. Check if an active OPEN escalation exists for (cleaner_user_id + location_id + business_date)
        const activeEscalation = await prisma.sla_escalations.findFirst({
            where: {
                cleaner_user_id: cleanerUserId,
                location_id: locIdBigInt,
                business_date: businessDate,
                state: "OPEN"
            }
        });

        // =========================================================================
        // SCENARIO 1: ACTIVE OPEN ESCALATION EXISTS -> AUTOMATIC RETRY FLOW
        // =========================================================================
        if (activeEscalation) {
            console.log(`🎯 [SLA RETRY DETECTED] Found active OPEN Escalation #${activeEscalation.id}. Processing as RETRY.`);
            return await handleSlaRetry({
                review,
                activeEscalation,
                effectiveSla,
                score: numericScore,
                threshold,
                cleanerUserId
            });
        }

        // =========================================================================
        // SCENARIO 2: NO OPEN ESCALATION -> ORIGINAL REVIEW FLOW
        // =========================================================================
        if (numericScore >= threshold) {
            console.log(`✅ [SLA PASS] Original Review #${reviewIdBigInt} meets threshold (${numericScore.toFixed(1)} >= ${threshold}).`);
            await prisma.cleaner_review.update({
                where: { id: reviewIdBigInt },
                data: {
                    review_type: "ORIGINAL",
                    attempt_no: 1,
                    is_latest: true
                }
            });
            return { evaluated: true, breached: false, status: "PASS", score: numericScore, threshold };
        }

        // Score failed threshold -> CREATE NEW ESCALATION
        const newEscalation = await createSlaEscalation({
            review,
            effectiveSla,
            score: numericScore,
            threshold,
            cleanerUserId,
            businessDate
        });

        return {
            evaluated: true,
            breached: true,
            status: "ESCALATION_CREATED",
            escalationId: newEscalation.id.toString()
        };
    } catch (error) {
        console.error("❌ [SLA EVALUATION ERROR]:", error);
        return { evaluated: false, error: error.message };
    }
};
