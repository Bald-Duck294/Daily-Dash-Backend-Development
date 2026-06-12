import express from "express";
import {
getLocationsForDropdown,
getUsersForDropdown,
getCompaniesForDropdown,
getCleanersForDropdown,
getZonesForDropdown,
getRolesForDropdown
} from "../controller/dropdownlistController.js";
import { verifyToken } from "../middlewares/authMiddleware.js";

const dropdown_list_router = express.Router();


dropdown_list_router.get("/location", verifyToken, getLocationsForDropdown);
dropdown_list_router.get("/user", verifyToken, getUsersForDropdown);
dropdown_list_router.get("/companies", verifyToken,getCompaniesForDropdown);
dropdown_list_router.get("/cleaners", verifyToken,getCleanersForDropdown);
dropdown_list_router.get("/zone", verifyToken,getZonesForDropdown);
dropdown_list_router.get("/role", verifyToken,getRolesForDropdown);


export default dropdown_list_router;