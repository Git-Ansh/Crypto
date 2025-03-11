// server/index.js
const dotenv = require("dotenv");
const path = require("path");

// Load environment variables with absolute path
const envFile = process.env.NODE_ENV === 'production' ? '.env' : '.env.development';
const envPath = path.resolve(__dirname, envFile);
console.log(`Loading environment from: ${envPath}`);
dotenv.config({ path: envPath });

// Double-check with direct loading of .env file regardless of NODE_ENV
const defaultEnvPath = path.resolve(__dirname, '.env');
console.log(`Also checking default .env at: ${defaultEnvPath}`);
dotenv.config({ path: defaultEnvPath });

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");

console.log("Environment variables loaded:", {
  NODE_ENV: process.env.NODE_ENV,
  PORT: process.env.PORT,
  JWT_SECRET: process.env.JWT_SECRET ? "***[SET]***" : "undefined",
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY ? "***[SET]***" : "undefined",
  MONGO_URI: process.env.MONGO_URI ? "***[SET]***" : "undefined",
});

// Now validate the environment
const validateEnv = require("./utils/validateEnv");
try {
  validateEnv(); // Validate environment variables after loading
  console.log("Environment validation passed");
} catch (error) {
  console.error("Environment validation failed:", error.message);
  process.exit(1);
}

// Access environment variables
const {
  NODE_ENV,
  PORT = 5000,
  JWT_SECRET,
  ENCRYPTION_KEY,
  MONGO_URI,
} = process.env;
console.log("NODE_ENV", NODE_ENV);
// Ensure essential environment variables are set
if (!JWT_SECRET || !ENCRYPTION_KEY || !MONGO_URI) {
  console.error("Missing essential environment variables. Exiting...");
  process.exit(1);
}
//console.log(NODE_ENV);
const app = express();
//const PORT = process.env.PORT || 5000;

var allowedOrigins = [
  "http://localhost:5173",
  "https://www.crypto-pilot.dev",
  "https://api.crypto-pilot.dev"
];

console.log("Allowed origins:", allowedOrigins);

// Enhanced CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    // For development, allow requests with no origin (like mobile apps or curl requests)
    if (allowedOrigins.includes(origin) || !origin) {
      callback(null, true);
    } else {
      console.log(`CORS blocked origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS",
  credentials: true,
  preflightContinue: false,
  optionsSuccessStatus: 204,
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
};

// Apply CORS middleware before all routes
app.use(cors(corsOptions));

// Additional CORS headers middleware to ensure they are set
app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (allowedOrigins.includes(origin) || !origin) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }

  // Handle preflight OPTIONS requests
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  next();
});

// Handle OPTIONS requests explicitly
app.options('*', cors(corsOptions));

app.use(express.json());
app.use(cookieParser());
app.use(helmet()); // Adds security-related HTTP headers

app.use(
  helmet.contentSecurityPolicy({
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: [],
    },
  })
);

app.use(
  helmet.hsts({
    maxAge: 63072000, // 2 years in seconds
    includeSubDomains: true,
    preload: true,
  })
);

// Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: "Too many requests from this IP, please try again after 15 minutes",
});
app.use(limiter);

// Connect to MongoDB
mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("MongoDB connected"))
  .catch((err) => {
    console.error("MongoDB connection error:", err);
    process.exit(1); // Exit process with failure
  });

// Import Routes
const authRoutes = require("../Server/routes/auth");
const dashboardRoutes = require("../Server/routes/dashboard");
const tradesRoutes = require("../Server/routes/trades");

// Special handler for Google auth verification route
app.use('/api/auth/google-verify', (req, res, next) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin) || !origin) {
    res.header('Access-Control-Allow-Origin', origin || '*');
  }
  res.header('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.header('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  next();
});

// Use Routes
app.use("/api/auth", authRoutes);
app.use("/auth", authRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/trades", tradesRoutes);

// Basic Route
app.get("/", (req, res) => {
  res.send("Welcome to the Crypto Trading Bot API");
});

// Serve frontend in production
if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.join(__dirname, "../frontend/dist"))); // Adjust path as needed

  app.get("*", (req, res) => {
    res.sendFile(path.resolve(__dirname, "../frontend", "dist", "index.html"));
  });
}

// Add 404 route handler
app.use((req, res, next) => {
  res.status(404).json({
    success: false,
    message: "Route not found"
  });
});

// Error Handling Middleware (Must be after all other routes)
const errorHandler = require("../Server/middleware/errorHandler");
app.use(errorHandler);

// Start the Server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
