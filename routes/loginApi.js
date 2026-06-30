import express from "express";
import { 
  loginUser, 
  registerUser, 
  googleLogin, 
  requestOtp, 
  verifyOtp,
  resetPassword
} from "../controller/authController.js";

const loginRoute = express.Router();

// Register API - POST /api/auth/register
loginRoute.post("/register", registerUser);

// Login API - POST /api/auth/login
loginRoute.post("/login", loginUser);

// Google Auth API - POST /api/auth/google-login
loginRoute.post("/google-login", googleLogin);

// OTP Auth APIs
// Request OTP - POST /api/auth/request-otp
loginRoute.post("/request-otp", requestOtp);

// Verify OTP - POST /api/auth/verify-otp
loginRoute.post("/verify-otp", verifyOtp);

loginRoute.post("/reset-pass",resetPassword);
export default loginRoute;