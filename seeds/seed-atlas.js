require("dotenv").config();
const dns = require("dns");
// Some local DNS servers cant resolve Atlas SRV records; Google DNS fixes it.
dns.setServers(["8.8.8.8", "8.8.4.4"]);

const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");

(async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error("  set MONGO_URI in .env first");
    process.exit(1);
  }
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 25000 });
    console.log("  Connected to:", mongoose.connection.host);
  } catch (e) {
    console.error("  Connect failed:", e.message);
    process.exit(1);
  }

  const Product = require("../models/Product");
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "products.json"), "utf8"));
  try {
    for (const item of data) {
      await Product.findOneAndUpdate({ id: item.id }, item, { upsert: true, new: true, setDefaultsOnInsert: true });
      console.log("  Seeded:", item.id, "-", item.name);
    }
    const count = await Product.countDocuments();
    console.log("\n  Done:", data.length, "seeded. Total in DB:", count);
  } catch (err) {
    console.error("  Seed error:", err.message);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
})();