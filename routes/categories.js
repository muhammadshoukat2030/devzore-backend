import express from "express";
import mongoose from "mongoose";
import Category from "../models/Category.js";
import { protect, adminOnly } from "../middleware/auth.js";

const router = express.Router();

// ======================================================
// GET ALL CATEGORIES
// Public
// GET /api/categories
// ======================================================
router.get("/", async (req, res) => {
  try {
    const categories = await Category.find()
      .sort({ postCount: -1, name: 1 })
      .lean();

    return res.status(200).json({
      success: true,
      data: categories,
    });
  } catch (error) {
    console.error("Get categories error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to load categories.",
    });
  }
});

// ======================================================
// GET SINGLE CATEGORY
// Public
// GET /api/categories/:id
// ======================================================
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid category ID.",
      });
    }

    const category = await Category.findById(id).lean();

    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Category not found.",
      });
    }

    return res.status(200).json({
      success: true,
      data: category,
    });
  } catch (error) {
    console.error("Get category error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to load category.",
    });
  }
});

// ======================================================
// CREATE CATEGORY
// Admin only
// POST /api/categories
// ======================================================
router.post("/", protect, adminOnly, async (req, res) => {
  try {
    const { name, description, color } = req.body;

    // Validate name
    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: "Category name is required.",
      });
    }

    const cleanName = name.trim();

    // Check duplicate category
    const existingCategory = await Category.findOne({
      name: {
        $regex: `^${cleanName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
        $options: "i",
      },
    });

    if (existingCategory) {
      return res.status(409).json({
        success: false,
        message: "Category already exists.",
      });
    }

    // Create category
    const category = await Category.create({
      name: cleanName,
      description: description?.trim() || "",
      color: color || "#7c3aed",
    });

    return res.status(201).json({
      success: true,
      message: "Category created successfully.",
      data: category,
    });
  } catch (error) {
    console.error("Create category error:", error);

    // MongoDB duplicate key error
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Category already exists.",
      });
    }

    // Mongoose validation error
    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map(
        (err) => err.message
      );

      return res.status(400).json({
        success: false,
        message: messages.join(", "),
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to create category.",
    });
  }
});

// ======================================================
// UPDATE CATEGORY
// Admin only
// PUT /api/categories/:id
// ======================================================
router.put("/:id", protect, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, color } = req.body;

    // Validate ID
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid category ID.",
      });
    }

    // Validate name
    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: "Category name is required.",
      });
    }

    const cleanName = name.trim();

    // Check duplicate category excluding current category
    const existingCategory = await Category.findOne({
      _id: { $ne: id },
      name: {
        $regex: `^${cleanName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
        $options: "i",
      },
    });

    if (existingCategory) {
      return res.status(409).json({
        success: false,
        message: "Another category with this name already exists.",
      });
    }

    const updateData = {
      name: cleanName,
      description: description?.trim() || "",
    };

    if (color) {
      updateData.color = color;
    }

    const category = await Category.findByIdAndUpdate(
      id,
      updateData,
      {
        new: true,
        runValidators: true,
      }
    );

    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Category not found.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Category updated successfully.",
      data: category,
    });
  } catch (error) {
    console.error("Update category error:", error);

    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Category already exists.",
      });
    }

    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map(
        (err) => err.message
      );

      return res.status(400).json({
        success: false,
        message: messages.join(", "),
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to update category.",
    });
  }
});

// ======================================================
// DELETE CATEGORY
// Admin only
// DELETE /api/categories/:id
// ======================================================
router.delete("/:id", protect, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;

    // Validate ID
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid category ID.",
      });
    }

    const category = await Category.findById(id);

    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Category not found.",
      });
    }

    // Prevent deleting category if posts are attached
    if (category.postCount > 0) {
      return res.status(400).json({
        success: false,
        message:
          "This category contains posts. Remove or move those posts before deleting the category.",
      });
    }

    await Category.findByIdAndDelete(id);

    return res.status(200).json({
      success: true,
      message: "Category deleted successfully.",
    });
  } catch (error) {
    console.error("Delete category error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to delete category.",
    });
  }
});

export default router;