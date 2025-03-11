const { cleanEnv, str, makeValidator } = require("envalid");

// Create a more flexible validator that won't error in production
const strOrUndefined = makeValidator((x) => {
  if (x === undefined && process.env.NODE_ENV === "production")
    return undefined;
  if (typeof x === "string") return x;
  throw new Error("Expected string");
});

function validateEnv() {
  const isProduction = process.env.NODE_ENV === "production";

  // In production environment (like Vercel), be more lenient
  if (isProduction) {
    return cleanEnv(process.env, {
      NODE_ENV: str({
        choices: ["production", "development", "test"],
        default: "production",
      }),
      PORT: strOrUndefined({ default: "5000" }),
      JWT_SECRET: strOrUndefined(),
      ENCRYPTION_KEY: strOrUndefined(),
      MONGO_URI: strOrUndefined(),
    });
  }

  // In development, be strict
  return cleanEnv(process.env, {
    NODE_ENV: str({ choices: ["production", "development", "test"] }),
    PORT: str(),
    JWT_SECRET: str(),
    ENCRYPTION_KEY: str({ length: 64, matches: /^[0-9a-fA-F]+$/ }),
    MONGO_URI: str(),
  });
}

module.exports = validateEnv;
