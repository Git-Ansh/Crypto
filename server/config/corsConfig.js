// Create a dedicated CORS configuration file
const NODE_ENV = process.env.NODE_ENV || "development";

// Define allowed origins
const allowedOrigins =
  NODE_ENV === "production"
    ? [
        "https://www.crypto-pilot.dev",
        "https://crypto-pilot.dev",
        "https://app.crypto-pilot.dev",
      ]
    : [
        "http://localhost:3000",
        "http://localhost:5173",
        "http://localhost:5174",
      ];

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin) || NODE_ENV === "development") {
      callback(null, true);
    } else {
      console.log("Origin not allowed by CORS:", origin);
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Origin",
    "X-Requested-With",
    "Content-Type",
    "Accept",
    "Authorization",
  ],
};

// Remove the app.use and app.options calls from this file
// They should only be in index.js

module.exports = corsOptions;
