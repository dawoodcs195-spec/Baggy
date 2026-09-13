// Bootstrap module for tests.
// Env vars MUST be set before requiring server.js (which calls dotenv.config()
// and reads them at module-load time). This ensures tests always use the
// isolated `baggy_test` database and known test credentials.
process.env.NODE_ENV = 'test';
process.env.MONGO_URI = 'mongodb://localhost:27017/baggy_test';
process.env.SESSION_SECRET = 'test-session-secret-key-min-32-chars!';
process.env.ADMIN_EMAILS = 'admin@baggy.test';
process.env.ADMIN_PASSWORD = 'TestAdminPass123!';
process.env.STRICT_TEMPLATE_SMOKE = '0';

const Product = require('../models/Product');
const Coupon = require('../models/Coupon');
const User = require('../models/User');
const { app, boot } = require('../server');
const { agent } = require('supertest');

let booted = false;

async function ensureBooted() {
  if (!booted) {
    booted = true;
    await boot();
  }
  // Always re-seed so each test file starts from a known state
  await seedTestData();
}

async function seedTestData() {
    // Explicitly clear known collections (more reliable than iterating
  // mongoose.connection.collections which can be empty right after connect).
  try { await Product.deleteMany({}); } catch {}
  try { await Coupon.deleteMany({}); } catch {}
  try { await User.deleteMany({}); } catch {}
  try { const Order = require('../models/Order'); await Order.deleteMany({}); } catch {}
  try { const Wishlist = require('../models/Wishlist'); await Wishlist.deleteMany({}); } catch {}
  try { const Newsletter = require('../models/Newsletter'); await Newsletter.deleteMany({}); } catch {}
  try { const Contact = require('../models/Contact'); await Contact.deleteMany({}); } catch {}
  try { const OrderMessage = require('../models/OrderMessage'); await OrderMessage.deleteMany({}); } catch {}
  try { const Review = require('../models/Review'); await Review.deleteMany({}); } catch {}

  // Seed a test product
  await Product.create({
    id: 'test-jeans-001',
    name: 'Test Baggy Jeans',
    category: 'jeans',
    subcategory: 'Men',
    price: 2999,
    originalPrice: 3999,
    stock: 100,
    sizes: ['32', '34', '36', '38'],
    images: ['test-jeans-001-1.jpg'],
    description: 'Premium baggy fit jeans for testing.',
    details: ['Heavy cotton twill', 'Adjustable waist'],
    care: ['Machine wash cold'],
    featured: true,
    rating: 4.5,
    reviewCount: 12,
  });

  // Seed test coupons
  await Coupon.create([
    { code: 'TEST10', type: 'percent', value: 10, minOrder: 100, usedCount: 0, active: true },
    { code: 'EXPIRED20', type: 'percent', value: 20, minOrder: 50, usedCount: 0, active: true, expiresAt: new Date(Date.now() - 86400000) },
  ]);

  // Seed test users
  await User.deleteMany({});
  const user = new User({ name: 'Test User', email: 'tester@baggy.test', role: 'user' });
  await user.setPassword('TestPass123!');
  await user.save();

  const admin = new User({ name: 'Baggy Admin', email: 'admin@baggy.test', role: 'admin' });
  await admin.setPassword('TestAdminPass123!');
  await admin.save();

  console.log('  ✓ Test data seeded');
}

function createClient() {
  return agent(app);
}

module.exports = {
  app,
  ensureBooted,
  createClient,
  Product,
  Coupon,
  User,
};
