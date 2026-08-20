import mongoose from 'mongoose';
import slugify from 'slugify';

const postSchema = new mongoose.Schema({
  title:          { type: String, required: [true, 'Title required'], trim: true, maxlength: 200 },
  slug:           { type: String, unique: true },
  excerpt:        { type: String, required: [true, 'Excerpt required'], maxlength: 300 },
  content:        { type: String, required: [true, 'Content required'] },
  coverImage:     { type: String, default: '' },
  coverImageAlt:  { type: String, default: '' },
  author:         { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  category:       { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
  tags:           [{ type: String, trim: true, lowercase: true }],
  status:         { type: String, enum: ['draft', 'published', 'scheduled'], default: 'draft' },
  publishedAt:    { type: Date },
  featured:       { type: Boolean, default: false },
  readTime:       { type: Number, default: 1 },
  views:          { type: Number, default: 0 },
  likes:          { type: Number, default: 0 },
  seoTitle:       { type: String, maxlength: 70, default: '' },
  seoDescription: { type: String, maxlength: 160, default: '' },
  seoKeywords:    { type: String, default: '' },
  tableOfContents: [{ id: String, text: String, level: Number }],
}, { timestamps: true });

postSchema.pre('save', function (next) {
  if (this.isModified('title')) {
    this.slug = slugify(this.title, { lower: true, strict: true }) + '-' + Date.now();
  }
  if (this.isModified('content')) {
    const wordCount = this.content.replace(/<[^>]*>/g, '').split(/\s+/).length;
    this.readTime = Math.max(1, Math.ceil(wordCount / 200));
  }
  if (this.isModified('status') && this.status === 'published' && !this.publishedAt) {
    this.publishedAt = new Date();
  }
  next();
});

postSchema.methods.incrementViews = async function () {
  this.views += 1;
  return this.save({ validateBeforeSave: false });
};
postSchema.index({ status: 1, publishedAt: -1 });
postSchema.index({ category: 1, status: 1 });
postSchema.index({ tags: 1 });
postSchema.index({ featured: 1 });
postSchema.index({ title: 'text', excerpt: 'text', content: 'text' });

export default mongoose.model('Post', postSchema);