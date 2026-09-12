// Single source of truth for storefront product reads.
// Mongo adapter when the database is reachable; products.json adapter as the
// offline dev fallback. The Mongo/JSON duplication that used to live in every
// storefront route now lives here — and nowhere else.
const fs = require('fs');
const path = require('path');
const Product = require('../models/Product');
const { escapeRegex } = require('../utils/sanitize');

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

// ── Catalog query: DB-level filter + sort + pagination ──────────
// Replaces the old "load every product, filter in memory" path. Mongo does
// the filtering, counting and paging; products.json still serves as the
// offline fallback so the storefront works without a database.
const SORTS = {
  featured: { featured: -1, createdAt: -1 },
  newest: { createdAt: -1 },
  'price-asc': { price: 1 },
  'price-desc': { price: -1 },
  rating: { rating: -1 },
  name: { name: 1 }
};

const SORT_KEYS = Object.keys(SORTS);
const MAX_PER_PAGE = 48;

function decorate(products, total, page, perPage) {
  const pages = Math.max(1, Math.ceil(total / perPage));
  return {
    products,
    total,
    page,
    pages,
    perPage,
    from: total === 0 ? 0 : (page - 1) * perPage + 1,
    to: Math.min(total, page * perPage),
    hasPrev: page > 1,
    hasNext: page < pages
  };
}

async function pageOf(filter, orderBy, page, perPage) {
  const [products, total] = await Promise.all([
    Product.find(filter).sort(orderBy).skip((page - 1) * perPage).limit(perPage).lean(),
    Product.countDocuments(filter)
  ]);
  return decorate(products, total, page, perPage);
}

function sortJson(items, sort) {
  const arr = [...items];
  if (sort === 'price-asc') return arr.sort((a, b) => a.price - b.price);
  if (sort === 'price-desc') return arr.sort((a, b) => b.price - a.price);
  if (sort === 'rating') return arr.sort((a, b) => (b.rating || 0) - (a.rating || 0));
  if (sort === 'name') return arr.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  if (sort === 'newest') return arr.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  return arr;
}

/**
 * @param {{q?: string, category?: string, sort?: string, page?: number|string, limit?: number|string}} opts
 * @returns {Promise<{products: object[], total: number, page: number, pages: number, perPage: number, from: number, to: number, hasPrev: boolean, hasNext: boolean}>}
 */
async function listCatalog(opts = {}) {
  const page = Math.max(1, parseInt(opts.page, 10) || 1);
  const perPage = Math.min(MAX_PER_PAGE, Math.max(1, parseInt(opts.limit, 10) || 24));
  const q = String(opts.q || '').trim();
  const category = String(opts.category || '').trim();
  const sort = SORT_KEYS.includes(opts.sort) ? opts.sort : null;
  const orderBy = sort ? SORTS[sort] : SORTS.featured;

  const filter = { active: { $ne: false } };
  if (category) filter.category = category;

  try {
    if (q) {
      // The text index (models/Product.js) gives relevance + speed. If it is
      // missing on an older database the $text query throws, so fall back to
      // a regex scan rather than failing the search page.
      try {
        return await pageOf({ ...filter, $text: { $search: q } }, orderBy, page, perPage);
      } catch {
        const rx = new RegExp(escapeRegex(q), 'i');
        return await pageOf(
          { ...filter, $or: [{ name: rx }, { description: rx }, { subcategory: rx }, { category: rx }, { colors: rx }] },
          orderBy, page, perPage
        );
      }
    }
    return await pageOf(filter, orderBy, page, perPage);
  } catch {
    let items = readJsonProducts().filter(p => p.active !== false);
    if (category) items = items.filter(p => p.category === category);
    if (q) items = items.filter(p => matchesQuery(p, q.toLowerCase()));
    items = sortJson(items, sort);
    const total = items.length;
    const start = (page - 1) * perPage;
    return decorate(items.slice(start, start + perPage), total, page, perPage);
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

module.exports = { listActive, listFeatured, listByCategory, getById, listRelated, matchesQuery, listCatalog, SORT_KEYS };
