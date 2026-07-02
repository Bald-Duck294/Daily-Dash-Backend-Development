import express from "express";
import {
  getCompanies,
  getLocations,
  getCleaners,
  getAiInsightsContext,
} from "../controller/aiInsightController.js";

const ai_insights_Router = express.Router();

// Dropdown APIs
ai_insights_Router.get("/companies", getCompanies);
ai_insights_Router.get("/locations", getLocations);
ai_insights_Router.get("/cleaners", getCleaners);

// Main AI Insights Context API
ai_insights_Router.get("/context", getAiInsightsContext);

export default ai_insights_Router;