import express, { Router } from "express";

// import {
//   getAllLocationTypes,
//   createLocationType,
//   updateLocationTypeParent,
//   markAsToilet,
//   getLocationTypeTree,
// } from "../controller/locationTypesController.js";

import {
  getAllLocationTypes,
  createLocationType,
  updateLocationType,
  markAsToilet,
  getLocationTypeTree,
  deleteLocationType,
} from "../controller/locationTypesController.js";

const location_types_router = express.Router();

location_types_router.get("/tree", getLocationTypeTree);
location_types_router.get("/", getAllLocationTypes);
location_types_router.post("/", createLocationType);
location_types_router.patch("/:id", updateLocationType);
location_types_router.patch("/:id/mark-toilet", markAsToilet);
location_types_router.delete("/delete/:id", deleteLocationType);

export default location_types_router;
