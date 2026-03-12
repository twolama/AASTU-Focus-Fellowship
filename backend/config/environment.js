import dotenv from "dotenv";

dotenv.config();

const jwtSecret = process.env.JWT_SECRET || process.env.JWT_secret_key;
const jwtExpiresIn = process.env.JWT_EXPIRES_IN || process.env.JWT_EXPIRES;

const config = {
  NODE_ENV: process.env.NODE_ENV || "development",
  PORT: process.env.PORT || 5002,
  MONGODB_URI: process.env.MONGODB_URI,
  JWT_SECRET:
    jwtSecret ||
    (process.env.NODE_ENV === "development" ? "development_secret" : null),
  JWT_EXPIRES_IN: jwtExpiresIn || "1h", // Shorter default for security
  BCRYPT_SALT_ROUNDS: parseInt(process.env.BCRYPT_SALT_ROUNDS) || 12,
  // OAuth Configuration
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
  CLIENT_URL: process.env.CLIENT_URL || "http://localhost:3000",
  SESSION_SECRET: process.env.SESSION_SECRET || null,
  // Enhanced Security
  COOKIE_DOMAIN: process.env.COOKIE_DOMAIN,
  PASSWORD_MIN_LENGTH: parseInt(process.env.PASSWORD_MIN_LENGTH) || 8,
  MAX_LOGIN_ATTEMPTS: parseInt(process.env.MAX_LOGIN_ATTEMPTS) || 5,
  LOCKOUT_TIME: parseInt(process.env.LOCKOUT_TIME) || 15,
};

const requiredEnvVars = ["MONGODB_URI", "JWT_SECRET", "SESSION_SECRET"];
// Add OAuth validation when in production
const optionalEnvVars = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"];
for (const envVar of requiredEnvVars) {
  if (!config[envVar]) {
    throw new Error(`Missing required environment variable: ${envVar}`);
  }
}

// Validate session secret strength
if (config.SESSION_SECRET && config.SESSION_SECRET.length < 32) {
  console.warn(
    "⚠️ WARNING: SESSION_SECRET should be at least 32 characters for security",
  );
}

// Warn about OAuth config missing
if (
  config.NODE_ENV === "production" &&
  (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_CLIENT_SECRET)
) {
  console.warn(
    "⚠️ WARNING: Google OAuth credentials not configured in production",
  );
}

export default config;
