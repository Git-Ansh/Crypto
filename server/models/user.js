const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  password: {
    type: String,
    // Not required for Firebase users
  },
  firebaseUid: {
    type: String,
    sparse: true, // Allow null but enforce uniqueness when present
    unique: true,
  },
  avatar: {
    type: String,
  },
  paperBalance: {
    type: Number,
    default: 10000,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
  lastLogin: {
    type: Date,
    default: null,
  },
  role: {
    type: String,
    enum: ["user", "admin"],
    default: "user",
  },
  isActive: {
    type: Boolean,
    default: true,
  },
});

// Check if the model exists before creating it
module.exports = mongoose.models.User || mongoose.model("User", UserSchema);
