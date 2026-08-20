import mongoose from "mongoose";
import bcrypt from "bcryptjs";

// ======================================================
// User Schema
// ======================================================

const userSchema = new mongoose.Schema(
  {
    // --------------------------------------------------
    // Name
    // --------------------------------------------------

    name: {
      type: String,
      required: [true, "Name required"],
      trim: true,
      maxlength: 50,
    },

    // --------------------------------------------------
    // Email
    // --------------------------------------------------

    email: {
      type: String,
      required: [true, "Email required"],
      unique: true,
      lowercase: true,
      trim: true,
    },

    // --------------------------------------------------
    // Password
    // --------------------------------------------------

    password: {
      type: String,
      required: [true, "Password required"],
      minlength: 6,
      select: false,
    },

    // --------------------------------------------------
    // Role
    // --------------------------------------------------

    role: {
      type: String,
      enum: ["admin", "author"],
      default: "author",
    },

    // --------------------------------------------------
    // Avatar
    // --------------------------------------------------

    avatar: {
      type: String,
      default: "",
      trim: true,
    },

    // --------------------------------------------------
    // Bio
    // --------------------------------------------------

    bio: {
      type: String,
      default: "",
      trim: true,
      maxlength: 300,
    },

    // --------------------------------------------------
    // Active / Inactive
    // --------------------------------------------------

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// ======================================================
// Hash Password Before Save
// Mongoose 9 Compatible
// ======================================================

userSchema.pre("save", async function () {
  // Password change nahi hua
  // to dobara hash nahi karein
  if (!this.isModified("password")) {
    return;
  }

  // Password ko bcrypt se hash karein
  this.password = await bcrypt.hash(this.password, 12);
});

// ======================================================
// Compare Password
// ======================================================

userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// ======================================================
// Remove Password From JSON Response
// ======================================================

userSchema.methods.toJSON = function () {
  const obj = this.toObject();

  delete obj.password;

  return obj;
};

// ======================================================
// Export Model
// ======================================================

const User = mongoose.model("User", userSchema);

export default User;