// MongoDB connection. Resolves true when connected, false when offline.
// In production a failed connection is fatal (fail-fast).
const mongoose = require("mongoose");
const dns = require("dns");

// Some local DNS servers (e.g. 192.168.100.1) cannot resolve Atlas SRV records.
// Use Google DNS as a fallback so the SRV lookup works on restricted networks.
dns.setServers(["8.8.8.8", "8.8.4.4", "192.168.100.1"]);

async function connectDB({ mongoUri, isProduction } = {}) {
  try {
    await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 10000 });
    console.log(`  ✓ MongoDB Connected: ${mongoose.connection.host}`);
    return true;
  } catch (err) {
    if (isProduction) {
      console.error(`  ✗ MongoDB is required in production — connection failed: ${err.message}`);
      process.exit(1);
    }
    console.warn("  ⚠ MongoDB offline — dev fallback: products.json catalog + memory-only sessions");
    console.warn("  💡 Start MongoDB or check your network/DNS to enable database features");
    return false;
  }
}

module.exports = connectDB;