import prisma from "../config/prismaClient.mjs";

/**
 * Helper to safely serialize BigInts, Dates, and nested objects
 */
const safeSerialize = (obj) => {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj === "bigint") return obj.toString();
    if (obj instanceof Date) return obj.toISOString();
    // Support Prisma Decimal objects
    if (typeof obj === "object" && typeof obj.toNumber === "function") {
        return obj.toNumber();
    }
    if (typeof obj === "object" && (obj.s !== undefined && obj.e !== undefined && Array.isArray(obj.d))) {
        const num = Number(obj);
        return isNaN(num) ? null : num;
    }
    if (Array.isArray(obj)) return obj.map(safeSerialize);
    if (typeof obj === "object") {
        const serialized = {};
        for (const [key, value] of Object.entries(obj)) {
            serialized[key] = safeSerialize(value);
        }
        return serialized;
    }
    return obj;
};

/**
 * Parses date preset or custom range into { fromDate, toDate }
 */
function parseDateFilters(datePreset, startDate, endDate) {
    let fromDate = null;
    let toDate = null;

    if (datePreset === "today") {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayEnd = new Date();
        todayEnd.setHours(23, 59, 59, 999);
        fromDate = todayStart;
        toDate = todayEnd;
    } else if (datePreset === "week" || datePreset === "7days" || datePreset === "last7days") {
        const weekStart = new Date();
        weekStart.setDate(weekStart.getDate() - 7);
        weekStart.setHours(0, 0, 0, 0);
        const weekEnd = new Date();
        weekEnd.setHours(23, 59, 59, 999);
        fromDate = weekStart;
        toDate = weekEnd;
    } else if (datePreset === "month" || datePreset === "30days" || datePreset === "last30days") {
        const monthStart = new Date();
        monthStart.setDate(monthStart.getDate() - 30);
        monthStart.setHours(0, 0, 0, 0);
        const monthEnd = new Date();
        monthEnd.setHours(23, 59, 59, 999);
        fromDate = monthStart;
        toDate = monthEnd;
    } else if (startDate || endDate) {
        if (startDate) {
            fromDate = new Date(startDate);
            fromDate.setHours(0, 0, 0, 0);
        }
        if (endDate) {
            toDate = new Date(endDate);
            toDate.setHours(23, 59, 59, 999);
        }
    }

    return { fromDate, toDate };
}

/**
 * GET /api/sla-logs/incidents
 * Retrieves paginated, filterable SLA Incidents (1 incident = 1 sla_escalations record)
 */
export async function getSlaIncidents(req, res) {
    try {
        const {
            company_id,
            companyId,
            cleaner_user_id,
            cleanerId,
            location_id,
            locationId,
            state,
            status,
            tier,
            level,
            datePreset,
            startDate,
            endDate,
            search,
            page = 1,
            limit = 15,
            sort = "desc"
        } = req.query;

        const effectiveCompanyId = company_id || companyId || (req.user?.role_id !== 1 ? req.user?.company_id : null);
        const effectiveCleanerId = cleaner_user_id || cleanerId;
        const effectiveLocationId = location_id || locationId;
        const effectiveState = state || status;
        const effectiveTier = tier || level;

        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const pageSize = Math.max(1, Math.min(100, parseInt(limit, 10) || 15));
        const skip = (pageNum - 1) * pageSize;

        const where = {};

        // 1. Company Filter
        if (effectiveCompanyId) {
            where.company_id = BigInt(effectiveCompanyId);
        }

        // 2. Cleaner Filter
        if (effectiveCleanerId && effectiveCleanerId !== "all") {
            where.cleaner_user_id = BigInt(effectiveCleanerId);
        }

        // 3. Location Filter
        if (effectiveLocationId && effectiveLocationId !== "all") {
            where.location_id = BigInt(effectiveLocationId);
        }

        // 4. State / Status Filter
        if (effectiveState && effectiveState !== "all") {
            where.state = String(effectiveState).toUpperCase();
        }

        // 5. Tier / Current Level Filter
        if (effectiveTier && effectiveTier !== "all") {
            where.current_level = parseInt(effectiveTier, 10);
        }

        // 6. Date Range Filter
        const { fromDate, toDate } = parseDateFilters(datePreset, startDate, endDate);
        if (fromDate || toDate) {
            where.created_at = {};
            if (fromDate && !isNaN(fromDate.getTime())) {
                where.created_at.gte = fromDate;
            }
            if (toDate && !isNaN(toDate.getTime())) {
                where.created_at.lte = toDate;
            }
        }

        // 7. Search Filter (by cleaner name, location name)
        if (search && search.trim()) {
            const term = search.trim();
            where.OR = [
                { location: { name: { contains: term, mode: "insensitive" } } },
                { cleaner_user: { name: { contains: term, mode: "insensitive" } } }
            ];
        }

        // Execute total count & paginated fetch in parallel
        const [total, rawIncidents, summaryStats] = await Promise.all([
            prisma.sla_escalations.count({ where }),
            prisma.sla_escalations.findMany({
                where,
                skip,
                take: pageSize,
                orderBy: {
                    created_at: sort === "asc" ? "asc" : "desc"
                },
                include: {
                    location: {
                        select: {
                            id: true,
                            name: true,
                            code: true,
                            address: true,
                            city: true
                        }
                    },
                    cleaner_user: {
                        select: {
                            id: true,
                            name: true,
                            email: true,
                            phone: true,
                            avatar_url: true
                        }
                    },
                    company: {
                        select: {
                            id: true,
                            name: true
                        }
                    },
                    triggered_by_review: {
                        select: {
                            id: true,
                            score: true,
                            original_score: true,
                            created_at: true,
                            status: true,
                            review_type: true,
                            attempt_no: true,
                            before_photo: true,
                            after_photo: true
                        }
                    },
                    resolved_by_review: {
                        select: {
                            id: true,
                            score: true,
                            created_at: true,
                            status: true
                        }
                    },
                    corrective_reviews: {
                        select: {
                            id: true,
                            score: true,
                            original_score: true,
                            created_at: true,
                            status: true,
                            review_type: true,
                            attempt_no: true,
                            is_latest: true,
                            before_photo: true,
                            after_photo: true
                        },
                        orderBy: {
                            attempt_no: "asc"
                        }
                    },
                    escalation_logs: {
                        select: {
                            id: true,
                            event_type: true,
                            level: true,
                            score: true,
                            review_id: true,
                            metadata: true,
                            created_at: true,
                            actor_user: {
                                select: {
                                    id: true,
                                    name: true,
                                    role: { select: { id: true, name: true } }
                                }
                            }
                        },
                        orderBy: {
                            created_at: "asc"
                        }
                    }
                }
            }),
            getIncidentSummaryStats(effectiveCompanyId, fromDate, toDate)
        ]);

        // Process and normalize incident review lists
        const incidents = rawIncidents.map(inc => {
            // Deduplicate and aggregate all reviews belonging to this escalation
            const reviewMap = new Map();
            if (inc.triggered_by_review) {
                reviewMap.set(inc.triggered_by_review.id.toString(), {
                    ...inc.triggered_by_review,
                    attempt_no: inc.triggered_by_review.attempt_no || 1,
                    review_type: inc.triggered_by_review.review_type || "ORIGINAL"
                });
            }
            if (Array.isArray(inc.corrective_reviews)) {
                inc.corrective_reviews.forEach(r => {
                    reviewMap.set(r.id.toString(), r);
                });
            }

            const reviewsList = Array.from(reviewMap.values()).sort((a, b) => {
                return (Number(a.attempt_no || 1) - Number(b.attempt_no || 1)) ||
                    (new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
            });

            // Determine best score in this chain
            let bestScore = null;
            reviewsList.forEach(r => {
                if (r.score !== null && r.score !== undefined && !isNaN(Number(r.score))) {
                    const sc = Number(r.score);
                    if (bestScore === null || sc > bestScore) {
                        bestScore = sc;
                    }
                }
            });

            // Target threshold from initial breach metadata if available
            const breachLog = inc.escalation_logs?.find(l => l.event_type === "SLA_BREACH");
            const threshold = breachLog?.metadata?.threshold || 8.0;

            return {
                id: inc.id.toString(),
                company_id: inc.company_id.toString(),
                location_id: inc.location_id.toString(),
                cleaner_user_id: inc.cleaner_user_id ? inc.cleaner_user_id.toString() : null,
                business_date: inc.business_date,
                current_level: inc.current_level,
                max_level: inc.max_level,
                state: inc.state,
                retry_count: inc.retry_count,
                max_retries: inc.max_retries,
                due_at: inc.due_at,
                created_at: inc.created_at,
                updated_at: inc.updated_at,
                resolved_at: inc.resolved_at,
                location: inc.location,
                cleaner_user: inc.cleaner_user,
                company: inc.company,
                best_score: bestScore,
                threshold: Number(threshold),
                total_attempts: reviewsList.length,
                reviews: reviewsList,
                logs_count: inc.escalation_logs?.length || 0,
                events: inc.escalation_logs || []
            };
        });

        const totalPages = Math.ceil(total / pageSize);

        return res.status(200).json({
            success: true,
            data: safeSerialize(incidents),
            pagination: {
                total,
                page: pageNum,
                limit: pageSize,
                totalPages,
                hasNextPage: pageNum < totalPages,
                hasPrevPage: pageNum > 1
            },
            summary: summaryStats
        });
    } catch (error) {
        console.error("❌ [GET SLA INCIDENTS ERROR]:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch SLA incidents",
            error: error.message
        });
    }
}

/**
 * GET /api/sla-logs/incidents/:id
 * Retrieves full single incident details including cleaning attempts, tier progression, and audit trail
 */
export async function getSlaIncidentById(req, res) {
    try {
        const { id } = req.params;
        if (!id) {
            return res.status(400).json({ success: false, message: "Incident ID is required" });
        }

        const incIdBigInt = BigInt(id);

        const inc = await prisma.sla_escalations.findUnique({
            where: { id: incIdBigInt },
            include: {
                location: {
                    select: {
                        id: true,
                        name: true,
                        code: true,
                        address: true,
                        city: true
                    }
                },
                cleaner_user: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                        phone: true,
                        avatar_url: true
                    }
                },
                company: {
                    select: {
                        id: true,
                        name: true
                    }
                },
                triggered_by_review: {
                    select: {
                        id: true,
                        score: true,
                        original_score: true,
                        created_at: true,
                        updated_at: true,
                        status: true,
                        review_type: true,
                        attempt_no: true,
                        before_photo: true,
                        after_photo: true,
                        tasks: true,
                        initial_comment: true,
                        final_comment: true
                    }
                },
                resolved_by_review: {
                    select: {
                        id: true,
                        score: true,
                        created_at: true,
                        status: true
                    }
                },
                corrective_reviews: {
                    select: {
                        id: true,
                        score: true,
                        original_score: true,
                        created_at: true,
                        updated_at: true,
                        status: true,
                        review_type: true,
                        attempt_no: true,
                        is_latest: true,
                        before_photo: true,
                        after_photo: true,
                        tasks: true,
                        initial_comment: true,
                        final_comment: true
                    },
                    orderBy: {
                        attempt_no: "asc"
                    }
                },
                escalation_logs: {
                    include: {
                        actor_user: {
                            select: {
                                id: true,
                                name: true,
                                avatar_url: true,
                                role: { select: { id: true, name: true } }
                            }
                        }
                    },
                    orderBy: {
                        created_at: "asc"
                    }
                }
            }
        });

        if (!inc) {
            return res.status(404).json({ success: false, message: "Incident not found" });
        }

        // Aggregate reviews
        const reviewMap = new Map();
        if (inc.triggered_by_review) {
            reviewMap.set(inc.triggered_by_review.id.toString(), {
                ...inc.triggered_by_review,
                attempt_no: inc.triggered_by_review.attempt_no || 1,
                review_type: inc.triggered_by_review.review_type || "ORIGINAL"
            });
        }
        if (Array.isArray(inc.corrective_reviews)) {
            inc.corrective_reviews.forEach(r => {
                reviewMap.set(r.id.toString(), r);
            });
        }

        const reviewsList = Array.from(reviewMap.values()).sort((a, b) => {
            return (Number(a.attempt_no || 1) - Number(b.attempt_no || 1)) ||
                (new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        });

        const breachLog = inc.escalation_logs?.find(l => l.event_type === "SLA_BREACH");
        const threshold = Number(breachLog?.metadata?.threshold || 8.0);

        let bestScore = null;
        reviewsList.forEach(r => {
            if (r.score !== null && r.score !== undefined && !isNaN(Number(r.score))) {
                const sc = Number(r.score);
                if (bestScore === null || sc > bestScore) {
                    bestScore = sc;
                }
            }
        });

        const responsePayload = {
            id: inc.id.toString(),
            company_id: inc.company_id.toString(),
            location_id: inc.location_id.toString(),
            cleaner_user_id: inc.cleaner_user_id ? inc.cleaner_user_id.toString() : null,
            business_date: inc.business_date,
            current_level: inc.current_level,
            max_level: inc.max_level,
            state: inc.state,
            snapshot_hierarchy: inc.snapshot_hierarchy,
            retry_count: inc.retry_count,
            max_retries: inc.max_retries,
            due_at: inc.due_at,
            created_at: inc.created_at,
            updated_at: inc.updated_at,
            resolved_at: inc.resolved_at,
            location: inc.location,
            cleaner_user: inc.cleaner_user,
            company: inc.company,
            best_score: bestScore,
            threshold,
            reviews: reviewsList,
            events: inc.escalation_logs || []
        };

        return res.status(200).json({
            success: true,
            data: safeSerialize(responsePayload)
        });
    } catch (error) {
        console.error("❌ [GET SLA INCIDENT DETAILS ERROR]:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch SLA incident details",
            error: error.message
        });
    }
}

/**
 * Helper to compute incident summary counts for top metric cards
 */
async function getIncidentSummaryStats(companyId, fromDate, toDate) {
    try {
        const baseWhere = {};
        if (companyId) {
            baseWhere.company_id = BigInt(companyId);
        }

        const dateWhere = {};
        if (fromDate || toDate) {
            if (fromDate) dateWhere.gte = fromDate;
            if (toDate) dateWhere.lte = toDate;
            baseWhere.created_at = dateWhere;
        }

        // Today start for new breaches
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayWhere = {
            ...baseWhere,
            created_at: { gte: todayStart }
        };

        const [totalIncidents, openCount, resolvedCount, exhaustedCount, newBreachesToday] = await Promise.all([
            prisma.sla_escalations.count({ where: baseWhere }),
            prisma.sla_escalations.count({
                where: { ...baseWhere, state: "OPEN" }
            }),
            prisma.sla_escalations.count({
                where: { ...baseWhere, state: "RESOLVED" }
            }),
            prisma.sla_escalations.count({
                where: { ...baseWhere, state: "EXHAUSTED" }
            }),
            prisma.sla_escalations.count({
                where: todayWhere
            })
        ]);

        return {
            totalIncidents,
            activeIncidents: openCount,
            open: openCount,
            resolved: resolvedCount,
            exhausted: exhaustedCount,
            newBreaches: newBreachesToday
        };
    } catch (err) {
        console.warn("⚠️ [INCIDENT SUMMARY STATS ERROR]:", err.message);
        return {
            totalIncidents: 0,
            activeIncidents: 0,
            open: 0,
            resolved: 0,
            exhausted: 0,
            newBreaches: 0
        };
    }
}

/**
 * GET /api/sla-logs
 * Retrieves paginated, filterable raw SLA escalation audit logs (Audit Stream View)
 */
export async function getSlaLogs(req, res) {
    try {
        const {
            company_id,
            companyId,
            cleaner_user_id,
            cleanerId,
            location_id,
            locationId,
            event_type,
            eventType,
            state,
            status,
            datePreset,
            startDate,
            endDate,
            search,
            page = 1,
            limit = 15,
            sort = "desc"
        } = req.query;

        const effectiveCompanyId = company_id || companyId || (req.user?.role_id !== 1 ? req.user?.company_id : null);
        const effectiveCleanerId = cleaner_user_id || cleanerId;
        const effectiveLocationId = location_id || locationId;
        const effectiveEventType = event_type || eventType;
        const effectiveState = state || status;

        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const pageSize = Math.max(1, Math.min(100, parseInt(limit, 10) || 15));
        const skip = (pageNum - 1) * pageSize;

        // Build base where clause
        const where = {};

        // 1. Company Filter (via escalation or review relation)
        if (effectiveCompanyId) {
            const compIdBigInt = BigInt(effectiveCompanyId);
            where.escalation = {
                company_id: compIdBigInt
            };
        }

        // 2. Cleaner Filter
        if (effectiveCleanerId && effectiveCleanerId !== "all") {
            const cleanerBigInt = BigInt(effectiveCleanerId);
            where.OR = [
                { actor_user_id: cleanerBigInt },
                { review: { cleaner_user_id: cleanerBigInt } },
                { escalation: { cleaner_user_id: cleanerBigInt } }
            ];
        }

        // 3. Location Filter
        if (effectiveLocationId && effectiveLocationId !== "all") {
            const locBigInt = BigInt(effectiveLocationId);
            where.escalation = {
                ...(where.escalation || {}),
                location_id: locBigInt
            };
        }

        // 4. Event Type Filter
        if (effectiveEventType && effectiveEventType !== "all") {
            where.event_type = String(effectiveEventType);
        }

        // 5. Escalation State Filter
        if (effectiveState && effectiveState !== "all") {
            where.escalation = {
                ...(where.escalation || {}),
                state: String(effectiveState).toUpperCase()
            };
        }

        // 6. Date Filter
        const { fromDate, toDate } = parseDateFilters(datePreset, startDate, endDate);
        if (fromDate || toDate) {
            where.created_at = {};
            if (fromDate && !isNaN(fromDate.getTime())) {
                where.created_at.gte = fromDate;
            }
            if (toDate && !isNaN(toDate.getTime())) {
                where.created_at.lte = toDate;
            }
        }

        // 7. Search Filter (by cleaner name, washroom name, event type)
        if (search && search.trim()) {
            const term = search.trim();
            const searchConditions = [
                { event_type: { contains: term, mode: "insensitive" } },
                {
                    escalation: {
                        location: {
                            name: { contains: term, mode: "insensitive" }
                        }
                    }
                },
                {
                    escalation: {
                        cleaner_user: {
                            name: { contains: term, mode: "insensitive" }
                        }
                    }
                },
                {
                    actor_user: {
                        name: { contains: term, mode: "insensitive" }
                    }
                }
            ];

            if (where.OR) {
                where.AND = [{ OR: where.OR }, { OR: searchConditions }];
                delete where.OR;
            } else {
                where.OR = searchConditions;
            }
        }

        // Execute total count & paginated fetch in parallel
        const [total, rawLogs, summaryCounts] = await Promise.all([
            prisma.sla_escalation_logs.count({ where }),
            prisma.sla_escalation_logs.findMany({
                where,
                skip,
                take: pageSize,
                orderBy: {
                    created_at: sort === "asc" ? "asc" : "desc"
                },
                include: {
                    escalation: {
                        include: {
                            location: {
                                select: {
                                    id: true,
                                    name: true,
                                    code: true,
                                    address: true
                                }
                            },
                            cleaner_user: {
                                select: {
                                    id: true,
                                    name: true,
                                    email: true,
                                    phone: true,
                                    avatar_url: true
                                }
                            },
                            company: {
                                select: {
                                    id: true,
                                    name: true
                                }
                            }
                        }
                    },
                    review: {
                        select: {
                            id: true,
                            score: true,
                            status: true,
                            review_type: true,
                            attempt_no: true,
                            is_latest: true,
                            before_photo: true,
                            after_photo: true,
                            created_at: true
                        }
                    },
                    actor_user: {
                        select: {
                            id: true,
                            name: true,
                            avatar_url: true,
                            role: {
                                select: {
                                    id: true,
                                    name: true
                                }
                            }
                        }
                    }
                }
            }),
            getIncidentSummaryStats(effectiveCompanyId, fromDate, toDate)
        ]);

        // Clean score formatting to prevent NaN
        const logs = rawLogs.map(log => {
            let cleanScore = null;
            if (log.score !== null && log.score !== undefined && !isNaN(Number(log.score)) && Number(log.score) > 0) {
                cleanScore = Number(log.score);
            } else if (log.review?.score !== null && log.review?.score !== undefined && !isNaN(Number(log.review.score))) {
                cleanScore = Number(log.review.score);
            }

            return {
                ...log,
                score: cleanScore
            };
        });

        const totalPages = Math.ceil(total / pageSize);

        return res.status(200).json({
            success: true,
            data: safeSerialize(logs),
            pagination: {
                total,
                page: pageNum,
                limit: pageSize,
                totalPages,
                hasNextPage: pageNum < totalPages,
                hasPrevPage: pageNum > 1
            },
            summary: summaryCounts
        });
    } catch (error) {
        console.error("❌ [GET SLA LOGS ERROR]:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch SLA logs",
            error: error.message
        });
    }
}
