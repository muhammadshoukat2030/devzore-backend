import mongoose from 'mongoose';
import slugify from 'slugify';

const categorySchema = new mongoose.Schema({
  name:        { type: String, required: [true, 'Category name required'], unique: true, trim: true, maxlength: 50 },
  slug:        { type: String, unique: true },
  description: { type: String, default: '', maxlength: 200 },
  color:       { type: String, default: '#7c3aed' },
  postCount:   { type: Number, default: 0 },
}, { timestamps: true });

categorySchema.pre('save', function (next) {
  if (this.isModified('name')) {
    this.slug = slugify(this.name, { lower: true, strict: true });
  }
  next();
});

export default mongoose.model('Category', categorySchema);