import express from "express";
// import {
//     getZoneWiseReport,
//     getAvailableZones,
//     exportReportCSV,
// } from "../controller/reportController.js";
import { verifyToken } from "../middlewares/authMiddleware.js"

import {
    getZoneWiseReport, getAvailableZones,
    getDailyCleaningReport, getCleanersForReport,
    getLocationsForReport,
    getAiScoringReport,
    getPerformanceSummary, getDetailedCleaningReport,
    getWashroomReport,
    getCleanerReport,
    getWashroomDailyScoresReport,
    getWashroomAverageReport
} from "../controller/reportController.js";
const reportRouter = express.Router();


reportRouter.get("/zone-wise", verifyToken, getZoneWiseReport);

reportRouter.get("/zones", getAvailableZones);

// ✅ NEW: Daily Task Report routes
reportRouter.get("/daily-task", verifyToken, getDailyCleaningReport);
reportRouter.get("/detailed-cleaning", verifyToken, getDetailedCleaningReport);
reportRouter.get("/washroom-report", verifyToken, getWashroomReport)
reportRouter.get("/cleaner-report", verifyToken, getCleanerReport)
reportRouter.get("/washroom-daily-scores", getWashroomDailyScoresReport)
reportRouter.get("/washroom-average", verifyToken, getWashroomAverageReport)



///////////////////////////////// CLEANERS & LOCATIONS FOR REPORT FILTERS //////////////////////////////////
reportRouter.get("/cleaners", verifyToken, getCleanersForReport);
reportRouter.get("/locations", verifyToken, getLocationsForReport);

/////////////////////////////////////////////  Not In Use //////////////////////////////////////////////////////////////
reportRouter.get('/ai-scoring', getAiScoringReport)  // not in use
reportRouter.get("/cleaner-performance-summary", getPerformanceSummary) // not in use





export default reportRouter;
