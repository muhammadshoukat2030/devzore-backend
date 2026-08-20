import express from 'express';
import { body, validationResult } from 'express-validator';
import Post from '../models/Post.js';
import Category from '../models/Category.js';
import { protect, adminOnly } from '../middleware/auth.js';

const router = express.Router();

// GET /api/posts — All published posts
router.get('/', async (req, res) => {
  try {
    const { category, tag, search, featured, page = 1, limit = 10, sort = '-publishedAt' } = req.query;
    const filter = { status: 'published' };
    if (category) {
      const cat = await Category.findOne({ slug: category });
      if (cat) filter.category = cat._id;
    }
    if (tag) filter.tags = { $in: [tag.toLowerCase()] };
    if (featured) filter.featured = true;
    if (search) filter.$text = { $search: search };

    const skip = (Number(page) - 1) * Number(limit);
    const total = await Post.countDocuments(filter);
    const posts = await Post.find(filter)
      .populate('author', 'name avatar bio')
      .populate('category', 'name slug color')
      .select('-content -tableOfContents')
      .sort(sort)
      .skip(skip)
      .limit(Number(limit));

    res.json({
      success: true, data: posts,
      pagination: { total, page: Number(page), pages: Math.ceil(total / Number(limit)), limit: Number(limit) }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/posts/featured
router.get('/featured', async (req, res) => {
  try {
    const posts = await Post.find({ status: 'published', featured: true })
      .populate('author', 'name avatar')
      .populate('category', 'name slug color')
      .select('-content -tableOfContents')
      .sort('-publishedAt').limit(6);
    res.json({ success: true, data: posts });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/posts/latest
router.get('/latest', async (req, res) => {
  try {
    const posts = await Post.find({ status: 'published' })
      .populate('author', 'name avatar')
      .populate('category', 'name slug color')
      .select('-content -tableOfContents')
      .sort('-publishedAt').limit(3);
    res.json({ success: true, data: posts });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/posts/admin/all — Admin all posts
router.get('/admin/all', protect, adminOnly, async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (status) filter.status = status;
    const skip = (Number(page) - 1) * Number(limit);
    const total = await Post.countDocuments(filter);
    const posts = await Post.find(filter)
      .populate('author', 'name')
      .populate('category', 'name slug')
      .select('-content -tableOfContents')
      .sort('-createdAt').skip(skip).limit(Number(limit));
    res.json({ success: true, data: posts, pagination: { total, page: Number(page), pages: Math.ceil(total / Number(limit)) } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/posts/admin/:id
router.get('/admin/:id', protect, adminOnly, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id)
      .populate('author', 'name')
      .populate('category', 'name slug');
    if (!post) return res.status(404).json({ success: false, message: 'Post not found' });
    res.json({ success: true, data: post });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/posts/:slug — Single post (public)
router.get('/:slug', async (req, res) => {
  try {
    const post = await Post.findOne({ slug: req.params.slug, status: 'published' })
      .populate('author', 'name avatar bio')
      .populate('category', 'name slug color');
    if (!post) return res.status(404).json({ success: false, message: 'Post not found' });
    await post.incrementViews();
    const related = await Post.find({
      status: 'published', category: post.category._id, _id: { $ne: post._id }
    }).populate('author', 'name avatar').populate('category', 'name slug color')
      .select('-content -tableOfContents').limit(3);
    res.json({ success: true, data: post, related });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/posts — Create post
router.post('/', protect, adminOnly, [
  body('title').trim().notEmpty().withMessage('Title required'),
  body('excerpt').trim().notEmpty().withMessage('Excerpt required'),
  body('content').notEmpty().withMessage('Content required'),
  body('category').notEmpty().withMessage('Category required'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });
    const post = await Post.create({ ...req.body, author: req.user._id });
    if (post.status === 'published') {
      await Category.findByIdAndUpdate(post.category, { $inc: { postCount: 1 } });
    }
    res.status(201).json({ success: true, data: post });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/posts/:id — Update post
router.put('/:id', protect, adminOnly, async (req, res) => {
  try {
    const post = await Post.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!post) return res.status(404).json({ success: false, message: 'Post not found' });
    res.json({ success: true, data: post });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/posts/:id
router.delete('/:id', protect, adminOnly, async (req, res) => {
  try {
    const post = await Post.findByIdAndDelete(req.params.id);
    if (!post) return res.status(404).json({ success: false, message: 'Post not found' });
    if (post.status === 'published') {
      await Category.findByIdAndUpdate(post.category, { $inc: { postCount: -1 } });
    }
    res.json({ success: true, message: 'Post deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH /api/posts/:id/toggle-featured
router.patch('/:id/toggle-featured', protect, adminOnly, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ success: false, message: 'Post not found' });
    post.featured = !post.featured;
    await post.save({ validateBeforeSave: false });
    res.json({ success: true, data: post });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;