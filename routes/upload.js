import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import crypto from 'crypto';
import { Readable } from 'stream';

import { protect, adminOnly } from '../middleware/auth.js';
import { getDriveClient } from './googleDrive.js';

const router = express.Router();

// ======================================================
// MULTER CONFIGURATION
// ======================================================
// Image RAM mein temporarily receive hogi.
// Local public/uploads folder mein save nahi hogi.
// Maximum image size = 5 MB.
// ======================================================

const storage = multer.memoryStorage();

const upload = multer({
  storage,

  limits: {
    fileSize: 5 * 1024 * 1024,
  },

  fileFilter: (req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith('image/')) {
      return cb(null, true);
    }

    return cb(new Error('Only image files are allowed'), false);
  },
});

// ======================================================
// BUFFER -> STREAM
// ======================================================
// Google Drive API upload ke liye image Buffer ko
// readable stream mein convert karta hai.
// ======================================================

const bufferToStream = (buffer) => {
  const stream = new Readable();

  stream.push(buffer);
  stream.push(null);

  return stream;
};

// ======================================================
// CREATE UNIQUE IMAGE NAME
// ======================================================

const createImageName = () => {
  const timestamp = Date.now();
  const random = crypto.randomBytes(4).toString('hex');

  return `${timestamp}-${random}.webp`;
};

// ======================================================
// COMPRESS IMAGE
// ======================================================
// Original JPG / PNG / WEBP etc. ko WebP mein convert karega.
// Large images ko max 1600px width tak resize karega.
// Aspect ratio preserve rahega.
// ======================================================

const compressImage = async (buffer) => {
  try {
    const originalMetadata = await sharp(buffer).metadata();

    const compressedBuffer = await sharp(buffer)
      .rotate()
      .resize({
        width: 1600,
        withoutEnlargement: true,
        fit: 'inside',
      })
      .webp({
        quality: 80,
      })
      .toBuffer();

    const finalMetadata = await sharp(compressedBuffer).metadata();

    return {
      buffer: compressedBuffer,
      width: finalMetadata.width || originalMetadata.width || null,
      height: finalMetadata.height || originalMetadata.height || null,
      format: 'webp',
    };
  } catch (error) {
    throw new Error(`Image compression failed: ${error.message}`);
  }
};

// ======================================================
// UPLOAD IMAGE TO GOOGLE DRIVE
// ======================================================

const uploadImageToGoogleDrive = async (buffer, filename) => {
  try {
    const drive = getDriveClient();

    const response = await drive.files.create({
      requestBody: {
        name: filename,
        mimeType: 'image/webp',
      },

      media: {
        mimeType: 'image/webp',
        body: bufferToStream(buffer),
      },

      fields: 'id,name,mimeType,size,createdTime',
    });

    const fileId = response.data.id;

    if (!fileId) {
      throw new Error('Google Drive did not return a file ID');
    }

    // --------------------------------------------------
    // Make image publicly readable
    // --------------------------------------------------
    // Blog visitors ko Google login ki zaroorat nahi hogi.
    // --------------------------------------------------

    await drive.permissions.create({
      fileId,

      requestBody: {
        role: 'reader',
        type: 'anyone',
      },
    });

    return {
      fileId,
      filename,

      // Direct image URL.
      // Existing frontend ke "url" field ke saath compatible.
      url: `https://drive.google.com/uc?export=view&id=${fileId}`,

      webViewLink: `https://drive.google.com/file/d/${fileId}/view`,
    };
  } catch (error) {
    throw new Error(`Google Drive upload failed: ${error.message}`);
  }
};

// ======================================================
// DELETE IMAGE FROM GOOGLE DRIVE
// ======================================================

const deleteImageFromGoogleDrive = async (fileId) => {
  try {
    const drive = getDriveClient();

    await drive.files.delete({
      fileId,
    });

    return true;
  } catch (error) {
    // Already deleted / missing file ko separately handle karein.
    if (error?.code === 404 || error?.response?.status === 404) {
      throw new Error('Google Drive image was not found');
    }

    throw new Error(`Google Drive delete failed: ${error.message}`);
  }
};

// ======================================================
// POST /api/upload/image
// ======================================================
// Admin image upload.
//
// Expected form-data:
//
// image = <selected image>
//
// Response frontend ke existing format ko maintain karta hai:
//
// {
//   success,
//   url,
//   publicId,
//   width,
//   height,
//   format
// }
//
// publicId ab local filename ki jagah Google Drive File ID hoga.
// ======================================================

router.post(
  '/image',
  protect,
  adminOnly,
  upload.single('image'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'No image provided',
        });
      }

      // -----------------------------------------------
      // 1. Compress image
      // -----------------------------------------------

      const compressed = await compressImage(req.file.buffer);

      // -----------------------------------------------
      // 2. Generate filename
      // -----------------------------------------------

      const filename = createImageName();

      // -----------------------------------------------
      // 3. Upload compressed image to Google Drive
      // -----------------------------------------------

      const driveFile = await uploadImageToGoogleDrive(
        compressed.buffer,
        filename
      );

      console.log('=================================');
      console.log('✅ IMAGE UPLOADED TO GOOGLE DRIVE');
      console.log('File ID:', driveFile.fileId);
      console.log('Filename:', filename);
      console.log('=================================');

      // -----------------------------------------------
      // 4. Send same structure expected by frontend
      // -----------------------------------------------

      return res.status(201).json({
        success: true,

        url: driveFile.url,

        // IMPORTANT:
        // Google Drive File ID is used for deletion.
        publicId: driveFile.fileId,

        width: compressed.width,
        height: compressed.height,
        format: compressed.format,

        filename,

        webViewLink: driveFile.webViewLink,
      });
    } catch (error) {
      console.error('❌ Image Upload Error:', error);

      return res.status(500).json({
        success: false,
        message: error.message || 'Image upload failed',
      });
    }
  }
);

// ======================================================
// DELETE /api/upload/image/:publicId
// ======================================================
// publicId = Google Drive File ID
//
// Example:
// DELETE /api/upload/image/1AbCdEfGh...
// ======================================================

router.delete(
  '/image/:publicId',
  protect,
  adminOnly,
  async (req, res) => {
    try {
      const { publicId } = req.params;

      if (!publicId) {
        return res.status(400).json({
          success: false,
          message: 'Google Drive file ID is required',
        });
      }

      await deleteImageFromGoogleDrive(publicId);

      console.log('=================================');
      console.log('🗑️ GOOGLE DRIVE IMAGE DELETED');
      console.log('File ID:', publicId);
      console.log('=================================');

      return res.status(200).json({
        success: true,
        message: 'Image deleted successfully',
        publicId,
      });
    } catch (error) {
      console.error('❌ Image Delete Error:', error);

      const isNotFound =
        error.message === 'Google Drive image was not found';

      return res.status(isNotFound ? 404 : 500).json({
        success: false,
        message: error.message || 'Image deletion failed',
      });
    }
  }
);

// ======================================================
// MULTER ERROR HANDLER
// ======================================================

router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: 'Image size must be 5 MB or less',
      });
    }

    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }

  if (error?.message === 'Only image files are allowed') {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }

  return next(error);
});

// ======================================================
// EXPORT
// ======================================================

export default router;