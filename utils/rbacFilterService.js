import prisma from "../config/prismaClient.mjs";

const ROLES = {
  SUPER_ADMIN: 1,
  ADMIN: 2,
  SUPERVISOR: 3,
  FELLOW: 4,
  CLEANER: 5,
  ZONAL_ADMIN: 6,
  FACILITY_SUPV: 7,
  FACILITY_ADMIN: 8
};

const flattenLocationTree = (locations) => {
  let ids = [];
  for (const location of locations) {
    ids.push(location.id);
    if (location.other_locations && location.other_locations.length > 0) {
      ids = [...ids, ...flattenLocationTree(location.other_locations)];
    }
  }
  return ids;
};

class RBACFilterService {

  // ==========================================
  // 1. GET LOCATION FILTER (Globally Fixed)
  // ==========================================
  static async getLocationFilter(user, type) {
    if (!user) return { id: -1 }; 

    const { role_id, company_id, id: user_id } = user;

    if (role_id === ROLES.SUPER_ADMIN) return {};
    if (role_id === ROLES.ADMIN) return { company_id };

    try {
      // ✅ Now it uses your main authorization function, which supports BOTH Locations and Zones!
      const authorizedIds = await this.getAuthorizedLocationIds(user_id, company_id);

      if (authorizedIds.length === 0) {
        return { id: -1 }; 
      }

      if (type === "cleaner_activity") {
        return { location_id: { in: authorizedIds } }; 
      } else if (type === "user_activity") {
        return { toilet_id: { in: authorizedIds } };
      } else {
        return { id: { in: authorizedIds } }; 
      }
    } catch (error) {
      console.error('Error in getLocationFilter:', error);
      return { id: -1 }; 
    }
  }

  // ==========================================
  // 2. GET USER FILTER (Fixed for Sub-Zones)
  // ==========================================
static async getUserFilter(currentUser) {
    // Return empty array instead of -1 to prevent UI bugs
    if (!currentUser) return { id: { in: [] } };

    const { role_id, company_id, id: rawUserId } = currentUser;
    
    // ✅ CRITICAL FIX: Cast incoming user ID to BigInt to prevent Prisma crashes
    const userId = BigInt(rawUserId);

    if (role_id === ROLES.SUPER_ADMIN) return {};
    if (role_id === ROLES.ADMIN) return { company_id };

    if (role_id === ROLES.ZONAL_ADMIN) {
      try {
        const assignments = await prisma.cleaner_assignments.findMany({
          where: { cleaner_user_id: userId, released_on: null, deleted_at: null },
          select: { type_id: true }
        });

        const typeIds = [...new Set(assignments.map(a => a.type_id).filter(Boolean))];
        
        // ✅ FIX: Return empty array instead of self if no zones exist
        if (typeIds.length === 0) return { id: { in: [] } };

        // Fetch sub-zones so Zonal Admin sees users in child zones
        const subZones = await prisma.location_types.findMany({
          where: { parent_id: { in: typeIds } },
          select: { id: true }
        });
        const allAllowedTypeIds = [...typeIds, ...subZones.map(z => z.id)];

        const locationsInZone = await prisma.locations.findMany({
          where: { type_id: { in: allAllowedTypeIds }, company_id, deleted_at: null },
          select: { id: true }
        });

        const locationIds = locationsInZone.map(loc => loc.id);
        
        // ✅ FIX: Return empty array instead of self
        if (locationIds.length === 0) return { id: { in: [] } };

        const usersInLocations = await prisma.cleaner_assignments.findMany({
          where: { location_id: { in: locationIds }, released_on: null, deleted_at: null },
          select: { cleaner_user_id: true }
        });

        // ✅ FIX: Ensure the logged-in Zonal Admin is filtered out of the results
        const userIds = [...new Set(usersInLocations.map(a => a.cleaner_user_id))].filter(id => id !== userId);
        return { id: { in: userIds } };

      } catch (error) {
        console.error('Error in getUserFilter for Zonal Admin:', error);
        return { id: { in: [] } };
      }
    }

    if (role_id === ROLES.SUPERVISOR || role_id === ROLES.FACILITY_SUPV || role_id === ROLES.FACILITY_ADMIN) {
      try {
        const whereClause = { released_on: null, deleted_at: null };
        whereClause.role_id = role_id === ROLES.FACILITY_ADMIN ? { in: [5, 7] } : { in: [5] };

        const assignments = await prisma.cleaner_assignments.findMany({
          where: { cleaner_user_id: userId, released_on: null, deleted_at: null, status: 'assigned' },
          select: { location_id: true }
        });

        const locationIds = assignments.map(a => a.location_id).filter(Boolean);
        
        // ✅ FIX: Return empty array instead of self
        if (locationIds.length === 0) return { id: { in: [] } };
        
        whereClause.location_id = { in: locationIds };

        const usersInLocations = await prisma.cleaner_assignments.findMany({
          where: whereClause,
          select: { cleaner_user_id: true }
        });

        // ✅ FIX: Ensure the logged-in Supervisor/Admin is filtered out of the results
        const userIds = [...new Set(usersInLocations.map(a => a.cleaner_user_id))].filter(id => id !== userId);
        return { id: { in: userIds } };
        
      } catch (error) {
        console.error('Error in getUserFilter:', error);
        return { id: { in: [] } };
      }
    }

    // Default fallback
    return { id: { in: [] } };
  }

  // ==========================================
  // 3. GET ZONE FILTER
  // ==========================================
  static async getZoneFilter(user) {
    if (user.role_id === ROLES.SUPER_ADMIN || user.role_id === ROLES.ADMIN) {
      return {}; 
    }
    // If Zonal Admin, only show zones they are assigned to
    if (user.role_id === ROLES.ZONAL_ADMIN) {
        const assignments = await prisma.cleaner_assignments.findMany({
            where: { cleaner_user_id: BigInt(user.id), status: 'assigned', type_id: { not: null } },
            select: { type_id: true }
        });
        const assignedZoneIds = assignments.map(a => a.type_id);
        if(assignedZoneIds.length > 0) return { id: { in: assignedZoneIds } };
        else return { id: -1 };
    }
    return {}; 
  }

  // ==========================================
  // 4. GET AUTHORIZED LOCATION IDS (The Engine)
  // ==========================================
  static async getAuthorizedLocationIds(userId, companyId) {
    const assignments = await prisma.cleaner_assignments.findMany({
      where: { 
        cleaner_user_id: BigInt(userId),
        company_id: BigInt(companyId),
        status: 'assigned',
        deleted_at: null
      },
      select: { location_id: true, type_id: true }
    });

    if (assignments.length === 0) return [];

    const locationIds = assignments.map(a => a.location_id).filter(id => id !== null);
    const typeIds = assignments.map(a => a.type_id).filter(id => id !== null);

    let authorizedIds = [];

    // --- 1. PROCESS NODE-BASED ASSIGNMENTS ---
    if (locationIds.length > 0) {
      const nodeLocations = await prisma.locations.findMany({
        where: { id: { in: locationIds }, deleted_at: null },
        select: {
          id: true,
          other_locations: { 
            where: { deleted_at: null },
            select: {
              id: true,
              other_locations: { 
                where: { deleted_at: null },
                select: { 
                  id: true, 
                  other_locations: { 
                    where: { deleted_at: null },
                    select: { id: true } 
                  } 
                } 
              }
            }
          }
        }
      });
      authorizedIds = [...authorizedIds, ...flattenLocationTree(nodeLocations)];
    }

    // --- 2. PROCESS TYPE-BASED ASSIGNMENTS (ZONES) ---
    if (typeIds.length > 0) {
      // ✅ NEW: Fetch sub-zones. If assigned to Nagpur, also fetch Dighori's locations.
      const subZones = await prisma.location_types.findMany({
        where: { parent_id: { in: typeIds } },
        select: { id: true }
      });
      const subZoneIds = subZones.map(z => z.id);
      const allAllowedTypeIds = [...typeIds, ...subZoneIds];

      const typeLocations = await prisma.locations.findMany({
        where: { type_id: { in: allAllowedTypeIds }, company_id: BigInt(companyId), deleted_at: null },
        select: {
          id: true,
          other_locations: { 
            where: { deleted_at: null },
            select: {
              id: true,
              other_locations: { 
                where: { deleted_at: null },
                select: { 
                  id: true, 
                  other_locations: { 
                    where: { deleted_at: null },
                    select: { id: true } 
                  } 
                } 
              }
            }
          }
        }
      });
      authorizedIds = [...authorizedIds, ...flattenLocationTree(typeLocations)];
    }

    return [...new Set(authorizedIds)]; 
  }
}

export default RBACFilterService;