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
  origin: [
    "http://localhost:5173",
    "https://www.crypto-pilot.dev",
    "https://crypto-pilot.dev",
  ],
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(cors(corsOptions));

// Also update the specific route if it has its own CORS config
app.options("/api/auth/exchange-google-token", cors(corsOptions));
app.post(
  "/api/auth/exchange-google-token",
  cors(corsOptions),
  async (req, res) => {
    // Your existing route handler code
  }
);

module.exports = corsOptions;
