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
// controllers/authController.js

// export const loginUser = async (req, res) => {
//   console.log('in login controller');
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

//     //  BLOCK: Roles without dashboard access (e.g., cleaner)
//     const NO_DASHBOARD_ROLES = [5]; //  role IDs that can't access dashboard

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

//     // Generate token
//     const token = generateToken({
//       id: serializeUser.id,
//       email: user.email,
//       role_id: user.role_id,
//       company_id: serializeUser.company_id
//     });

//     // Update user token in DB
//     await prisma.users.update({
//       where: { id: user.id },
//       data: { token: token }
//     });

//     console.log('✅ Login successful:', user.name, '(' + user.role.name + ')');

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

// controllers/authController.js

export const loginUser = async (req, res) => {
  // console.log('in login controller');
  const { phone, password } = req.body;

  if (!phone || !password) {
    return res.status(400).json({ error: "Phone and password are required." });
  }

  try {
    const user = await prisma.users.findUnique({
      where: { phone },
      include: {
        role: {
          select: {
            id: true,
            name: true,
            permissions: true,
          },
        },
      },
    });

    if (!user) {
      return res.status(404).json({
        error: "error",
        message: "User not found!",
      });
    }

    // ✅ BLOCK: Roles without dashboard access
    const NO_DASHBOARD_ROLES = [5];

    if (NO_DASHBOARD_ROLES.includes(user.role_id)) {
      return res.status(403).json({
        status: "error",
        message:
          "Dashboard access is not available for your role. Please use the mobile app.",
      });
    }

    // Verify password
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({
        status: "error",
        message: "Password does not match!",
      });
    }

    // ✅ Validate role and permissions
    if (!user.role || !Array.isArray(user.role.permissions)) {
      console.error("❌ User role missing permissions:", user.id);
      return res.status(500).json({
        status: "error",
        message: "Invalid role configuration. Please contact support.",
      });
    }

    const serializeUser = {
      ...user,
      id: user?.id?.toString(),
      company_id: user?.company_id?.toString(),
    };

    // ✅ FIX: Include permissions in token payload
    const token = generateToken({
      id: serializeUser.id,
      email: user.email,
      role_id: user.role_id,
      company_id: serializeUser.company_id,
      permissions: user.role.permissions, // ✅ ADD THIS!
    });

    // Update user token in DB
    await prisma.users.update({
      where: { id: user.id },
      data: { token: token },
    });

    // console.log('✅ Login successful:', user.name, '(' + user.role.name + ')');
    // console.log('✅ Permissions included in token:', user.role.permissions.length);
    const companyData = await prisma.companies.findUnique({
      where: { id: BigInt(user.company_id) },
      select: {
        name: true,
        is_onboarding_completed: true,
        onboarding_metadata: true,
      },
    });
    // Return success response
    res.json({
      status: "success",
      message: "Login successful",
      user: {
        id: user.id.toString(),
        name: user.name,
        email: user.email,
        phone: user.phone,
        age: user.age,
        role_id: user.role_id,
        company_id: user.company_id?.toString(),
        role: user.role,
        token: token,
      },
      company: {
        name: companyData.name,
        is_onboarding_completed: companyData.is_onboarding_completed,
        metadata: companyData.onboarding_metadata,
      },
    });
  } catch (err) {
    console.error("Login Error:", err);
    res.status(500).json({ error: "Login failed." });
  }
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
