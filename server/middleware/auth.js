const jwt = require("jsonwebtoken");
const admin = require("firebase-admin"); // Make sure firebase-admin is initialized in your app

module.exports = async function (req, res, next) {
  // Get token from header
  const token = req.header("Authorization")?.replace("Bearer ", "");

  if (!token) {
    return res.status(401).json({ message: "No token, authorization denied" });
  }

  try {
    // Check token format to determine verification method
    const tokenParts = token.split(".");
    if (tokenParts.length !== 3) {
      return res.status(401).json({ message: "Invalid token format" });
    }

    // Decode header to check algorithm
    const header = JSON.parse(Buffer.from(tokenParts[0], "base64").toString());
    console.log("Token header:", header);
    console.log("Token algorithm:", header.alg);

    let decoded;

    // Handle different token types
    if (header.alg === "RS256" && header.kid) {
      // This is likely a Google/Firebase token
      try {
        // Verify with Firebase Admin
        decoded = await admin.auth().verifyIdToken(token);

        // Get user from database based on Firebase UID
        const User = require("../models/user");
        const user = await User.findOne({ firebaseUid: decoded.uid });

        if (!user) {
          return res.status(401).json({ message: "User not found" });
        }

        // Set user info on request
        req.user = {
          id: user._id,
          email: user.email,
        };

        next();
      } catch (error) {
        console.error("Firebase token verification failed:", error);
        return res.status(401).json({ message: "Invalid token" });
      }
    } else {
      // This is our own JWT token (HS256)
      decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = decoded.user;
      next();
    }
  } catch (err) {
    console.error("JWT Verification Error:", err.message);
    res.status(401).json({ message: "Token is not valid" });
  }
};
