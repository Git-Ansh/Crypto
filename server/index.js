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

// Initialize Firebase Admin SDK
const admin = require("firebase-admin");

// Use environment variables instead of requiring the JSON file
const firebaseConfig = {
  type: process.env.FIREBASE_TYPE || "service_account",
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID,
  auth_uri:
    process.env.FIREBASE_AUTH_URI ||
    "https://accounts.google.com/o/oauth2/auth",
  token_uri:
    process.env.FIREBASE_TOKEN_URI || "https://oauth2.googleapis.com/token",
  auth_provider_x509_cert_url:
    process.env.FIREBASE_AUTH_PROVIDER_CERT_URL ||
    "https://www.googleapis.com/oauth2/v1/certs",
  client_x509_cert_url: process.env.FIREBASE_CLIENT_CERT_URL,
};

// Only initialize if we have the required credentials
if (
  process.env.FIREBASE_PROJECT_ID &&
  process.env.FIREBASE_CLIENT_EMAIL &&
  process.env.FIREBASE_PRIVATE_KEY
) {
  admin.initializeApp({
    credential: admin.credential.cert(firebaseConfig),
  });
  console.log("Firebase Admin SDK initialized");
} else {
  console.warn(
    "Firebase credentials missing, authentication features may not work properly"
  );
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

// Rate Limiting - only apply strict limits in production
if (NODE_ENV === "production") {
  app.use(limiter);
} else {
  // In development, use a more lenient rate limiter or none at all
  console.log("Using development rate limits");
  const devLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000, // Much higher limit for development
    message:
      "Too many requests from this IP, please try again after 15 minutes",
  });
  app.use(devLimiter);
}

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
const portfolioRoutes = require("./routes/portfolio");
const botConfigRoutes = require("./routes/botConfig");
const usersRoutes = require("./routes/users");
const positionRoutes = require("./routes/positions");
const botRoutes = require("./routes/bot");

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
app.use("/api/portfolio", portfolioRoutes);
app.use("/api/bot-config", botConfigRoutes);
app.use("/api/users", usersRoutes); // This should be the only registration for users routes
app.use("/api/positions", positionRoutes);
app.use("/api/bot", botRoutes);

// Add a diagnostic route to check if server is running properly
app.get("/api/status", (req, res) => {
  res.json({
    status: "ok",
    message: "Server is running properly",
    environment: process.env.NODE_ENV,
    routes: {
      auth: "/api/auth/*",
      portfolio: "/api/portfolio/*",
      trades: "/api/trades/*",
      positions: "/api/positions/*",
      users: "/api/users/*",
      bot: "/api/bot/*",
    },
  });
});

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

// Add this near the top with other imports
const { updatePortfolioSnapshots } = require("./utils/portfolioUpdater");

// Add this after MongoDB connection setup
// Schedule portfolio updates (once per day)
if (NODE_ENV === "production") {
  // In production, run once a day at midnight
  const runDailyAt = (hour, minute, task) => {
    const now = new Date();
    let scheduledTime = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      hour,
      minute,
      0
    );

    if (scheduledTime <= now) {
      scheduledTime = new Date(scheduledTime.getTime() + 24 * 60 * 60 * 1000);
    }

    const timeUntilTask = scheduledTime.getTime() - now.getTime();

    setTimeout(() => {
      task();
      // Schedule for next day
      setInterval(task, 24 * 60 * 60 * 1000);
    }, timeUntilTask);
  };

  runDailyAt(0, 0, updatePortfolioSnapshots);
} else {
  // In development, run once at startup for testing
  setTimeout(updatePortfolioSnapshots, 5000);
}

// Add this after all your routes are registered
console.log("Registered routes:");
app._router.stack.forEach(function (r) {
  if (r.route && r.route.path) {
    console.log(r.route.path);
  }
});

// Add this line to print registered user routes for debugging
console.log("User routes registered:", Object.keys(usersRoutes.stack));
