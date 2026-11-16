import prisma from "../config/prismaClient.mjs";

export const getPenalties = async (company_id, {
  status,
  cleaner_id,
  location_id,
  scope,
  start_date,
  end_date,
  page = 1,
  limit = 20,
  currentUser = null
} = {}) => {
  const companyIdBigInt = BigInt(company_id);
  const where = { company_id: companyIdBigInt };

  // Role-based visibility scoping:
  // Admin (role_id 1 & 2): Full visibility of ALL company SLA activities
  // Supervisor (role_id 3 & 7): Receives entries for locations they supervise in cleaner_assignments or assigned as approver
  // Cleaner (role_id 5): Receives only their own penalty deductions
  if (currentUser) {
    const roleId = Number(currentUser.role_id);
    const userIdBigInt = currentUser.id ? BigInt(currentUser.id) : null;

    if (userIdBigInt && (roleId === 3 || roleId === 7)) {
      const supAssignments = await prisma.cleaner_assignments.findMany({
        where: {
          cleaner_user_id: userIdBigInt,
          role_id: { in: [3, 7] },
          deleted_at: null,
          location_id: { not: null }
        },
        select: { location_id: true }
      });
      const locationIds = supAssignments.map((a) => a.location_id).filter(Boolean);

      where.OR = [
        { assigned_approver_id: userIdBigInt },
        { location_id: { in: locationIds } }
      ];
    } else if (userIdBigInt && roleId === 5) {
      where.cleaner_user_id = userIdBigInt;
    }
  }

  if (status && status !== "ALL") {
    where.status = String(status).toUpperCase();
  }
  if (cleaner_id && cleaner_id !== "ALL") {
    where.cleaner_user_id = BigInt(cleaner_id);
  }
  if (location_id && location_id !== "ALL") {
    where.location_id = BigInt(location_id);
  }
  if (scope && scope !== "ALL") {
    where.scope = String(scope).toUpperCase();
  }
  if (start_date || end_date) {
    where.business_date = {};
    if (start_date) where.business_date.gte = new Date(start_date);
    if (end_date) where.business_date.lte = new Date(end_date);
  }

  const skip = (Number(page) - 1) * Number(limit);
  const take = Number(limit);

  const [penalties, total] = await Promise.all([
    prisma.cleaner_penalties.findMany({
      where,
      skip,
      take,
      orderBy: { created_at: "desc" },
      include: {
        cleaner_user: {
          select: { id: true, name: true, email: true, phone: true }
        },
        location: {
          select: { id: true, name: true, address: true, city: true }
        },
        rule: {
          select: {
            id: true,
            rule_code: true,
            name: true,
            violation_category: true,
            scope: true,
            calculation_method: true
          }
        },
        violation: {
          select: {
            id: true,
            score: true,
            threshold: true,
            evidence_references: true,
            occurrence_time: true
          }
        },
        assigned_approver: {
          select: { id: true, name: true, email: true }
        },
        approver_user: {
          select: { id: true, name: true, email: true }
        }
      }
    }),
    prisma.cleaner_penalties.count({ where })
  ]);

  return {
    penalties,
    total,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(total / take)
  };
};

export const getPenaltySummary = async (company_id, { start_date, end_date, cleaner_id, currentUser = null } = {}) => {
  const companyIdBigInt = BigInt(company_id);
  const where = { company_id: companyIdBigInt };

  if (cleaner_id) {
    where.cleaner_user_id = BigInt(cleaner_id);
  }

  if (currentUser) {
    const roleId = Number(currentUser.role_id);
    const userIdBigInt = currentUser.id ? BigInt(currentUser.id) : null;

    if (userIdBigInt && (roleId === 3 || roleId === 7)) {
      const supAssignments = await prisma.cleaner_assignments.findMany({
        where: {
          cleaner_user_id: userIdBigInt,
          role_id: { in: [3, 7] },
          deleted_at: null,
          location_id: { not: null }
        },
        select: { location_id: true }
      });
      const locationIds = supAssignments.map((a) => a.location_id).filter(Boolean);

      where.OR = [
        { assigned_approver_id: userIdBigInt },
        { location_id: { in: locationIds } }
      ];
    } else if (userIdBigInt && roleId === 5) {
      where.cleaner_user_id = userIdBigInt;
    }
  }

  if (start_date || end_date) {
    where.business_date = {};
    if (start_date) where.business_date.gte = new Date(start_date);
    if (end_date) where.business_date.lte = new Date(end_date);
  }

  const penalties = await prisma.cleaner_penalties.findMany({
    where,
    select: {
      status: true,
      calculated_amount: true,
      approved_amount: true
    }
  });

  const summary = {
    total_count: penalties.length,
    pending_count: 0,
    approved_count: 0,
    rejected_count: 0,
    disputed_count: 0,
    reversed_count: 0,
    total_calculated_amount: 0,
    total_approved_amount: 0,
    pending_amount: 0
  };

  for (const p of penalties) {
    const calc = Number(p.calculated_amount || 0);
    const apprv = Number(p.approved_amount || 0);
    summary.total_calculated_amount += calc;

    switch (p.status) {
      case "PENDING":
      case "UNDER_REVIEW":
        summary.pending_count++;
        summary.pending_amount += calc;
        break;
      case "APPROVED":
        summary.approved_count++;
        summary.total_approved_amount += apprv;
        break;
      case "REJECTED":
        summary.rejected_count++;
        break;
      case "DISPUTED":
        summary.disputed_count++;
        summary.pending_amount += calc;
        break;
      case "REVERSED":
        summary.reversed_count++;
        break;
      default:
        break;
    }
  }

  summary.total_calculated_amount = Number(summary.total_calculated_amount.toFixed(2));
  summary.total_approved_amount = Number(summary.total_approved_amount.toFixed(2));
  summary.pending_amount = Number(summary.pending_amount.toFixed(2));

  return summary;
};

export const getPenaltyById = async (id, company_id) => {
  const penalty = await prisma.cleaner_penalties.findFirst({
    where: {
      id: BigInt(id),
      company_id: BigInt(company_id)
    },
    include: {
      cleaner_user: {
        select: { id: true, name: true, email: true, phone: true }
      },
      location: {
        select: { id: true, name: true, address: true, city: true, code: true }
      },
      rule: true,
      violation: true,
      review: {
        select: {
          id: true,
          score: true,
          attempt_no: true,
          review_type: true,
          before_photo: true,
          after_photo: true,
          initial_comment: true,
          final_comment: true,
          created_at: true
        }
      },
      logs: {
        orderBy: { created_at: "asc" },
        include: {
          actor_user: {
            select: { id: true, name: true, email: true }
          }
        }
      },
      assigned_approver: {
        select: { id: true, name: true, email: true }
      },
      approver_user: {
        select: { id: true, name: true, email: true }
      }
    }
  });

  if (!penalty) {
    throw new Error(`Penalty #${id} not found for company #${company_id}`);
  }

  return penalty;
};

export const approvePenalty = async (id, company_id, actorUser, { approved_amount, comment } = {}) => {
  const penaltyId = BigInt(id);
  const companyIdBigInt = BigInt(company_id);

  const penalty = await prisma.cleaner_penalties.findFirst({
    where: { id: penaltyId, company_id: companyIdBigInt }
  });

  if (!penalty) {
    throw new Error(`Penalty #${id} not found`);
  }

  if (["APPROVED", "REJECTED", "REVERSED"].includes(penalty.status)) {
    throw new Error(`Cannot approve penalty with status "${penalty.status}"`);
  }

  const finalAmount = approved_amount !== undefined && approved_amount !== null
    ? Number(approved_amount)
    : Number(penalty.calculated_amount);

  const updated = await prisma.$transaction(async (tx) => {
    const p = await tx.cleaner_penalties.update({
      where: { id: penaltyId },
      data: {
        status: "APPROVED",
        approval_stage: "APPROVED",
        approved_amount: finalAmount,
        approver_user_id: actorUser?.id ? BigInt(actorUser.id) : null,
        approved_at: new Date()
      }
    });

    await tx.cleaner_penalty_logs.create({
      data: {
        penalty_id: penaltyId,
        actor_user_id: actorUser?.id ? BigInt(actorUser.id) : null,
        action: "APPROVED",
        previous_status: penalty.status,
        new_status: "APPROVED",
        previous_amount: penalty.approved_amount,
        new_amount: finalAmount,
        comment: comment || `Penalty approved by ${actorUser?.name || "Authorized Approver"}`
      }
    });

    return p;
  });

  return updated;
};

export const rejectPenalty = async (id, company_id, actorUser, { rejection_reason } = {}) => {
  const penaltyId = BigInt(id);
  const companyIdBigInt = BigInt(company_id);

  const penalty = await prisma.cleaner_penalties.findFirst({
    where: { id: penaltyId, company_id: companyIdBigInt }
  });

  if (!penalty) {
    throw new Error(`Penalty #${id} not found`);
  }

  if (["REJECTED", "REVERSED"].includes(penalty.status)) {
    throw new Error(`Cannot reject penalty with status "${penalty.status}"`);
  }

  const reason = rejection_reason || "Rejected by supervisor inspection";

  const updated = await prisma.$transaction(async (tx) => {
    const p = await tx.cleaner_penalties.update({
      where: { id: penaltyId },
      data: {
        status: "REJECTED",
        approval_stage: "REJECTED",
        approved_amount: 0,
        rejection_reason: reason,
        approver_user_id: actorUser?.id ? BigInt(actorUser.id) : null
      }
    });

    await tx.cleaner_penalty_logs.create({
      data: {
        penalty_id: penaltyId,
        actor_user_id: actorUser?.id ? BigInt(actorUser.id) : null,
        action: "REJECTED",
        previous_status: penalty.status,
        new_status: "REJECTED",
        previous_amount: penalty.approved_amount,
        new_amount: 0,
        comment: reason
      }
    });

    return p;
  });

  return updated;
};

export const disputePenalty = async (id, company_id, actorUser, { dispute_reason } = {}) => {
  const penaltyId = BigInt(id);
  const companyIdBigInt = BigInt(company_id);

  const penalty = await prisma.cleaner_penalties.findFirst({
    where: { id: penaltyId, company_id: companyIdBigInt }
  });

  if (!penalty) {
    throw new Error(`Penalty #${id} not found`);
  }

  const reason = dispute_reason || "Cleaner filed a dispute against deduction";

  const updated = await prisma.$transaction(async (tx) => {
    const p = await tx.cleaner_penalties.update({
      where: { id: penaltyId },
      data: {
        status: "DISPUTED",
        approval_stage: "DISPUTED",
        dispute_reason: reason,
        disputed_at: new Date()
      }
    });

    await tx.cleaner_penalty_logs.create({
      data: {
        penalty_id: penaltyId,
        actor_user_id: actorUser?.id ? BigInt(actorUser.id) : null,
        action: "DISPUTED",
        previous_status: penalty.status,
        new_status: "DISPUTED",
        previous_amount: penalty.approved_amount,
        new_amount: penalty.approved_amount,
        comment: reason
      }
    });

    return p;
  });

  return updated;
};

export const reversePenalty = async (id, company_id, actorUser, { reversal_reason } = {}) => {
  const penaltyId = BigInt(id);
  const companyIdBigInt = BigInt(company_id);

  const penalty = await prisma.cleaner_penalties.findFirst({
    where: { id: penaltyId, company_id: companyIdBigInt }
  });

  if (!penalty) {
    throw new Error(`Penalty #${id} not found`);
  }

  const reason = reversal_reason || "Management decision: reversed deduction";

  const updated = await prisma.$transaction(async (tx) => {
    const p = await tx.cleaner_penalties.update({
      where: { id: penaltyId },
      data: {
        status: "REVERSED",
        approval_stage: "REVERSED",
        approved_amount: 0,
        reversal_reason: reason
      }
    });

    await tx.cleaner_penalty_logs.create({
      data: {
        penalty_id: penaltyId,
        actor_user_id: actorUser?.id ? BigInt(actorUser.id) : null,
        action: "REVERSED",
        previous_status: penalty.status,
        new_status: "REVERSED",
        previous_amount: penalty.approved_amount,
        new_amount: 0,
        comment: reason
      }
    });

    return p;
  });

  return updated;
};

export const getViolations = async (company_id, { cleaner_id, location_id, page = 1, limit = 20, currentUser = null } = {}) => {
  const companyIdBigInt = BigInt(company_id);
  const where = { company_id: companyIdBigInt };

  if (currentUser) {
    const roleId = Number(currentUser.role_id);
    const userIdBigInt = currentUser.id ? BigInt(currentUser.id) : null;

    if (userIdBigInt && (roleId === 3 || roleId === 7)) {
      const supAssignments = await prisma.cleaner_assignments.findMany({
        where: {
          cleaner_user_id: userIdBigInt,
          role_id: { in: [3, 7] },
          deleted_at: null,
          location_id: { not: null }
        },
        select: { location_id: true }
      });
      const locationIds = supAssignments.map((a) => a.location_id).filter(Boolean);

      where.location_id = { in: locationIds };
    } else if (userIdBigInt && roleId === 5) {
      where.cleaner_id = userIdBigInt;
    }
  }

  if (cleaner_id && cleaner_id !== "ALL") {
    where.cleaner_user_id = BigInt(cleaner_id);
  }
  if (location_id && location_id !== "ALL") {
    where.location_id = BigInt(location_id);
  }

  const skip = (Number(page) - 1) * Number(limit);
  const take = Number(limit);

  const [violations, total] = await Promise.all([
    prisma.sla_violations.findMany({
      where,
      skip,
      take,
      orderBy: { created_at: "desc" },
      include: {
        cleaner_user: {
          select: { id: true, name: true, email: true }
        },
        location: {
          select: { id: true, name: true, address: true }
        },
        rule: {
          select: { id: true, rule_code: true, name: true, violation_category: true }
        }
      }
    }),
    prisma.sla_violations.count({ where })
  ]);

  return {
    violations,
    total,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(total / take)
  };
};

