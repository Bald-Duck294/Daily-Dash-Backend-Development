import express from "express";
import {
  saveSensorData,
  getSensorData,
  getLatestReading,
} from "../controller/iotController.js";

const router = express.Router();

router.get("/odor-reading", getSensorData);

router.get("/odor-reading/latest", getLatestReading);

// router.get("/odor-reading/device/:deviceId", getDeviceData);

router.post("/odor-reading", saveSensorData);

export default router;
