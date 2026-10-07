import express from "express";
import multer from "multer";
import sharp from "sharp";
import crypto from "crypto";
import { Readable } from "stream";

import {
  protect,
  adminOnly,
} from "../middleware/auth.js";

import {
  getDriveClient,
} from "./googleDrive.js";

const router = express.Router();

// ======================================================
// CONFIG
// ======================================================

const MAX_FILE_SIZE =
  5 * 1024 * 1024; // 5 MB

const MAX_PUBLIC_IMAGE_SIZE =
  10 * 1024 * 1024; // 10 MB

const MAX_IMAGE_WIDTH = 1600;
const MIN_IMAGE_WIDTH = 520;

const TARGET_IMAGE_SIZE =
  70 * 1024;

const HARD_MAX_IMAGE_SIZE =
  80 * 1024;

const START_WEBP_QUALITY = 80;
const MIN_WEBP_QUALITY = 38;
const QUALITY_STEP = 8;

const DRIVE_FOLDER_ID =
  process.env.GOOGLE_DRIVE_FOLDER_ID?.trim() ||
  "";

// ======================================================
// MULTER
// ======================================================

const storage =
  multer.memoryStorage();

const ALLOWED_IMAGE_TYPES =
  new Set([
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

  fileFilter: (
    req,
    file,
    cb
  ) => {
    if (!file?.mimetype) {
      return cb(
        new Error(
          "Invalid image file"
        )
      );
    }

    if (
      !ALLOWED_IMAGE_TYPES.has(
        file.mimetype
      )
    ) {
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

// ======================================================
// GENERAL HELPERS
// ======================================================

const bufferToStream = (
  buffer
) => {
  return Readable.from(buffer);
};

const createImageName = () => {
  const timestamp = Date.now();

  const random =
    crypto
      .randomBytes(5)
      .toString("hex");

  return `${timestamp}-${random}.webp`;
};

const formatBytes = (
  bytes = 0
) => {
  if (
    !Number.isFinite(bytes)
  ) {
    return "0 KB";
  }

  return `${(
    bytes / 1024
  ).toFixed(2)} KB`;
};

const isValidDriveFileId = (
  fileId
) => {
  return /^[a-zA-Z0-9_-]+$/.test(
    fileId || ""
  );
};

// ======================================================
// BACKEND PUBLIC ORIGIN
// ======================================================
//
// Supports:
//
// Local:
// http://localhost:5000
//
// Production:
// https://devzore-backend.vercel.app
//
// API_PUBLIC_URL / BACKEND_URL can be:
// https://backend.com
// OR
// https://backend.com/api
//
// Both work.
// ======================================================

const getRequestBaseUrl = (
  req
) => {
  const configuredBaseUrl =
    process.env.API_PUBLIC_URL?.trim() ||
    process.env.BACKEND_URL?.trim();

  if (configuredBaseUrl) {
    return configuredBaseUrl
      .replace(/\/+$/, "")
      .replace(/\/api$/, "");
  }

  const forwardedProto =
    req
      .get("x-forwarded-proto")
      ?.split(",")[0]
      ?.trim();

  const forwardedHost =
    req
      .get("x-forwarded-host")
      ?.split(",")[0]
      ?.trim();

  const protocol =
    forwardedProto ||
    req.protocol ||
    "http";

  const host =
    forwardedHost ||
    req.get("host");

  return `${protocol}://${host}`;
};

// ======================================================
// GOOGLE ERROR HELPERS
// ======================================================

const getGoogleErrorMessage = (
  error
) => {
  return (
    error?.response?.data
      ?.error_description ||
    error?.response?.data
      ?.error?.message ||
    error?.response?.data
      ?.error ||
    error?.message ||
    "Unknown Google Drive error"
  );
};

const isGoogleAuthFailure = (
  error
) => {
  const message =
    getGoogleErrorMessage(
      error
    ).toLowerCase();

  return (
    message.includes(
      "invalid_grant"
    ) ||
    message.includes(
      "invalid_client"
    ) ||
    message.includes(
      "expired"
    ) ||
    message.includes(
      "revoked"
    ) ||
    message.includes(
      "unauthorized"
    )
  );
};

// ======================================================
// IMAGE MIME DETECTION
// ======================================================
//
// IMPORTANT:
//
// We do NOT trust arbitrary upstream Content-Type.
//
// App images are converted to WebP anyway.
// Magic bytes are checked before serving.
// ======================================================

const detectImageMime = (
  buffer
) => {
  if (
    !buffer ||
    buffer.length < 12
  ) {
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
  const gifHeader =
    buffer
      .subarray(0, 6)
      .toString("ascii");

  if (
    gifHeader === "GIF87a" ||
    gifHeader === "GIF89a"
  ) {
    return "image/gif";
  }

  // WEBP
  const riff =
    buffer
      .subarray(0, 4)
      .toString("ascii");

  const webp =
    buffer
      .subarray(8, 12)
      .toString("ascii");

  if (
    riff === "RIFF" &&
    webp === "WEBP"
  ) {
    return "image/webp";
  }

  // AVIF / AVIS
  const fileTypeBox =
    buffer
      .subarray(4, 8)
      .toString("ascii");

  const brand =
    buffer
      .subarray(8, 12)
      .toString("ascii");

  if (
    fileTypeBox === "ftyp" &&
    [
      "avif",
      "avis",
    ].includes(brand)
  ) {
    return "image/avif";
  }

  return null;
};

// ======================================================
// COMPRESS IMAGE TO WEBP
// ======================================================

const createCompressedWebp =
  async (
    inputBuffer,
    width,
    quality
  ) => {
    const {
      data,
      info,
    } = await sharp(
      inputBuffer,
      {
        failOn: "none",
        animated: false,
      }
    )
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

      width:
        info?.width ||
        null,

      height:
        info?.height ||
        null,

      size:
        data.length,

      quality,
    };
  };

const compressImage =
  async (buffer) => {
    if (
      !buffer ||
      !Buffer.isBuffer(buffer)
    ) {
      throw new Error(
        "Invalid image buffer"
      );
    }

    try {
      const originalMetadata =
        await sharp(
          buffer,
          {
            failOn: "none",
          }
        ).metadata();

      if (
        !originalMetadata?.width ||
        !originalMetadata?.height
      ) {
        throw new Error(
          "Unable to read image dimensions"
        );
      }

      let currentWidth =
        Math.min(
          originalMetadata.width,
          MAX_IMAGE_WIDTH
        );

      let currentQuality =
        START_WEBP_QUALITY;

      let smallestResult =
        null;

      // ==================================================
      // MAIN COMPRESSION LOOP
      // ==================================================

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
          result.size <
            smallestResult.size
        ) {
          smallestResult =
            result;
        }

        console.log(
          `🗜️ Compression attempt ${attempt}:`,
          `${result.width}x${result.height}`,
          `quality ${currentQuality}`,
          formatBytes(
            result.size
          )
        );

        // Preferred target reached
        if (
          result.size <=
          TARGET_IMAGE_SIZE
        ) {
          return {
            ...result,
            format: "webp",
            originalSize:
              buffer.length,
            targetMet: true,
          };
        }

        // Hard maximum reached
        if (
          result.size <=
          HARD_MAX_IMAGE_SIZE
        ) {
          return {
            ...result,
            format: "webp",
            originalSize:
              buffer.length,
            targetMet: true,
          };
        }

        // Reduce quality first
        if (
          currentQuality >
          MIN_WEBP_QUALITY
        ) {
          currentQuality =
            Math.max(
              MIN_WEBP_QUALITY,
              currentQuality -
                QUALITY_STEP
            );

          continue;
        }

        // Then reduce dimensions
        if (
          currentWidth >
          MIN_IMAGE_WIDTH
        ) {
          currentWidth =
            Math.max(
              MIN_IMAGE_WIDTH,

              Math.floor(
                currentWidth *
                  0.84
              )
            );

          currentQuality = 72;

          continue;
        }

        break;
      }

      // ==================================================
      // EMERGENCY COMPRESSION
      // ==================================================

      let emergencyWidth =
        Math.min(
          currentWidth,
          MIN_IMAGE_WIDTH
        );

      let emergencyQuality =
        34;

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
          result.size <
            smallestResult.size
        ) {
          smallestResult =
            result;
        }

        if (
          result.size <=
          HARD_MAX_IMAGE_SIZE
        ) {
          return {
            ...result,

            format:
              "webp",

            originalSize:
              buffer.length,

            targetMet:
              true,
          };
        }

        emergencyWidth =
          Math.max(
            360,

            Math.floor(
              emergencyWidth *
                0.85
            )
          );

        emergencyQuality =
          Math.max(
            26,

            emergencyQuality -
              3
          );
      }

      if (!smallestResult) {
        throw new Error(
          "Unable to compress image"
        );
      }

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

        format:
          "webp",

        originalSize:
          buffer.length,

        targetMet:
          true,
      };
    } catch (error) {
      throw new Error(
        `Image compression failed: ${error.message}`
      );
    }
  };

// ======================================================
// GOOGLE DRIVE URL HELPERS
// ======================================================

const createGoogleDriveViewUrl =
  (fileId) => {
    return `https://drive.google.com/file/d/${encodeURIComponent(
      fileId
    )}/view`;
  };

const createGoogleDriveDownloadUrl =
  (fileId) => {
    return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(
      fileId
    )}`;
  };

const createGoogleDrivePublicUrl =
  (fileId) => {
    return `https://drive.google.com/uc?export=view&id=${encodeURIComponent(
      fileId
    )}`;
  };

// ======================================================
// PUBLIC GOOGLE DRIVE FETCH
// ======================================================
//
// Uploaded images are shared:
//
// type: anyone
// role: reader
//
// Therefore the public image route normally does NOT
// depend on OAuth.
//
// If Google's public media URL fails, we later use
// authenticated Drive API as a fallback.
// ======================================================

const getPublicDriveCandidates =
  (fileId) => {
    const encodedId =
      encodeURIComponent(
        fileId
      );

    return [
      `https://drive.usercontent.google.com/download?id=${encodedId}&export=download&confirm=t`,

      `https://drive.google.com/uc?export=download&id=${encodedId}&confirm=t`,

      `https://drive.google.com/uc?export=view&id=${encodedId}`,
    ];
  };

// ======================================================
// FETCH WITH TIMEOUT
// ======================================================

const fetchWithTimeout =
  async (
    url,
    timeout = 15000
  ) => {
    const controller =
      new AbortController();

    const timeoutId =
      setTimeout(
        () => {
          controller.abort();
        },
        timeout
      );

    try {
      return await fetch(
        url,
        {
          method: "GET",

          redirect:
            "follow",

          signal:
            controller.signal,

          headers: {
            Accept:
              "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",

            "User-Agent":
              "DevZoreImageProxy/1.0",
          },
        }
      );
    } finally {
      clearTimeout(
        timeoutId
      );
    }
  };

// ======================================================
// FETCH PUBLIC DRIVE IMAGE
// ======================================================

const fetchPublicDriveImage =
  async (fileId) => {
    const candidates =
      getPublicDriveCandidates(
        fileId
      );

    let lastError =
      null;

    for (
      const url of candidates
    ) {
      try {
        const response =
          await fetchWithTimeout(
            url
          );

        if (!response.ok) {
          lastError =
            new Error(
              `Google Drive returned HTTP ${response.status}`
            );

          continue;
        }

        const contentLengthHeader =
          response.headers.get(
            "content-length"
          );

        if (
          contentLengthHeader
        ) {
          const contentLength =
            Number(
              contentLengthHeader
            );

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
          Buffer.from(
            arrayBuffer
          );

        if (
          imageBuffer.length >
          MAX_PUBLIC_IMAGE_SIZE
        ) {
          throw new Error(
            "Drive image is larger than allowed proxy size"
          );
        }

        const mimeType =
          detectImageMime(
            imageBuffer
          );

        // Google sometimes returns an HTML page instead
        // of the actual file.
        if (!mimeType) {
          lastError =
            new Error(
              "Google Drive public endpoint did not return image bytes"
            );

          continue;
        }

        return {
          buffer:
            imageBuffer,

          mimeType,

          source:
            "public",
        };
      } catch (error) {
        lastError =
          error;
      }
    }

    throw (
      lastError ||
      new Error(
        "Unable to fetch public Google Drive image"
      )
    );
  };

// ======================================================
// AUTHENTICATED DRIVE FALLBACK
// ======================================================
//
// This is only used if the public URL fails.
//
// OAuth client automatically refreshes access tokens
// using GOOGLE_REFRESH_TOKEN.
// ======================================================

const fetchAuthenticatedDriveImage =
  async (fileId) => {
    const drive =
      getDriveClient();

    const metadataResponse =
      await drive.files.get({
        fileId,

        fields:
          "id,name,mimeType,size",

        supportsAllDrives:
          true,
      });

    const declaredSize =
      Number(
        metadataResponse?.data
          ?.size || 0
      );

    if (
      declaredSize &&
      declaredSize >
        MAX_PUBLIC_IMAGE_SIZE
    ) {
      throw new Error(
        "Drive image is larger than allowed proxy size"
      );
    }

    const response =
      await drive.files.get(
        {
          fileId,

          alt:
            "media",

          supportsAllDrives:
            true,
        },
        {
          responseType:
            "arraybuffer",
        }
      );

    const imageBuffer =
      Buffer.isBuffer(
        response.data
      )
        ? response.data
        : Buffer.from(
            response.data
          );

    if (
      imageBuffer.length >
      MAX_PUBLIC_IMAGE_SIZE
    ) {
      throw new Error(
        "Drive image is larger than allowed proxy size"
      );
    }

    const mimeType =
      detectImageMime(
        imageBuffer
      );

    if (!mimeType) {
      throw new Error(
        "Google Drive did not return valid image bytes"
      );
    }

    return {
      buffer:
        imageBuffer,

      mimeType,

      source:
        "oauth",
    };
  };

// ======================================================
// FINAL DRIVE IMAGE FETCH
// ======================================================

const getDriveImage =
  async (fileId) => {
    // First:
    // public Drive access.
    //
    // This keeps blog images independent from OAuth
    // during normal public viewing.

    try {
      return await fetchPublicDriveImage(
        fileId
      );
    } catch (
      publicError
    ) {
      console.warn(
        "⚠️ Public Drive image fetch failed. Trying authenticated fallback:",
        publicError?.message
      );
    }

    // Second:
    // authenticated fallback.

    return await fetchAuthenticatedDriveImage(
      fileId
    );
  };

// ======================================================
// UPLOAD TO GOOGLE DRIVE
// ======================================================

const uploadImageToGoogleDrive =
  async (
    buffer,
    filename
  ) => {
    let fileId = null;

    try {
      const drive =
        getDriveClient();

      const requestBody = {
        name:
          filename,

        mimeType:
          "image/webp",
      };

      if (
        DRIVE_FOLDER_ID
      ) {
        requestBody.parents = [
          DRIVE_FOLDER_ID,
        ];
      }

      // ==================================================
      // CREATE FILE
      // ==================================================

      const response =
        await drive.files.create({
          requestBody,

          media: {
            mimeType:
              "image/webp",

            body:
              bufferToStream(
                buffer
              ),
          },

          fields:
            "id,name,mimeType,size,createdTime,modifiedTime",

          supportsAllDrives:
            true,
        });

      fileId =
        response?.data?.id;

      if (!fileId) {
        throw new Error(
          "Google Drive did not return a file ID"
        );
      }

      // ==================================================
      // PUBLIC READ PERMISSION
      // ==================================================
      //
      // Blog image can now be loaded without requiring
      // the website visitor to authenticate with Google.
      // ==================================================

      await drive.permissions.create({
        fileId,

        requestBody: {
          role:
            "reader",

          type:
            "anyone",

          allowFileDiscovery:
            false,
        },

        fields:
          "id",

        supportsAllDrives:
          true,
      });

      // ==================================================
      // GET FINAL METADATA
      // ==================================================

      const fileResponse =
        await drive.files.get({
          fileId,

          fields:
            "id,name,mimeType,size,createdTime,modifiedTime,webViewLink,webContentLink",

          supportsAllDrives:
            true,
        });

      const file =
        fileResponse?.data ||
        {};

      return {
        fileId,

        filename:
          file.name ||
          filename,

        mimeType:
          file.mimeType ||
          "image/webp",

        size:
          Number(
            file.size ||
              buffer.length
          ),

        createdTime:
          file.createdTime ||
          null,

        modifiedTime:
          file.modifiedTime ||
          null,

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
      // ==================================================
      // CLEANUP PARTIAL UPLOAD
      // ==================================================

      if (fileId) {
        try {
          const drive =
            getDriveClient();

          await drive.files.delete({
            fileId,

            supportsAllDrives:
              true,
          });

          console.log(
            "🧹 Incomplete Drive upload removed:",
            fileId
          );
        } catch (
          cleanupError
        ) {
          console.error(
            "⚠️ Drive cleanup failed:",
            cleanupError
              ?.message
          );
        }
      }

      const googleMessage =
        getGoogleErrorMessage(
          error
        );

      throw new Error(
        `Google Drive upload failed: ${googleMessage}`
      );
    }
  };

// ======================================================
// DELETE FROM GOOGLE DRIVE
// ======================================================

const deleteImageFromGoogleDrive =
  async (fileId) => {
    try {
      const drive =
        getDriveClient();

      await drive.files.delete({
        fileId,

        supportsAllDrives:
          true,
      });

      return true;
    } catch (error) {
      const status =
        error?.code ||
        error?.response?.status;

      if (
        Number(status) === 404
      ) {
        throw new Error(
          "Google Drive image was not found"
        );
      }

      throw new Error(
        `Google Drive delete failed: ${getGoogleErrorMessage(
          error
        )}`
      );
    }
  };

// ======================================================
// GET PUBLIC IMAGE
// ======================================================
//
// GET
// /api/upload/image/:fileId
//
// IMPORTANT:
//
// No admin auth.
// Public blog pages need to use this endpoint.
//
// Process:
//
// 1. Try public Google Drive file.
// 2. If public endpoint fails, OAuth fallback.
// 3. Return actual image bytes.
// ======================================================

router.get(
  "/image/:fileId",

  async (req, res) => {
    try {
      const fileId =
        req.params?.fileId?.trim();

      if (!fileId) {
        return res
          .status(400)
          .json({
            success:
              false,

            message:
              "Google Drive file ID is required.",
          });
      }

      if (
        !isValidDriveFileId(
          fileId
        )
      ) {
        return res
          .status(400)
          .json({
            success:
              false,

            message:
              "Invalid Google Drive file ID.",
          });
      }

      // ==================================================
      // FETCH IMAGE
      // ==================================================

      const driveImage =
        await getDriveImage(
          fileId
        );

      // ==================================================
      // ETAG
      // ==================================================

      const etag =
        `"${crypto
          .createHash("sha1")
          .update(
            driveImage.buffer
          )
          .digest("hex")}"`;

      if (
        req.headers[
          "if-none-match"
        ] === etag
      ) {
        return res
          .status(304)
          .end();
      }

      // ==================================================
      // RESPONSE HEADERS
      // ==================================================

      res.setHeader(
        "Content-Type",
        driveImage.mimeType
      );

      res.setHeader(
        "Content-Length",
        driveImage.buffer
          .length
      );

      res.setHeader(
        "Content-Disposition",
        "inline"
      );

      // Image ID changes whenever a new image is uploaded,
      // so aggressive caching is safe.
      res.setHeader(
        "Cache-Control",
        "public, max-age=31536000, s-maxage=31536000, immutable"
      );

      res.setHeader(
        "ETag",
        etag
      );

      // IMPORTANT for localhost:5173 -> localhost:5000
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

      // Useful for debugging without exposing secrets.
      res.setHeader(
        "X-DevZore-Image-Source",
        driveImage.source
      );

      return res
        .status(200)
        .send(
          driveImage.buffer
        );
    } catch (error) {
      const googleAuthError =
        isGoogleAuthFailure(
          error
        );

      console.error(
        "❌ Drive image serve error:",
        error?.message
      );

      if (
        !res.headersSent
      ) {
        return res
          .status(
            googleAuthError
              ? 503
              : 404
          )
          .json({
            success:
              false,

            code:
              googleAuthError
                ? "GOOGLE_DRIVE_AUTH_REQUIRED"
                : "IMAGE_NOT_FOUND",

            message:
              googleAuthError
                ? "Google Drive authentication is unavailable."
                : "Image could not be loaded.",
          });
      }

      return res.end();
    }
  }
);

// ======================================================
// POST IMAGE
// ======================================================
//
// POST
// /api/upload/image
//
// Admin only.
// ======================================================

router.post(
  "/image",

  protect,
  adminOnly,

  upload.single(
    "image"
  ),

  async (req, res) => {
    try {
      if (!req.file) {
        return res
          .status(400)
          .json({
            success:
              false,

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

      // ==================================================
      // COMPRESS
      // ==================================================

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

      // ==================================================
      // CREATE UNIQUE FILE NAME
      // ==================================================

      const filename =
        createImageName();

      // ==================================================
      // GOOGLE DRIVE UPLOAD
      // ==================================================

      const driveFile =
        await uploadImageToGoogleDrive(
          compressed.buffer,
          filename
        );

      // ==================================================
      // PUBLIC BACKEND IMAGE URL
      // ==================================================

      const baseUrl =
        getRequestBaseUrl(
          req
        );

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

      // ==================================================
      // RESPONSE
      // ==================================================

      return res
        .status(201)
        .json({
          success:
            true,

          // Frontend may use this immediately.
          url:
            imageUrl,

          // MOST IMPORTANT:
          // Save this as coverImagePublicId.
          publicId:
            driveFile.fileId,

          width:
            compressed.width,

          height:
            compressed.height,

          format:
            "webp",

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
      const message =
        error?.message ||
        "Image upload failed";

      const googleAuthError =
        isGoogleAuthFailure(
          error
        );

      console.error(
        "❌ Image Upload Error:",
        message
      );

      return res
        .status(
          googleAuthError
            ? 503
            : 500
        )
        .json({
          success:
            false,

          code:
            googleAuthError
              ? "GOOGLE_DRIVE_AUTH_REQUIRED"
              : "IMAGE_UPLOAD_FAILED",

          message:
            googleAuthError
              ? "Google Drive authorization is unavailable."
              : message,
        });
    }
  }
);

// ======================================================
// DELETE IMAGE
// ======================================================
//
// DELETE
// /api/upload/image/:publicId
//
// Admin only.
// ======================================================

router.delete(
  "/image/:publicId",

  protect,
  adminOnly,

  async (req, res) => {
    try {
      const publicId =
        req.params
          ?.publicId
          ?.trim();

      if (!publicId) {
        return res
          .status(400)
          .json({
            success:
              false,

            message:
              "Google Drive file ID is required",
          });
      }

      if (
        !isValidDriveFileId(
          publicId
        )
      ) {
        return res
          .status(400)
          .json({
            success:
              false,

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

      return res
        .status(200)
        .json({
          success:
            true,

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

      const googleAuthError =
        isGoogleAuthFailure(
          error
        );

      let statusCode =
        500;

      if (isNotFound) {
        statusCode = 404;
      } else if (
        googleAuthError
      ) {
        statusCode = 503;
      }

      return res
        .status(
          statusCode
        )
        .json({
          success:
            false,

          code:
            googleAuthError
              ? "GOOGLE_DRIVE_AUTH_REQUIRED"
              : isNotFound
                ? "IMAGE_NOT_FOUND"
                : "IMAGE_DELETE_FAILED",

          message:
            error?.message ||
            "Image deletion failed",
        });
    }
  }
);

// ======================================================
// MULTER ERROR HANDLER
// ======================================================

router.use(
  (
    error,
    req,
    res,
    next
  ) => {
    if (
      error instanceof
      multer.MulterError
    ) {
      if (
        error.code ===
        "LIMIT_FILE_SIZE"
      ) {
        return res
          .status(400)
          .json({
            success:
              false,

            message:
              "Image size must be 5 MB or less",
          });
      }

      return res
        .status(400)
        .json({
          success:
            false,

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
      return res
        .status(400)
        .json({
          success:
            false,

          message:
            error.message,
        });
    }

    return next(error);
  }
);

// ======================================================
// EXPORT
// ======================================================

export default router;