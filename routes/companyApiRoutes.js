import express from "express";
// import * as companyController from "../controllers/companyController.js";
import * as companyController from "../controller/companyController.js";
import { verifyToken } from "../middlewares/authMiddleware.js";
const companyRouter = express.Router();

// Route to get all companies and create a new company
// GET /api/companies
// POST /api/companies
companyRouter
  .route("/")
  .get(companyController.getAllCompanies)
  .post(companyController.createCompany);

companyRouter.get("/count", companyController.getCompaniesCount);

// Route to get, update, and delete a specific company by ID
// GET /api/companies/:id
// POST /api/companies/:id (for update)
// DELETE /api/companies/:id

companyRouter.post("/setup", verifyToken, companyController.setupCompany);
companyRouter
  .route("/:id")
  .get(companyController.getCompanyById)

  .post(companyController.updateCompany) // Using POST for updates as you requested
  .delete(companyController.deleteCompany);

export default companyRouter;
