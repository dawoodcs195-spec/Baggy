// Single source of truth for storefront product reads.
// Mongo adapter when the database is reachable; products.json adapter as the
// offline dev fallback. The Mongo/JSON duplication that used to live in every
// storefront route now lives here — and nowhere else.
const fs = require('fs');
const path = require('path');
const Product = require('../models/Product');

const JSON_PATH = path.join(__dirname, '..', 'data', 'products.json');

function readJsonProducts() {
  return JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
}

// Never throws: Mongo first, then JSON fallback, then [].
async function mongoOrJson(mongoQuery, jsonFilter) {
  try {
    return await mongoQuery();
  } catch {
    try {
      return readJsonProducts().filter(jsonFilter);
    } catch {
      return [];
    }
  }
}

function listActive() {
  return mongoOrJson(
    () => Product.find({ active: { $ne: false } }).lean(),
    p => p.active !== false
  );
}

function listFeatured() {
  return mongoOrJson(
    () => Product.find({ featured: true, active: { $ne: false } }).lean(),
    p => p.featured && p.active !== false
  );
}

function listByCategory(category) {
  return mongoOrJson(
    () => Product.find({ category, active: { $ne: false } }).lean(),
    p => p.category === category && p.active !== false
  );
}

function getById(id) {
  return mongoOrJson(
    () => Product.findOne({ id }).lean(),
    p => p.id === id
  );
}

// Related products for the product page (same category, exclude self, limit 4)
async function listRelated(product, limit = 4) {
  try {
    return await Product.find({ category: product.category, _id: { $ne: product._id } }).limit(limit).lean();
  } catch {
    try {
      return readJsonProducts().filter(p => p.category === product.category && p.id !== product.id).slice(0, limit);
    } catch {
      return [];
    }
  }
}

// Full-text-ish matcher for /shop and /search (in-memory until the text index lands in Phase 3)
function matchesQuery(product, q) {
  return product.name.toLowerCase().includes(q) ||
    product.category.toLowerCase().includes(q) ||
    (product.subcategory || '').toLowerCase().includes(q) ||
    (product.colors || []).some(c => c.toLowerCase().includes(q)) ||
    (product.description || '').toLowerCase().includes(q);
}

module.exports = { listActive, listFeatured, listByCategory, getById, listRelated, matchesQuery };
