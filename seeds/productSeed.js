require('dotenv').config();
const mongoose = require('mongoose');
const fs       = require('fs');
const path     = require('path');
const connectDB = require('../config/db');
const Product  = require('../models/Product');

(async () => {
  await connectDB();
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'products.json'), 'utf8'));

  try {
    for (const item of data) {
      await Product.findOneAndUpdate({ id: item.id }, item, { upsert: true, new: true, setDefaultsOnInsert: true });
      console.log(`  ✓ Seeded: ${item.id} — ${item.name}`);
    }
    console.log(`\n  ✓ Seeded ${data.length} products\n`);
  } catch (err) {
    console.error('  ✗ Seed error:', err.message);
  } finally {
    await mongoose.connection.close();
  }
})();