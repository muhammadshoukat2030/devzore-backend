import express from "express";
import mongoose from "mongoose";
import { body, validationResult } from "express-validator";

import Comment from "../models/Comment.js";
import { protect, adminOnly } from "../middleware/auth.js";

const router = express.Router();

// ======================================================
// ADMIN - GET ALL COMMENTS
// GET /api/comments/admin/all
// ======================================================

router.get(
  "/admin/all",
  protect,
  adminOnly,
  async (req, res) => {
    try {
      const { approved, spam } = req.query;

      const filter = {};

      // Filter by approval status
      if (approved !== undefined) {
        filter.isApproved = approved === "true";
      }

      // Filter by spam status
      if (spam !== undefined) {
        filter.isSpam = spam === "true";
      }

      const comments = await Comment.find(filter)
        .populate("post", "title slug")
        .sort({ createdAt: -1 });

      return res.status(200).json({
        success: true,
        count: comments.length,
        data: comments,
      });
    } catch (error) {
      console.error("Get admin comments error:", error);

      return res.status(500).json({
        success: false,
        message:
          error.message || "Failed to fetch comments.",
      });
    }
  }
);

// ======================================================
// ADMIN - APPROVE COMMENT
// PATCH /api/comments/:id/approve
// ======================================================

router.patch(
  "/:id/approve",
  protect,
  adminOnly,
  async (req, res) => {
    try {
      const { id } = req.params;

      // Validate ObjectId
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          message: "Invalid comment ID.",
        });
      }

      const comment = await Comment.findByIdAndUpdate(
        id,
        {
          isApproved: true,
          isSpam: false,
        },
        {
          new: true,
          runValidators: true,
        }
      ).populate("post", "title slug");

      if (!comment) {
        return res.status(404).json({
          success: false,
          message: "Comment not found.",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Comment approved successfully.",
        data: comment,
      });
    } catch (error) {
      console.error("Approve comment error:", error);

      return res.status(500).json({
        success: false,
        message:
          error.message || "Failed to approve comment.",
      });
    }
  }
);

// ======================================================
// ADMIN - DELETE COMMENT
// DELETE /api/comments/:id
// ======================================================

router.delete(
  "/:id",
  protect,
  adminOnly,
  async (req, res) => {
    try {
      const { id } = req.params;

      // Validate ObjectId
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          message: "Invalid comment ID.",
        });
      }

      const comment = await Comment.findByIdAndDelete(id);

      if (!comment) {
        return res.status(404).json({
          success: false,
          message: "Comment not found.",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Comment deleted successfully.",
      });
    } catch (error) {
      console.error("Delete comment error:", error);

      return res.status(500).json({
        success: false,
        message:
          error.message || "Failed to delete comment.",
      });
    }
  }
);

// ======================================================
// PUBLIC - GET APPROVED COMMENTS FOR A POST
// GET /api/comments/:postId
// ======================================================

router.get(
  "/:postId",
  async (req, res) => {
    try {
      const { postId } = req.params;

      // Validate Post ID
      if (!mongoose.Types.ObjectId.isValid(postId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid post ID.",
        });
      }

      const comments = await Comment.find({
        post: postId,
        isApproved: true,
        isSpam: false,
      })
        .sort({ createdAt: -1 })
        .select("name content createdAt post");

      return res.status(200).json({
        success: true,
        count: comments.length,
        data: comments,
      });
    } catch (error) {
      console.error("Get public comments error:", error);

      return res.status(500).json({
        success: false,
        message:
          error.message || "Failed to fetch comments.",
      });
    }
  }
);

// ======================================================
// PUBLIC - CREATE COMMENT
// POST /api/comments
// ======================================================

router.post(
  "/",
  [
    // --------------------------------------------------
    // Post ID
    // --------------------------------------------------

    body("post")
      .trim()
      .notEmpty()
      .withMessage("Post ID required.")
      .custom((value) => {
        if (!mongoose.Types.ObjectId.isValid(value)) {
          throw new Error("Invalid post ID.");
        }

        return true;
      }),

    // --------------------------------------------------
    // Name
    // --------------------------------------------------

    body("name")
      .trim()
      .notEmpty()
      .withMessage("Name required.")
      .isLength({
        max: 60,
      })
      .withMessage(
        "Name cannot exceed 60 characters."
      ),

    // --------------------------------------------------
    // Email
    // --------------------------------------------------

    body("email")
      .trim()
      .notEmpty()
      .withMessage("Email required.")
      .isEmail()
      .withMessage("Valid email required.")
      .normalizeEmail(),

    // --------------------------------------------------
    // Content
    // --------------------------------------------------

    body("content")
      .trim()
      .notEmpty()
      .withMessage("Comment required.")
      .isLength({
        min: 10,
        max: 500,
      })
      .withMessage(
        "Comment must be between 10 and 500 characters."
      ),
  ],
  async (req, res) => {
    try {
      // ==================================================
      // VALIDATION
      // ==================================================

      const errors = validationResult(req);

      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
        });
      }

      // ==================================================
      // ALLOWED FIELDS ONLY
      // ==================================================

      const commentData = {
        post: req.body.post,
        name: req.body.name.trim(),
        email: req.body.email.trim().toLowerCase(),
        content: req.body.content.trim(),

        // Explicitly set moderation defaults
        isApproved: false,
        isSpam: false,
      };

      // ==================================================
      // CREATE COMMENT
      // ==================================================

      const comment = await Comment.create(commentData);

      return res.status(201).json({
        success: true,
        message:
          "Comment submitted successfully. It is awaiting approval.",
        data: comment,
      });
    } catch (error) {
      console.error("Create comment error:", error);

      return res.status(500).json({
        success: false,
        message:
          error.message || "Failed to submit comment.",
      });
    }
  }
);

// ======================================================
// EXPORT ROUTER
// ======================================================

export default router;