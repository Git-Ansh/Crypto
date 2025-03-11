// server/utils/validateEnv.js
const { cleanEnv, str } = require('envalid');

function validateEnv() {
  try {
    console.log("Validating environment variables...");
    console.log("Environment state before validation:", {
      NODE_ENV: process.env.NODE_ENV || "undefined",
      PORT: process.env.PORT || "undefined",
      JWT_SECRET: process.env.JWT_SECRET ? "***[SET]***" : "undefined",
      ENCRYPTION_KEY: process.env.ENCRYPTION_KEY ? "***[SET]***" : "undefined",
      MONGO_URI: process.env.MONGO_URI ? "***[SET]***" : "undefined",
    });
    
    cleanEnv(process.env, {
      NODE_ENV: str(),
      PORT: str(),
      JWT_SECRET: str(),
      ENCRYPTION_KEY: str({ length: 64, matches: /^[0-9a-fA-F]+$/ }),
      MONGO_URI: str(),
    });
    
    return true;
  } catch (error) {
    console.error("Environment validation error:", error.message);
    throw error;
  }
}

module.exports = validateEnv;
