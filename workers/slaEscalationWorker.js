import "dotenv/config";
import cron from "node-cron";
import dotenv from "dotenv";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { fileURLToPath } from "url";
import path from "path";
import prisma from "../config/prismaClient.mjs";
import { advanceEscalationLevel, evaluateReviewSla } from "../services/slaEscalationService.js";

let isProcessing = false;

/**
 * Ensures Firebase Admin is initialized if environment variables are present.
 */
function initFirebaseIfConfigured() {
    if (getApps().length === 0 && process.env.FIREBASE_PROJECT_ID) {
        const serviceAccount = {
            type: process.env.FIREBASE_TYPE,
            project_id: process.env.FIREBASE_PROJECT_ID,
            private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
            private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
            client_email: process.env.FIREBASE_CLIENT_EMAIL,
            client_id: process.env.FIREBASE_CLIENT_ID,
            auth_uri: process.env.FIREBASE_AUTH_URI,
            token_uri: process.env.FIREBASE_TOKEN_URI,
            auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_CERT_URL,
            client_x509_cert_url: process.env.FIREBASE_CLIENT_CERT_URL,
            universe_domain: process.env.FIREBASE_UNIVERSE_DOMAIN,
        };
        try {
            initializeApp({
                credential: cert(serviceAccount),
            });
            console.log("🔥 [SLA WORKER] Firebase Admin initialized for push notifications.");
        } catch (err) {
            console.warn("⚠️ [SLA WORKER] Firebase initialization skipped or failed:", err.message);
        }
    }
}

/**
 * Halts active escalation timers on open escalations from prior business dates (Day-Boundary Guard).
 */
async function processDayBoundaryExpirations() {
    try {
        const istOffsetMs = 5.5 * 60 * 60 * 1000;
        const istDate = new Date(Date.now() + istOffsetMs);
        const todayDate = new Date(Date.UTC(istDate.getUTCFullYear(), istDate.getUTCMonth(), istDate.getUTCDate()));

        const priorOpenEscalations = await prisma.sla_escalations.findMany({
            where: {
                state: "OPEN",
                business_date: { lt: todayDate },
                due_at: { not: null }
            },
            select: { id: true, current_level: true, business_date: true }
        });

        if (priorOpenEscalations.length > 0) {
            console.log(`🌅 [SLA WORKER] Halting active timers for ${priorOpenEscalations.length} unresolved escalation(s) from prior business dates...`);
            for (const esc of priorOpenEscalations) {
                await prisma.sla_escalations.update({
                    where: { id: esc.id },
                    data: { due_at: null }
                });
            }
        }
    } catch (err) {
        console.error("❌ [SLA WORKER] Error in day-boundary expiration check:", err.message);
    }
}

/**
 * Scans for recent completed cleaner reviews that have not yet been evaluated by the SLA engine.
 * Filters out reviews that have already been evaluated (sla_evaluated = true) to prevent infinite loops.
 */
async function scanUnevaluatedBreaches() {
    try {
        const sinceDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // Past 24 hours

        // Query only unlinked reviews that have not yet been evaluated
        const unlinkedReviews = await prisma.$queryRaw`
            SELECT id, company_id, location_id, cleaner_user_id, score, created_at, parent_review_id
            FROM cleaner_review
            WHERE status = 'completed'
              AND score IS NOT NULL
              AND cleaner_user_id IS NOT NULL
              AND location_id IS NOT NULL
              AND company_id IS NOT NULL
              AND escalation_id IS NULL
              AND COALESCE(sla_evaluated, FALSE) = FALSE
              AND created_at >= ${sinceDate}
            ORDER BY created_at ASC
            LIMIT 20
        `;

        if (!unlinkedReviews || unlinkedReviews.length === 0) {
            return 0;
        }

        console.log(`🔎 [SLA SCANNER] Found ${unlinkedReviews.length} unevaluated completed review(s). Processing...`);

        let evaluatedCount = 0;
        for (const rev of unlinkedReviews) {
            try {
                const result = await evaluateReviewSla({
                    reviewId: rev.id,
                    locationId: rev.location_id,
                    companyId: rev.company_id,
                    score: rev.score
                });

                // Mark review as evaluated so it is never re-scanned
                await prisma.$executeRaw`
                    UPDATE cleaner_review
                    SET sla_evaluated = TRUE
                    WHERE id = ${rev.id}
                `;

                if (result.evaluated && result.breached) {
                    evaluatedCount++;
                }
            } catch (err) {
                console.error(`❌ [SLA SCANNER] Error evaluating Review #${rev.id}:`, err.message);
            }
        }
        return evaluatedCount;
    } catch (error) {
        console.error("❌ [SLA SCANNER ERROR]:", error.message);
        return 0;
    }
}

/**
 * Core execution loop for processing due SLA escalations.
 * Finds all OPEN escalations whose due_at timestamp is in the past.
 */
export async function processDueSlaEscalations() {
    if (isProcessing) {
        console.log("⏳ [SLA WORKER] Previous cron run still in progress. Skipping this cycle.");
        return { processed: 0, skipped: true };
    }

    isProcessing = true;
    const now = new Date();

    try {
        // Ensure Firebase is ready for notifications
        initFirebaseIfConfigured();

        // 1. Day boundary guard: close timers on escalations from prior days
        await processDayBoundaryExpirations();

        // 2. Auto-discover and evaluate any newly completed reviews that breached SLA
        await scanUnevaluatedBreaches();

        // 3. Find all active OPEN escalations where due_at <= NOW
        const dueEscalations = await prisma.sla_escalations.findMany({
            where: {
                state: "OPEN",
                due_at: {
                    lte: now,
                    not: null
                }
            },
            select: {
                id: true,
                company_id: true,
                location_id: true,
                current_level: true,
                max_level: true,
                due_at: true
            },
            orderBy: {
                due_at: "asc"
            }
        });

        if (dueEscalations.length === 0) {
            console.log(`💓 [SLA WORKER HEARTBEAT] Cron active at ${now.toISOString()} | 0 due escalations to process.`);
            return { processed: 0, count: 0 };
        }

        console.log(`\n⏰ [SLA WORKER] Found ${dueEscalations.length} due escalation(s) at ${now.toISOString()}`);

        let successCount = 0;
        let failCount = 0;

        for (const item of dueEscalations) {
            const escalationId = item.id;
            try {
                console.log(`➡️ [SLA WORKER] Processing Escalation #${escalationId} (Current Level: ${item.current_level}/${item.max_level}, Due At: ${item.due_at?.toISOString()})...`);
                
                const result = await advanceEscalationLevel(escalationId);

                if (result.advanced) {
                    console.log(`✅ [SLA WORKER] Successfully advanced Escalation #${escalationId} to Level ${result.newLevel}.`);
                    successCount++;
                } else {
                    console.log(`ℹ️ [SLA WORKER] Escalation #${escalationId} was not advanced (${result.reason}).`);
                }
            } catch (itemError) {
                // Per-record error handling ensures one bad record does not halt the entire batch
                failCount++;
                console.error(`❌ [SLA WORKER] Error processing Escalation #${escalationId}:`, itemError.message);
            }
        }

        console.log(`🏁 [SLA WORKER] Cycle complete. Processed: ${dueEscalations.length} | Succeeded: ${successCount} | Failed: ${failCount}\n`);
        return { processed: dueEscalations.length, succeeded: successCount, failed: failCount };
    } catch (err) {
        console.error("❌ [SLA WORKER CRON ERROR]:", err);
        return { processed: 0, error: err.message };
    } finally {
        isProcessing = false;
    }
}

/**
 * Initializes the node-cron scheduler to run every 60 seconds (* * * * *).
 */
export function startSlaEscalationWorker() {
    console.log("🚀 [SLA WORKER] Escalation cron worker initialized (Schedule: every 60s)");

    // Run every minute
    const task = cron.schedule("* * * * *", async () => {
        try {
            await processDueSlaEscalations();
        } catch (error) {
            console.error("❌ [SLA WORKER] Uncaught error in cron iteration:", error);
        }
    });

    return task;
}

/**
 * One-shot runner for Render Cron Jobs or CLI manual triggers.
 * Runs one scan/escalation cycle, disconnects database, and cleanly exits with appropriate status code.
 * Does NOT start node-cron or any persistent background timers.
 */
export async function runOnce() {
    dotenv.config();
    initFirebaseIfConfigured();

    console.log("🏁 [SLA WORKER] Starting one-shot SLA escalation cycle (Render Cron / CLI mode)...");
    try {
        const result = await processDueSlaEscalations();
        if (result && result.error) {
            console.error("❌ [SLA WORKER] One-shot cycle encountered an error:", result.error);
            await prisma.$disconnect();
            process.exit(1);
        }
        console.log("✅ [SLA WORKER] One-shot SLA escalation cycle completed successfully.");
        await prisma.$disconnect();
        process.exit(0);
    } catch (err) {
        console.error("❌ [SLA WORKER] Fatal error during one-shot SLA escalation execution:", err);
        try {
            await prisma.$disconnect();
        } catch (_) {}
        process.exit(1);
    }
}

// Standalone execution support: `node workers/slaEscalationWorker.js`
const currentFilePath = fileURLToPath(import.meta.url);
const isDirectExecution = Boolean(
    process.argv[1] && (
        path.resolve(process.argv[1]).toLowerCase() === path.resolve(currentFilePath).toLowerCase() ||
        currentFilePath.toLowerCase().endsWith(process.argv[1].toLowerCase().replace(/\\/g, "/"))
    )
);

if (isDirectExecution || process.env.RUN_SLA_WORKER_ONCE === "true") {
    runOnce();
}
