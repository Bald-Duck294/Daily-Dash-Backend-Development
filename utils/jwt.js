// import jwt from "jsonwebtoken";

// const secret = "defaultSecret"; // keep it constant for tests

// // Generate token once
// export const generateToken = () => {
//   return jwt.sign(
//     { id: 1, email: "test@example.com", role: "admin" },
//     secret,
//     { noTimestamp: true } // no iat/exp
//   );
// };

// // Middleware
// export const verifyToken = (req, res, next) => {
//   console.log('in verify token')
//   const authHeader = req.headers["authorization"];
//   console.log(authHeader , "auth headers");
//   if (!authHeader) {
//     return res.status(401).json({ message: "No token provided" });
//   }

// const parts = authHeader.split(" ");
// if (parts.length !== 2 || parts[0] !== "Bearer") {
//   return res.status(401).json({ message: "Malformed token" });
// }

// const token = parts[1]; // only the <token> part
// console.log(token, "token");

//   const token = authHeader; // expect "Bearer <token>"

//   console.log(token , "token ")
//   try {
//     const decoded = jwt.verify(token, secret);
//     req.user = decoded;
//     next();
//   } catch (err) {
//     return res.status(403).json({ message: "Invalid token" });
//   }
// };

// import jwt from "jsonwebtoken";

// const secret = "defaultSecret"; // must be SAME everywhere

// export const generateToken = (payload) => {
//   return jwt.sign(payload, secret);
// };


// export const verifyToken = (req, res, next) => {
//   // console.log("in verify token 222");


// // console.log(req?.authorization , "auth type");
//   const authHeader = req.headers["authorization"]; // "Bearer <token>"
//   // console.log(authHeader , "authheaders");
//   // console.log(authHeader.split(" "), "auth headers");

//   if (!authHeader) {
//     return res.status(401).json({ message: "No token provided" });
//   }

//   // ✅ Extract token after "Bearer "
//   const parts = authHeader.split(" ");
//   if (parts.length !== 2 || parts[0] !== "Bearer") {
//     return res.status(401).json({ message: "Malformed token" });
//   }

//   const token = parts[1]; // only the <token> part
//   // console.log(token, "token");

//   try {
//     const decoded = jwt.verify(token, secret);
//     // console.log(decoded, "decoded");
//     req.user = decoded;
//     next();
//   } catch (err) {
//     return res.status(403).json({ message: "Invalid token " });
//   }
// };


// utils/jwt.js
import jwt from 'jsonwebtoken';
import dotenv from "dotenv";
dotenv.config();


const JWT_SECRET = process.env.JWT_SECRETS || 'your-secret-key-change-in-production';
const JWT_EXPIRY = '24h';  // Token expires in 24 hours


console.log('JWT_SECRET loaded:', JWT_SECRET ? 'YES' : 'NO');  // Debug log
console.log("jwt secret", JWT_SECRET)

export const generateToken = (payload) => {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY });
};

console.log('expired time', JWT_EXPIRY);
export const verifyTokenUtil = (token) => {

  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    console.error('Token verification failed:', error.message);
    return null;
  }
};

export const generateRegistrationToken = (payload) => {
  return jwt.sign(
    { ...payload, purpose: "registration", verified: true },
    JWT_SECRET,
    { expiresIn: '5m' }
  );
};

export const verifyRegistrationToken = (token) => {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.purpose !== "registration") return null;
    return decoded;
  } catch (error) {
    console.error('Registration token verification failed:', error.message);
    return null;
  }
};

export default { generateToken, verifyTokenUtil, generateRegistrationToken, verifyRegistrationToken };
