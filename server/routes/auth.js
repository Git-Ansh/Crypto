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
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
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
      if (!(error instanceof CustomError)) {
        return next(new CustomError("Server error", 500));
      }
      next(error);
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
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(new CustomError("Validation failed", 400));
    }

    try {
      const { email, password } = req.body;
      const userEmail = email.toLowerCase();
      console.log("User Email:", userEmail);
      const user = await User.findOne({ email: userEmail });
      console.log("User:", user);
      if (!user) {
        throw new CustomError("Invalid credentials", 400);
      }

      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        throw new CustomError("Invalid credentials", 400);
      }

      // Delete expired refresh tokens
      await RefreshToken.deleteMany({
        userId: user._id,
        expiresAt: { $lt: new Date() },
      });

      // Create JWT Access Token with explicit algorithm
      const accessPayload = { user: { id: user.id } };
      const accessToken = jwt.sign(accessPayload, process.env.JWT_SECRET, {
        algorithm: "HS256",
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

      // Set cookies
      res.cookie("token", accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 15 * 60 * 1000,
      });

      res.cookie("refreshToken", rawRefresh, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });

      res.json({
        success: true,
        message: "Logged in successfully",
        token: accessToken,
        expiresIn: 15 * 60,
      });
    } catch (error) {
      console.log(error);
      if (!(error instanceof CustomError)) {
        return next(new CustomError("Server error", 500));
      }
      next(error);
    }
  }
);

// ============== VERIFY TOKEN ROUTE ==============
router.get("/verify", async (req, res, next) => {
  try {
    console.log("Environment:", process.env.NODE_ENV);
    console.log("Headers:", req.headers);
    console.log("Cookies:", req.cookies);

    const token = req.cookies.token;
    console.log("Extracted Token:", token);

    if (!token) {
      throw new CustomError("No token provided", 401);
    }

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

    const decryptedRefresh = decrypt(refreshToken);

    const storedToken = await RefreshToken.findOne({
      encryptedToken: encrypt(decryptedRefresh),
    });

    if (!storedToken) {
      throw new CustomError("Invalid refresh token", 403);
    }

    if (storedToken.expiresAt < new Date()) {
      await RefreshToken.deleteOne({ _id: storedToken._id });
      throw new CustomError("Refresh token has expired", 403);
    }

    const user = await User.findById(storedToken.userId);
    if (!user) {
      throw new CustomError("User not found", 404);
    }

    const accessPayload = { user: { id: user.id } };
    const newAccessToken = jwt.sign(accessPayload, process.env.JWT_SECRET, {
      algorithm: "HS256",
      expiresIn: "15m",
    });

    // Optionally: Generate a new refresh token and invalidate the old one
    const newRefreshString = generateRefreshTokenString();
    const newEncryptedRefresh = encrypt(newRefreshString);

    const newExpiry = new Date();
    newExpiry.setDate(newExpiry.getDate() + REFRESH_TOKEN_EXPIRY_DAYS);

    await RefreshToken.create({
      userId: user._id,
      encryptedToken: newEncryptedRefresh,
      expiresAt: newExpiry,
    });
    await RefreshToken.deleteMany({
      userId: user._id,
      expiresAt: { $lt: new Date() },
    });

    res.cookie("refreshToken", newRefreshString, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "none",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.cookie("token", newAccessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "none",
      maxAge: 15 * 60 * 1000,
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
      const encryptedRefresh = encrypt(refreshToken);
      await RefreshToken.deleteOne({ encryptedToken: encryptedRefresh });
    }

    res.clearCookie("token", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "none",
    });
    res.clearCookie("refreshToken", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "none",
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

    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const { uid, email, name, picture } = decodedToken;

    let user = await User.findOne({ email });
    if (!user) {
      user = new User({
        username: name || email.split("@")[0],
        email,
        firebaseUid: uid,
        avatar: picture,
      });
      await user.save();
    } else {
      if (!user.firebaseUid) {
        user.firebaseUid = uid;
        if (picture && !user.avatar) user.avatar = picture;
        await user.save();
      }
    }

    await RefreshToken.deleteMany({
      userId: user._id,
      expiresAt: { $lt: new Date() },
    });

    const accessPayload = { user: { id: user.id } };
    const accessToken = jwt.sign(accessPayload, process.env.JWT_SECRET, {
      algorithm: "HS256",
      expiresIn: "15m",
    });

    const rawRefresh = generateRefreshTokenString();
    const encryptedRefresh = encrypt(rawRefresh);

    const expiry = new Date();
    expiry.setDate(expiry.getDate() + REFRESH_TOKEN_EXPIRY_DAYS);

    await RefreshToken.create({
      userId: user._id,
      encryptedToken: encryptedRefresh,
      expiresAt: expiry,
    });

    res.cookie("token", accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "none",
      maxAge: 15 * 60 * 1000,
    });

    res.cookie("refreshToken", rawRefresh, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "none",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

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

// ============== DEBUG TOKEN ROUTE ==============
router.get("/debug-token", async (req, res) => {
  const authHeader = req.header("Authorization");
  console.log("Auth header:", authHeader);

  const token = authHeader?.split(" ")[1];
  console.log("Extracted token:", token ? "Token exists" : "No token");

  if (!token) {
    return res.status(400).json({
      message: "No token provided",
      headers: req.headers,
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return res.json({
      valid: true,
      decoded,
      message: "Token is valid",
    });
  } catch (err) {
    console.error("Token verification error:", err);
    return res.status(401).json({
      valid: false,
      message: "Invalid token",
      error: err.message,
    });
  }
});

// ============== TOKEN INFO ROUTE ==============
router.get("/token-info", async (req, res) => {
  const authHeader = req.header("Authorization");
  const token = authHeader?.split(" ")[1] || req.cookies.token;

  if (!token) {
    return res.status(400).json({ message: "No token provided" });
  }

  try {
    const decoded = jwt.decode(token, { complete: true });
    return res.json({
      header: decoded.header,
      payload: decoded.payload,
      signature: "exists but not shown",
    });
  } catch (err) {
    return res.status(400).json({
      message: "Error decoding token",
      error: err.message,
    });
  }
});

// Add a new route for token exchange
router.post("/exchange-google-token", async (req, res, next) => {
  try {
    const { idToken } = req.body;

    if (!idToken) {
      throw new CustomError("No ID token provided", 400);
    }

    // Verify the Google token using Firebase Admin SDK
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const { uid, email, name, picture } = decodedToken;

    // Find or create user
    let user = await User.findOne({ email });
    if (!user) {
      user = new User({
        username: name || email.split("@")[0],
        email,
        firebaseUid: uid,
        avatar: picture,
      });
      await user.save();
    }

    // Create our own token with HS256 algorithm
    const accessPayload = { user: { id: user.id } };
    const accessToken = jwt.sign(accessPayload, process.env.JWT_SECRET, {
      algorithm: "HS256",
      expiresIn: "15m",
    });

    // Create refresh token
    const rawRefresh = generateRefreshTokenString();
    const encryptedRefresh = encrypt(rawRefresh);

    const expiry = new Date();
    expiry.setDate(expiry.getDate() + REFRESH_TOKEN_EXPIRY_DAYS);

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
      maxAge: 15 * 60 * 1000,
    });

    res.cookie("refreshToken", rawRefresh, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "none",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.json({
      success: true,
      token: accessToken,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
      },
    });
  } catch (error) {
    console.error("Token exchange error:", error);
    next(error);
  }
});

module.exports = router;
