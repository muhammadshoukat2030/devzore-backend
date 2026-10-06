import express from "express";
import multer from "multer";
import sharp from "sharp";
import crypto from "crypto";
import { Readable } from "stream";

import { protect, adminOnly } from "../middleware/auth.js";
import { getDriveClient } from "./googleDrive.js";

const router = express.Router();

// CONFIG

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_PUBLIC_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB safety limit

const MAX_IMAGE_WIDTH = 1600;
const MIN_IMAGE_WIDTH = 520;

const TARGET_IMAGE_SIZE = 70 * 1024; // preferred ~70 KB
const HARD_MAX_IMAGE_SIZE = 80 * 1024; // maximum target 80 KB

const START_WEBP_QUALITY = 80;
const MIN_WEBP_QUALITY = 38;
const QUALITY_STEP = 8;

const DRIVE_FOLDER_ID =
  process.env.GOOGLE_DRIVE_FOLDER_ID?.trim() || "";

// MULTER

const storage = multer.memoryStorage();

const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/gif",
  "image/tiff",
]);

const upload = multer({
  storage,

  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1,
  },

  fileFilter: (req, file, cb) => {
    if (!file?.mimetype) {
      return cb(new Error("Invalid image file"));
    }

    if (!ALLOWED_IMAGE_TYPES.has(file.mimetype)) {
      return cb(
        new Error(
          "Only JPG, PNG, WebP, AVIF, GIF and TIFF images are allowed"
        ),
        false
      );
    }

    return cb(null, true);
  },
});

// HELPERS

const bufferToStream = (buffer) => {
  return Readable.from(buffer);
};

const createImageName = () => {
  const timestamp = Date.now();
  const random = crypto.randomBytes(5).toString("hex");

  return `${timestamp}-${random}.webp`;
};

const formatBytes = (bytes = 0) => {
  if (!Number.isFinite(bytes)) return "0 KB";

  return `${(bytes / 1024).toFixed(2)} KB`;
};

const isValidDriveFileId = (fileId) => {
  return /^[a-zA-Z0-9_-]+$/.test(fileId || "");
};

const getRequestBaseUrl = (req) => {
  const configuredBaseUrl =
    process.env.API_PUBLIC_URL?.trim() ||
    process.env.BACKEND_URL?.trim();

  if (configuredBaseUrl) {
    return configuredBaseUrl.replace(/\/+$/, "");
  }

  const forwardedProto = req
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();

  const forwardedHost = req
    .get("x-forwarded-host")
    ?.split(",")[0]
    ?.trim();

  const protocol =
    forwardedProto ||
    req.protocol ||
    "https";

  const host =
    forwardedHost ||
    req.get("host");

  return `${protocol}://${host}`;
};

// IMAGE MIME DETECTION

const detectImageMime = (
  buffer,
  upstreamContentType = ""
) => {
  if (!buffer || buffer.length < 12) {
    return null;
  }

  // JPEG
  if (
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return "image/jpeg";
  }

  // PNG
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return "image/png";
  }

  // GIF
  const gifHeader = buffer
    .subarray(0, 6)
    .toString("ascii");

  if (
    gifHeader === "GIF87a" ||
    gifHeader === "GIF89a"
  ) {
    return "image/gif";
  }

  // WEBP
  const riff = buffer
    .subarray(0, 4)
    .toString("ascii");

  const webp = buffer
    .subarray(8, 12)
    .toString("ascii");

  if (riff === "RIFF" && webp === "WEBP") {
    return "image/webp";
  }

  // AVIF
  const fileTypeBox = buffer
    .subarray(4, 8)
    .toString("ascii");

  const avifBrand = buffer
    .subarray(8, 12)
    .toString("ascii");

  if (
    fileTypeBox === "ftyp" &&
    ["avif", "avis"].includes(avifBrand)
  ) {
    return "image/avif";
  }

  if (
    upstreamContentType &&
    upstreamContentType.startsWith("image/")
  ) {
    return upstreamContentType.split(";")[0];
  }

  return null;
};

// COMPRESS IMAGE

const createCompressedWebp = async (
  inputBuffer,
  width,
  quality
) => {
  const { data, info } = await sharp(inputBuffer, {
    failOn: "none",
    animated: false,
  })
    .rotate()
    .resize({
      width: Math.max(
        1,
        Math.round(width)
      ),

      withoutEnlargement: true,
      fit: "inside",
    })
    .webp({
      quality,
      effort: 6,
      smartSubsample: true,
    })
    .toBuffer({
      resolveWithObject: true,
    });

  return {
    buffer: data,
    width: info?.width || null,
    height: info?.height || null,
    size: data.length,
    quality,
  };
};

const compressImage = async (buffer) => {
  if (!buffer || !Buffer.isBuffer(buffer)) {
    throw new Error("Invalid image buffer");
  }

  try {
    const originalMetadata = await sharp(buffer, {
      failOn: "none",
    }).metadata();

    if (
      !originalMetadata?.width ||
      !originalMetadata?.height
    ) {
      throw new Error(
        "Unable to read image dimensions"
      );
    }

    let currentWidth = Math.min(
      originalMetadata.width,
      MAX_IMAGE_WIDTH
    );

    let currentQuality =
      START_WEBP_QUALITY;

    let smallestResult = null;

    // Main compression loop
    for (
      let attempt = 1;
      attempt <= 24;
      attempt += 1
    ) {
      const result =
        await createCompressedWebp(
          buffer,
          currentWidth,
          currentQuality
        );

      if (
        !smallestResult ||
        result.size < smallestResult.size
      ) {
        smallestResult = result;
      }

      console.log(
        `🗜️ Compression attempt ${attempt}:`,
        `${result.width}x${result.height}`,
        `quality ${currentQuality}`,
        formatBytes(result.size)
      );

      // Excellent result
      if (
        result.size <= TARGET_IMAGE_SIZE
      ) {
        return {
          ...result,
          format: "webp",
          originalSize: buffer.length,
          targetMet: true,
        };
      }

      // Under hard maximum: keep good quality
      if (
        result.size <= HARD_MAX_IMAGE_SIZE
      ) {
        return {
          ...result,
          format: "webp",
          originalSize: buffer.length,
          targetMet: true,
        };
      }

      // First reduce quality
      if (
        currentQuality >
        MIN_WEBP_QUALITY
      ) {
        currentQuality = Math.max(
          MIN_WEBP_QUALITY,
          currentQuality - QUALITY_STEP
        );

        continue;
      }

      // Then reduce dimensions
      if (
        currentWidth >
        MIN_IMAGE_WIDTH
      ) {
        currentWidth = Math.max(
          MIN_IMAGE_WIDTH,
          Math.floor(
            currentWidth * 0.84
          )
        );

        currentQuality = 72;

        continue;
      }

      break;
    }

    // Emergency compression
    let emergencyWidth = Math.min(
      currentWidth,
      MIN_IMAGE_WIDTH
    );

    let emergencyQuality = 34;

    for (
      let attempt = 1;
      attempt <= 8;
      attempt += 1
    ) {
      const result =
        await createCompressedWebp(
          buffer,
          emergencyWidth,
          emergencyQuality
        );

      if (
        !smallestResult ||
        result.size < smallestResult.size
      ) {
        smallestResult = result;
      }

      if (
        result.size <= HARD_MAX_IMAGE_SIZE
      ) {
        return {
          ...result,
          format: "webp",
          originalSize: buffer.length,
          targetMet: true,
        };
      }

      emergencyWidth = Math.max(
        360,
        Math.floor(
          emergencyWidth * 0.85
        )
      );

      emergencyQuality = Math.max(
        26,
        emergencyQuality - 3
      );
    }

    if (!smallestResult) {
      throw new Error(
        "Unable to compress image"
      );
    }

    // We enforce the requested maximum instead of
    // silently storing a very large image.
    if (
      smallestResult.size >
      HARD_MAX_IMAGE_SIZE
    ) {
      throw new Error(
        `Unable to compress this image below 80 KB. Smallest result was ${formatBytes(
          smallestResult.size
        )}.`
      );
    }

    return {
      ...smallestResult,
      format: "webp",
      originalSize: buffer.length,
      targetMet: true,
    };
  } catch (error) {
    throw new Error(
      `Image compression failed: ${error.message}`
    );
  }
};

// GOOGLE DRIVE URLS

const createGoogleDriveViewUrl = (
  fileId
) => {
  return `https://drive.google.com/file/d/${encodeURIComponent(
    fileId
  )}/view`;
};

const createGoogleDriveDownloadUrl = (
  fileId
) => {
  return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(
    fileId
  )}`;
};

const createGoogleDrivePublicUrl = (
  fileId
) => {
  return `https://drive.google.com/uc?export=view&id=${encodeURIComponent(
    fileId
  )}`;
};

// PUBLIC DRIVE FETCH
//
// Important:
// Ye function Google OAuth use nahi karta.
// File "anyone reader" honi chahiye.
//
// Is wajah se already-published images OAuth
// refresh token expire hone ke baad bhi load ho sakti hain.

const getPublicDriveCandidates = (
  fileId
) => {
  const encodedId =
    encodeURIComponent(fileId);

  return [
    `https://drive.usercontent.google.com/download?id=${encodedId}&export=download&confirm=t`,

    `https://drive.google.com/uc?export=download&id=${encodedId}&confirm=t`,

    `https://drive.google.com/uc?export=view&id=${encodedId}`,
  ];
};

const fetchWithTimeout = async (
  url,
  timeout = 15000
) => {
  const controller =
    new AbortController();

  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeout);

  try {
    return await fetch(url, {
      method: "GET",

      redirect: "follow",

      signal: controller.signal,

      headers: {
        Accept:
          "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",

        "User-Agent":
          "Mozilla/5.0 DevZoreImageProxy/1.0",
      },
    });
  } finally {
    clearTimeout(timeoutId);
  }
};

const fetchPublicDriveImage = async (
  fileId
) => {
  const candidates =
    getPublicDriveCandidates(fileId);

  let lastError = null;

  for (const url of candidates) {
    try {
      const response =
        await fetchWithTimeout(url);

      if (!response.ok) {
        lastError = new Error(
          `Google Drive returned HTTP ${response.status}`
        );

        continue;
      }

      const contentLengthHeader =
        response.headers.get(
          "content-length"
        );

      if (contentLengthHeader) {
        const contentLength =
          Number(contentLengthHeader);

        if (
          Number.isFinite(
            contentLength
          ) &&
          contentLength >
            MAX_PUBLIC_IMAGE_SIZE
        ) {
          throw new Error(
            "Drive image is larger than allowed proxy size"
          );
        }
      }

      const arrayBuffer =
        await response.arrayBuffer();

      const imageBuffer =
        Buffer.from(arrayBuffer);

      if (
        imageBuffer.length >
        MAX_PUBLIC_IMAGE_SIZE
      ) {
        throw new Error(
          "Drive image is larger than allowed proxy size"
        );
      }

      const upstreamContentType =
        response.headers
          .get("content-type")
          ?.toLowerCase() || "";

      const mimeType =
        detectImageMime(
          imageBuffer,
          upstreamContentType
        );

      if (!mimeType) {
        lastError = new Error(
          "Google Drive did not return a valid image"
        );

        continue;
      }

      return {
        buffer: imageBuffer,
        mimeType,
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw (
    lastError ||
    new Error(
      "Unable to fetch public Google Drive image"
    )
  );
};

// UPLOAD TO GOOGLE DRIVE

const uploadImageToGoogleDrive = async (
  buffer,
  filename
) => {
  let fileId = null;

  try {
    const drive = getDriveClient();

    const requestBody = {
      name: filename,
      mimeType: "image/webp",
    };

    if (DRIVE_FOLDER_ID) {
      requestBody.parents = [
        DRIVE_FOLDER_ID,
      ];
    }

    // Upload
    const response =
      await drive.files.create({
        requestBody,

        media: {
          mimeType: "image/webp",
          body: bufferToStream(buffer),
        },

        fields:
          "id,name,mimeType,size,createdTime,modifiedTime",

        supportsAllDrives: true,
      });

    fileId = response?.data?.id;

    if (!fileId) {
      throw new Error(
        "Google Drive did not return a file ID"
      );
    }

    // Make public
    await drive.permissions.create({
      fileId,

      requestBody: {
        role: "reader",
        type: "anyone",
      },

      fields: "id",

      supportsAllDrives: true,
    });

    // Metadata
    const fileResponse =
      await drive.files.get({
        fileId,

        fields:
          "id,name,mimeType,size,createdTime,modifiedTime,webViewLink,webContentLink",

        supportsAllDrives: true,
      });

    const file =
      fileResponse?.data || {};

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
        buffer.length,

      createdTime:
        file.createdTime ||
        null,

      modifiedTime:
        file.modifiedTime ||
        null,

      // Direct Drive references
      driveUrl:
        createGoogleDrivePublicUrl(
          fileId
        ),

      webViewLink:
        file.webViewLink ||
        createGoogleDriveViewUrl(
          fileId
        ),

      webContentLink:
        file.webContentLink ||
        createGoogleDriveDownloadUrl(
          fileId
        ),

      downloadUrl:
        createGoogleDriveDownloadUrl(
          fileId
        ),
    };
  } catch (error) {
    // Cleanup incomplete upload
    if (fileId) {
      try {
        const drive =
          getDriveClient();

        await drive.files.delete({
          fileId,
          supportsAllDrives: true,
        });

        console.log(
          "🧹 Incomplete Drive upload removed:",
          fileId
        );
      } catch (cleanupError) {
        console.error(
          "⚠️ Drive cleanup failed:",
          cleanupError?.message
        );
      }
    }

    const googleMessage =
      error?.response?.data?.error_description ||
      error?.response?.data?.error?.message ||
      error?.message ||
      "Unknown Google Drive error";

    throw new Error(
      `Google Drive upload failed: ${googleMessage}`
    );
  }
};

// DELETE FROM GOOGLE DRIVE

const deleteImageFromGoogleDrive = async (
  fileId
) => {
  try {
    const drive = getDriveClient();

    await drive.files.delete({
      fileId,
      supportsAllDrives: true,
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

    const googleMessage =
      error?.response?.data?.error_description ||
      error?.response?.data?.error?.message ||
      error?.message ||
      "Unknown Google Drive error";

    throw new Error(
      `Google Drive delete failed: ${googleMessage}`
    );
  }
};

// GET PUBLIC IMAGE
//
// No OAuth here.
//
// Existing:
// /api/upload/image/FILE_ID
//
// URL same rehne ki wajah se old MongoDB posts ko
// manually change karne ki zaroorat nahi hogi.

router.get(
  "/image/:fileId",
  async (req, res) => {
    try {
      const fileId =
        req.params?.fileId?.trim();

      if (!fileId) {
        return res.status(400).json({
          success: false,
          message:
            "Google Drive file ID is required.",
        });
      }

      if (
        !isValidDriveFileId(fileId)
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid Google Drive file ID.",
        });
      }

      // Important:
      // getDriveClient() intentionally NOT used here.

      const publicImage =
        await fetchPublicDriveImage(
          fileId
        );

      const etag = `"${crypto
        .createHash("sha1")
        .update(publicImage.buffer)
        .digest("hex")}"`;

      // Browser cache validation
      if (
        req.headers["if-none-match"] ===
        etag
      ) {
        res.status(304);
        res.end();
        return;
      }

      res.setHeader(
        "Content-Type",
        publicImage.mimeType
      );

      res.setHeader(
        "Content-Length",
        publicImage.buffer.length
      );

      res.setHeader(
        "Content-Disposition",
        "inline"
      );

      res.setHeader(
        "Cache-Control",
        "public, max-age=31536000, s-maxage=31536000, immutable"
      );

      res.setHeader(
        "ETag",
        etag
      );

      res.setHeader(
        "Cross-Origin-Resource-Policy",
        "cross-origin"
      );

      res.setHeader(
        "Access-Control-Allow-Origin",
        "*"
      );

      res.setHeader(
        "Timing-Allow-Origin",
        "*"
      );

      res.setHeader(
        "X-Content-Type-Options",
        "nosniff"
      );

      return res.status(200).send(
        publicImage.buffer
      );
    } catch (error) {
      console.error(
        "❌ Public Drive image error:",
        error?.message
      );

      if (!res.headersSent) {
        return res.status(404).json({
          success: false,

          message:
            "Image could not be loaded. Make sure the Google Drive file is publicly readable.",
        });
      }

      return res.end();
    }
  }
);

// POST IMAGE

router.post(
  "/image",

  protect,
  adminOnly,

  upload.single("image"),

  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message:
            "No image provided",
        });
      }

      console.log(
        "================================="
      );

      console.log(
        "📷 IMAGE UPLOAD STARTED"
      );

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
        formatBytes(
          req.file.size
        )
      );

      console.log(
        "================================="
      );

      // Compress
      const compressed =
        await compressImage(
          req.file.buffer
        );

      console.log(
        "✅ Compression complete"
      );

      console.log(
        "Final dimensions:",
        `${compressed.width}x${compressed.height}`
      );

      console.log(
        "Final size:",
        formatBytes(
          compressed.size
        )
      );

      console.log(
        "WebP quality:",
        compressed.quality
      );

      // Unique name
      const filename =
        createImageName();

      // Upload
      const driveFile =
        await uploadImageToGoogleDrive(
          compressed.buffer,
          filename
        );

      // Stable backend image URL
      const baseUrl =
        getRequestBaseUrl(req);

      const imageUrl =
        `${baseUrl}/api/upload/image/${encodeURIComponent(
          driveFile.fileId
        )}`;

      console.log(
        "================================="
      );

      console.log(
        "✅ IMAGE UPLOADED"
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
        "Final size:",
        formatBytes(
          compressed.size
        )
      );

      console.log(
        "Public API URL:",
        imageUrl
      );

      console.log(
        "================================="
      );

      return res.status(201).json({
        success: true,

        // Save this in MongoDB.
        // BlogDetails / Blog / Admin can all use it.
        url: imageUrl,

        publicId:
          driveFile.fileId,

        width:
          compressed.width,

        height:
          compressed.height,

        format: "webp",

        size:
          compressed.size,

        originalSize:
          compressed.originalSize,

        quality:
          compressed.quality,

        filename:
          driveFile.filename,

        mimeType:
          driveFile.mimeType,

        // Drive references
        driveUrl:
          driveFile.driveUrl,

        webViewLink:
          driveFile.webViewLink,

        webContentLink:
          driveFile.webContentLink,

        downloadUrl:
          driveFile.downloadUrl,
      });
    } catch (error) {
      console.error(
        "❌ Image Upload Error:",
        error?.message
      );

      const message =
        error?.message ||
        "Image upload failed";

      const isGoogleAuthError =
        message.includes(
          "invalid_grant"
        ) ||
        message
          .toLowerCase()
          .includes("expired") ||
        message
          .toLowerCase()
          .includes("revoked");

      return res
        .status(
          isGoogleAuthError
            ? 503
            : 500
        )
        .json({
          success: false,

          code: isGoogleAuthError
            ? "GOOGLE_DRIVE_AUTH_REQUIRED"
            : "IMAGE_UPLOAD_FAILED",

          message: isGoogleAuthError
            ? "Google Drive authorization needs to be renewed."
            : message,
        });
    }
  }
);

// DELETE IMAGE

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

      if (
        !isValidDriveFileId(
          publicId
        )
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
        error?.message
      );

      const isNotFound =
        error?.message ===
        "Google Drive image was not found";

      const isGoogleAuthError =
        error?.message?.includes(
          "invalid_grant"
        ) ||
        error?.message
          ?.toLowerCase()
          .includes("expired") ||
        error?.message
          ?.toLowerCase()
          .includes("revoked");

      let statusCode = 500;

      if (isNotFound) {
        statusCode = 404;
      } else if (
        isGoogleAuthError
      ) {
        statusCode = 503;
      }

      return res
        .status(statusCode)
        .json({
          success: false,

          code: isGoogleAuthError
            ? "GOOGLE_DRIVE_AUTH_REQUIRED"
            : "IMAGE_DELETE_FAILED",

          message:
            error?.message ||
            "Image deletion failed",
        });
    }
  }
);

// MULTER ERROR HANDLER

router.use(
  (error, req, res, next) => {
    if (
      error instanceof
      multer.MulterError
    ) {
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

    if (
      error?.message ===
        "Invalid image file" ||
      error?.message?.startsWith(
        "Only JPG"
      )
    ) {
      return res.status(400).json({
        success: false,

        message:
          error.message,
      });
    }

    return next(error);
  }
);

export default router;