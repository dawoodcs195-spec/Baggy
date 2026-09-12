// Fail-fast environment validation.
// Refuses to boot with insecure/missing config in production; warns (and uses
// safe dev fallbacks) in development.
const crypto = require("crypto");

const MIN_SECRET_LEN = 32;
const OLD_ADMIN_PASSWORD = "ChangeMe-Admin-2024";

function validateEnv(env = process.env) {
  const isProduction = env.NODE_ENV === "production";
  const problems = [];
  const warnings = [];

  let sessionSecret = env.SESSION_SECRET;
  if (isProduction) {
    if (!sessionSecret || sessionSecret.length < MIN_SECRET_LEN) {
      problems.push(`SESSION_SECRET must be a unique random value of at least ${MIN_SECRET_LEN} characters in production`);
    }
    if (!env.MONGO_URI) problems.push("MONGO_URI is required in production");
    if (!env.ADMIN_EMAILS) problems.push("ADMIN_EMAILS is required in production");
    if (!env.ADMIN_PASSWORD || env.ADMIN_PASSWORD.length < 10 || env.ADMIN_PASSWORD === OLD_ADMIN_PASSWORD) {
      problems.push("ADMIN_PASSWORD must be a strong value (10+ characters, not the old default) in production");
    }
  } else {
    if (!sessionSecret || sessionSecret.length < MIN_SECRET_LEN) {
      warnings.push("SESSION_SECRET missing or short — a random one is generated per boot (sessions reset on restart). Set it in .env");
      sessionSecret = crypto.randomBytes(32).toString("hex");
    }
    if (!env.MONGO_URI) warnings.push("MONGO_URI not set — defaulting to mongodb://localhost:27017/baggy_jeans_shop");
    if (!env.ADMIN_PASSWORD || env.ADMIN_PASSWORD.length < 10) {
      warnings.push("ADMIN_PASSWORD missing or weak — set a strong value before deploying");
    }
  }

  if (problems.length > 0) {
    console.error("  ✗ Invalid configuration — refusing to start:");
    problems.forEach(p => console.error(`    - ${p}`));
    process.exit(1);
  }
  warnings.forEach(w => console.warn(`  ⚠ ${w}`));

  return {
    isProduction,
    port: parseInt(env.PORT, 10) || 3000,
    mongoUri: env.MONGO_URI || "mongodb://localhost:27017/baggy_jeans_shop",
    sessionSecret
  };
}

module.exports = { validateEnv };