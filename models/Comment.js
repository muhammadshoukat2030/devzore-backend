import mongoose from "mongoose";

// ======================================================
// HELPERS
// ======================================================

const normalizeText = (value = "") => {
  return String(value)
    .replace(/\s+/g, " ")
    .trim();
};

const normalizeEmail = (value = "") => {
  return String(value)
    .trim()
    .toLowerCase();
};

// Simple practical email validation.
// Extremely strict regex intentionally use nahi kar rahe.
const EMAIL_REGEX =
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ======================================================
// COMMENT SCHEMA
// ======================================================

const commentSchema = new mongoose.Schema(
  {
    // ==================================================
    // POST
    // ==================================================

    post: {
      type: mongoose.Schema.Types.ObjectId,

      ref: "Post",

      required: [
        true,
        "Post ID required",
      ],
    },

    // ==================================================
    // COMMENTER NAME
    // ==================================================

    name: {
      type: String,

      required: [
        true,
        "Name required",
      ],

      trim: true,

      minlength: [
        2,
        "Name must be at least 2 characters",
      ],

      maxlength: [
        60,
        "Name cannot exceed 60 characters",
      ],

      set: normalizeText,
    },

    // ==================================================
    // COMMENTER EMAIL
    // ==================================================

    email: {
      type: String,

      required: [
        true,
        "Email required",
      ],

      trim: true,

      lowercase: true,

      maxlength: [
        120,
        "Email cannot exceed 120 characters",
      ],

      set: normalizeEmail,

      validate: {
        validator(value) {
          return EMAIL_REGEX.test(
            String(value || "")
          );
        },

        message:
          "Please enter a valid email address",
      },
    },

    // ==================================================
    // COMMENT CONTENT
    // ==================================================

    content: {
      type: String,

      required: [
        true,
        "Comment required",
      ],

      trim: true,

      minlength: [
        10,
        "Comment must be at least 10 characters",
      ],

      maxlength: [
        500,
        "Comment cannot exceed 500 characters",
      ],

      set: normalizeText,
    },

    // ==================================================
    // APPROVAL
    // ==================================================

    isApproved: {
      type: Boolean,

      default: false,
    },

    // ==================================================
    // SPAM
    // ==================================================

    isSpam: {
      type: Boolean,

      default: false,
    },
  },
  {
    timestamps: true,

    minimize: true,
  }
);

// ======================================================
// INDEXES
// ======================================================

/*
 * Public comments:
 *
 * GET approved comments for one post,
 * newest/oldest ordering efficiently.
 */
commentSchema.index({
  post: 1,
  isApproved: 1,
  isSpam: 1,
  createdAt: -1,
});

/*
 * Admin moderation:
 *
 * Pending comments.
 */
commentSchema.index({
  isApproved: 1,
  isSpam: 1,
  createdAt: -1,
});

/*
 * Admin latest comments.
 */
commentSchema.index({
  createdAt: -1,
});

// ======================================================
// CLEAN JSON OUTPUT
// ======================================================

commentSchema.set(
  "toJSON",
  {
    transform(
      document,
      returnedObject
    ) {
      delete returnedObject.__v;

      return returnedObject;
    },
  }
);

commentSchema.set(
  "toObject",
  {
    transform(
      document,
      returnedObject
    ) {
      delete returnedObject.__v;

      return returnedObject;
    },
  }
);

// ======================================================
// MODEL
// ======================================================

const Comment =
  mongoose.models.Comment ||
  mongoose.model(
    "Comment",
    commentSchema
  );

// ======================================================
// EXPORT
// ======================================================

export default Comment;