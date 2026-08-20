import express from 'express';
import { body, validationResult } from 'express-validator';
import Comment from '../models/Comment.js';
import { protect, adminOnly } from '../middleware/auth.js';

const router = express.Router();

// GET /api/comments/:postId (public)
router.get('/:postId', async (req, res) => {
  try {
    const comments = await Comment.find({
      post: req.params.postId, isApproved: true, isSpam: false
    }).sort('-createdAt');
    res.json({ success: true, data: comments });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/comments (public)
router.post('/', [
  body('post').notEmpty().withMessage('Post ID required'),
  body('name').trim().notEmpty().withMessage('Name required'),
  body('email').isEmail().withMessage('Valid email required'),
  body('content').trim().isLength({ min: 10, max: 500 }).withMessage('Comment must be 10-500 chars'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });
    const comment = await Comment.create(req.body);
    res.status(201).json({ success: true, message: 'Comment submitted — awaiting approval', data: comment });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/comments/admin/all (admin)
router.get('/admin/all', protect, adminOnly, async (req, res) => {
  try {
    const { approved } = req.query;
    const filter = {};
    if (approved !== undefined) filter.isApproved = approved === 'true';
    const comments = await Comment.find(filter).populate('post', 'title slug').sort('-createdAt');
    res.json({ success: true, data: comments });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH /api/comments/:id/approve (admin)
router.patch('/:id/approve', protect, adminOnly, async (req, res) => {
  try {
    const comment = await Comment.findByIdAndUpdate(req.params.id, { isApproved: true }, { new: true });
    res.json({ success: true, data: comment });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/comments/:id (admin)
router.delete('/:id', protect, adminOnly, async (req, res) => {
  try {
    await Comment.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Comment deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;