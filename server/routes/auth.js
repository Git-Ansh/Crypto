// server/routes/auth.js
const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs"); // Changed from bcrypt to bcryptjs
const jwt = require("jsonwebtoken");
const { check, validationResult } = require("express-validator");
const crypto = require("crypto");
const admin = require("firebase-admin");

// Initialize Firebase Admin SDK if not already initialized
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
  });
}

// Models
const User = require("../models/user");
const RefreshToken = require("../models/RefreshTokens");

// Utilities
const { encrypt, decrypt } = require("../utils/crypto");
const CustomError = require("../utils/CustomError");

// Constants
const REFRESH_TOKEN_EXPIRY_DAYS = 7;

/**
 * Utility to create a random token string for refresh tokens
 */
function generateRefreshTokenString() {
  return crypto.randomBytes(32).toString("hex");
}

// ============== REGISTER ROUTE ==============
router.post(
  "/register",
  [
    check("username", "Username is required").not().isEmpty(),
    check("email", "Please include a valid email").isEmail(),
    check("password", "Password must be 6 or more characters").isLength({
      min: 6,
    }),
  ],
  async (req, res, next) => {
    // Validate request body
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      // Pass validation errors to error handler
      return next(new CustomError("Validation failed", 400));
    }

    try {
      const { username, email, password } = req.body;

      // Check if user already exists
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        throw new CustomError("User already exists", 400);
      }

      // Hash the password
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);

      // Create a new user
      const newUser = new User({
        username,
        email,
        password: hashedPassword,
      });

      await newUser.save();

      res.status(201).json({ message: "User registered successfully" });
    } catch (error) {
      // If the error is not a CustomError, convert it to one
      if (!(error instanceof CustomError)) {
        return next(new CustomError("Server error", 500));
      }
      next(error); // Pass the error to the error handler
    }
  }
);

// ============== LOGIN ROUTE ==============
router.post(
  "/login",
  [
    check("email", "Please include a valid email").isEmail(),
    check("password", "Password is required").exists(),
  ],
  async (req, res, next) => {
    // Validate request body
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(new CustomError("Validation failed", 400));
    }

    try {
      const { email, password } = req.body;

      // Check if user exists

      const userEmail = email.toLowerCase();
      console.log("User Email:", userEmail);
      const user = await User.findOne({ email: userEmail });
      console.log("User:", user);
      if (!user) {
        throw new CustomError("Invalid credentials", 400);
      }

      // Compare passwords
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        throw new CustomError("Invalid credentials", 400);
      }

      // Delete expired refresh tokens
      await RefreshToken.deleteMany({
        userId: user._id,
        expiresAt: { $lt: new Date() },
      });

      // Create short-lived JWT Access Token
      const accessPayload = { user: { id: user.id } };
      const accessToken = jwt.sign(accessPayload, process.env.JWT_SECRET, {
        expiresIn: "15m",
      });

      // Generate and encrypt a refresh token
      const rawRefresh = generateRefreshTokenString();
      const encryptedRefresh = encrypt(rawRefresh);

      // Calculate refresh token expiry
      const expiry = new Date();
      expiry.setDate(expiry.getDate() + REFRESH_TOKEN_EXPIRY_DAYS);

      // Store encrypted refresh token in DB
      await RefreshToken.create({
        userId: user._id,
        encryptedToken: encryptedRefresh,
        expiresAt: expiry,
      });

      res.cookie("token", accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production", // only send over HTTPS in production
        sameSite: "none",
        secure: true,
        maxAge: 15 * 60 * 1000, // 15 minutes in ms
      });

      res.cookie("refreshToken", rawRefresh, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "none",
        secure: true,
        maxAge: 7 * 24 * 60 * 60 * 1000, // e.g. 7 days
      });

      // Return minimal JSON (no tokens)
      res.json({
        success: true,
        message: "Logged in successfully",
        expiresIn: 15 * 60, // optional, if you want the client to know the access token expiry in seconds
      });
    } catch (error) {
      console.log(error);
      // If the error is not a CustomError, convert it to one
      if (!(error instanceof CustomError)) {
        return next(new CustomError("Server error", 500));
      }
      next(error); // Pass the error to the error handler
    }
  }
);

router.get("/verify", async (req, res, next) => {
  try {
    console.log("Environment:", process.env.NODE_ENV);
    console.log("Headers:", req.headers);
    console.log("Cookies:", req.cookies);

    // Extract the access token from cookies
    const token = req.cookies.token;
    console.log("Extracted Token:", token);

    if (!token) {
      throw new CustomError("No token provided", 401);
    }

    // Verify the access token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log("Decoded Token:", decoded);

    res.json({ message: "Token is valid", user: decoded.user });
  } catch (error) {
    console.error(error);
    if (error.name === "TokenExpiredError") {
      throw new CustomError("Token has expired", 401);
    } else if (error.name === "JsonWebTokenError") {
      throw new CustomError("Invalid token", 401);
    }
    next(new CustomError("Server error", error.message, 500));
  }
});

// ============== REFRESH TOKEN ROUTE ==============
router.post("/refresh-token", async (req, res, next) => {
  try {
    const refreshToken = req.cookies.refreshToken;

    if (!refreshToken) {
      throw new CustomError("Refresh token is required", 400);
    }

    // Decrypt the received refresh token
    const decryptedRefresh = decrypt(refreshToken);

    // Find the refresh token in the database
    const storedToken = await RefreshToken.findOne({
      encryptedToken: encrypt(decryptedRefresh),
    });

    if (!storedToken) {
      throw new CustomError("Invalid refresh token", 403);
    }

    // Check if the refresh token has expired
    if (storedToken.expiresAt < new Date()) {
      // Delete the expired refresh token
      await RefreshToken.deleteOne({ _id: storedToken._id });
      throw new CustomError("Refresh token has expired", 403);
    }

    // Find the associated user
    const user = await User.findById(storedToken.userId);
    if (!user) {
      throw new CustomError("User not found", 404);
    }

    // Generate a new access token
    const accessPayload = { user: { id: user.id } };
    const newAccessToken = jwt.sign(accessPayload, process.env.JWT_SECRET, {
      expiresIn: "15m",
    });

    // Optionally: Generate a new refresh token and invalidate the old one
    // Comment out the following block if you want to reuse the same refresh token
    const newRefreshString = generateRefreshTokenString();
    const newEncryptedRefresh = encrypt(newRefreshString);

    // Calculate new expiry
    const newExpiry = new Date();
    newExpiry.setDate(newExpiry.getDate() + REFRESH_TOKEN_EXPIRY_DAYS);

    // Store the new refresh token and delete the old one
    await RefreshToken.create({
      userId: user._id,
      encryptedToken: newEncryptedRefresh,
      expiresAt: newExpiry,
    });
    await RefreshToken.deleteMany({
      userId: user._id,
      expiresAt: { $lt: new Date() },
    });

    // Send the new tokens to the client
    res.cookie("refreshToken", newRefreshString, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "none",
      secure: true,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in ms
    });

    res.cookie("token", newAccessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "none",
      secure: true,
      maxAge: 15 * 60 * 1000, // 15 minutes in ms
    });

    res.json({
      message: "Token refreshed successfully",
      accessToken: newAccessToken,
    });
  } catch (error) {
    console.error(error);
    if (!(error instanceof CustomError)) {
      return next(new CustomError("Server error", 500));
    }
    next(error);
  }
});

// ============== LOGOUT ROUTE ==============
router.post("/logout", async (req, res, next) => {
  try {
    const { refreshToken } = req.cookies;
    if (refreshToken) {
      // We do *not* call 'decrypt' because this is the raw token
      const encryptedRefresh = encrypt(refreshToken);
      await RefreshToken.deleteOne({ encryptedToken: encryptedRefresh });
    }

    // Clear cookies
    res.clearCookie("token", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "none",
      secure: true,
    });
    res.clearCookie("refreshToken", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "none",
      secure: true,
    });

    res.json({ message: "Logged out successfully" });
  } catch (error) {
    console.error(error);
    next(new CustomError("Server error", 500));
  }
});

// ============== GOOGLE AUTH VERIFICATION ROUTE ==============
router.post("/google-verify", async (req, res, next) => {
  try {
    const { idToken } = req.body;

    if (!idToken) {
      throw new CustomError("No ID token provided", 400);
    }

    // Verify the Firebase ID token
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const { uid, email, name, picture } = decodedToken;

    // Check if user exists in our database
    let user = await User.findOne({ email });

    if (!user) {
      // Create a new user if they don't exist
      user = new User({
        username: name || email.split("@")[0],
        email,
        firebaseUid: uid,
        avatar: picture,
        // No password needed for OAuth users
      });

      await user.save();
    } else {
      // Update existing user with Firebase UID if needed
      if (!user.firebaseUid) {
        user.firebaseUid = uid;
        if (picture && !user.avatar) user.avatar = picture;
        await user.save();
      }
    }

    // Delete expired refresh tokens
    await RefreshToken.deleteMany({
      userId: user._id,
      expiresAt: { $lt: new Date() },
    });

    // Create JWT access token
    const accessPayload = { user: { id: user.id } };
    const accessToken = jwt.sign(accessPayload, process.env.JWT_SECRET, {
      expiresIn: "15m",
    });

    // Generate refresh token
    const rawRefresh = generateRefreshTokenString();
    const encryptedRefresh = encrypt(rawRefresh);

    // Calculate refresh token expiry
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + REFRESH_TOKEN_EXPIRY_DAYS);

    // Store encrypted refresh token in DB
    await RefreshToken.create({
      userId: user._id,
      encryptedToken: encryptedRefresh,
      expiresAt: expiry,
    });

    // Set cookies
    res.cookie("token", accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "none",
      secure: true,
      maxAge: 15 * 60 * 1000, // 15 minutes
    });

    res.cookie("refreshToken", rawRefresh, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "none",
      secure: true,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    // Return success response with minimal user data
    res.json({
      success: true,
      message: "Google authentication successful",
      data: {
        id: user._id,
        name: user.username,
        email: user.email,
        avatar: user.avatar,
      },
    });
  } catch (error) {
    console.error("Google auth error:", error);
    if (!(error instanceof CustomError)) {
      return next(new CustomError("Server error", 500));
    }
    next(error);
  }
});

// Export the router containing all authentication routes
module.exports = router;
