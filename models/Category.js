import mongoose from "mongoose";
import slugify from "slugify";

// ======================================================
// CATEGORY SCHEMA
// ======================================================

const categorySchema = new mongoose.Schema(
  {
    // --------------------------------------------------
    // Category Name
    // --------------------------------------------------

    name: {
      type: String,
      required: [true, "Category name required"],
      unique: true,
      trim: true,
      maxlength: 50,
    },

    // --------------------------------------------------
    // SEO Slug
    // Example: "Web Development" -> "web-development"
    // --------------------------------------------------

    slug: {
      type: String,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },

    // --------------------------------------------------
    // Description
    // --------------------------------------------------

    description: {
      type: String,
      default: "",
      trim: true,
      maxlength: 200,
    },

    // --------------------------------------------------
    // Category Color
    // --------------------------------------------------

    color: {
      type: String,
      default: "#7c3aed",
      trim: true,
    },

    // --------------------------------------------------
    // Number of Posts
    // --------------------------------------------------

    postCount: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: true,
  }
);

// ======================================================
// CREATE SLUG BEFORE SAVE
// ======================================================

categorySchema.pre("save", async function () {
  if (this.isModified("name") || !this.slug) {
    this.slug = slugify(this.name, {
      lower: true,
      strict: true,
      trim: true,
    });
  }
});

// ======================================================
// CREATE SLUG BEFORE FINDONEANDUPDATE
// ======================================================

categorySchema.pre("findOneAndUpdate", async function () {
  const update = this.getUpdate();

  if (!update) {
    return;
  }

  // --------------------------------------------------
  // Normal update
  // { name: "Web Development" }
  // --------------------------------------------------

  if (update.name) {
    update.slug = slugify(update.name, {
      lower: true,
      strict: true,
      trim: true,
    });
  }

  // --------------------------------------------------
  // $set update
  // { $set: { name: "Web Development" } }
  // --------------------------------------------------

  if (update.$set?.name) {
    update.$set.slug = slugify(update.$set.name, {
      lower: true,
      strict: true,
      trim: true,
    });
  }

  this.setUpdate(update);
});

// ======================================================
// EXPORT MODEL
// ======================================================

const Category = mongoose.model("Category", categorySchema);

export default Category;