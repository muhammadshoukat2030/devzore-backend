import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema({
  name:     { type: String, required: [true, 'Name required'], trim: true, maxlength: 50 },
  email:    { type: String, required: [true, 'Email required'], unique: true, lowercase: true, trim: true },
  password: { type: String, required: [true, 'Password required'], minlength: 6, select: false },
  role:     { type: String, enum: ['admin', 'author'], default: 'author' },
  avatar:   { type: String, default: '' },
  bio:      { type: String, default: '', maxlength: 300 },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  return obj;
};

export default mongoose.model('User', userSchema);
