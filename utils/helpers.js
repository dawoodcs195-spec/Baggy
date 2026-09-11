// Shared helpers: currency formatting, image URLs, session/user mapping,
// and order-status tracking.
const path = require('path');

function fmt(num) {
  return Number(num).toLocaleString('en-PK');
}

const CLOUDINARY_PLACEHOLDER = 'https://res.cloudinary.com/' + (process.env.CLOUDINARY_CLOUD_NAME || 'demo') + '/image/upload/baggy-jeans-shop/placeholder.png';

function imgUrl(src) {
  const s = String(src || "").trim();
  if (!s) return CLOUDINARY_PLACEHOLDER || "/public/images/placeholder.png";
  if (s.startsWith('http://') || s.startsWith('https://')) return s;
  if (s.startsWith("/")) return s;
  return "/public/images/" + s;
}

function getDistinctCategories(products) {
  // Base categories always exist (even with 0 products) so shop filters and admin forms stay consistent
  const BASE_CATEGORIES = ['jeans', 'shirts', 'accessories', 'uppers'];
  const cats = [...new Set([...BASE_CATEGORIES, ...(products || []).map(p => p.category).filter(Boolean)])];
  return cats.sort();
}

function sessionUser(user) {
  return {
    id: user._id?.toString?.() || user.id,
    name: user.name,
    email: user.email,
    role: user.role || 'user'
  };
}

const ORDER_STATUSES = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'];
const TRACKING_LABELS = ['Order Placed', 'Confirmed', 'Processing', 'Shipped', 'Delivered'];

// Map order status -> which tracking steps are completed
function trackingStepsFor(status, placedAt) {
  const idx = { pending: 0, confirmed: 1, processing: 2, shipped: 3, delivered: 4 }[status];
  const now = new Date();
  return TRACKING_LABELS.map((label, i) => ({
    label,
    completed: idx !== undefined && i <= idx,
    date: idx !== undefined && i <= idx ? (i === 0 ? (placedAt || now) : now) : null
  }));
}


// Normalize a cart quantity to a positive integer (or null when invalid)
function normalizeQty(qty) {
  const n = parseInt(qty, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}
module.exports = {
  fmt,
  CLOUDINARY_PLACEHOLDER, normalizeQty,
  imgUrl,
  getDistinctCategories,
  sessionUser,
  ORDER_STATUSES,
  TRACKING_LABELS,
  trackingStepsFor
};
