import express from 'express';
import multer from 'multer';
import dotenv from 'dotenv';
import { protect, adminOnly } from '../middleware/auth.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs/promises';
import sharp from 'sharp';
import crypto from 'crypto';

dotenv.config();

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const uploadsDir = join(__dirname, '../public/uploads');

// Ensure uploads directory exists
try {
  await fs.mkdir(uploadsDir, { recursive: true });
} catch (err) {
  console.error('Failed to create uploads directory:', err);
}

// Configure multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only images allowed'), false);
  }
});

// Helper function to compress and save image
const compressAndSaveImage = async (buffer, originalName) => {
  try {
    const timestamp = Date.now();
    const random = crypto.randomBytes(4).toString('hex');
    const filename = `${timestamp}-${random}.webp`;
    const filepath = join(uploadsDir, filename);

    // Use sharp to compress image to WebP format
    const image = sharp(buffer);
    const metadata = await image.metadata();
    
    await image
      .webp({ quality: 80 })
      .toFile(filepath);

    return {
      filename,
      url: `/uploads/${filename}`,
      width: metadata.width,
      height: metadata.height,
      format: 'webp'
    };
  } catch (err) {
    throw new Error(`Image compression failed: ${err.message}`);
  }
};

// POST /api/upload/image
router.post('/image', protect, adminOnly, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No image provided' });
    }

    const result = await compressAndSaveImage(req.file.buffer, req.file.originalname);

    res.json({
      success: true,
      url: result.url,
      publicId: result.filename, // Use filename as publicId for deletion
      width: result.width,
      height: result.height,
      format: result.format,
    });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/upload/image/:publicId
router.delete('/image/:publicId', protect, adminOnly, async (req, res) => {
  try {
    const filepath = join(uploadsDir, req.params.publicId);
    
    // Security check: ensure the path is within uploads directory
    if (!filepath.startsWith(uploadsDir)) {
      return res.status(400).json({ success: false, message: 'Invalid file path' });
    }

    await fs.unlink(filepath);
    res.json({ success: true, message: 'Image deleted' });
  } catch (err) {
    console.error('Delete error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;