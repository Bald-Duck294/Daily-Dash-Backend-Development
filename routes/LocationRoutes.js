import express, { Router } from "express";
import {
  getAllToilets,
  getToiletById,
  createLocation,
  getZonesWithToilets,
  getNearbyLocations,
  deleteLocationImage,
  getSearchToilet,
  updateLocationById,
  deleteLocationById,
  toggleStatusToilet,
  getAllToiletsForWeb,
  getMapToilets,
} from "../controller/LocationsController.js";
import { upload, processAndUploadImages } from "../middlewares/imageUpload.js";
import { verifyToken } from "../middlewares/authMiddleware.js";
import { checkLimit } from "../middlewares/limitMiddleware.js";
console.log("in get location rutes");
const getLocationRoutes = express.Router();

// getLocationRoutes.get("/getUsers", getUser);
// getLocationRoutes.get('/getLocations' , getLocation);
getLocationRoutes.get("/loc", getAllToilets);
getLocationRoutes.get("/", verifyToken, getAllToilets);
getLocationRoutes.get("/saafai_locations", getAllToiletsForWeb);
getLocationRoutes.get("/map", verifyToken, getMapToilets);

// getLocationRoutes.post("/", createLocation);

getLocationRoutes.get("/zones", getZonesWithToilets);
getLocationRoutes.get("/nearby", getNearbyLocations);
getLocationRoutes.get("/:id", getToiletById);
getLocationRoutes.get("/search", getSearchToilet);
getLocationRoutes.delete("/:id/image", deleteLocationImage);
getLocationRoutes.post("/status/:id", toggleStatusToilet);
// Add this route to your locations routes
getLocationRoutes.delete("/:id", deleteLocationById);

// getLocationRoutes.post("/update/:id", updateLocationById);

// ✅ Routes with image upload support
// getLocationRoutes.post("/",
//   upload.fields([{ name: 'images', maxCount: 10 }]), // Support up to 10 images
//   processAndUploadImages([
//     { fieldName: 'images', folder: 'locations', maxCount: 10 }
//   ]),
//   createLocation
// );
getLocationRoutes.post(
  "/",
  upload.fields([{ name: "images", maxCount: 10 }]), // 2. Parse form-data so req.body is available
  checkLimit("MAX_WASHROOMS"), // 3. 🚨 CHECK LIMIT NOW (Reads req.body.company_id)
  processAndUploadImages([
    { fieldName: "images", folder: "locations", maxCount: 10 },
  ]),
  createLocation, // 4. Finally, create and increment limit
);

getLocationRoutes.post(
  "/update/:id",
  upload.fields([{ name: "images", maxCount: 10 }]),
  processAndUploadImages([
    { fieldName: "images", folder: "locations", maxCount: 10 },
  ]),
  updateLocationById,
);

// -------------- old routes ---------------

// getLocationRoutes.get("/getUsers", getUser);
// // getLocationRoutes.get('/getLocations' , getLocation);
// getLocationRoutes.get("/locations", getAllToilets);
// getLocationRoutes.post("/locations", createLocation);
// getLocationRoutes.get("/locations/:id", getToiletById);
// getLocationRoutes.get("/zones", getZonesWithToilets);
// getLocationRoutes.get('/nearby', getNearbyLocations);

export default getLocationRoutes;
