import prisma from "../config/prismaClient.mjs";
import bcrypt from "bcryptjs";
import { generateToken } from "../utils/jwt.js"

export const registerUser = async (req, res) => {
  const { name, email, phone, password, role_id, company_id, age, birthdate } =
    req.body;

  if (!phone || !password) {
    return res.status(400).json({
      error: " Phone, and Password fields are required.",
    });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);

    const existing_user = await prisma.users.findUnique({
      where: { phone },
    });

    if (existing_user) {
      return res.status(409).json({
        status: "error",
        message: "Phone No. already exists, please try another one!",
      });
    }

    // Build the base data object
    const data = {
      name,
      email,
      phone,
      password: hashedPassword,
      role_id: role_id || null,
      age: age || null,
      birthdate: birthdate || null,
    };

    // Conditionally add relation
    if (company_id) {
      data.companies = { connect: { id: company_id } };
    }

    // Create the user with full data
    const user = await prisma.users.create({ data });

    res.status(201).json({
      message: "User registered",
      userId: user.id.toString(),
    });
  } catch (err) {
    console.error("Registration Error:", err);
    res.status(500).json({ error: "User registration failed." });
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
            permissions: true
          }
        }
      }
    });

    if (!user) {
      return res.status(404).json({
        error: "error",
        message: "User not found!"
      });
    }

    // ✅ BLOCK: Roles without dashboard access
    const NO_DASHBOARD_ROLES = [5];

    if (NO_DASHBOARD_ROLES.includes(user.role_id)) {
      return res.status(403).json({
        status: "error",
        message: "Dashboard access is not available for your role. Please use the mobile app.",
      });
    }

    // Verify password
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({
        status: "error",
        message: "Password does not match!"
      });
    }

    // ✅ Validate role and permissions
    if (!user.role || !Array.isArray(user.role.permissions)) {
      console.error('❌ User role missing permissions:', user.id);
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
      data: { token: token }
    });

    // console.log('✅ Login successful:', user.name, '(' + user.role.name + ')');
    // console.log('✅ Permissions included in token:', user.role.permissions.length);

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
        token: token
      },
    });
  } catch (err) {
    console.error("Login Error:", err);
    res.status(500).json({ error: "Login failed." });
  }
};
