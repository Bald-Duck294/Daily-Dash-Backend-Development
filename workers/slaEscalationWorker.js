import cron from "node-cron";
import prisma from "../config/prismaClient.mjs";
import { advanceEscalationLevel } from "../services/slaEscalationService.js";

let isProcessing = false;

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
        // Find all active OPEN escalations where due_at <= NOW
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
            // Heartbeat log can be kept concise
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

// Standalone execution support: node workers/slaEscalationWorker.js
const isDirectExecution = import.meta.url.endsWith(process.argv[1]?.replace(/\\/g, "/") || "");
if (isDirectExecution || process.env.RUN_SLA_WORKER_STANDALONE === "true") {
    console.log("▶️ [SLA WORKER] Running in standalone daemon mode...");
    startSlaEscalationWorker();
}
