import mongoose from 'mongoose';

const commentSchema = new mongoose.Schema({
  post:       { type: mongoose.Schema.Types.ObjectId, ref: 'Post', required: true },
  name:       { type: String, required: [true, 'Name required'], trim: true, maxlength: 60 },
  email:      { type: String, required: [true, 'Email required'], lowercase: true },
  content:    { type: String, required: [true, 'Comment required'], maxlength: 500 },
  isApproved: { type: Boolean, default: false },
  isSpam:     { type: Boolean, default: false },
}, { timestamps: true });

commentSchema.index({ post: 1, isApproved: 1 });

export default mongoose.model('Comment', commentSchema);