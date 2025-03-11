// server/index.js
const dotenv = require("dotenv");

// Load environment variables from proper .env file
const envFile = process.env.NODE_ENV === 'production' ? '.env' : '.env.development';
dotenv.config({ path: envFile });

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const validateEnv = require("./utils/validateEnv");
validateEnv(); // Validate environment variables before proceeding

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

var address = "https://crypto-pilot.dev";

if (NODE_ENV === "development") {
  address = "http://localhost:5173";
}
console.log("CORS address set to:", address);
console.log("address", address);

// Enhanced CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = [address];
    // For development, allow requests with no origin (like mobile apps or curl requests)
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS",
  credentials: true,
  preflightContinue: false,
  optionsSuccessStatus: 204,
  allowedHeaders: ['Content-Type', 'Authorization']
};

// Apply CORS middleware before all routes
app.use(cors(corsOptions));

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

// Use Routes
app.use("/api/auth", authRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/trades", tradesRoutes);

// Basic Route
app.get("/", (req, res) => {
  res.send("Welcome to the Crypto Trading Bot API");
});

// Serve frontend in production
const path = require("path");
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
