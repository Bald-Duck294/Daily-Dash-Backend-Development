import express from "express";
import cors from "cors";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
// import { verifyToken } from "./utils/jwt.js";

import { verifyToken } from "./middlewares/authMiddleware.js";
import getLocationRoutes from "./routes/LocationRoutes.js";
import location_types_router from "./routes/locationTypes.js";
import configRouter from "./routes/configRoutes.js";
import clean_review_Router from "./routes/CleanerReviewRoutes.js";
// import reviewRoutes from "./routes/reviewRoutes.js";
import reviewRoutes from "./routes/reviewRoutes.js";
import loginRoute from "./routes/loginApi.js";
import clen_assign_router from "./routes/clen_assignRoutes.js";
import userRouter from "./routes/userRoutes.js";
import companyRouter from "./routes/companyApiRoutes.js";
import roleRouter from "./routes/roleRoutes.js";
import registered_users_router from "./routes/registerUserApi.js";
import dotenv from "dotenv";
import reportRouter from "./routes/reportsRoutes.js";
import facility_company_router from "./routes/facilityCompanyRoutes.js";
import shift_router from "./routes/shiftRoutes.js";
import fcmRoutes from "./routes/fcmRoutes.js";
import dashboardRoutes from "./routes/dashboardRoutes.js";
import serviceReqRouter from "./routes/serviceRequestRoute.js";
import shiftAssign_router from "./routes/shiftAssignRoutes.js";
import dropdownlist_router from "./routes/dropdownlist.route.js";
import getPhotoRoutes from "./routes/photoRoute.js";
import iotRoutes from "./routes/iotRoutes.js";
import getattendanceRoute from "./routes/attendanceRoute.js";
import serviceAccount from "./safai-ai-firebase-adminsdk.json" with { type: "json" };

dotenv.config();

if (getApps().length === 0) {
  initializeApp({
    credential: cert(serviceAccount),
  });
}
const app = express();
app.use(express.json());

// ✅ Correct CORS setup (put before routes)
const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:8100", // Ionic dev
  "http://localhost:8101", // Ionic dev
  "http://localhost:8102", // Ionic dev
  "capacitor://localhost", // Capacitor native
  "ionic://localhost", // Ionic native
  "https://localhost", // Ionic native
  "http://localhost", // Ionic native
  "https://safai-index-frontend.onrender.com", // your frontend (change if needed)
  "https://safai-index.vercel.app",
  "https://saaf-ai.vercel.app",
  "https://safaiindex.vercel.app",
  "https://safai-form.vercel.app",
  "https://safai-index-livid.vercel.app",
];

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

// Routes
app.use("/api/iot", iotRoutes);

app.use("/api/auth", loginRoute);
app.use("/api/fcm", fcmRoutes);
app.use("/api/reports", reportRouter);
app.use("/api/facility-companies", facility_company_router);
app.use("/api/service-req", serviceReqRouter);
app.use("/api/dropdown-list", dropdownlist_router);

// app.use("/api", verifyToken);

app.use("/api/locations", getLocationRoutes);
// app.use("/api", getLocationRoutes);
app.use("/api/location-types", location_types_router);
app.use("/api/configurations", configRouter);
app.use("/api/reviews", reviewRoutes);
app.use("/api/assignments", clen_assign_router);
app.use("/api/cleaner-reviews", clean_review_Router);
app.use("/api/users", userRouter);
app.use("/api/companies", companyRouter);
app.use("/api/roles", roleRouter);
app.use("/api/shifts", shift_router);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/shifts-assign", shiftAssign_router);
app.use("/api/photo", getPhotoRoutes);
app.use("/api/attendance", getattendanceRoute);
app.use("/uploads", express.static("uploads"));
// app.use("/api", registered_users_router);

app.use((err, req, res, next) => {
  // Set CORS headers even for errors
  res.header("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.header("Access-Control-Allow-Credentials", "true");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With",
  );

  console.error("Error:", err);
  res.status(err.status || 500).json({
    error: err.message || "Internal Server Error",
  });
});

app.get("/", (req, res) => {
  res.send("Hi there, Your server has successfully started");
});

// 2. The Push Notification Endpoint
app.post("/api/send-push", async (req, res) => {
  // fcmToken is the token you get from your frontend hook
  const { fcmToken, title, body, type, taskId, reviewId } = req.body;

  if (!fcmToken) {
    return res.status(400).json({ error: "fcmToken is required" });
  }

  // 🚨 THIS IS THE MAGIC 🚨
  // Notice there is NO "notification" object here.
  // It is ONLY a "data" object. This forces Android to stay quiet
  // and lets your Service Worker draw the custom mascot notification.
  const message = {
    token: fcmToken,
    data: {
      title: title || "Custom Safai Test",
      body: body || "This is a data-only test notification.",
      type: type || "task",
      taskId: taskId || "12345",
      reviewId: reviewId || "",
    },
  };

  try {
    const response = await getMessaging().send(message);
    console.log("Successfully sent message:", response);
    res.status(200).json({
      success: true,
      message: "Data-only push sent successfully!",
      firebaseResponse: response,
    });
  } catch (error) {
    console.error("Error sending message:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Error handling middleware (add BEFORE app.listen)

// console.log(BigInt('123'));
const PORT = process.env.PORT;
app.listen(PORT, () => {
  console.log(
    `----------/////Server running on port ${PORT}\\\\\\\------------`,
  );
  // console.log(process.env.DATABASE_URL);
});
