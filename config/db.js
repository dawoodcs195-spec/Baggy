// MongoDB connection. Resolves true when connected, false when offline.
// In production a failed connection is fatal (fail-fast).
const mongoose = require('mongoose');

async function connectDB({ mongoUri, isProduction } = {}) {
  try {
    await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });
    console.log(`  ✓ MongoDB Connected: ${mongoose.connection.host}`);
    return true;
  } catch (err) {
    if (isProduction) {
      console.error(`  ✗ MongoDB is required in production — connection failed: ${err.message}`);
      process.exit(1);
    }
    console.warn('  ⚠ MongoDB offline — dev fallback: products.json catalog + memory-only sessions');
    console.warn("  💡 Start MongoDB or run 'mongod' to enable database features");
    return false;
  }
}

module.exports = connectDB;
