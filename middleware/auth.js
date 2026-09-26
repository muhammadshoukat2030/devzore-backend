import jwt from "jsonwebtoken";
import User from "../models/User.js";

// ======================================================
// AUTHENTICATION MIDDLEWARE
// ======================================================
//
// protect:
// 1. Authorization header check karta hai
// 2. Bearer token extract karta hai
// 3. JWT verify karta hai
// 4. JWT se user ID nikalta hai
// 5. MongoDB se user find karta hai
// 6. Account active check karta hai
// 7. req.user set karta hai
//
// Usage:
//
// router.post(
//   "/",
//   protect,
//   adminOnly,
//   controller
// );
//
// ======================================================


// ======================================================
// PROTECT MIDDLEWARE
// ======================================================

export const protect = async (req, res, next) => {
  try {
    // --------------------------------------------------
    // 1. JWT SECRET CHECK
    // --------------------------------------------------

    const jwtSecret = process.env.JWT_SECRET;

    if (!jwtSecret) {
      console.error(
        "❌ AUTH ERROR: JWT_SECRET is missing in environment variables."
      );

      return res.status(500).json({
        success: false,
        message: "Server authentication configuration error.",
      });
    }


    // --------------------------------------------------
    // 2. AUTHORIZATION HEADER
    // --------------------------------------------------

    const authorization =
      req.headers.authorization ||
      req.headers.Authorization;

    if (!authorization) {
      console.warn(
        `⚠️ AUTH FAILED: Authorization header missing → ${req.method} ${req.originalUrl}`
      );

      return res.status(401).json({
        success: false,
        message: "Not authorized. Authorization header missing.",
      });
    }


    // --------------------------------------------------
    // 3. BEARER FORMAT CHECK
    // --------------------------------------------------

    const parts = authorization.trim().split(/\s+/);

    if (
      parts.length !== 2 ||
      parts[0].toLowerCase() !== "bearer"
    ) {
      console.warn(
        `⚠️ AUTH FAILED: Invalid Authorization format → ${req.method} ${req.originalUrl}`
      );

      return res.status(401).json({
        success: false,
        message:
          "Not authorized. Authorization header must use Bearer token format.",
      });
    }


    // --------------------------------------------------
    // 4. EXTRACT TOKEN
    // --------------------------------------------------

    const token = parts[1]?.trim();

    if (!token) {
      console.warn(
        `⚠️ AUTH FAILED: JWT token missing → ${req.method} ${req.originalUrl}`
      );

      return res.status(401).json({
        success: false,
        message: "Not authorized. No token provided.",
      });
    }


    // --------------------------------------------------
    // 5. VERIFY JWT
    // --------------------------------------------------

    let decoded;

    try {
      decoded = jwt.verify(
        token,
        jwtSecret
      );
    } catch (error) {
      // Token expired
      if (error.name === "TokenExpiredError") {
        console.warn(
          `⚠️ AUTH FAILED: JWT expired → ${req.method} ${req.originalUrl}`
        );

        return res.status(401).json({
          success: false,
          message: "Authentication token has expired. Please login again.",
          code: "TOKEN_EXPIRED",
        });
      }

      // Invalid JWT
      if (error.name === "JsonWebTokenError") {
        console.warn(
          `⚠️ AUTH FAILED: Invalid JWT → ${req.method} ${req.originalUrl}`
        );

        return res.status(401).json({
          success: false,
          message: "Invalid authentication token.",
          code: "INVALID_TOKEN",
        });
      }

      // Token not active yet
      if (error.name === "NotBeforeError") {
        console.warn(
          `⚠️ AUTH FAILED: JWT not active yet → ${req.method} ${req.originalUrl}`
        );

        return res.status(401).json({
          success: false,
          message: "Authentication token is not active yet.",
          code: "TOKEN_NOT_ACTIVE",
        });
      }

      console.error(
        "❌ JWT verification error:",
        error.message
      );

      return res.status(401).json({
        success: false,
        message: "Authentication failed.",
      });
    }


    // --------------------------------------------------
    // 6. GET USER ID FROM JWT
    // --------------------------------------------------
    //
    // Different login implementations may generate:
    //
    // { id: user._id }
    //
    // OR
    //
    // { userId: user._id }
    //
    // OR
    //
    // { _id: user._id }
    //
    // Supporting all three prevents unnecessary 401 errors.
    // --------------------------------------------------

    const userId =
      decoded?.id ||
      decoded?.userId ||
      decoded?._id;

    if (!userId) {
      console.warn(
        "⚠️ AUTH FAILED: JWT payload does not contain a user ID."
      );

      return res.status(401).json({
        success: false,
        message: "Invalid authentication token payload.",
        code: "INVALID_TOKEN_PAYLOAD",
      });
    }


    // --------------------------------------------------
    // 7. FIND USER IN DATABASE
    // --------------------------------------------------

    let user;

    try {
      user = await User.findById(userId);
    } catch (error) {
      console.error(
        "❌ Database user lookup error:",
        error.message
      );

      return res.status(401).json({
        success: false,
        message: "Invalid user authentication.",
      });
    }


    // --------------------------------------------------
    // 8. USER EXISTS CHECK
    // --------------------------------------------------

    if (!user) {
      console.warn(
        `⚠️ AUTH FAILED: User not found for ID ${userId}`
      );

      return res.status(401).json({
        success: false,
        message: "User associated with this token was not found.",
        code: "USER_NOT_FOUND",
      });
    }


    // --------------------------------------------------
    // 9. ACCOUNT ACTIVE CHECK
    // --------------------------------------------------
    //
    // IMPORTANT:
    //
    // Only block when isActive is explicitly false.
    //
    // This means old users without an isActive field
    // will continue to work.
    // --------------------------------------------------

    if (user.isActive === false) {
      console.warn(
        `⚠️ AUTH FAILED: User account disabled → ${userId}`
      );

      return res.status(403).json({
        success: false,
        message: "Your account has been deactivated.",
        code: "ACCOUNT_DISABLED",
      });
    }


    // --------------------------------------------------
    // 10. ATTACH USER TO REQUEST
    // --------------------------------------------------

    req.user = user;

    // Optional useful value for controllers
    req.userId = user._id;


    // --------------------------------------------------
    // 11. AUTH SUCCESS
    // --------------------------------------------------

    console.log(
      `🔐 AUTH OK → ${req.method} ${req.originalUrl} | ${user.email || user._id}`
    );

    return next();

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
// ADMIN ONLY MIDDLEWARE
// ======================================================
//
// IMPORTANT:
//
// Always use AFTER protect:
//
// router.post(
//   "/image",
//   protect,
//   adminOnly,
//   upload.single("image"),
//   controller
// );
//
// ======================================================

export const adminOnly = (
  req,
  res,
  next
) => {
  try {
    // --------------------------------------------------
    // 1. USER MUST EXIST
    // --------------------------------------------------

    if (!req.user) {
      console.warn(
        `⚠️ ADMIN AUTH FAILED: req.user missing → ${req.method} ${req.originalUrl}`
      );

      return res.status(401).json({
        success: false,
        message: "Not authorized.",
      });
    }


    // --------------------------------------------------
    // 2. ROLE CHECK
    // --------------------------------------------------

    const role =
      typeof req.user.role === "string"
        ? req.user.role.toLowerCase().trim()
        : "";

    if (role !== "admin") {
      console.warn(
        `⚠️ ADMIN ACCESS DENIED → User: ${
          req.user.email || req.user._id
        } | Role: ${role || "missing"}`
      );

      return res.status(403).json({
        success: false,
        message: "Admin access required.",
        code: "ADMIN_REQUIRED",
      });
    }


    // --------------------------------------------------
    // 3. ADMIN VERIFIED
    // --------------------------------------------------

    console.log(
      `👑 ADMIN OK → ${req.method} ${req.originalUrl}`
    );

    return next();

  } catch (error) {
    console.error(
      "❌ Admin Middleware Error:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Admin authorization error.",
    });
  }
};


// ======================================================
// DEFAULT EXPORT
// ======================================================

export default {
  protect,
  adminOnly,
};