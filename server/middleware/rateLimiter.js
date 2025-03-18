// server/middleware/rateLimiter.js
const rateLimit = require("express-rate-limit");

// Track which endpoints are being hit most frequently
const endpointTracker = {};

// General API rate limiter with tracking
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === "development" ? 1000 : 100, // More lenient in development
  message: {
    status: 429,
    message:
      "Too many requests from this IP, please try again after 15 minutes",
    retryAfter: 900, // seconds
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Track which endpoints are being hit
    const endpoint = req.originalUrl || req.url;
    if (!endpointTracker[endpoint]) {
      endpointTracker[endpoint] = 0;
    }
    endpointTracker[endpoint]++;

    // Log if an endpoint is being hit too frequently
    if (endpointTracker[endpoint] % 20 === 0) {
      console.log(
        `High traffic endpoint: ${endpoint} (${endpointTracker[endpoint]} hits)`
      );
    }

    // Use both IP and user ID (if available) for more granular rate limiting
    return req.user ? `${req.ip}-${req.user.id}` : req.ip;
  },
});

// Stricter rate limiting for auth routes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === "development" ? 100 : 10, // Higher limit in development
  message: {
    message:
      "Too many authentication attempts from this IP, please try again after 15 minutes",
  },
  headers: true,
});

// Create a separate, more lenient limiter for the trades endpoint
const tradesLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === "development" ? 2000 : 200, // Double the limit for trades endpoint
  message: {
    status: 429,
    message: "Too many trade requests, please try again after 15 minutes",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { limiter, authLimiter, tradesLimiter };
