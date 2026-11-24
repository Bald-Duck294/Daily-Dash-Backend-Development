// // middleware/auth.js
// export function verifyToken(req, res, next) {
//   const authHeader = req.headers.authorization;
//   if (!authHeader) return res.status(401).json({ error: "No token" });

//   const token = authHeader.split(" ")[1];

//   console.log(token , "token")

//   // Instead of jwt.verify, just compare against a hardcoded one
//   if (
//     token ==
//     "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEyMywiaWF0IjoxNzU1MzM5MjQ2LCJleHAiOjE3NTU0MjU2NDZ9.0G8-AwtdCjU2Uigje3x3x7h-4n9k0smH-VF5FWvYEe0"
//   ) {
//     req.user = { id: 1, email: "test@example.com", role: "admin" };
//     return next();
//   }

//   return res.status(403).json({ error: "Invalid token" });
// }


// middleware/auth.js
import jwt from 'jsonwebtoken';
import dotenv from "dotenv";
dotenv.config();

const getJwtSecret = () => {
  return (
    process.env.JWT_SECRETS?.trim() ||
    process.env.JWT_SECRET?.trim() ||
    "53-0t9wgwpowgjp3-i3itdglkn"
  );
};

export const verifyToken = (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    // console.log(authHeader, "authheader");

    if (!authHeader) {
      return res.status(401).json({ message: 'No token provided' });
    }

    // Extract token from "Bearer <token>"
    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      return res.status(401).json({ message: 'Malformed token' });
    }

    // console.log(parts, "parts");
    const token = parts[1];
    const secret = getJwtSecret();

    // Verify token and extract payload
    const decoded = jwt.verify(token, secret);

    // console.log(decoded, "decoded")

    // Set req.user with all necessary data
    req.user = {
      id: decoded.id,
      role_id: decoded.role_id,
      company_id: decoded.company_id,
      email: decoded.email,
      permissions: decoded.permissions || []
    };

    // console.log('User authenticated:', req.user);
    next();

  } catch (error) {
    console.error('Auth error:', error.message);

    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Token expired' });
    }

    return res.status(403).json({ message: 'Invalid token' });
  }
};

export default { verifyToken };
