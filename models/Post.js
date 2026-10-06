import mongoose from "mongoose";
import slugify from "slugify";

// POST SCHEMA

const postSchema = new mongoose.Schema(
  {
    // BASIC

    title: {
      type: String,
      required: [true, "Title required"],
      trim: true,
      maxlength: [200, "Title cannot exceed 200 characters"],
    },

    slug: {
      type: String,
      required: [true, "Slug required"],
      unique: true,
      index: true,
      trim: true,
      lowercase: true,
      maxlength: [220, "Slug is too long"],
    },

    excerpt: {
      type: String,
      required: [true, "Excerpt required"],
      trim: true,
      maxlength: [300, "Excerpt cannot exceed 300 characters"],
    },

    /*
     * Tiptap ka complete HTML yahan save hota hai.
     *
     * Example:
     *
     * <h2>Heading</h2>
     * <p>Content...</p>
     * <img
     *   src="..."
     *   alt="..."
     *   data-public-id="GOOGLE_DRIVE_FILE_ID"
     * />
     *
     * Is liye content ko plain text mein convert nahi karna.
     */
    content: {
      type: String,
      required: [true, "Content required"],
    },

    // COVER IMAGE

    coverImage: {
      type: String,
      default: "",
      trim: true,
    },

    /*
     * Google Drive File ID.
     *
     * Ye Drive se cover image delete/replace karne
     * ke waqt use hoga.
     */
    coverImagePublicId: {
      type: String,
      default: "",
      trim: true,
    },

    coverImageAlt: {
      type: String,
      default: "",
      trim: true,
      maxlength: [
        200,
        "Cover image alt text cannot exceed 200 characters",
      ],
    },

    // AUTHOR

    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Author required"],
      index: true,
    },

    // CATEGORY

    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: [true, "Category required"],
      index: true,
    },

    // TAGS

    tags: {
      type: [
        {
          type: String,
          trim: true,
          lowercase: true,
          maxlength: 80,
        },
      ],

      default: [],

      set: (values) => {
        if (!Array.isArray(values)) {
          return [];
        }

        return [
          ...new Set(
            values
              .map((value) =>
                String(value || "")
                  .trim()
                  .toLowerCase()
              )
              .filter(Boolean)
          ),
        ];
      },
    },

    // PUBLISHING

    status: {
      type: String,
      enum: ["draft", "published", "scheduled"],
      default: "draft",
      index: true,
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

    // STATISTICS

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

    // SEO

    seoTitle: {
      type: String,
      maxlength: [
        70,
        "SEO title cannot exceed 70 characters",
      ],
      default: "",
      trim: true,
    },

    seoDescription: {
      type: String,
      maxlength: [
        160,
        "SEO description cannot exceed 160 characters",
      ],
      default: "",
      trim: true,
    },

    seoKeywords: {
      type: String,
      default: "",
      trim: true,
    },

    // TABLE OF CONTENTS

    tableOfContents: {
      type: [
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

      default: [],
    },
  },
  {
    timestamps: true,

    /*
     * Empty fields ko JSON response mein unnecessary
     * virtual behaviour ke baghair clean rakhta hai.
     */
    minimize: true,
  }
);

// NORMALIZE BEFORE VALIDATION

postSchema.pre("validate", function () {
  // TITLE

  if (typeof this.title === "string") {
    this.title = this.title.trim();
  }

  // SLUG

  /*
   * IMPORTANT:
   *
   * Admin editor agar slug bhej raha hai to usi slug ko
   * preserve karna hai.
   *
   * Purana code:
   *
   * title change hone par slug ko Date.now() ke saath
   * dobara generate kar raha tha.
   *
   * Is version mein:
   *
   * - provided slug preserve hota hai
   * - slug missing ho to title se generate hota hai
   * - slug clean SEO-friendly format mein normalize hota hai
   */

  const slugSource =
    typeof this.slug === "string" && this.slug.trim()
      ? this.slug.trim()
      : this.title;

  if (slugSource) {
    this.slug = slugify(slugSource, {
      lower: true,
      strict: true,
      trim: true,
    });
  }

  if (!this.slug) {
    this.invalidate(
      "slug",
      "A valid slug could not be generated."
    );
  }

  // COVER IMAGE

  if (typeof this.coverImage === "string") {
    this.coverImage = this.coverImage.trim();
  }

  if (typeof this.coverImagePublicId === "string") {
    this.coverImagePublicId =
      this.coverImagePublicId.trim();
  }

  if (typeof this.coverImageAlt === "string") {
    this.coverImageAlt =
      this.coverImageAlt.trim();
  }

  // SCHEDULE VALIDATION

  if (this.status === "scheduled") {
    if (!this.scheduledAt) {
      this.invalidate(
        "scheduledAt",
        "Scheduled publish date and time is required."
      );
    }

    if (
      this.scheduledAt &&
      Number.isNaN(
        new Date(this.scheduledAt).getTime()
      )
    ) {
      this.invalidate(
        "scheduledAt",
        "Invalid scheduled publish date."
      );
    }
  }
});

// PRE SAVE

postSchema.pre("save", function () {
  // READ TIME

  if (
    this.isModified("content") ||
    this.isNew
  ) {
    const cleanContent = String(
      this.content || ""
    )
      // Remove scripts
      .replace(
        /<script[\s\S]*?>[\s\S]*?<\/script>/gi,
        " "
      )

      // Remove styles
      .replace(
        /<style[\s\S]*?>[\s\S]*?<\/style>/gi,
        " "
      )

      // Remove HTML tags
      .replace(/<[^>]*>/g, " ")

      // Decode common entities
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")

      // Normalize spaces
      .replace(/\s+/g, " ")
      .trim();

    const wordCount = cleanContent
      ? cleanContent.split(/\s+/).length
      : 0;

    /*
     * Around 200 words/minute.
     */
    this.readTime = Math.max(
      1,
      Math.ceil(wordCount / 200)
    );
  }

  // PUBLISHED

  if (this.status === "published") {
    /*
     * First publication par publishedAt set hoga.
     *
     * Normal article update par original published date
     * unnecessarily change nahi hogi.
     */
    if (!this.publishedAt) {
      this.publishedAt = new Date();
    }

    /*
     * Once published, scheduled date ki zarurat nahi.
     */
    this.scheduledAt = null;
  }

  // SCHEDULED

  if (this.status === "scheduled") {
    /*
     * Scheduled article abhi published nahi hua.
     */
    this.publishedAt = null;
  }

  // DRAFT

  if (this.status === "draft") {
    this.publishedAt = null;
    this.scheduledAt = null;
  }
});

// INCREMENT VIEWS

postSchema.methods.incrementViews =
  async function () {
    /*
     * Atomic increment use karne se simultaneous
     * visitors ki wajah se view count lose nahi hota.
     */
    const result =
      await this.constructor.findByIdAndUpdate(
        this._id,
        {
          $inc: {
            views: 1,
          },
        },
        {
          new: true,
          select: "views",
        }
      );

    if (result) {
      this.views = result.views;
    }

    return this;
  };

// INDEXES

// Public blog listing
postSchema.index({
  status: 1,
  publishedAt: -1,
});

// Scheduled publisher
postSchema.index({
  status: 1,
  scheduledAt: 1,
});

// Category filtering
postSchema.index({
  category: 1,
  status: 1,
  publishedAt: -1,
});

// Tags
postSchema.index({
  tags: 1,
});

// Featured posts
postSchema.index({
  featured: 1,
  status: 1,
  publishedAt: -1,
});

// Author posts
postSchema.index({
  author: 1,
  createdAt: -1,
});

// Full-text search
postSchema.index({
  title: "text",
  excerpt: "text",
  content: "text",
});

// Clean output

postSchema.set(
  "toJSON",
  {
    transform: (
      doc,
      ret
    ) => {
      delete ret.__v;
      return ret;
    },
  }
);

postSchema.set(
  "toObject",
  {
    transform: (
      doc,
      ret
    ) => {
      delete ret.__v;
      return ret;
    },
  }
);

// MODEL

const Post =
  mongoose.models.Post ||
  mongoose.model(
    "Post",
    postSchema
  );

export default Post;