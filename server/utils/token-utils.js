const jwt = require("jsonwebtoken");
const admin = require("firebase-admin");

/**
 * Utility functions for token verification and analysis
 */
const tokenUtils = {
  /**
   * Analyze a token to determine its type and format
   * @param {string} token - The token to analyze
   * @returns {Object} Token analysis result
   */
  analyzeToken(token) {
    try {
      const decoded = jwt.decode(token, { complete: true });
      if (!decoded) {
        return {
          valid: false,
          format: "unknown",
          error: "Could not decode token",
        };
      }

      const { header, payload } = decoded;
      return {
        valid: true,
        format: header.alg === "RS256" ? "firebase" : "jwt",
        algorithm: header.alg,
        header,
        payload,
        issuer: payload.iss,
        subject: payload.sub,
        audience: payload.aud,
        expiry: payload.exp
          ? new Date(payload.exp * 1000).toISOString()
          : "none",
        isExpired: payload.exp ? Date.now() > payload.exp * 1000 : false,
      };
    } catch (e) {
      return { valid: false, format: "unknown", error: e.message };
    }
  },

  /**
   * Verify a token using the appropriate method based on its algorithm
   * @param {string} token - The token to verify
   * @param {string} jwtSecret - The secret for HS256 tokens
   * @returns {Promise<Object>} The verification result
   */
  async verifyToken(token, jwtSecret) {
    try {
      // First analyze the token
      const analysis = this.analyzeToken(token);

      if (!analysis.valid) {
        return { success: false, error: "Invalid token format" };
      }

      // Handle based on token type
      if (analysis.algorithm === "RS256") {
        // Firebase token verification
        try {
          const decodedFirebase = await admin.auth().verifyIdToken(token);
          return {
            success: true,
            type: "firebase",
            uid: decodedFirebase.uid,
            email: decodedFirebase.email,
            decodedToken: decodedFirebase,
          };
        } catch (e) {
          return { success: false, type: "firebase", error: e.message };
        }
      } else {
        // Standard JWT verification
        try {
          const decoded = jwt.verify(token, jwtSecret);
          return {
            success: true,
            type: "jwt",
            user: decoded.user,
            decodedToken: decoded,
          };
        } catch (e) {
          return { success: false, type: "jwt", error: e.message };
        }
      }
    } catch (e) {
      return { success: false, error: e.message };
    }
  },
};

module.exports = tokenUtils;
