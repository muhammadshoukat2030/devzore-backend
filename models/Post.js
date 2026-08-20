import mongoose from "mongoose";
import slugify from "slugify";

// ======================================================
// POST SCHEMA
// ======================================================

const postSchema = new mongoose.Schema(
  {
    // --------------------------------------------------
    // Basic Information
    // --------------------------------------------------

    title: {
      type: String,
      required: [true, "Title required"],
      trim: true,
      maxlength: 200,
    },

    slug: {
      type: String,
      unique: true,
      index: true,
      trim: true,
      lowercase: true,
    },

    excerpt: {
      type: String,
      required: [true, "Excerpt required"],
      trim: true,
      maxlength: 300,
    },

    content: {
      type: String,
      required: [true, "Content required"],
    },

    // --------------------------------------------------
    // Images
    // --------------------------------------------------

    coverImage: {
      type: String,
      default: "",
      trim: true,
    },

    coverImageAlt: {
      type: String,
      default: "",
      trim: true,
      maxlength: 200,
    },

    // --------------------------------------------------
    // Author & Category
    // --------------------------------------------------

    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Author required"],
    },

    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: [true, "Category required"],
    },

    // --------------------------------------------------
    // Tags
    // --------------------------------------------------

    tags: [
      {
        type: String,
        trim: true,
        lowercase: true,
      },
    ],

    // --------------------------------------------------
    // Publishing
    // --------------------------------------------------

    status: {
      type: String,
      enum: ["draft", "published", "scheduled"],
      default: "draft",
    },

    publishedAt: {
      type: Date,
      default: null,
    },

    scheduledAt: {
      type: Date,
      default: null,
    },

    featured: {
      type: Boolean,
      default: false,
    },

    // --------------------------------------------------
    // Statistics
    // --------------------------------------------------

    readTime: {
      type: Number,
      default: 1,
      min: 1,
    },

    views: {
      type: Number,
      default: 0,
      min: 0,
    },

    likes: {
      type: Number,
      default: 0,
      min: 0,
    },

    // --------------------------------------------------
    // SEO
    // --------------------------------------------------

    seoTitle: {
      type: String,
      maxlength: 70,
      default: "",
      trim: true,
    },

    seoDescription: {
      type: String,
      maxlength: 160,
      default: "",
      trim: true,
    },

    seoKeywords: {
      type: String,
      default: "",
      trim: true,
    },

    // --------------------------------------------------
    // Table of Contents
    // --------------------------------------------------

    tableOfContents: [
      {
        id: {
          type: String,
          trim: true,
        },

        text: {
          type: String,
          trim: true,
        },

        level: {
          type: Number,
          min: 1,
          max: 6,
        },
      },
    ],
  },
  {
    timestamps: true,
  }
);

// ======================================================
// GENERATE SLUG + READ TIME + PUBLISHED DATE
// ======================================================

postSchema.pre("save", async function () {
  // --------------------------------------------------
  // Generate slug when title changes
  // --------------------------------------------------

  if (this.isModified("title") || !this.slug) {
    const baseSlug = slugify(this.title, {
      lower: true,
      strict: true,
      trim: true,
    });

    this.slug = `${baseSlug}-${Date.now()}`;
  }

  // --------------------------------------------------
  // Calculate reading time
  // --------------------------------------------------

  if (this.isModified("content")) {
    const cleanContent = this.content
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const wordCount = cleanContent
      ? cleanContent.split(/\s+/).length
      : 0;

    this.readTime = Math.max(
      1,
      Math.ceil(wordCount / 200)
    );
  }

  // --------------------------------------------------
  // Published date
  // --------------------------------------------------

  if (
    this.isModified("status") &&
    this.status === "published" &&
    !this.publishedAt
  ) {
    this.publishedAt = new Date();
  }

  // --------------------------------------------------
  // If post becomes draft
  // --------------------------------------------------

  if (
    this.isModified("status") &&
    this.status === "draft"
  ) {
    this.publishedAt = null;
  }
});

// ======================================================
// INCREMENT VIEWS
// ======================================================

postSchema.methods.incrementViews = async function () {
  this.views += 1;

  return this.save({
    validateBeforeSave: false,
  });
};

// ======================================================
// INDEXES
// ======================================================

// Published posts sorted by date
postSchema.index({
  status: 1,
  publishedAt: -1,
});

// Category filtering
postSchema.index({
  category: 1,
  status: 1,
});

// Tags filtering
postSchema.index({
  tags: 1,
});

// Featured posts
postSchema.index({
  featured: 1,
  status: 1,
});

// Text search
postSchema.index({
  title: "text",
  excerpt: "text",
  content: "text",
});

// Author posts
postSchema.index({
  author: 1,
  createdAt: -1,
});

// ======================================================
// EXPORT MODEL
// ======================================================

const Post = mongoose.model("Post", postSchema);

export default Post;