import express from "express";
import jwt from "jsonwebtoken";
import { body, validationResult } from "express-validator";

import User from "../models/User.js";
import { protect } from "../middleware/auth.js";

const router = express.Router();




/* =========================================================
   Generate JWT Token
========================================================= */

const generateToken = (userId) => {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is missing in .env");
  }

  return jwt.sign(
    {
      id: userId,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: process.env.JWT_EXPIRE || "7d",
    }
  );
};

/* =========================================================
   Validation Helper
========================================================= */

const handleValidationErrors = (req, res) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: errors.array(),
    });

    return false;
  }

  return true;
};

/* =========================================================
   POST /api/auth/register

   Public registration

   IMPORTANT:
   Public user can NEVER create an admin account.
========================================================= */

router.post(
  "/register",

  [
    body("name")
      .trim()
      .notEmpty()
      .withMessage("Name is required")
      .isLength({ max: 50 })
      .withMessage("Name cannot exceed 50 characters"),

    body("email")
      .trim()
      .isEmail()
      .withMessage("Please enter a valid email")
      .normalizeEmail(),

    body("password")
      .isLength({ min: 6 })
      .withMessage("Password must be at least 6 characters"),
  ],

  async (req, res) => {
    try {
      /* -----------------------------------------
         Validate
      ----------------------------------------- */

      if (!handleValidationErrors(req, res)) {
        return;
      }

      const {
        name,
        email,
        password,
      } = req.body;

      /* -----------------------------------------
         Check existing user
      ----------------------------------------- */

      const existingUser = await User.findOne({
        email: email.toLowerCase(),
      });

      if (existingUser) {
        return res.status(409).json({
          success: false,
          message: "Email already registered",
        });
      }

      /* -----------------------------------------
         Create user

         NEVER accept role from req.body
      ----------------------------------------- */

      const user = await User.create({
        name: name.trim(),
        email: email.toLowerCase(),
        password,
        role: "author",
        isActive: true,
      });

      /* -----------------------------------------
         Generate JWT
      ----------------------------------------- */

      const token = generateToken(user._id);

      /* -----------------------------------------
         Response
      ----------------------------------------- */

      return res.status(201).json({
        success: true,
        message: "Registration successful",
        token,
        user,
      });
    } catch (error) {
      console.error("❌ Register Error:", error);

      /* Duplicate email protection */
      if (error.code === 11000) {
        return res.status(409).json({
          success: false,
          message: "Email already registered",
        });
      }

      return res.status(500).json({
        success: false,
        message: error.message || "Registration failed",
      });
    }
  }
);


// ======================================================
// GET /api/auth/setup-admin
// Create / Reset Admin from .env
// Browser friendly
// ======================================================

router.get("/setup-admin", async (req, res) => {
  try {
    // ==================================================
    // CHECK SETUP KEY
    // ==================================================

    const key = req.query.key;
    if (!process.env.SETUP_ADMIN_KEY) {
      return res.status(500).json({
        success: false,
        message: "SETUP_ADMIN_KEY is missing in .env",
      });
    }

    if (!key) {
      return res.status(401).json({
        success: false,
        message: "Setup key is required.",
      });
    }

    if (key !== process.env.SETUP_ADMIN_KEY) {
      return res.status(403).json({
        success: false,
        message: "Invalid setup key.",
      });
    }

    // ==================================================
    // ADMIN DATA FROM .ENV
    // ==================================================

    const adminName = process.env.ADMIN_NAME;
    const adminEmail =
      process.env.ADMIN_EMAIL?.toLowerCase().trim();
    const adminPassword = process.env.ADMIN_PASSWORD;
    const adminRole = process.env.ADMIN_ROLE;

    // ==================================================
    // CHECK ENV
    // ==================================================

    if (
      !adminName ||
      !adminEmail ||
      !adminPassword ||
      !adminRole
    ) {
      return res.status(500).json({
        success: false,
        message:
          "ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD and ADMIN_ROLE are required in .env",
      });
    }

    // ==================================================
    // FIND EXISTING USER
    // ==================================================

    let admin = await User.findOne({
      email: adminEmail,
    }).select("+password");

    // ==================================================
    // CREATE ADMIN
    // ==================================================

    if (!admin) {
      admin = new User({
        name: adminName,
        email: adminEmail,
        password: adminPassword,
        role: adminRole,
        isActive: true,
      });

      await admin.save();

      return res.status(201).json({
        success: true,
        message: "Admin account created successfully.",
        admin: {
          id: admin._id,
          name: admin.name,
          email: admin.email,
          role: admin.role,
          isActive: admin.isActive,
        },
      });
    }

    // ==================================================
    // UPDATE / RESET EXISTING ADMIN
    // ==================================================

    admin.name = adminName;
    admin.email = adminEmail;
    admin.password = adminPassword;
    admin.role = adminRole;
    admin.isActive = true;

    await admin.save();

    return res.status(200).json({
      success: true,
      message: "Admin account updated successfully.",
      admin: {
        id: admin._id,
        name: admin.name,
        email: admin.email,
        role: admin.role,
        isActive: admin.isActive,
      },
    });

  } catch (error) {
    console.error("❌ Setup Admin Error:", error);

    return res.status(500).json({
      success: false,
      message:
        error.message ||
        "Failed to setup admin account.",
    });
  }
});


/* =========================================================
   POST /api/auth/login

   Login admin/author
========================================================= */

router.post(
  "/login",

  [
    body("email")
      .trim()
      .isEmail()
      .withMessage("Please enter a valid email")
      .normalizeEmail(),

    body("password")
      .notEmpty()
      .withMessage("Password is required"),
  ],

  async (req, res) => {
    try {
      /* -----------------------------------------
         Validate
      ----------------------------------------- */

      if (!handleValidationErrors(req, res)) {
        return;
      }

      const {
        email,
        password,
      } = req.body;

      /* -----------------------------------------
         Find user

         Password has select:false
         in User model.

         Therefore:
         .select("+password")
      ----------------------------------------- */

      const user = await User.findOne({
        email: email.toLowerCase(),
      }).select("+password");

      /* -----------------------------------------
         Invalid credentials
      ----------------------------------------- */

      if (!user) {
        return res.status(401).json({
          success: false,
          message: "Invalid email or password",
        });
      }

      /* -----------------------------------------
         Check password
      ----------------------------------------- */

      const passwordMatch =
        await user.comparePassword(password);

      if (!passwordMatch) {
        return res.status(401).json({
          success: false,
          message: "Invalid email or password",
        });
      }

      /* -----------------------------------------
         Check active account
      ----------------------------------------- */

      if (!user.isActive) {
        return res.status(403).json({
          success: false,
          message: "Account is deactivated",
        });
      }

      /* -----------------------------------------
         Generate token
      ----------------------------------------- */

      const token = generateToken(user._id);

      /* -----------------------------------------
         Response
      ----------------------------------------- */

      return res.status(200).json({
        success: true,
        message: "Login successful",
        token,
        user,
      });
    } catch (error) {
      console.error("❌ Login Error:", error);

      return res.status(500).json({
        success: false,
        message: error.message || "Login failed",
      });
    }
  }
);

/* =========================================================
   GET /api/auth/me

   Get currently logged-in user
========================================================= */

router.get(
  "/me",
  protect,
  async (req, res) => {
    try {
      return res.status(200).json({
        success: true,
        user: req.user,
      });
    } catch (error) {
      console.error("❌ Get Me Error:", error);

      return res.status(500).json({
        success: false,
        message: "Failed to get current user",
      });
    }
  }
);

/* =========================================================
   PUT /api/auth/profile

   Update current user's profile
========================================================= */

router.put(
  "/profile",
  protect,
  [
    body("name")
      .optional()
      .trim()
      .isLength({ min: 1, max: 50 })
      .withMessage(
        "Name must be between 1 and 50 characters"
      ),

    body("bio")
      .optional()
      .isLength({ max: 300 })
      .withMessage(
        "Bio cannot exceed 300 characters"
      ),

    body("avatar")
      .optional()
      .trim(),
  ],
  async (req, res) => {
    try {
      /* -----------------------------------------
         Validate
      ----------------------------------------- */

      if (!handleValidationErrors(req, res)) {
        return;
      }

      const {
        name,
        bio,
        avatar,
      } = req.body;

      const updateData = {};

      /* -----------------------------------------
         Name
      ----------------------------------------- */

      if (name !== undefined) {
        updateData.name = name.trim();
      }

      /* -----------------------------------------
         Bio
      ----------------------------------------- */

      if (bio !== undefined) {
        updateData.bio = bio.trim();
      }

      /* -----------------------------------------
         Avatar
      ----------------------------------------- */

      if (avatar !== undefined) {
        updateData.avatar = avatar.trim();
      }

      /* -----------------------------------------
         Update user
      ----------------------------------------- */

      const user =
        await User.findByIdAndUpdate(
          req.user._id,
          updateData,
          {
            new: true,
            runValidators: true,
          }
        );

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Profile updated successfully",
        user,
      });
    } catch (error) {
      console.error(
        "❌ Update Profile Error:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          error.message ||
          "Failed to update profile",
      });
    }
  }
);

/* =========================================================
   PUT /api/auth/change-password

   Change current user's password
========================================================= */

router.put(
  "/change-password",
  protect,
  [
    body("currentPassword")
      .notEmpty()
      .withMessage(
        "Current password is required"
      ),

    body("newPassword")
      .isLength({ min: 6 })
      .withMessage(
        "New password must be at least 6 characters"
      ),
  ],
  async (req, res) => {
    try {
      /* -----------------------------------------
         Validate
      ----------------------------------------- */

      if (!handleValidationErrors(req, res)) {
        return;
      }

      const {
        currentPassword,
        newPassword,
      } = req.body;

      /* -----------------------------------------
         Get user with password
      ----------------------------------------- */

      const user =
        await User.findById(
          req.user._id
        ).select("+password");

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      /* -----------------------------------------
         Check current password
      ----------------------------------------- */

      const passwordMatch =
        await user.comparePassword(
          currentPassword
        );

      if (!passwordMatch) {
        return res.status(400).json({
          success: false,
          message:
            "Current password is incorrect",
        });
      }

      /* -----------------------------------------
         Prevent same password
      ----------------------------------------- */

      const samePassword =
        await user.comparePassword(
          newPassword
        );

      if (samePassword) {
        return res.status(400).json({
          success: false,
          message:
            "New password must be different from current password",
        });
      }

      /* -----------------------------------------
         Update password

         User.js pre-save middleware
         will automatically hash it.
      ----------------------------------------- */

      user.password = newPassword;

      await user.save();

      return res.status(200).json({
        success: true,
        message:
          "Password updated successfully",
      });
    } catch (error) {
      console.error(
        "❌ Change Password Error:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          error.message ||
          "Failed to change password",
      });
    }
  }
);

/* =========================================================
   Export Router
========================================================= */

export default router;