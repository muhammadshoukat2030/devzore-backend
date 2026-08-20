import express from "express";
import { body, validationResult } from "express-validator";

import Post from "../models/Post.js";
import Category from "../models/Category.js";
import { protect, adminOnly } from "../middleware/auth.js";

const router = express.Router();

// ======================================================
// HELPERS
// ======================================================

// Safe pagination values
const getPagination = (page, limit) => {
  const parsedPage = Math.max(Number(page) || 1, 1);
  const parsedLimit = Math.min(
    Math.max(Number(limit) || 10, 1),
    100
  );

  return {
    page: parsedPage,
    limit: parsedLimit,
    skip: (parsedPage - 1) * parsedLimit,
  };
};

// ======================================================
// GET /api/posts
// PUBLIC — Get all published posts
// ======================================================

router.get("/", async (req, res) => {
  try {
    const {
      category,
      tag,
      search,
      featured,
      page = 1,
      limit = 10,
      sort = "-publishedAt",
    } = req.query;

    const { page: currentPage, limit: currentLimit, skip } =
      getPagination(page, limit);

    const filter = {
      status: "published",
    };

    // Category filter
    if (category) {
      const cat = await Category.findOne({
        slug: category.toLowerCase(),
      });

      if (cat) {
        filter.category = cat._id;
      } else {
        return res.json({
          success: true,
          data: [],
          pagination: {
            total: 0,
            page: currentPage,
            pages: 0,
            limit: currentLimit,
          },
        });
      }
    }

    // Tag filter
    if (tag) {
      filter.tags = {
        $in: [tag.toLowerCase()],
      };
    }

    // Featured filter
    if (featured === "true") {
      filter.featured = true;
    }

    // Search
    if (search && search.trim()) {
      filter.$text = {
        $search: search.trim(),
      };
    }

    const total = await Post.countDocuments(filter);

    const posts = await Post.find(filter)
      .populate("author", "name avatar bio")
      .populate("category", "name slug color")
      .select("-content -tableOfContents")
      .sort(sort)
      .skip(skip)
      .limit(currentLimit);

    res.json({
      success: true,
      data: posts,
      pagination: {
        total,
        page: currentPage,
        pages: Math.ceil(total / currentLimit),
        limit: currentLimit,
      },
    });
  } catch (err) {
    console.error("Get posts error:", err);

    res.status(500).json({
      success: false,
      message: err.message || "Failed to fetch posts.",
    });
  }
});

// ======================================================
// GET /api/posts/featured
// PUBLIC — Get featured posts
// ======================================================

router.get("/featured", async (req, res) => {
  try {
    const posts = await Post.find({
      status: "published",
      featured: true,
    })
      .populate("author", "name avatar")
      .populate("category", "name slug color")
      .select("-content -tableOfContents")
      .sort("-publishedAt")
      .limit(6);

    res.json({
      success: true,
      data: posts,
    });
  } catch (err) {
    console.error("Get featured posts error:", err);

    res.status(500).json({
      success: false,
      message: err.message || "Failed to fetch featured posts.",
    });
  }
});

// ======================================================
// GET /api/posts/latest
// PUBLIC — Get latest posts
// ======================================================

router.get("/latest", async (req, res) => {
  try {
    const posts = await Post.find({
      status: "published",
    })
      .populate("author", "name avatar")
      .populate("category", "name slug color")
      .select("-content -tableOfContents")
      .sort("-publishedAt")
      .limit(3);

    res.json({
      success: true,
      data: posts,
    });
  } catch (err) {
    console.error("Get latest posts error:", err);

    res.status(500).json({
      success: false,
      message: err.message || "Failed to fetch latest posts.",
    });
  }
});

// ======================================================
// GET /api/posts/admin/all
// ADMIN — Get all posts
// ======================================================

router.get("/admin/all", protect, adminOnly, async (req, res) => {
  try {
    const {
      status,
      page = 1,
      limit = 20,
    } = req.query;

    const {
      page: currentPage,
      limit: currentLimit,
      skip,
    } = getPagination(page, limit);

    const filter = {};

    if (status) {
      filter.status = status;
    }

    const total = await Post.countDocuments(filter);

    const posts = await Post.find(filter)
      .populate("author", "name avatar")
      .populate("category", "name slug color")
      .select("-content -tableOfContents")
      .sort("-createdAt")
      .skip(skip)
      .limit(currentLimit);

    res.json({
      success: true,
      data: posts,
      pagination: {
        total,
        page: currentPage,
        pages: Math.ceil(total / currentLimit),
        limit: currentLimit,
      },
    });
  } catch (err) {
    console.error("Admin get all posts error:", err);

    res.status(500).json({
      success: false,
      message: err.message || "Failed to fetch admin posts.",
    });
  }
});

// ======================================================
// GET /api/posts/admin/:id
// ADMIN — Get single post by ID
// ======================================================

router.get("/admin/:id", protect, adminOnly, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id)
      .populate("author", "name avatar bio")
      .populate("category", "name slug color");

    if (!post) {
      return res.status(404).json({
        success: false,
        message: "Post not found.",
      });
    }

    res.json({
      success: true,
      data: post,
    });
  } catch (err) {
    console.error("Admin get post error:", err);

    res.status(500).json({
      success: false,
      message: err.message || "Failed to fetch post.",
    });
  }
});

// ======================================================
// GET /api/posts/:slug
// PUBLIC — Get single published post
// ======================================================

router.get("/:slug", async (req, res) => {
  try {
    const post = await Post.findOne({
      slug: req.params.slug,
      status: "published",
    })
      .populate("author", "name avatar bio")
      .populate("category", "name slug color");

    if (!post) {
      return res.status(404).json({
        success: false,
        message: "Post not found.",
      });
    }

    // Increment views ONLY ONCE
    await post.incrementViews();

    // Related posts
    const related = await Post.find({
      status: "published",
      category: post.category?._id,
      _id: { $ne: post._id },
    })
      .populate("author", "name avatar")
      .populate("category", "name slug color")
      .select("-content -tableOfContents")
      .sort("-publishedAt")
      .limit(3);

    res.json({
      success: true,
      data: post,
      related,
    });
  } catch (err) {
    console.error("Get single post error:", err);

    res.status(500).json({
      success: false,
      message: err.message || "Failed to fetch post.",
    });
  }
});

// ======================================================
// POST /api/posts
// ADMIN — Create post
// ======================================================

router.post(
  "/",
  protect,
  adminOnly,

  [
    body("title")
      .trim()
      .notEmpty()
      .withMessage("Title is required.")
      .isLength({ max: 200 })
      .withMessage("Title cannot exceed 200 characters."),

    body("excerpt")
      .trim()
      .notEmpty()
      .withMessage("Excerpt is required.")
      .isLength({ max: 300 })
      .withMessage("Excerpt cannot exceed 300 characters."),

    body("content")
      .notEmpty()
      .withMessage("Content is required."),

    body("category")
      .notEmpty()
      .withMessage("Category is required."),
  ],

  async (req, res) => {
    try {
      const errors = validationResult(req);

      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
        });
      }

      // Check category exists
      const category = await Category.findById(req.body.category);

      if (!category) {
        return res.status(400).json({
          success: false,
          message: "Selected category not found.",
        });
      }

      const post = await Post.create({
        ...req.body,
        author: req.user._id,
      });

      // Increase category post count
      if (post.status === "published") {
        await Category.findByIdAndUpdate(
          post.category,
          {
            $inc: {
              postCount: 1,
            },
          }
        );
      }

      const populatedPost = await Post.findById(post._id)
        .populate("author", "name avatar bio")
        .populate("category", "name slug color");

      res.status(201).json({
        success: true,
        data: populatedPost,
      });
    } catch (err) {
      console.error("Create post error:", err);

      res.status(500).json({
        success: false,
        message: err.message || "Failed to create post.",
      });
    }
  }
);

// ======================================================
// PUT /api/posts/:id
// ADMIN — Update post
// ======================================================

router.put("/:id", protect, adminOnly, async (req, res) => {
  try {
    const existingPost = await Post.findById(req.params.id);

    if (!existingPost) {
      return res.status(404).json({
        success: false,
        message: "Post not found.",
      });
    }

    // Old values
    const oldCategoryId = existingPost.category?.toString();
    const wasPublished =
      existingPost.status === "published";

    // New values
    const newStatus =
      req.body.status || existingPost.status;

    const newCategoryId =
      req.body.category || oldCategoryId;

    const willBePublished =
      newStatus === "published";

    // Check new category if changed
    if (
      newCategoryId &&
      newCategoryId !== oldCategoryId
    ) {
      const categoryExists =
        await Category.findById(newCategoryId);

      if (!categoryExists) {
        return res.status(400).json({
          success: false,
          message: "Selected category not found.",
        });
      }
    }

    // Update publishedAt
    const updateData = {
      ...req.body,
    };

    if (
      willBePublished &&
      !existingPost.publishedAt
    ) {
      updateData.publishedAt = new Date();
    }

    if (!willBePublished) {
      updateData.publishedAt = undefined;
    }

    const post = await Post.findByIdAndUpdate(
      req.params.id,
      updateData,
      {
        new: true,
        runValidators: true,
      }
    )
      .populate("author", "name avatar bio")
      .populate("category", "name slug color");

    // ==================================================
    // Handle category postCount
    // ==================================================

    const categoryChanged =
      oldCategoryId !== newCategoryId;

    // Published -> Draft/Scheduled
    if (wasPublished && !willBePublished) {
      await Category.findByIdAndUpdate(
        oldCategoryId,
        {
          $inc: {
            postCount: -1,
          },
        }
      );
    }

    // Draft/Scheduled -> Published
    else if (!wasPublished && willBePublished) {
      await Category.findByIdAndUpdate(
        newCategoryId,
        {
          $inc: {
            postCount: 1,
          },
        }
      );
    }

    // Published -> Published but category changed
    else if (
      wasPublished &&
      willBePublished &&
      categoryChanged
    ) {
      // Remove from old category
      await Category.findByIdAndUpdate(
        oldCategoryId,
        {
          $inc: {
            postCount: -1,
          },
        }
      );

      // Add to new category
      await Category.findByIdAndUpdate(
        newCategoryId,
        {
          $inc: {
            postCount: 1,
          },
        }
      );
    }

    res.json({
      success: true,
      data: post,
    });
  } catch (err) {
    console.error("Update post error:", err);

    res.status(500).json({
      success: false,
      message: err.message || "Failed to update post.",
    });
  }
});

// ======================================================
// DELETE /api/posts/:id
// ADMIN — Delete post
// ======================================================

router.delete("/:id", protect, adminOnly, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);

    if (!post) {
      return res.status(404).json({
        success: false,
        message: "Post not found.",
      });
    }

    const wasPublished =
      post.status === "published";

    const categoryId = post.category;

    await Post.findByIdAndDelete(req.params.id);

    // Decrease category post count
    if (wasPublished && categoryId) {
      await Category.findByIdAndUpdate(
        categoryId,
        {
          $inc: {
            postCount: -1,
          },
        }
      );
    }

    res.json({
      success: true,
      message: "Post deleted successfully.",
    });
  } catch (err) {
    console.error("Delete post error:", err);

    res.status(500).json({
      success: false,
      message: err.message || "Failed to delete post.",
    });
  }
});

// ======================================================
// PATCH /api/posts/:id/toggle-featured
// ADMIN — Toggle featured status
// ======================================================

router.patch(
  "/:id/toggle-featured",
  protect,
  adminOnly,
  async (req, res) => {
    try {
      const post = await Post.findById(req.params.id);

      if (!post) {
        return res.status(404).json({
          success: false,
          message: "Post not found.",
        });
      }

      post.featured = !post.featured;

      await post.save({
        validateBeforeSave: false,
      });

      res.json({
        success: true,
        data: post,
      });
    } catch (err) {
      console.error(
        "Toggle featured error:",
        err
      );

      res.status(500).json({
        success: false,
        message:
          err.message ||
          "Failed to update featured status.",
      });
    }
  }
);

// ======================================================
// EXPORT ROUTER
// ======================================================

export default router;