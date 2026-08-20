import mongoose from "mongoose";

// ======================================================
// COMMENT SCHEMA
// ======================================================

const commentSchema = new mongoose.Schema(
  {
    // --------------------------------------------------
    // Post Reference
    // --------------------------------------------------

    post: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Post",
      required: [true, "Post ID required"],
      index: true,
    },

    // --------------------------------------------------
    // Commenter Name
    // --------------------------------------------------

    name: {
      type: String,
      required: [true, "Name required"],
      trim: true,
      maxlength: [60, "Name cannot exceed 60 characters"],
    },

    // --------------------------------------------------
    // Commenter Email
    // --------------------------------------------------

    email: {
      type: String,
      required: [true, "Email required"],
      trim: true,
      lowercase: true,
      maxlength: [120, "Email cannot exceed 120 characters"],
    },

    // --------------------------------------------------
    // Comment Content
    // --------------------------------------------------

    content: {
      type: String,
      required: [true, "Comment required"],
      trim: true,
      minlength: [10, "Comment must be at least 10 characters"],
      maxlength: [500, "Comment cannot exceed 500 characters"],
    },

    // --------------------------------------------------
    // Approval Status
    // --------------------------------------------------

    isApproved: {
      type: Boolean,
      default: false,
      index: true,
    },

    // --------------------------------------------------
    // Spam Status
    // --------------------------------------------------

    isSpam: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// ======================================================
// INDEXES
// ======================================================

// Public comments:
// Only approved and non-spam comments should be shown.

commentSchema.index({
  post: 1,
  isApproved: 1,
  isSpam: 1,
});

// ======================================================
// ADMIN COMMENTS
// ======================================================

// Latest comments first.

commentSchema.index({
  createdAt: -1,
});

// ======================================================
// EXPORT MODEL
// ======================================================

const Comment = mongoose.model("Comment", commentSchema);

export default Comment;