import jwt from "jsonwebtoken";
import User from "../models/User.js";

// ======================================================
// Protect Middleware
// ======================================================
// Checks:
// 1. Authorization header exists
// 2. Bearer token exists
// 3. JWT_SECRET exists
// 4. JWT is valid
// 5. User exists
// 6. User account is active
// ======================================================

export const protect = async (req, res, next) => {
  try {
    // --------------------------------------------------
    // Check JWT Secret
    // --------------------------------------------------

    if (!process.env.JWT_SECRET) {
      console.error("❌ JWT_SECRET is missing in .env");

      return res.status(500).json({
        success: false,
        message: "Server authentication configuration error.",
      });
    }

    // --------------------------------------------------
    // Get Authorization Header
    // --------------------------------------------------

    const authorization = req.headers.authorization;

    if (!authorization) {
      return res.status(401).json({
        success: false,
        message: "Not authorized. Authorization header missing.",
      });
    }

    // --------------------------------------------------
    // Check Bearer Token
    // --------------------------------------------------

    if (!authorization.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Not authorized. Invalid authorization format.",
      });
    }

    // --------------------------------------------------
    // Extract Token
    // --------------------------------------------------

    const token = authorization
      .slice(7)
      .trim();

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Not authorized. No token provided.",
      });
    }

    // --------------------------------------------------
    // Verify JWT
    // --------------------------------------------------

    let decoded;

    try {
      decoded = jwt.verify(
        token,
        process.env.JWT_SECRET
      );
    } catch (error) {
      if (error.name === "TokenExpiredError") {
        return res.status(401).json({
          success: false,
          message: "Authentication token has expired.",
        });
      }

      if (error.name === "JsonWebTokenError") {
        return res.status(401).json({
          success: false,
          message: "Invalid authentication token.",
        });
      }

      return res.status(401).json({
        success: false,
        message: "Authentication failed.",
      });
    }

    // --------------------------------------------------
    // Validate Decoded Token
    // --------------------------------------------------

    if (!decoded || !decoded.id) {
      return res.status(401).json({
        success: false,
        message: "Invalid authentication token.",
      });
    }

    // --------------------------------------------------
    // Find User
    // --------------------------------------------------
    // Password automatically excluded because
    // User.js contains:
    //
    // password: {
    //   select: false
    // }
    // --------------------------------------------------

    const user = await User.findById(decoded.id);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "User not found.",
      });
    }

    // --------------------------------------------------
    // Check Account Status
    // --------------------------------------------------

    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        message: "Your account has been deactivated.",
      });
    }

    // --------------------------------------------------
    // Attach User To Request
    // --------------------------------------------------

    req.user = user;

    // --------------------------------------------------
    // Continue
    // --------------------------------------------------

    next();
  } catch (error) {
    console.error(
      "❌ Authentication Middleware Error:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Authentication server error.",
    });
  }
};

// ======================================================
// Admin Only Middleware
// ======================================================
// IMPORTANT:
// adminOnly ko protect ke BAAD use karna hai.
//
// Example:
//
// router.post(
//   "/",
//   protect,
//   adminOnly,
//   controller
// );
// ======================================================

export const adminOnly = (req, res, next) => {
  try {
    // --------------------------------------------------
    // User Check
    // --------------------------------------------------

    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Not authorized.",
      });
    }

    // --------------------------------------------------
    // Admin Role Check
    // --------------------------------------------------

    if (req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Admin access required.",
      });
    }

    // --------------------------------------------------
    // Continue
    // --------------------------------------------------

    next();
  } catch (error) {
    console.error(
      "❌ Admin Middleware Error:",
      error
    );

    return res.status(403).json({
      success: false,
      message: "Admin access required.",
    });
  }
};

export default {
  protect,
  adminOnly,
};