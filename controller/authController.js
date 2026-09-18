// import prisma from "../config/prismaClient.mjs";
// import bcrypt from "bcryptjs";
// import { generateToken } from "../utils/jwt.js"

// export const registerUser = async (req, res) => {
//   const { name, email, phone, password, role_id, company_id, age, birthdate } =
//     req.body;

//   if (!phone || !password) {
//     return res.status(400).json({
//       error: " Phone, and Password fields are required.",
//     });
//   }

//   try {
//     const hashedPassword = await bcrypt.hash(password, 10);

//     const existing_user = await prisma.users.findUnique({
//       where: { phone },
//     });

//     if (existing_user) {
//       return res.status(409).json({
//         status: "error",
//         message: "Phone No. already exists, please try another one!",
//       });
//     }

//     // Build the base data object
//     const data = {
//       name,
//       email,
//       phone,
//       password: hashedPassword,
//       role_id: role_id || null,
//       age: age || null,
//       birthdate: birthdate || null,
//     };

//     // Conditionally add relation
//     if (company_id) {
//       data.companies = { connect: { id: company_id } };
//     }

//     // Create the user with full data
//     const user = await prisma.users.create({ data });

//     res.status(201).json({
//       message: "User registered",
//       userId: user.id.toString(),
//     });
//   } catch (err) {
//     console.error("Registration Error:", err);
//     res.status(500).json({ error: "User registration failed." });
//   }
// };

// // controllers/authController.js

// // export const loginUser = async (req, res) => {
// //   console.log('in login controller');
// //   const { phone, password } = req.body;

// //   if (!phone || !password) {
// //     return res.status(400).json({ error: "Phone and password are required." });
// //   }

// //   try {
// //     const user = await prisma.users.findUnique({
// //       where: { phone },
// //       include: {
// //         role: {
// //           select: {
// //             id: true,
// //             name: true,
// //             permissions: true
// //           }
// //         }
// //       }
// //     });

// //     if (!user) {
// //       return res.status(404).json({
// //         error: "error",
// //         message: "User not found!"
// //       });
// //     }

// //     //  BLOCK: Roles without dashboard access (e.g., cleaner)
// //     const NO_DASHBOARD_ROLES = [5]; //  role IDs that can't access dashboard

// //     if (NO_DASHBOARD_ROLES.includes(user.role_id)) {
// //       return res.status(403).json({
// //         status: "error",
// //         message: "Dashboard access is not available for your role. Please use the mobile app.",
// //       });
// //     }

// //     // Verify password
// //     const isMatch = await bcrypt.compare(password, user.password);

// //     if (!isMatch) {
// //       return res.status(401).json({
// //         status: "error",
// //         message: "Password does not match!"
// //       });
// //     }

// //     // ✅ Validate role and permissions
// //     if (!user.role || !Array.isArray(user.role.permissions)) {
// //       console.error('❌ User role missing permissions:', user.id);
// //       return res.status(500).json({
// //         status: "error",
// //         message: "Invalid role configuration. Please contact support.",
// //       });
// //     }

// //     const serializeUser = {
// //       ...user,
// //       id: user?.id?.toString(),
// //       company_id: user?.company_id?.toString(),
// //     };

// //     // Generate token
// //     const token = generateToken({
// //       id: serializeUser.id,
// //       email: user.email,
// //       role_id: user.role_id,
// //       company_id: serializeUser.company_id
// //     });

// //     // Update user token in DB
// //     await prisma.users.update({
// //       where: { id: user.id },
// //       data: { token: token }
// //     });

// //     console.log('✅ Login successful:', user.name, '(' + user.role.name + ')');

// //     // Return success response
// //     res.json({
// //       status: "success",
// //       message: "Login successful",
// //       user: {
// //         id: user.id.toString(),
// //         name: user.name,
// //         email: user.email,
// //         phone: user.phone,
// //         age: user.age,
// //         role_id: user.role_id,
// //         company_id: user.company_id?.toString(),
// //         role: user.role,
// //         token: token
// //       },
// //     });
// //   } catch (err) {
// //     console.error("Login Error:", err);
// //     res.status(500).json({ error: "Login failed." });
// //   }
// // };

// // controllers/authController.js

// export const loginUser = async (req, res) => {
//   // console.log('in login controller');
//   const { phone, password } = req.body;

//   if (!phone || !password) {
//     return res.status(400).json({ error: "Phone and password are required." });
//   }

//   try {
//     const user = await prisma.users.findUnique({
//       where: { phone },
//       include: {
//         role: {
//           select: {
//             id: true,
//             name: true,
//             permissions: true
//           }
//         }
//       }
//     });

//     if (!user) {
//       return res.status(404).json({
//         error: "error",
//         message: "User not found!"
//       });
//     }

//     // ✅ BLOCK: Roles without dashboard access
//     const NO_DASHBOARD_ROLES = [5];

//     if (NO_DASHBOARD_ROLES.includes(user.role_id)) {
//       return res.status(403).json({
//         status: "error",
//         message: "Dashboard access is not available for your role. Please use the mobile app.",
//       });
//     }

//     // Verify password
//     const isMatch = await bcrypt.compare(password, user.password);

//     if (!isMatch) {
//       return res.status(401).json({
//         status: "error",
//         message: "Password does not match!"
//       });
//     }

//     // ✅ Validate role and permissions
//     if (!user.role || !Array.isArray(user.role.permissions)) {
//       console.error('❌ User role missing permissions:', user.id);
//       return res.status(500).json({
//         status: "error",
//         message: "Invalid role configuration. Please contact support.",
//       });
//     }

//     const serializeUser = {
//       ...user,
//       id: user?.id?.toString(),
//       company_id: user?.company_id?.toString(),
//     };

//     // ✅ FIX: Include permissions in token payload
//     const token = generateToken({
//       id: serializeUser.id,
//       email: user.email,
//       role_id: user.role_id,
//       company_id: serializeUser.company_id,
//       permissions: user.role.permissions, // ✅ ADD THIS!
//     });

//     // Update user token in DB
//     await prisma.users.update({
//       where: { id: user.id },
//       data: { token: token }
//     });

//     // console.log('✅ Login successful:', user.name, '(' + user.role.name + ')');
//     // console.log('✅ Permissions included in token:', user.role.permissions.length);

//     // Return success response
//     res.json({
//       status: "success",
//       message: "Login successful",
//       user: {
//         id: user.id.toString(),
//         name: user.name,
//         email: user.email,
//         phone: user.phone,
//         age: user.age,
//         role_id: user.role_id,
//         company_id: user.company_id?.toString(),
//         role: user.role,
//         token: token
//       },
//     });
//   } catch (err) {
//     console.error("Login Error:", err);
//     res.status(500).json({ error: "Login failed." });
//   }
// };

import prisma from "../config/prismaClient.mjs";
import bcrypt from "bcryptjs";
import { generateToken } from "../utils/jwt.js";
import redisClient from "../config/redis.js";
import { randomInt } from "crypto";
import jwt from "jsonwebtoken";
// import { serializeBigInt } from "../utils/serializeBigInt.js";
export const registerUser = async (req, res) => {
  // ❌ Removed company_name from requirements
  const { name, email, phone, password, role_id, age, birthdate, registrationToken } = req.body;

  if (!phone || !password || !registrationToken) {
    return res.status(400).json({
      error: "Phone, Password and Registration Token are required.",
    });
  }

  const { verifyRegistrationToken } = await import("../utils/jwt.js");
  const decodedToken = verifyRegistrationToken(registrationToken);
  
  if (!decodedToken || decodedToken.phone !== phone) {
    return res.status(401).json({
      error: "Invalid or expired registration token. Please verify OTP again."
    });
  }

  try {
    const existingUser = await prisma.users.findUnique({
      where: { phone },
    });

    if (existingUser) {
      return res.status(409).json({
        status: "error",
        message: "Phone No. already exists, please try another one!",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // 🚀 Perform Transaction: Create Placeholder Company -> Create User
    const result = await prisma.$transaction(async (tx) => {
      // 1. Create a placeholder company
      const newCompany = await tx.companies.create({
        data: {
          name: "Pending Setup", // Temporary name until they fill the setup form
        },
      });

      // 2. Create the user and link to the new placeholder company
      const newUser = await tx.users.create({
        data: {
          name: name || null,
          email: email || null,
          phone,
          password: hashedPassword,
          role_id: role_id || 2, // Default to Admin
          company_id: newCompany.id,
          age: age || null,
          birthdate: birthdate || null,
        },
      });

      return { company: newCompany, user: newUser };
    });

    res.status(201).json({
      status: "success",
      message: "Account created successfully",
      data: {
        userId: result.user.id.toString(),
        companyId: result.company.id.toString(),
      },
    });
  } catch (err) {
    console.error("Registration Error:", err);
    res.status(500).json({
      error: "User registration failed.",
      details: err.message,
    });
  }
};

// --- 1. PASSWORD LOGIN ---

const validateAccess = (user) => {
  const NO_DASHBOARD_ROLES = [5]; // e.g., Cleaners

  if (NO_DASHBOARD_ROLES.includes(user.role_id)) {
    const error = new Error(
      "Dashboard access is not available for your role. Please use the mobile app.",
    );
    error.statusCode = 403;
    throw error;
  }

  if (!user.role || !Array.isArray(user.role.permissions)) {
    const error = new Error(
      "Invalid role configuration. Please contact support.",
    );
    error.statusCode = 500;
    throw error;
  }
};

// --- UNIVERSAL BIGINT SERIALIZER ---
const serializeData = (obj) => {
  if (obj === null || obj === undefined) return obj;

  // ✅ Convert BigInt to string
  if (typeof obj === "bigint") return obj.toString();

  // ✅ Handle Dates correctly so they don't break
  if (obj instanceof Date) return obj.toISOString();

  // ✅ Recursively handle Arrays
  if (Array.isArray(obj)) return obj.map(serializeData);

  // ✅ Recursively handle nested Objects (like role, permissions, company)
  if (typeof obj === "object") {
    const serialized = {};
    for (const [key, value] of Object.entries(obj)) {
      serialized[key] = serializeData(value);
    }
    return serialized;
  }

  return obj;
};
// export const loginUser = async (req, res) => {
//   const { phone, password } = req.body;
//   if (!phone || !password)
//     return res.status(400).json({ error: "Phone and password required." });

//   try {
//     // ✅ ADD `companies: true` TO INCLUDE
//     const user = await prisma.users.findUnique({
//       where: { phone },
//       include: { role: true, companies: true }, // Use 'company: true' if your schema names it that way
//     });

//     if (!user || !user.password)
//       return res.status(401).json({ error: "Invalid credentials." });

//     const isMatch = await bcrypt.compare(password, user.password);
//     if (!isMatch)
//       return res.status(401).json({ error: "Invalid credentials." });

//     validateAccess(user);

//     const token = generateToken({
//       id: user.id.toString(),
//       email: user.email,
//       company_id: user.company_id?.toString(),
//       role_id: user.role_id,
//       permissions: user.role.permissions,
//     });

//     await prisma.users.update({ where: { id: user.id }, data: { token } });

//     const responsePayload = {
//       status: "success",
//       user: { ...user, token }, // No more sanitizeUser here
//       company: user.companies || user.company,
//     };
//     res.json(serializeData(responsePayload));
//   } catch (err) {
//     res
//       .status(err.statusCode || 500)
//       .json({ error: err.message || "Login failed" });
//   }
// };

// --- 2. GOOGLE LOGIN ---

export const loginUser = async (req, res) => {
  const { phone, password } = req.body;

  if (!phone || !password) {
    return res
      .status(400)
      .json({ status: "error", message: "Phone and password are required." });
  }

  try {
    const user = await prisma.users.findUnique({
      where: { phone },
      include: {
        role: { select: { id: true, name: true, permissions: true } },
        companies: true,
      },
    });

    if (!user)
      return res
        .status(404)
        .json({ status: "error", message: "User not found!" });

    // STRICT DASHBOARD ACCESS CONTROL
    const ALLOWED_DASHBOARD_ROLES = [1, 2, 3];
    if (!ALLOWED_DASHBOARD_ROLES.includes(user.role_id)) {
      return res.status(403).json({
        status: "error",
        message:
          "Dashboard access is not available for your role. Please use the mobile app.",
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch)
      return res
        .status(401)
        .json({ status: "error", message: "Password does not match!" });

    if (!user.role || !Array.isArray(user.role.permissions)) {
      return res
        .status(500)
        .json({ status: "error", message: "Invalid role configuration." });
    }

    const token = generateToken({
      id: user.id.toString(),
      email: user.email,
      role_id: user.role_id,
      company_id: user.company_id?.toString(),
      permissions: user.role.permissions,
    });

    await prisma.users.update({
      where: { id: user.id },
      data: { token: token },
    });

    // 🚀 NEW: CALCULATE ONBOARDING STATUS DIRECTLY IN LOGIN
    let nextStep = "dashboard";

    if (user.role_id === 2 && user.company_id) {
      const locationCount = await prisma.locations.count({
        where: { company_id: user.company_id, deleted_at: null },
      });

      const company = user.companies || {};
      const hasWorkspace =
        locationCount > 0 || Boolean(company.is_onboarding_completed);
      const hasProfile =
        Boolean(company.name) &&
        company.name !== "Pending Setup" &&
        Boolean(company.onboarding_metadata);

      if (!hasWorkspace) {
        nextStep = !hasProfile ? "company" : "workspace";
      }
    }

    const responsePayload = {
      id: user.id.toString(),
      name: user.name,
      email: user.email,
      phone: user.phone,
      age: user.age,
      role_id: user.role_id,
      company_id: user.company_id?.toString(),
      role: user.role,
      company: user.companies,
      token: token,
    };

    res.json({
      status: "success",
      message: "Login successful",
      user: serializeData(responsePayload),
      nextStep: nextStep, // 👈 Send it to the frontend immediately!
    });
  } catch (err) {
    console.error("Login Error:", err);
    res.status(500).json({ status: "error", message: "Login failed." });
  }
};

export const googleLogin = async (req, res) => {
  const { idToken } = req.body;
  try {
    const ticket = await client.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const { sub: google_id, email, name } = ticket.getPayload();

    // ✅ ADD `companies: true` TO ALL findUnique/update queries
    let user = await prisma.users.findUnique({
      where: { google_id },
      include: { role: true, companies: true },
    });

    if (!user) {
      user = await prisma.users.findUnique({
        where: { email },
        include: { role: true, companies: true },
      });

      if (user) {
        user = await prisma.users.update({
          where: { id: user.id },
          data: { google_id },
          include: { role: true, companies: true },
        });
      } else {
        user = await prisma.users.create({
          data: {
            email: email,
            name: name,
            google_id: google_id,
            role_id: 2,
          },
          include: { role: true, companies: true },
        });
      }
    }

    validateAccess(user);

    const token = generateToken({
      id: user.id.toString(),
      email: user.email,
      role_id: user.role_id,
      permissions: user.role.permissions,
    });

    const responsePayload = {
      status: "success",
      user: { ...user, token },
      company: user.companies || user.company,
    };

    res.json(serializeData(responsePayload));
  } catch (err) {
    console.error("Google Auth Error:", err);
    res
      .status(err.statusCode || 401)
      .json({ error: err.message || "Google authentication failed" });
  }
};
const sendMsg91Otp = async (phone, otp) => {
  const authKey = process.env.MSG91_AUTH_KEY;

  // NOTE: MSG91 provides an alphanumeric Template ID in their dashboard.
  // Do NOT confuse this with the numeric DLT Template ID in your screenshot.
  const templateId = process.env.MSG91_TEMPLATE_ID;

  // MSG91 strictly requires the 91 country code for Indian numbers
  const mobileNumber = phone.length === 10 ? `91${phone}` : phone;

  const options = {
    method: "POST",
    headers: {
      authkey: authKey,
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      template_id: templateId,
      short_url: "0",
      recipients: [
        {
          mobiles: mobileNumber,
          // Mapping directly to ##var## and ##var1## in your approved template
          var: "Safai",
          var1: otp,
        },
      ],
    }),
  };

  const response = await fetch(
    "https://control.msg91.com/api/v5/flow/",
    options,
  );
  const data = await response.json();

  if (data.type === "error") {
    throw new Error(`MSG91 Error: ${data.message}`);
  }

  return data;
};

const MAX_ATTEMPTS = 5;

export const requestOtp = async (req, res) => {
  const { phone, intent } = req.body;

  if (!phone || !intent) {
    return res.status(400).json({ error: "Phone number and intent are required." });
  }

  if (intent === 'register') {
    const existingUser = await prisma.users.findUnique({ where: { phone } });
    if (existingUser) {
      return res.status(409).json({ error: "Phone number already registered. Please login." });
    }
  } else if (intent === 'forgot') {
    const existingUser = await prisma.users.findUnique({ where: { phone } });
    if (!existingUser) {
      return res.status(404).json({ error: "No account found with this phone number." });
    }
  }

  // Cooldown key to prevent spamming SMS APIs
  const cooldownKey = `cooldown:${phone}`;
  const isCoolingDown = await redisClient.get(cooldownKey);

  if (isCoolingDown) {
    return res
      .status(429)
      .json({ error: "Please wait 60 seconds before requesting a new OTP." });
  }

  const code = randomInt(100000, 1000000).toString();

  try {
    const otpData = JSON.stringify({ code, attempts: 0 });

    // Store OTP in Upstash for 10 minutes (600 seconds)
    await redisClient.setEx(`otp:${phone}`, 600, otpData);

    // Lock the phone number for 60 seconds
    await redisClient.setEx(cooldownKey, 60, "locked");

    // 🔥 CALL MSG91 API
    await sendMsg91Otp(phone, code);

    res.json({ status: "success", message: "OTP sent successfully." });
  } catch (err) {
    console.error("OTP Request Error:", err);

    // Optional: If MSG91 fails, delete the Redis cooldown lock so the user can try again immediately
    await redisClient.del(`cooldown:${phone}`);
    await redisClient.del(`otp:${phone}`);

    res
      .status(500)
      .json({ error: "Failed to send OTP SMS. Please try again." });
  }
};

// ==========================================
// 2. VERIFY OTP & STATELESS LOGIN
// ==========================================



export const verifyOtp = async (req, res) => {
  // 1. Add 'intent' to the destructured body (e.g., intent = 'login' or 'register')
  const { phone, code, intent = 'login' } = req.body;

  if (!phone || !code) {
    return res.status(400).json({ error: "Phone and OTP code are required." });
  }

  try {
    const rawData = await redisClient.get(`otp:${phone}`);

    if (!rawData) {
      return res.status(400).json({ error: "OTP expired or does not exist." });
    }

    const otpData = JSON.parse(rawData);

    // Brute-force protection
    if (otpData.attempts >= MAX_ATTEMPTS) {
      await redisClient.del(`otp:${phone}`);
      return res.status(429).json({ error: "Too many failed attempts. Request a new OTP." });
    }

    // Validate the OTP code
    if (otpData.code !== code) {
      otpData.attempts += 1;
      const ttl = await redisClient.ttl(`otp:${phone}`);
      if (ttl > 0) {
        await redisClient.setEx(`otp:${phone}`, ttl, JSON.stringify(otpData));
      }
      return res.status(400).json({
        error: `Invalid OTP. You have ${MAX_ATTEMPTS - otpData.attempts} attempts left.`,
      });
    }

    // Success: Delete the OTP key immediately
    const deletedCount = await redisClient.del(`otp:${phone}`);

    if (deletedCount === 0) {
      return res.status(400).json({ error: "OTP has already been verified." });
    }

    // 🔥 2. NEW LOGIC: If they are just verifying for registration, stop here and return success.
    if (intent === 'register') {
      const { generateRegistrationToken } = await import("../utils/jwt.js");
      const registrationToken = generateRegistrationToken({ phone });
      return res.json({
        status: "success",
        message: "OTP verified. Proceed to account creation.",
        registrationToken
      });
    }
    
    if (intent === 'forgot') {
      const { generateRegistrationToken } = await import("../utils/jwt.js");
      const registrationToken = generateRegistrationToken({ phone });
      return res.json({
        status: "success",
        message: "OTP verified. Proceed to reset password.",
        registrationToken
      });
    }

    // 🔥 3. ORIGINAL LOGIC: Proceed with DB checks and JWT generation for Login
    let user = await prisma.users.findUnique({
      where: { phone },
      include: { role: true },
    });

    if (!user) {
      try {
        user = await prisma.users.create({
          data: { phone, role_id: 2 },
          include: { role: true },
        });
      } catch (err) {
        if (err.code === 'P2002') {
          return res.status(400).json({
            error: "This phone number might belong to a deactivated account. Please contact support."
          });
        }
        throw err;
      }
    }

    const token = generateToken({
      id: user.id.toString(),
      email: user.email,
      company_id: user.company_id?.toString(),
      role_id: user.role_id,
      permissions: user.role?.permissions,
    });

    const responsePayload = {
      status: "success",
      message: "Logged in successfully",
      user: { ...user, token },
    };

    res.json(serializeData(responsePayload));
  } catch (err) {
    console.error("OTP Verification Error:", err);
    res.status(500).json({ error: "Failed to verify OTP." });
  }
};



// export const verifyOtp = async (req, res) => {
//   const { phone, code } = req.body;

//   if (!phone || !code) {
//     return res.status(400).json({ error: "Phone and OTP code are required." });
//   }

//   try {
//     const rawData = await redisClient.get(`otp:${phone}`);

//     if (!rawData) {
//       return res.status(400).json({ error: "OTP expired or does not exist." });
//     }

//     const otpData = JSON.parse(rawData);

//     // Brute-force protection
//     if (otpData.attempts >= MAX_ATTEMPTS) {
//       await redisClient.del(`otp:${phone}`);
//       return res
//         .status(429)
//         .json({ error: "Too many failed attempts. Request a new OTP." });
//     }

//     // Validate the OTP code
//     if (otpData.code !== code) {
//       otpData.attempts += 1;
//       const ttl = await redisClient.ttl(`otp:${phone}`);
//       if (ttl > 0) {
//         await redisClient.setEx(`otp:${phone}`, ttl, JSON.stringify(otpData));
//       }
//       return res
//         .status(400)
//         .json({
//           error: `Invalid OTP. You have ${MAX_ATTEMPTS - otpData.attempts} attempts left.`,
//         });
//     }

//     // Success: Delete the OTP key immediately so it cannot be reused
//     await redisClient.del(`otp:${phone}`);

//     // Database check/create
//     let user = await prisma.users.findUnique({
//       where: { phone },
//       include: { role: true },
//     });

//     if (!user) {
//       user = await prisma.users.create({
//         data: { phone, role_id: 2 },
//         include: { role: true },
//       });
//     }

//     // 1. Use your existing generateToken helper! (This fixes the JWT_SECRETS typo automatically)
//     const token = generateToken({
//       id: user.id.toString(),
//       email: user.email,
//       company_id: user.company_id?.toString(),
//       role_id: user.role_id,
//       permissions: user.role?.permissions,
//     });

//     // 2. Build the payload
//     const responsePayload = {
//       status: "success",
//       message: "Logged in successfully",
//       user: { ...user, token },
//     };

//     // 3. Run it through your awesome serializeData function to kill all nested BigInts!
//     res.json(serializeData(responsePayload));
//   } catch (err) {
//     console.error("OTP Verification Error:", err);
//     res.status(500).json({ error: "Failed to verify OTP." });
//   }
// };



export const resetPassword = async (req, res) => {
  const { phone, newPassword } = req.body;

  if (!phone || !newPassword) {
    return res
      .status(400)
      .json({ error: "Phone number and new password are required." });
  }

  try {
    const user = await prisma.users.findUnique({
      where: { phone },
    });

    if (!user) {
      return res
        .status(404)
        .json({ error: "No account found with this phone number." });
    }

    // Hash the new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update the user's password
    await prisma.users.update({
      where: { phone },
      data: { password: hashedPassword },
    });

    res.json({
      status: "success",
      message: "Password updated successfully. You can now login.",
    });
  } catch (err) {
    console.error("Reset Password Error:", err);
    res
      .status(500)
      .json({ error: "Failed to reset password. Please try again." });
  }
};

export const getOnboardingStatus = async (req, res) => {
  console.log("Fetching onboarding status for user:", req.user);
  try {
    const companyId = req.user.company_id;
    if (!companyId) {
      return res
        .status(400)
        .json({ message: "No company associated with this user." });
    }

    const company = await prisma.companies.findUnique({
      where: { id: BigInt(companyId) },
    });

    if (!company) {
      return res.status(404).json({ message: "Company not found." });
    }
    const locationCount = await prisma.locations.count({
      where: {
        company_id: BigInt(companyId),
        deleted_at: null,
      },
    });

    const hasWorkspace =
      locationCount > 0 || Boolean(company.is_onboarding_completed);
    const hasProfile =
      Boolean(company.name) &&
      company.name !== "Pending Setup" &&
      Boolean(company.onboarding_metadata);

    let nextStep = "dashboard";

    if (!hasWorkspace) {
      if (!hasProfile) nextStep = "company";
      else nextStep = "workspace";
    }

    res.status(200).json({
      success: true,
      companyProfileCompleted: Boolean(hasProfile),
      workspaceExists: Boolean(hasWorkspace),
      isOnboardingCompleted: Boolean(company.is_onboarding_completed) || Boolean(hasWorkspace),
      is_onboarding_completed: Boolean(company.is_onboarding_completed) || Boolean(hasWorkspace),
      nextStep,
      company: {
        id: company.id.toString(),
        name: company.name,
        is_onboarding_completed: Boolean(company.is_onboarding_completed) || Boolean(hasWorkspace),
        onboarding_metadata: company.onboarding_metadata,
      },
    });
  } catch (error) {
    console.error("Error fetching onboarding status:", error);
    res.status(500).json({ success: false, message: "Failed to fetch onboarding status" });
  }
};
