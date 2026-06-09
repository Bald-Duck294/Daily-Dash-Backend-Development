import express from "express";
import cors from "cors";
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

dotenv.config();

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

// Error handling middleware (add BEFORE app.listen)

// console.log(BigInt('123'));
const PORT = process.env.PORT;
app.listen(PORT, () => {
  console.log(
    `----------/////Server running on port ${PORT}\\\\\\\------------`,
  );
  // console.log(process.env.DATABASE_URL);
});
