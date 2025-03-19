const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const User = require("../models/user");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

// Diagnostic route - no auth required
router.get("/debug", async (req, res) => {
  try {
    const count = await User.countDocuments();
    res.json({
      message: "User system connected",
      userCount: count,
      routes: router.stack.map((r) => r.route?.path).filter((p) => p),
    });
  } catch (err) {
    console.error("Error in debug route:", err);
    res
      .status(500)
      .json({ message: "Server Error in debug route", error: err.message });
  }
});

// Add a no-auth debug route to check if the basic routing is working
router.get("/debug-no-auth", async (req, res) => {
  try {
    console.log("No-auth debug route accessed");
    console.log("Headers:", req.headers);

    const authHeader = req.header("Authorization");
    let tokenInfo = "No token provided";

    if (authHeader) {
      try {
        const token = authHeader.startsWith("Bearer ")
          ? authHeader.substring(7)
          : authHeader;

        // Just decode without verification
        const decoded = jwt.decode(token);
        tokenInfo = {
          decoded,
          tokenPreview: token.substring(0, 10) + "...",
        };
      } catch (e) {
        tokenInfo = `Error decoding: ${e.message}`;
      }
    }

    // Return all potentially useful debugging info
    res.json({
      message: "No auth debug route successful",
      time: new Date().toISOString(),
      authHeader: authHeader ? `${authHeader.substring(0, 15)}...` : "none",
      tokenInfo,
      routePath: req.path,
      allRoutes: router.stack
        .map((r) => ({
          path: r.route?.path,
          methods: r.route?.methods,
        }))
        .filter((r) => r.path),
    });
  } catch (err) {
    console.error("Error in no-auth debug route:", err);
    res.status(500).json({ error: err.message });
  }
});

// Update profile route to try multiple user finding methods
router.get("/profile", auth, async (req, res) => {
  try {
    console.log("Profile request received with user ID:", req.user?.id);
    console.log("Auth method used:", req.authMethod || "unknown");
    console.log("Request path:", req.path);
    console.log("Request headers:", JSON.stringify(req.headers, null, 2));

    if (!req.user || !req.user.id) {
      console.error("No user ID in request after auth middleware");
      return res
        .status(400)
        .json({ message: "User ID missing from authenticated request" });
    }

    // Try multiple methods to find the user
    const userId = req.user.id.toString();
    console.log("Looking for user with ID:", userId);

    let user;
    let errorMessages = [];

    // Method 1: Direct findById
    try {
      user = await User.findById(userId).select("-password");
      if (user) {
        console.log("User found using direct findById");
      }
    } catch (err) {
      errorMessages.push(`findById error: ${err.message}`);
      console.error("Error with findById:", err.message);
    }

    // Method 2: Find by string comparison
    if (!user) {
      try {
        const users = await User.find({}).select("-password");
        user = users.find((u) => u._id.toString() === userId);
        if (user) {
          console.log("User found using array find method");
        }
      } catch (err) {
        errorMessages.push(`find+filter error: ${err.message}`);
        console.error("Error with find+filter:", err.message);
      }
    }

    // Method 3: Try ObjectId if available
    if (!user && mongoose.Types.ObjectId.isValid(userId)) {
      try {
        const objectId = new mongoose.Types.ObjectId(userId);
        user = await User.findOne({ _id: objectId }).select("-password");
        if (user) {
          console.log("User found using mongoose ObjectId");
        }
      } catch (err) {
        errorMessages.push(`ObjectId error: ${err.message}`);
        console.error("Error with ObjectId approach:", err.message);
      }
    }

    if (!user) {
      console.log(
        `User with ID ${userId} not found in database using any method`
      );
      return res.status(404).json({
        message: "User not found",
        userId,
        errorMessages,
        attempted: "multiple methods",
      });
    }

    console.log("User found, returning profile data");
    res.json({
      id: user._id,
      username: user.username,
      email: user.email,
      avatar: user.avatar,
      createdAt: user.createdAt,
      paperBalance: user.paperBalance || 0,
    });
  } catch (err) {
    console.error("Error in /profile route:", err);
    res.status(500).json({
      message: "Server Error",
      error: err.message,
      stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
    });
  }
});

// Add a simpler profile endpoint as fallback
router.get("/me", auth, async (req, res) => {
  try {
    console.log("Me route accessed with user ID:", req.user?.id);

    if (!req.user || !req.user.id) {
      return res.status(400).json({ message: "User ID missing" });
    }

    const user = await User.findById(req.user.id).select("-password");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    console.log("User found in /me route");
    res.json(user);
  } catch (err) {
    console.error("Error in /me route:", err);
    res.status(500).send("Server Error");
  }
});

module.exports = router;
