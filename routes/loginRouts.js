import express from "express";
import bcrypt from "bcryptjs";
import prisma from "../config/prismaClient.mjs";
import {
  loginUser,
  registerUser,
  resetPassword,
} from "../controller/authController.js";
const loginRoute11 = express.Router();

loginRoute11.post("/login", loginUser);
loginRoute11.post("/register", registerUser);
loginRoute11.post("/reset-password", resetPassword);
export default loginRoute11;
