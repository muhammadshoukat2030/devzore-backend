import express from "express";
import mongoose from "mongoose";
import {
  body,
  validationResult,
} from "express-validator";

import Comment from "../models/Comment.js";
import Post from "../models/Post.js";

import {
  protect,
  adminOnly,
} from "../middleware/auth.js";

const router = express.Router();

// ======================================================
// CONFIG
// ======================================================

const MAX_ADMIN_LIMIT = 100;

// ======================================================
// HELPERS
// ======================================================

const getPagination = (
  page,
  limit
) => {
  const parsedPage = Math.max(
    Number(page) || 1,
    1
  );

  const parsedLimit = Math.min(
    Math.max(
      Number(limit) || 20,
      1
    ),
    MAX_ADMIN_LIMIT
  );

  return {
    page: parsedPage,

    limit: parsedLimit,

    skip:
      (parsedPage - 1) *
      parsedLimit,
  };
};

// ======================================================
// BOOLEAN QUERY
// ======================================================

const parseBooleanQuery = (
  value
) => {
  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  return undefined;
};

// ======================================================
// NORMALIZE TEXT
// ======================================================

const normalizeText = (
  value = ""
) => {
  return String(value)
    .replace(/\s+/g, " ")
    .trim();
};

// ======================================================
// REMOVE HTML TAGS
// ======================================================
//
// Comments plain text hain.
// HTML/script content store nahi karna.
// ======================================================

const stripHtml = (
  value = ""
) => {
  return String(value)
    .replace(
      /<script[\s\S]*?>[\s\S]*?<\/script>/gi,
      " "
    )
    .replace(
      /<style[\s\S]*?>[\s\S]*?<\/style>/gi,
      " "
    )
    .replace(
      /<[^>]*>/g,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();
};

// ======================================================
// VALID OBJECT ID
// ======================================================

const isValidObjectId = (
  value
) => {
  return mongoose.Types.ObjectId.isValid(
    value
  );
};

// ======================================================
// ERROR RESPONSE
// ======================================================

const sendCommentError = (
  res,
  error,
  fallbackMessage
) => {
  if (
    error?.name ===
    "ValidationError"
  ) {
    const messages =
      Object.values(
        error.errors || {}
      )
        .map(
          (item) =>
            item?.message
        )
        .filter(Boolean);

    return res
      .status(400)
      .json({
        success: false,

        message:
          messages[0] ||
          "Comment validation failed.",

        errors:
          messages,
      });
  }

  if (
    error?.name ===
    "CastError"
  ) {
    return res
      .status(400)
      .json({
        success: false,

        message:
          "Invalid ID.",
      });
  }

  return res
    .status(500)
    .json({
      success: false,

      message:
        error?.message ||
        fallbackMessage,
    });
};

// ======================================================
// COMMENT VALIDATION
// ======================================================

const createCommentValidation = [
  // POST

  body("post")
    .trim()
    .notEmpty()
    .withMessage(
      "Post ID required."
    )
    .custom((value) => {
      if (
        !isValidObjectId(
          value
        )
      ) {
        throw new Error(
          "Invalid post ID."
        );
      }

      return true;
    }),

  // NAME

  body("name")
    .customSanitizer(
      (value) =>
        stripHtml(value)
    )
    .notEmpty()
    .withMessage(
      "Name required."
    )
    .isLength({
      min: 2,
      max: 60,
    })
    .withMessage(
      "Name must be between 2 and 60 characters."
    ),

  // EMAIL

  body("email")
    .trim()
    .notEmpty()
    .withMessage(
      "Email required."
    )
    .isEmail()
    .withMessage(
      "Please enter a valid email address."
    )
    .isLength({
      max: 120,
    })
    .withMessage(
      "Email cannot exceed 120 characters."
    )
    .normalizeEmail(),

  // CONTENT

  body("content")
    .customSanitizer(
      (value) =>
        stripHtml(value)
    )
    .notEmpty()
    .withMessage(
      "Comment required."
    )
    .isLength({
      min: 10,
      max: 500,
    })
    .withMessage(
      "Comment must be between 10 and 500 characters."
    ),
];

// ======================================================
// ADMIN - GET ALL COMMENTS
//
// GET /api/comments/admin/all
//
// Query:
// ?approved=true
// ?spam=false
// ?page=1
// ?limit=20
// ======================================================

router.get(
  "/admin/all",

  protect,
  adminOnly,

  async (req, res) => {
    try {
      const {
        approved,
        spam,
        page = 1,
        limit = 20,
      } = req.query;

      const {
        page: currentPage,
        limit: currentLimit,
        skip,
      } = getPagination(
        page,
        limit
      );

      const filter = {};

      // ----------------------------------------------
      // Approval filter
      // ----------------------------------------------

      if (
        approved !== undefined
      ) {
        const parsedApproved =
          parseBooleanQuery(
            approved
          );

        if (
          parsedApproved ===
          undefined
        ) {
          return res
            .status(400)
            .json({
              success: false,

              message:
                "approved must be true or false.",
            });
        }

        filter.isApproved =
          parsedApproved;
      }

      // ----------------------------------------------
      // Spam filter
      // ----------------------------------------------

      if (
        spam !== undefined
      ) {
        const parsedSpam =
          parseBooleanQuery(
            spam
          );

        if (
          parsedSpam ===
          undefined
        ) {
          return res
            .status(400)
            .json({
              success: false,

              message:
                "spam must be true or false.",
            });
        }

        filter.isSpam =
          parsedSpam;
      }

      // ----------------------------------------------
      // Count
      // ----------------------------------------------

      const total =
        await Comment.countDocuments(
          filter
        );

      // ----------------------------------------------
      // Comments
      // ----------------------------------------------

      const comments =
        await Comment.find(
          filter
        )
          .populate(
            "post",
            "title slug status"
          )
          .sort({
            createdAt: -1,
          })
          .skip(skip)
          .limit(
            currentLimit
          )
          .lean();

      return res
        .status(200)
        .json({
          success: true,

          count:
            comments.length,

          data:
            comments,

          pagination: {
            total,

            page:
              currentPage,

            pages:
              Math.ceil(
                total /
                  currentLimit
              ),

            limit:
              currentLimit,
          },
        });
    } catch (error) {
      console.error(
        "Get admin comments error:",
        error
      );

      return sendCommentError(
        res,
        error,
        "Failed to fetch comments."
      );
    }
  }
);

// ======================================================
// ADMIN - APPROVE COMMENT
//
// PATCH /api/comments/:id/approve
// ======================================================

router.patch(
  "/:id/approve",

  protect,
  adminOnly,

  async (req, res) => {
    try {
      const { id } =
        req.params;

      if (
        !isValidObjectId(id)
      ) {
        return res
          .status(400)
          .json({
            success: false,

            message:
              "Invalid comment ID.",
          });
      }

      const comment =
        await Comment.findByIdAndUpdate(
          id,

          {
            $set: {
              isApproved:
                true,

              isSpam:
                false,
            },
          },

          {
            new: true,
            runValidators:
              true,
          }
        ).populate(
          "post",
          "title slug status"
        );

      if (!comment) {
        return res
          .status(404)
          .json({
            success: false,

            message:
              "Comment not found.",
          });
      }

      return res
        .status(200)
        .json({
          success: true,

          message:
            "Comment approved successfully.",

          data:
            comment,
        });
    } catch (error) {
      console.error(
        "Approve comment error:",
        error
      );

      return sendCommentError(
        res,
        error,
        "Failed to approve comment."
      );
    }
  }
);

// ======================================================
// ADMIN - MARK COMMENT AS SPAM
//
// PATCH /api/comments/:id/spam
// ======================================================

router.patch(
  "/:id/spam",

  protect,
  adminOnly,

  async (req, res) => {
    try {
      const { id } =
        req.params;

      if (
        !isValidObjectId(id)
      ) {
        return res
          .status(400)
          .json({
            success: false,

            message:
              "Invalid comment ID.",
          });
      }

      const comment =
        await Comment.findByIdAndUpdate(
          id,

          {
            $set: {
              isSpam:
                true,

              isApproved:
                false,
            },
          },

          {
            new: true,
            runValidators:
              true,
          }
        ).populate(
          "post",
          "title slug status"
        );

      if (!comment) {
        return res
          .status(404)
          .json({
            success: false,

            message:
              "Comment not found.",
          });
      }

      return res
        .status(200)
        .json({
          success: true,

          message:
            "Comment marked as spam.",

          data:
            comment,
        });
    } catch (error) {
      console.error(
        "Mark spam error:",
        error
      );

      return sendCommentError(
        res,
        error,
        "Failed to mark comment as spam."
      );
    }
  }
);

// ======================================================
// ADMIN - DELETE COMMENT
//
// DELETE /api/comments/:id
// ======================================================

router.delete(
  "/:id",

  protect,
  adminOnly,

  async (req, res) => {
    try {
      const { id } =
        req.params;

      if (
        !isValidObjectId(id)
      ) {
        return res
          .status(400)
          .json({
            success: false,

            message:
              "Invalid comment ID.",
          });
      }

      const comment =
        await Comment.findByIdAndDelete(
          id
        );

      if (!comment) {
        return res
          .status(404)
          .json({
            success: false,

            message:
              "Comment not found.",
          });
      }

      return res
        .status(200)
        .json({
          success: true,

          message:
            "Comment deleted successfully.",
        });
    } catch (error) {
      console.error(
        "Delete comment error:",
        error
      );

      return sendCommentError(
        res,
        error,
        "Failed to delete comment."
      );
    }
  }
);

// ======================================================
// PUBLIC - GET COMMENTS
//
// GET /api/comments/:postId
// ======================================================

router.get(
  "/:postId",

  async (req, res) => {
    try {
      const { postId } =
        req.params;

      if (
        !isValidObjectId(
          postId
        )
      ) {
        return res
          .status(400)
          .json({
            success: false,

            message:
              "Invalid post ID.",
          });
      }

      // ----------------------------------------------
      // Confirm post exists and is public
      // ----------------------------------------------

      const post =
        await Post.findOne({
          _id: postId,

          status:
            "published",
        }).select(
          "_id"
        );

      if (!post) {
        return res
          .status(404)
          .json({
            success: false,

            message:
              "Published post not found.",
          });
      }

      // ----------------------------------------------
      // Only approved + non-spam
      // ----------------------------------------------

      const comments =
        await Comment.find({
          post: postId,

          isApproved:
            true,

          isSpam:
            false,
        })
          .sort({
            createdAt: -1,
          })

          /*
           * Email intentionally excluded.
           *
           * Public API ko commenter email kabhi
           * expose nahi karna.
           */
          .select(
            "_id name content createdAt post"
          )
          .lean();

      return res
        .status(200)
        .json({
          success: true,

          count:
            comments.length,

          data:
            comments,
        });
    } catch (error) {
      console.error(
        "Get public comments error:",
        error
      );

      return sendCommentError(
        res,
        error,
        "Failed to fetch comments."
      );
    }
  }
);

// ======================================================
// PUBLIC - CREATE COMMENT
//
// POST /api/comments
//
// Body:
//
// {
//   post: "POST_MONGODB_ID",
//   name: "Muhammad",
//   email: "example@gmail.com",
//   content: "Very useful article."
// }
// ======================================================

router.post(
  "/",

  createCommentValidation,

  async (req, res) => {
    try {
      // ----------------------------------------------
      // Validation
      // ----------------------------------------------

      const errors =
        validationResult(req);

      if (
        !errors.isEmpty()
      ) {
        return res
          .status(400)
          .json({
            success: false,

            message:
              errors.array()[0]
                ?.msg ||
              "Comment validation failed.",

            errors:
              errors.array(),
          });
      }

      // ----------------------------------------------
      // Verify published post
      // ----------------------------------------------

      const post =
        await Post.findOne({
          _id:
            req.body.post,

          status:
            "published",
        }).select(
          "_id"
        );

      if (!post) {
        return res
          .status(404)
          .json({
            success: false,

            message:
              "Published post not found.",
          });
      }

      // ----------------------------------------------
      // Allowed fields only
      // ----------------------------------------------

      const commentData = {
        post:
          post._id,

        name:
          normalizeText(
            stripHtml(
              req.body.name
            )
          ),

        email:
          String(
            req.body.email ||
              ""
          )
            .trim()
            .toLowerCase(),

        content:
          normalizeText(
            stripHtml(
              req.body.content
            )
          ),

        /*
         * Every public comment requires
         * moderation first.
         */
        isApproved:
          false,

        isSpam:
          false,
      };

      // ----------------------------------------------
      // Create
      // ----------------------------------------------

      const comment =
        await Comment.create(
          commentData
        );

      /*
       * Public response mein email return nahi karna.
       */
      const publicComment = {
        _id:
          comment._id,

        post:
          comment.post,

        name:
          comment.name,

        content:
          comment.content,

        isApproved:
          comment.isApproved,

        createdAt:
          comment.createdAt,
      };

      return res
        .status(201)
        .json({
          success: true,

          message:
            "Comment submitted successfully. It is awaiting approval.",

          data:
            publicComment,
        });
    } catch (error) {
      console.error(
        "Create comment error:",
        error
      );

      return sendCommentError(
        res,
        error,
        "Failed to submit comment."
      );
    }
  }
);

// ======================================================
// EXPORT
// ======================================================

export default router;