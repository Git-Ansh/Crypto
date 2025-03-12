// server/index.js
const dotenv = require("dotenv");

// Load environment variables
dotenv.config();

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");

// Try to validate env, but don't crash if it fails in production
try {
  const validateEnv = require("./utils/validateEnv");
  validateEnv();
} catch (err) {
  console.warn("Environment validation warning:", err.message);
}

// Access environment variables
const {
  NODE_ENV = "production",
  PORT = 5000,
  JWT_SECRET,
  ENCRYPTION_KEY,
  MONGO_URI,
} = process.env;
console.log("NODE_ENV", NODE_ENV);

// Create express app
const app = express();

// Set up CORS
const productionDomains = [
  "https://www.crypto-pilot.dev",
  "https://crypto-pilot.dev",
];
const corsOrigin =
  NODE_ENV === "development" ? "http://localhost:5173" : productionDomains;
console.log(`NODE_ENV: ${NODE_ENV}`);
console.log("CORS allowed origins:", corsOrigin);

// Middleware
app.use(
  cors({
    origin: corsOrigin,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Origin",
      "X-Requested-With",
      "Content-Type",
      "Accept",
      "Authorization",
    ],
  })
);
app.use(express.json());
app.use(cookieParser());
app.use(helmet());

// Simplified security policies for serverless
app.use(
  helmet.contentSecurityPolicy({
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      objectSrc: ["'none'"],
    },
  })
);

// Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: "Too many requests from this IP, please try again after 15 minutes",
});
app.use(limiter);

// MongoDB connection with connection pooling optimized for serverless
let cachedDb = null;

async function connectToDatabase() {
  if (cachedDb) {
    return cachedDb;
  }

  try {
    const client = await mongoose.connect(MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 5000,
      maxPoolSize: 10, // Keeping a smaller connection pool for serverless
    });

    cachedDb = client;
    console.log("MongoDB connected");
    return client;
  } catch (err) {
    console.error("MongoDB connection error:", err);
    throw err;
  }
}

// Import Routes
const authRoutes = require("./routes/auth");
const dashboardRoutes = require("./routes/dashboard");
const tradesRoutes = require("./routes/trades");

// Handle database connection before routing
app.use(async (req, res, next) => {
  try {
    await connectToDatabase();
    next();
  } catch (err) {
    console.error("Database connection error:", err);
    res.status(500).json({ message: "Database connection error" });
  }
});

// Use Routes
app.use("/api/auth", authRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/trades", tradesRoutes);

// Basic Route
app.get("/", (req, res) => {
  res.send("Welcome to the Crypto Trading Bot API");
});

// Health check endpoint for Vercel
app.get("/api/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

// Error Handling Middleware
const errorHandler = require("./middleware/errorHandler");
app.use(errorHandler);

// Only start listening on the port if we're not in Vercel environment
if (process.env.VERCEL !== "1") {
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
}

// Export the app for serverless use
module.exports = app;
