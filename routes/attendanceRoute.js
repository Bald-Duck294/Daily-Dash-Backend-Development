
import express from "express";
import {
getCleanerAttendance
} from "../controller/attendance.controller.js";


import { verifyToken } from "../middlewares/authMiddleware.js";
const attendance_Router = express.Router();


attendance_Router.get("/", verifyToken, getCleanerAttendance);


export default attendance_Router;