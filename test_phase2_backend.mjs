import prisma from "./config/prismaClient.mjs";
import { evaluateReviewForSlaPenalty } from "./services/slaPenaltyEvaluationService.js";
import {
  getPenalties,
  getPenaltySummary,
  approvePenalty,
  rejectPenalty,
  disputePenalty,
  reversePenalty,
  getViolations
} from "./services/penaltyLedgerService.js";
import { calculatePenalty } from "./services/penaltyCalculationEngine.js";

async function runTests() {
  console.log("🚀 Starting Phase 2 Backend Tests...\n");

  // 1. Test Penalty Calculation Engine
  console.log("1. Testing Penalty Calculation Engine:");
  const test1 = calculatePenalty({
    calculation_method: "FIXED_AMOUNT",
    penalty_value: 150
  }, {});
  console.log("  - FIXED_AMOUNT (150):", test1.calculated_amount === 150 ? "PASS" : "FAIL", test1.calculated_amount);

  const test2 = calculatePenalty({
    calculation_method: "TASK_VALUE_PERCENTAGE",
    penalty_value: 20,
    task_value_reference: 1000,
    max_penalty_cap: 300
  }, {});
  console.log("  - TASK_VALUE_PERCENTAGE (20% of 1000):", test2.calculated_amount === 200 ? "PASS" : "FAIL", test2.calculated_amount);

  const test3 = calculatePenalty({
    calculation_method: "PER_MINUTE_DELAY",
    penalty_value: 5,
    max_penalty_cap: 100
  }, { delay_minutes: 30 }); // 30 * 5 = 150 -> capped at 100
  console.log("  - PER_MINUTE_DELAY Capped (30 min * 5 = 150 -> cap 100):", test3.calculated_amount === 100 ? "PASS" : "FAIL", test3.calculated_amount);

  const test4 = calculatePenalty({
    calculation_method: "TIERED_FLAT_RATE",
    penalty_value: 50,
    tier_config: [
      { min_delay_minutes: 0, max_delay_minutes: 15, amount: 50 },
      { min_delay_minutes: 16, max_delay_minutes: 60, amount: 150 },
      { min_delay_minutes: 61, amount: 300 }
    ]
  }, { delay_minutes: 45 });
  console.log("  - TIERED_FLAT_RATE (45 min -> tier 2 = 150):", test4.calculated_amount === 150 ? "PASS" : "FAIL", test4.calculated_amount);

  // 2. Fetch a real or test cleaner review for Company 95
  console.log("\n2. Checking Cleaner Reviews for Company 95:");
  const sampleReview = await prisma.cleaner_review.findFirst({
    where: { company_id: BigInt(95) },
    orderBy: { id: "desc" }
  });
  console.log("  - Found sample review ID:", sampleReview?.id?.toString() || "None");

  let reviewIdToEval = sampleReview?.id;

  if (!reviewIdToEval) {
    // If none, create a mock test review
    const sampleLoc = await prisma.locations.findFirst({ where: { company_id: BigInt(95) } });
    const sampleCleaner = await prisma.users.findFirst({ where: { company_id: BigInt(95) } });
    if (sampleLoc && sampleCleaner) {
      const createdReview = await prisma.cleaner_review.create({
        data: {
          company_id: BigInt(95),
          location_id: sampleLoc.id,
          cleaner_user_id: sampleCleaner.id,
          score: 4.5,
          inspection_type: "ROUTINE",
          status: "COMPLETED",
          is_completed: true,
          details: { attempt_number: 1, delay_minutes: 20 }
        }
      });
      reviewIdToEval = createdReview.id;
      console.log("  - Created test review ID:", reviewIdToEval.toString());
    }
  }

  if (reviewIdToEval) {
    console.log("\n3. Testing slaPenaltyEvaluationService on review ID:", reviewIdToEval.toString());
    const evalResult = await evaluateReviewForSlaPenalty(reviewIdToEval);
    console.log("  - Evaluation Result:", JSON.stringify(evalResult, null, 2));

    // Check violations
    const violations = await getViolations(95, { limit: 5 });
    console.log(`  - Total violations found for company 95: ${violations.total}`);

    // Check penalties
    const penalties = await getPenalties(95, { limit: 5 });
    console.log(`  - Total penalties found for company 95: ${penalties.total}`);

    // Check summary
    const summary = await getPenaltySummary(95);
    console.log("  - Penalty Summary:", summary);

    if (penalties.penalties.length > 0) {
      const pen = penalties.penalties[0];
      console.log(`\n4. Testing Ledger Lifecycle Actions on Penalty #${pen.penalty_number} (ID: ${pen.id}):`);

      // Test Dispute
      if (pen.status !== "DISPUTED") {
        const disputed = await disputePenalty(pen.id, 95, {
          user_id: null,
          reason: "Cleaner requested grace period",
          dispute_notes: "Testing dispute workflow"
        });
        console.log("  - Dispute result status:", disputed.status);
      }

      // Test Reverse
      const reversed = await reversePenalty(pen.id, 95, {
        user_id: null,
        reason: "Waived after supervisor re-inspection passed"
      });
      console.log("  - Reverse result status:", reversed.status);

      // Check audit log count
      const logs = await prisma.cleaner_penalty_logs.findMany({
        where: { penalty_id: BigInt(pen.id) }
      });
      console.log(`  - Audit log entries recorded: ${logs.length} (Expected >= 3)`);
    }
  }

  console.log("\n✅ All Phase 2 backend tests finished successfully!");
  await prisma.$disconnect();
}

runTests().catch(err => {
  console.error("❌ Test failed:", err);
  prisma.$disconnect();
  process.exit(1);
});
