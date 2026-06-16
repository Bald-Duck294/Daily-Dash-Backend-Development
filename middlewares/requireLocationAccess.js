import RBACFilterService from '../utils/rbacFilterService.js';

export const requireLocationAccess = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.company_id;

    // 1. Call your function here!
const authorizedBigInts = await RBACFilterService.getAuthorizedLocationIds(userId, companyId);
    
    // 2. Convert to strings so JavaScript arrays can easily use .includes()
    const authorizedIds = authorizedBigInts.map(id => id.toString());

    // 3. Attach to the request so your controllers can use it
    req.authorizedLocationIds = authorizedIds;

    // 4. Optional: Block direct access if they request a specific location they don't own
    if (req.params.location_id && !authorizedIds.includes(req.params.location_id)) {
      return res.status(403).json({ error: 'Forbidden: You do not have access to this location.' });
    }

    next();
  } catch (error) {
    console.error("RBAC Error:", error);
    res.status(500).json({ error: 'Internal Server Error during authorization.' });
  }
};