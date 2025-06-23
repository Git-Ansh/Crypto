const express = require("express");
const router = express.Router();
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { check, validationResult } = require("express-validator");
const { CustomError } = require("../utils/errors");
const User = require("../models/user");
const RefreshToken = require("../models/RefreshTokens");
const { encrypt, decrypt } = require("../utils/crypto");
const crypto = require("crypto");
const admin = require("firebase-admin");

// Import your CORS configuration
const corsOptions = require("../config/corsConfig");

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
      res.status(201).json({
        success: true,
        message: "User registered successfully",
        data: {
          id: newUser._id,
          username: newUser.username,
          email: newUser.email
        }
      });
    } catch (error) {
      console.error("Registration error:", error);
      if (!(error instanceof CustomError)) {
        return next(new CustomError("Server error: " + error.message, 500));
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
        return res.status(404).json({
          success: false,
          message: "User does not exist. Please sign up instead.",
        });
      }

      // Check if this is a Google/Firebase user (no password)
      if (user.firebaseUid && !user.password) {
        return res.status(400).json({
          success: false,
          message:
            "This account was created with Google. Please sign in with Google instead.",
        });
      }

      // Now we can safely compare passwords
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return res.status(400).json({
          success: false,
          message: "Invalid credentials",
        });
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
router.options("/google-verify", cors(corsOptions));
router.post("/google-verify", cors(corsOptions), async (req, res, next) => {
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

// Add this route to get current user data - simplified version
router.get("/users/me", async (req, res) => {
  try {
    // Extract token from authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res
        .status(401)
        .json({ message: "No token, authorization denied" });
    }

    const token = authHeader.split(" ")[1];

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Get user from database
    const user = await User.findById(decoded.user.id).select("-password");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json(user);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: "Server Error" });
  }
});

// Add this route to get current user data - no dependencies version
router.get("/me", async (req, res) => {
  try {
    // Extract token from authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res
        .status(401)
        .json({ message: "No token, authorization denied" });
    }

    const token = authHeader.split(" ")[1];

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Get user from database
    const user = await User.findById(decoded.user.id).select("-password");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json(user);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: "Server Error" });
  }
});

// Modify the existing verify-token route to help with debugging
router.options("/verify-token", cors(corsOptions));
router.get("/verify-token", cors(corsOptions), async (req, res) => {
  try {
    console.log("Token verification requested");
    const authHeader = req.header("Authorization");

    if (!authHeader) {
      console.log("No Authorization header found");
      return res.status(401).json({ message: "No token provided" });
    }

    console.log("Auth header format:", authHeader.substring(0, 20) + "...");

    let token;
    if (authHeader.startsWith("Bearer ")) {
      token = authHeader.split(" ")[1];
    } else {
      token = authHeader;
    }

    try {
      // Try Firebase verification
      const decodedFirebase = await admin.auth().verifyIdToken(token);
      console.log(
        "Firebase verification successful for user:",
        decodedFirebase.uid
      );

      // Find user by Firebase UID
      const User = require("../models/user");
      const user = await User.findOne({ firebaseUid: decodedFirebase.uid });

      return res.json({
        valid: true,
        message: "Token is valid",
        uid: decodedFirebase.uid,
        user: user ? { id: user._id } : null,
      });
    } catch (firebaseError) {
      // If Firebase verification fails, try JWT
      console.log("Firebase verification failed:", firebaseError.message);

      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        console.log("JWT verification successful for user:", decoded.user?.id);
        return res.json({
          valid: true,
          message: "JWT token is valid",
          user: decoded.user,
        });
      } catch (jwtError) {
        console.error("JWT verification failed:", jwtError.message);
        return res.status(401).json({
          valid: false,
          message: "Invalid token",
          firebaseError: firebaseError.message,
          jwtError: jwtError.message,
        });
      }
    }
  } catch (error) {
    console.error("Token verification error:", error);
    return res
      .status(500)
      .json({ message: "Server error during token verification" });
  }
});

// Add this to your existing auth.js file

// Debug endpoint to help diagnose token issues
router.get("/debug-token", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({
        success: false,
        message: "No Authorization header provided",
        headers: Object.keys(req.headers),
      });
    }

    // Parse the token
    let token;
    if (authHeader.startsWith("Bearer ")) {
      token = authHeader.substring(7);
    } else if (authHeader.startsWith("Firebase ")) {
      token = authHeader.substring(9);
    } else {
      token = authHeader; // Assume raw token
    }

    // Try to decode the token (without verification)
    let decoded;
    try {
      // Basic decoding of JWT parts
      const parts = token.split(".");
      if (parts.length === 3) {
        const header = JSON.parse(Buffer.from(parts[0], "base64").toString());
        const payload = JSON.parse(Buffer.from(parts[1], "base64").toString());

        decoded = { header, payload };
      } else {
        decoded = { error: "Not a valid JWT format" };
      }
    } catch (e) {
      decoded = { error: `Error decoding: ${e.message}` };
    }

    // Try to verify with Firebase
    try {
      const decodedToken = await admin.auth().verifyIdToken(token);

      return res.json({
        success: true,
        message: "Token is valid",
        tokenFormat: authHeader.startsWith("Bearer ")
          ? "Bearer"
          : authHeader.startsWith("Firebase ")
            ? "Firebase"
            : "Raw",
        decodedJwt: decoded,
        verifiedToken: decodedToken,
      });
    } catch (firebaseError) {
      return res.status(401).json({
        success: false,
        message: "Token verification failed",
        tokenFormat: authHeader.startsWith("Bearer ")
          ? "Bearer"
          : authHeader.startsWith("Firebase ")
            ? "Firebase"
            : "Raw",
        decodedJwt: decoded,
        error: firebaseError.message,
        errorCode: firebaseError.code,
      });
    }
  } catch (error) {
    console.error("Debug token error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Add a comprehensive debug endpoint for authentication issues
router.get("/debug-auth", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({
        success: false,
        message: "No Authorization header",
        headers: Object.keys(req.headers),
      });
    }

    // Parse token
    let token;
    if (authHeader.startsWith("Bearer ")) {
      token = authHeader.split(" ")[1];
    } else {
      token = authHeader;
    }

    // Test both verification methods without throwing
    let firebaseResult = { success: false };
    let jwtResult = { success: false };

    try {
      const decodedFirebase = await admin.auth().verifyIdToken(token);
      firebaseResult = {
        success: true,
        uid: decodedFirebase.uid,
        email: decodedFirebase.email,
      };

      // Find associated user
      const user = await User.findOne({ firebaseUid: decodedFirebase.uid });
      if (user) {
        firebaseResult.mongoUser = {
          id: user._id.toString(),
          email: user.email,
        };
      } else {
        firebaseResult.mongoUser = null;
      }
    } catch (e) {
      firebaseResult.error = e.message;
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      jwtResult = {
        success: true,
        payload: decoded,
      };

      if (decoded.user && decoded.user.id) {
        const user = await User.findById(decoded.user.id);
        if (user) {
          jwtResult.mongoUser = {
            id: user._id.toString(),
            email: user.email,
          };
        } else {
          jwtResult.mongoUser = null;
        }
      }
    } catch (e) {
      jwtResult.error = e.message;
    }

    return res.json({
      tokenAnalysis: {
        authHeaderType: authHeader.startsWith("Bearer ") ? "Bearer" : "Other",
        tokenLength: token.length,
        tokenPreview: token.substring(0, 10) + "...",
      },
      firebaseVerification: firebaseResult,
      jwtVerification: jwtResult,
      requestUrl: req.originalUrl,
      requestPath: req.path,
    });
  } catch (error) {
    console.error("Auth debug error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Add this new diagnostic route
router.get("/token-check", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const tokenFromHeader = authHeader?.startsWith("Bearer ")
      ? authHeader.split(" ")[1]
      : authHeader;

    const tokenFromCookie = req.cookies?.token;
    const tokenFromQuery = req.query?.token;

    // Compare all sources
    const sources = {
      header: tokenFromHeader ? `${tokenFromHeader.substring(0, 10)}...` : null,
      cookie: tokenFromCookie ? `${tokenFromCookie.substring(0, 10)}...` : null,
      query: tokenFromQuery ? `${tokenFromQuery.substring(0, 10)}...` : null,
    };

    // Try to decode/verify each token source
    const verificationResults = {};

    for (const [source, token] of Object.entries(sources)) {
      if (!token) {
        verificationResults[source] = { status: "missing" };
        continue;
      }

      try {
        // Just decode without verification
        const decoded = jwt.decode(token.replace(/\.\.\.$/, ""));

        // Try verification
        try {
          const verified = jwt.verify(
            token.replace(/\.\.\.$/, ""),
            process.env.JWT_SECRET
          );
          verificationResults[source] = {
            status: "valid",
            decoded,
            verified: true,
          };
        } catch (e) {
          verificationResults[source] = {
            status: "invalid",
            decoded,
            error: e.message,
            verified: false,
          };
        }
      } catch (e) {
        verificationResults[source] = {
          status: "malformed",
          error: e.message,
        };
      }
    }

    res.json({
      tokenSources: sources,
      verification: verificationResults,
      requestInfo: {
        url: req.originalUrl,
        method: req.method,
        ip: req.ip,
        headers: {
          accept: req.headers.accept,
          contentType: req.headers["content-type"],
          userAgent: req.headers["user-agent"],
        },
      },
    });
  } catch (error) {
    console.error("Token check error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

module.exports = router;
