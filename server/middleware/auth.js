const jwt = require("jsonwebtoken");
const admin = require("firebase-admin");
const { CustomError } = require("../utils/errors");
const User = require("../models/user"); // Import at the top level

module.exports = async function (req, res, next) {
  try {
    console.log("Auth middleware running");
    const authHeader = req.header("Authorization");

    if (!authHeader) {
      console.log("No Authorization header found");
      return res
        .status(401)
        .json({ message: "No token, authorization denied" });
    }

    console.log("Auth header present:", authHeader.substring(0, 20) + "...");

    let token;
    // Support different token formats
    if (authHeader.startsWith("Bearer ")) {
      token = authHeader.split(" ")[1];
      console.log("Bearer token format detected");
    } else if (authHeader.startsWith("Firebase ")) {
      token = authHeader.split(" ")[1];
      console.log("Firebase token format detected");
    } else {
      token = authHeader; // Raw token
      console.log("Raw token format detected");
    }

    if (!token) {
      console.log("No token found after parsing header");
      return res
        .status(401)
        .json({ message: "No token, authorization denied" });
    }

    // Step 1: Detect token format - check if it's a Firebase token (RS256) or our JWT (HS256)
    let isFirebaseToken = false;
    try {
      const decodedWithoutVerify = jwt.decode(token, { complete: true });
      if (decodedWithoutVerify?.header?.alg === "RS256") {
        console.log("Detected RS256 algorithm - likely a Firebase token");
        isFirebaseToken = true;
      } else {
        console.log(
          "Token algorithm:",
          decodedWithoutVerify?.header?.alg || "unknown"
        );
      }
    } catch (err) {
      console.log("Error analyzing token format:", err.message);
    }

    // First try Firebase verification (always try this for RS256 tokens)
    if (isFirebaseToken) {
      try {
        console.log("Attempting Firebase token verification...");
        const decodedFirebase = await admin.auth().verifyIdToken(token);
        console.log(
          "Firebase token verification successful:",
          decodedFirebase.uid
        );

        // Find user by Firebase UID in your database
        let user = await User.findOne({ firebaseUid: decodedFirebase.uid });

        if (!user) {
          console.log(
            "Firebase user verified but not found in database, creating new user"
          );
          // Create a new user if it doesn't exist
          user = new User({
            username:
              decodedFirebase.name ||
              decodedFirebase.email?.split("@")[0] ||
              "User",
            email:
              decodedFirebase.email ||
              `user-${decodedFirebase.uid}@example.com`,
            firebaseUid: decodedFirebase.uid,
            avatar: decodedFirebase.picture,
            // Add some initial paper balance for new users
            paperBalance: 10000,
          });
          await user.save();
          console.log("Created new user with ID:", user._id);
        }

        // Always set req.user.id to the MongoDB ID
        req.user = { id: user._id.toString() };
        console.log("Set req.user.id to MongoDB ID:", req.user.id);

        // Add additional debug info to the request
        req.authMethod = "firebase";
        req.authUid = decodedFirebase.uid;

        return next();
      } catch (firebaseError) {
        console.log("Firebase verification failed:", firebaseError.message);

        // If this is a Firebase token and verification failed, don't try JWT
        if (isFirebaseToken) {
          return res.status(401).json({
            message: "Invalid Firebase token",
            error: firebaseError.message,
          });
        }
      }
    }

    // Try JWT verification for non-Firebase tokens (HS256)
    try {
      console.log("Attempting JWT verification with HS256...");
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      console.log("JWT verification successful:", decoded);

      if (decoded.user && decoded.user.id) {
        req.user = decoded.user;
        console.log("Set req.user from JWT:", req.user);

        // Add additional debug info
        req.authMethod = "jwt";

        return next();
      } else {
        console.log("JWT missing user ID");
        return res.status(401).json({ message: "Invalid token format" });
      }
    } catch (jwtError) {
      console.error("JWT verification failed:", jwtError.message);
      return res.status(401).json({
        message: "Invalid token",
        error: jwtError.message,
        path: req.originalUrl,
      });
    }
  } catch (err) {
    console.error("Auth middleware error:", err);
    res.status(500).send("Server Error");
  }
};
