// server/index.js
const dotenv = require("dotenv");
const express = require("express");
const path = require("path");

// Load environment variables
dotenv.config();
const cors = require("cors");
const mongoose = require("mongoose");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");

// Import Firebase Admin SDK if not already imported
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

// Add Google Auth verification endpoint with /api prefix
app.post("/api/auth/google-verify", async (req, res) => {
  try {
    console.log("Google auth verification endpoint hit");
    const { idToken } = req.body;

    if (!idToken) {
      return res
        .status(400)
        .json({ success: false, message: "No ID token provided" });
    }

    // Log the request for debugging
    console.log(
      "Processing Google auth with token:",
      idToken.substring(0, 10) + "..."
    );

    // Verify the Firebase ID token
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const { uid, email, name, picture } = decodedToken;

    // Check if user exists in our database
    let user = await mongoose.model("User").findOne({ email });

    if (!user) {
      // Create a new user if they don't exist
      user = new mongoose.model("User")({
        username: name || email.split("@")[0],
        email,
        firebaseUid: uid,
        avatar: picture,
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

    // Create JWT access token
    const accessPayload = { user: { id: user.id } };
    const accessToken = jwt.sign(accessPayload, JWT_SECRET, {
      expiresIn: "15m",
    });

    // Generate refresh token
    const rawRefresh = crypto.randomBytes(32).toString("hex");

    // Calculate refresh token expiry
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + 7); // 7 days

    // Store refresh token in DB (simplified for direct implementation)
    await mongoose.model("RefreshToken").create({
      userId: user._id,
      token: rawRefresh,
      expiresAt: expiry,
    });

    // Set cookies
    res.cookie("token", accessToken, {
      httpOnly: true,
      secure: NODE_ENV === "production",
      sameSite: "none",
      maxAge: 15 * 60 * 1000, // 15 minutes
    });

    res.cookie("refreshToken", rawRefresh, {
      httpOnly: true,
      secure: NODE_ENV === "production",
      sameSite: "none",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    // Return success response with user data
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
    res.status(500).json({
      success: false,
      message: "Authentication failed: " + (error.message || "Unknown error"),
    });
  }
});

// Always serve static files and fallback to index.html for client-side routing
const clientPath = path.join(__dirname, "..", "Client");
// Serve static files from the client folder
app.use(express.static(clientPath));

// Basic Route (optional)
app.get("/", (req, res) => {
  res.send("Welcome to the Crypto Trading Bot API");
});

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

// Fallback route for client-side routing
app.get("*", (req, res) => {
  res.sendFile(path.join(clientPath, "index.html"));
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

// Add this after all your routes are registered
console.log("Registered routes:");
app._router.stack.forEach(function (r) {
  if (r.route && r.route.path) {
    console.log(r.route.path);
  }
});
