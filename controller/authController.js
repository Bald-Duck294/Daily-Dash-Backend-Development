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

export const registerUser = async (req, res) => {
  // ❌ Removed company_name from requirements
  const { name, email, phone, password, role_id, age, birthdate } = req.body;

  if (!phone || !password) {
    return res.status(400).json({
      error: "Phone and Password fields are required.",
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
export const loginUser = async (req, res) => {
  const { phone, password } = req.body;
  if (!phone || !password)
    return res.status(400).json({ error: "Phone and password required." });

  try {
    // ✅ ADD `companies: true` TO INCLUDE
    const user = await prisma.users.findUnique({
      where: { phone },
      include: { role: true, companies: true }, // Use 'company: true' if your schema names it that way
    });

    if (!user || !user.password)
      return res.status(401).json({ error: "Invalid credentials." });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch)
      return res.status(401).json({ error: "Invalid credentials." });

    validateAccess(user);

    const token = generateToken({
      id: user.id.toString(),
      email: user.email,
      company_id: user.company_id?.toString(),
      role_id: user.role_id,
      permissions: user.role.permissions,
    });

    await prisma.users.update({ where: { id: user.id }, data: { token } });

    const responsePayload = {
      status: "success",
      user: { ...user, token }, // No more sanitizeUser here
      company: user.companies || user.company,
    };
    res.json(serializeData(responsePayload));
  } catch (err) {
    res
      .status(err.statusCode || 500)
      .json({ error: err.message || "Login failed" });
  }
};

// --- 2. GOOGLE LOGIN ---
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
export const requestOtp = async (req, res) => {
  const { phone } = req.body;

  if (!phone) {
    return res.status(400).json({ error: "Phone number is required." });
  }

  // 1. Generate a random 6-digit OTP
  const code = Math.floor(100000 + Math.random() * 900000).toString();

  // 2. Set expiry (e.g., 10 minutes from now)
  const expires_at = new Date(Date.now() + 10 * 60 * 1000);

  try {
    // 3. Save or Update OTP in database
    await prisma.otps.upsert({
      where: { phone },
      update: { code, expires_at },
      create: { phone, code, expires_at },
    });

    // 4. In a real app, you would send this via SMS (Twilio/Msg91)
    console.log(`[DEBUG] OTP for ${phone} is: ${code}`);

    res.json({ status: "success", message: "OTP sent successfully." });
  } catch (err) {
    console.error("OTP Request Error:", err);
    res.status(500).json({ error: "Failed to generate OTP." });
  }
};

// --- 3. OTP LOGIN ---
export const verifyOtp = async (req, res) => {
  const { phone, code } = req.body;
  const otpRecord = await prisma.otps.findUnique({ where: { phone } });

  if (
    !otpRecord ||
    otpRecord.code !== code ||
    new Date() > otpRecord.expires_at
  ) {
    return res.status(400).json({ error: "Invalid or expired OTP" });
  }

  let user = await prisma.users.findUnique({
    where: { phone },
    include: { role: true },
  });

  if (!user) {
    user = await prisma.users.create({
      data: { phone, role_id: 2 },
      include: { role: true },
    });
  }

  validateAccess(user);
  const token = generateToken({
    id: user.id.toString(),
    role_id: user.role_id,
    permissions: user.role.permissions,
  });
  res.json({ status: "success", user: { ...user, token } });
};

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
