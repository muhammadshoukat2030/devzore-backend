import express from "express";
import multer from "multer";
import sharp from "sharp";
import crypto from "crypto";
import { Readable } from "stream";

import { protect, adminOnly } from "../middleware/auth.js";
import { getDriveClient } from "./googleDrive.js";

const router = express.Router();

// ======================================================
// CONFIG
// ======================================================

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_IMAGE_WIDTH = 1600;
const WEBP_QUALITY = 80;

// ======================================================
// MULTER
// ======================================================
// Image RAM mein temporarily receive hogi.
// Vercel/local filesystem par permanently save nahi hogi.
// ======================================================

const storage = multer.memoryStorage();

const upload = multer({
  storage,

  limits: {
    fileSize: MAX_FILE_SIZE,
  },

  fileFilter: (req, file, cb) => {
    if (file?.mimetype?.startsWith("image/")) {
      return cb(null, true);
    }

    return cb(
      new Error("Only image files are allowed"),
      false
    );
  },
});

// ======================================================
// BUFFER -> STREAM
// ======================================================

const bufferToStream = (buffer) => {
  return Readable.from(buffer);
};

// ======================================================
// CREATE UNIQUE FILE NAME
// ======================================================

const createImageName = () => {
  const timestamp = Date.now();
  const random = crypto.randomBytes(4).toString("hex");

  return `${timestamp}-${random}.webp`;
};

// ======================================================
// COMPRESS IMAGE
// ======================================================

const compressImage = async (buffer) => {
  try {
    if (!buffer || !Buffer.isBuffer(buffer)) {
      throw new Error("Invalid image buffer");
    }

    const originalMetadata =
      await sharp(buffer).metadata();

    const compressedBuffer = await sharp(buffer)
      .rotate()
      .resize({
        width: MAX_IMAGE_WIDTH,
        withoutEnlargement: true,
        fit: "inside",
      })
      .webp({
        quality: WEBP_QUALITY,
      })
      .toBuffer();

    const finalMetadata =
      await sharp(compressedBuffer).metadata();

    return {
      buffer: compressedBuffer,

      width:
        finalMetadata.width ||
        originalMetadata.width ||
        null,

      height:
        finalMetadata.height ||
        originalMetadata.height ||
        null,

      format: "webp",

      size: compressedBuffer.length,
    };
  } catch (error) {
    throw new Error(
      `Image compression failed: ${error.message}`
    );
  }
};

// ======================================================
// GOOGLE DRIVE IMAGE URLS
// ======================================================

// Browser <img src=""> ke liye.
//
// IMPORTANT:
// drive.google.com/file/d/.../view webpage URL hai,
// isliye usko <img> mein use nahi karna.
//
// Google thumbnail endpoint actual image response deta hai.
// sz=w1600 image ko large blog cover ke liye request karta hai.

const createGoogleDriveImageUrl = (fileId) => {
  return `https://drive.google.com/thumbnail?id=${encodeURIComponent(
    fileId
  )}&sz=w1600`;
};

// Original Google Drive viewing page.
// Ye sirf reference/admin use ke liye hai.

const createGoogleDriveViewUrl = (fileId) => {
  return `https://drive.google.com/file/d/${encodeURIComponent(
    fileId
  )}/view`;
};

// Alternative download URL.
// Frontend currently isko use nahi karega,
// lekin response mein useful reference ke liye rakha hai.

const createGoogleDriveDownloadUrl = (fileId) => {
  return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(
    fileId
  )}`;
};

// ======================================================
// UPLOAD IMAGE TO GOOGLE DRIVE
// ======================================================

const uploadImageToGoogleDrive = async (
  buffer,
  filename
) => {
  let fileId = null;

  try {
    const drive = getDriveClient();

    // --------------------------------------------------
    // 1. Upload file
    // --------------------------------------------------

    const response = await drive.files.create({
      requestBody: {
        name: filename,
        mimeType: "image/webp",
      },

      media: {
        mimeType: "image/webp",
        body: bufferToStream(buffer),
      },

      fields:
        "id,name,mimeType,size,createdTime,modifiedTime",
    });

    fileId = response?.data?.id;

    if (!fileId) {
      throw new Error(
        "Google Drive did not return a file ID"
      );
    }

    // --------------------------------------------------
    // 2. Make file publicly readable
    // --------------------------------------------------

    await drive.permissions.create({
      fileId,

      requestBody: {
        role: "reader",
        type: "anyone",
      },
    });

    // --------------------------------------------------
    // 3. Get final Drive metadata
    // --------------------------------------------------

    const fileResponse = await drive.files.get({
      fileId,

      fields:
        "id,name,mimeType,size,createdTime,modifiedTime,webViewLink",
    });

    const file = fileResponse?.data || {};

    // --------------------------------------------------
    // 4. Generate URLs
    // --------------------------------------------------

    const imageUrl =
      createGoogleDriveImageUrl(fileId);

    const webViewLink =
      file.webViewLink ||
      createGoogleDriveViewUrl(fileId);

    const downloadUrl =
      createGoogleDriveDownloadUrl(fileId);

    return {
      fileId,

      filename:
        file.name ||
        filename,

      mimeType:
        file.mimeType ||
        "image/webp",

      size:
        file.size ||
        null,

      createdTime:
        file.createdTime ||
        null,

      modifiedTime:
        file.modifiedTime ||
        null,

      // Frontend response.url ko coverImage mein save karta hai
      url: imageUrl,

      webViewLink,

      downloadUrl,
    };
  } catch (error) {
    // --------------------------------------------------
    // CLEANUP
    // --------------------------------------------------

    if (fileId) {
      try {
        const drive = getDriveClient();

        await drive.files.delete({
          fileId,
        });

        console.log(
          "🧹 Incomplete Google Drive upload cleaned:",
          fileId
        );
      } catch (cleanupError) {
        console.error(
          "⚠️ Failed to cleanup incomplete Drive upload:",
          cleanupError?.message
        );
      }
    }

    throw new Error(
      `Google Drive upload failed: ${error.message}`
    );
  }
};

// ======================================================
// DELETE IMAGE FROM GOOGLE DRIVE
// ======================================================

const deleteImageFromGoogleDrive = async (
  fileId
) => {
  try {
    const drive = getDriveClient();

    await drive.files.delete({
      fileId,
    });

    return true;
  } catch (error) {
    const status =
      error?.code ||
      error?.response?.status;

    if (Number(status) === 404) {
      throw new Error(
        "Google Drive image was not found"
      );
    }

    throw new Error(
      `Google Drive delete failed: ${error.message}`
    );
  }
};

// ======================================================
// GET /api/upload/image/:fileId
// PUBLIC — SERVE GOOGLE DRIVE IMAGE THROUGH BACKEND
// ======================================================
//
// Google Drive ki actual image ko backend ke through
// browser/frontend tak stream karta hai.
//
// Example:
// http://localhost:5000/api/upload/image/FILE_ID
//
// IMPORTANT:
// Is route par protect/adminOnly nahi lagana.
// Blog images public visitors ko bhi show honi chahiye.
// ======================================================

router.get("/image/:fileId", async (req, res) => {
  try {
    const { fileId } = req.params;

    if (!fileId || !fileId.trim()) {
      return res.status(400).json({
        success: false,
        message: "Google Drive file ID is required.",
      });
    }

    const drive = getDriveClient();

    // --------------------------------------------------
    // 1. Get image metadata
    // --------------------------------------------------

    const metadataResponse =
      await drive.files.get({
        fileId,
        fields:
          "id,name,mimeType,size,modifiedTime",
      });

    const metadata =
      metadataResponse?.data;

    if (!metadata?.id) {
      return res.status(404).json({
        success: false,
        message: "Image not found.",
      });
    }

    // --------------------------------------------------
    // 2. Security check
    // --------------------------------------------------

    if (
      metadata.mimeType &&
      !metadata.mimeType.startsWith("image/")
    ) {
      return res.status(415).json({
        success: false,
        message:
          "Requested Google Drive file is not an image.",
      });
    }

    // --------------------------------------------------
    // 3. Download actual image from Google Drive
    // --------------------------------------------------

    const imageResponse =
      await drive.files.get(
        {
          fileId,
          alt: "media",
        },
        {
          responseType: "stream",
        }
      );

    // --------------------------------------------------
    // 4. Response headers
    // --------------------------------------------------

    res.setHeader(
      "Content-Type",
      metadata.mimeType ||
      "image/webp"
    );

    if (metadata.size) {
      res.setHeader(
        "Content-Length",
        metadata.size
      );
    }

    // Cache for 1 day
    res.setHeader(
      "Cache-Control",
      "public, max-age=86400"
    );

    // Allow browsers to render directly
    res.setHeader(
      "Content-Disposition",
      "inline"
    );

    // --------------------------------------------------
    // 5. Stream Drive image to browser
    // --------------------------------------------------

    imageResponse.data.on(
      "error",
      (streamError) => {
        console.error(
          "❌ Google Drive image stream error:",
          streamError
        );

        if (!res.headersSent) {
          return res.status(500).json({
            success: false,
            message:
              "Failed to stream image.",
          });
        }

        res.end();
      }
    );

    imageResponse.data.pipe(res);
  } catch (error) {
    console.error(
      "❌ Serve Google Drive image error:",
      error
    );

    const status =
      error?.code ||
      error?.response?.status;

    if (Number(status) === 404) {
      return res.status(404).json({
        success: false,
        message: "Image not found.",
      });
    }

    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        message:
          "Failed to load image from Google Drive.",
      });
    }

    return res.end();
  }
});

// ======================================================
// POST /api/upload/image
// ======================================================

router.post(
  "/image",

  protect,
  adminOnly,

  upload.single("image"),

  async (req, res) => {
    try {
      // ------------------------------------------------
      // FILE CHECK
      // ------------------------------------------------

      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "No image provided",
        });
      }

      console.log(
        "================================="
      );
      console.log("📷 IMAGE UPLOAD STARTED");
      console.log(
        "Original:",
        req.file.originalname
      );
      console.log(
        "Mime:",
        req.file.mimetype
      );
      console.log(
        "Original size:",
        req.file.size
      );
      console.log(
        "================================="
      );

      // ------------------------------------------------
      // 1. COMPRESS
      // ------------------------------------------------

      const compressed =
        await compressImage(req.file.buffer);

      // ------------------------------------------------
      // 2. CREATE UNIQUE NAME
      // ------------------------------------------------

      const filename =
        createImageName();

      // ------------------------------------------------
      // 3. UPLOAD TO GOOGLE DRIVE
      // ------------------------------------------------

      const driveFile =
        await uploadImageToGoogleDrive(
          compressed.buffer,
          filename
        );

      // ------------------------------------------------
      // LOG
      // ------------------------------------------------

      console.log(
        "================================="
      );
      console.log(
        "✅ IMAGE UPLOADED TO GOOGLE DRIVE"
      );
      console.log(
        "File ID:",
        driveFile.fileId
      );
      console.log(
        "Filename:",
        driveFile.filename
      );
      console.log(
        "Image URL:",
        driveFile.url
      );
      console.log(
        "================================="
      );

      // ------------------------------------------------
      // RESPONSE
      // ------------------------------------------------
      //
      // Existing frontend expects:
      //
      // response.url
      //
      // AdminPostEditor then stores:
      //
      // coverImage: response.url
      //
      // ------------------------------------------------

      return res.status(201).json({
        success: true,

        // Actual browser-renderable image URL
        url: driveFile.url,

        // Google Drive File ID
        // Delete endpoint ke liye.
        publicId: driveFile.fileId,

        width:
          compressed.width,

        height:
          compressed.height,

        format:
          compressed.format,

        size:
          compressed.size,

        filename:
          driveFile.filename,

        mimeType:
          driveFile.mimeType,

        webViewLink:
          driveFile.webViewLink,

        downloadUrl:
          driveFile.downloadUrl,
      });
    } catch (error) {
      console.error(
        "❌ Image Upload Error:",
        error
      );

      return res.status(500).json({
        success: false,

        message:
          error?.message ||
          "Image upload failed",
      });
    }
  }
);

// ======================================================
// DELETE /api/upload/image/:publicId
// ======================================================

router.delete(
  "/image/:publicId",

  protect,
  adminOnly,

  async (req, res) => {
    try {
      const publicId =
        req.params?.publicId?.trim();

      if (!publicId) {
        return res.status(400).json({
          success: false,

          message:
            "Google Drive file ID is required",
        });
      }

      // ------------------------------------------------
      // BASIC FILE ID VALIDATION
      // ------------------------------------------------

      if (
        !/^[a-zA-Z0-9_-]+$/.test(publicId)
      ) {
        return res.status(400).json({
          success: false,

          message:
            "Invalid Google Drive file ID",
        });
      }

      await deleteImageFromGoogleDrive(
        publicId
      );

      console.log(
        "================================="
      );
      console.log(
        "🗑️ GOOGLE DRIVE IMAGE DELETED"
      );
      console.log(
        "File ID:",
        publicId
      );
      console.log(
        "================================="
      );

      return res.status(200).json({
        success: true,

        message:
          "Image deleted successfully",

        publicId,
      });
    } catch (error) {
      console.error(
        "❌ Image Delete Error:",
        error
      );

      const isNotFound =
        error?.message ===
        "Google Drive image was not found";

      return res
        .status(isNotFound ? 404 : 500)
        .json({
          success: false,

          message:
            error?.message ||
            "Image deletion failed",
        });
    }
  }
);

// ======================================================
// MULTER / UPLOAD ERROR HANDLER
// ======================================================

router.use(
  (error, req, res, next) => {
    // --------------------------------------------------
    // MULTER ERRORS
    // --------------------------------------------------

    if (error instanceof multer.MulterError) {
      if (
        error.code ===
        "LIMIT_FILE_SIZE"
      ) {
        return res.status(400).json({
          success: false,

          message:
            "Image size must be 5 MB or less",
        });
      }

      return res.status(400).json({
        success: false,

        message:
          error.message ||
          "Image upload error",
      });
    }

    // --------------------------------------------------
    // INVALID FILE TYPE
    // --------------------------------------------------

    if (
      error?.message ===
      "Only image files are allowed"
    ) {
      return res.status(400).json({
        success: false,

        message:
          "Only image files are allowed",
      });
    }

    // --------------------------------------------------
    // PASS UNKNOWN ERROR
    // --------------------------------------------------

    return next(error);
  }
);

// ======================================================
// EXPORT
// ======================================================

export default router;