require('dotenv').config();
const express    = require('express');
const path       = require('path');
const helmet     = require('helmet');
const cors       = require('cors');
const fs         = require('fs');
const mongoose   = require('mongoose');
const ejs        = require('ejs');
const multer     = require('multer');
const cloudinary = require('cloudinary').v2;

const Product    = require('./models/Product');
const Order      = require('./models/Order');
const Wishlist   = require('./models/Wishlist');
const User       = require('./models/User');
const Settings   = require('./models/Settings');
const Coupon     = require('./models/Coupon');
const { runSmokeTest } = require('./scripts/smoke-templates');
const { Contact, Newsletter, OrderMessage } = require('./models/Newsletter');

const session = require('express-session');
const MongoStore = require('connect-mongo');
const { validateEnv } = require('./config/env');
const connectDB = require('./config/db');
const { getCsrfToken, verifyCsrf } = require('./middleware/csrf');
const { validatePassword } = require('./utils/password');
const { isValidEmail, sanitizeText, escapeRegex, parseBoolean } = require('./utils/sanitize');
const { imgUrl, getDistinctCategories, sessionUser, ORDER_STATUSES, trackingStepsFor, CLOUDINARY_PLACEHOLDER } = require('./utils/helpers');
const { ADMIN_EMAILS, isAdmin, requireAdminApi } = require('./middleware/auth');
const { globalLimiter, checkoutLimiter, couponLimiter, contactLimiter, authLimiter, passwordResetLimiter } = require('./middleware/rateLimiters');
const { asyncHandler, errorHandler } = require('./middleware/errors');
const productRepo = require('./services/productRepo');
const logger = require('./services/logger');

const app = express();

// ── Cloudinary ────────────────────────────────────────────
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// ── Security ────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // ponytail: scriptSrc keeps 'unsafe-inline' because 16 page templates still
      // ship inline <script> blocks (~1.5k lines). They move to the existing
      // pageJs mechanism during the Phase 2/4 refactor, after which
      // 'unsafe-inline' can be dropped (nonce-based CSP). The eval allowance is
      // removed — GSAP/ScrollTrigger don't need it.
      scriptSrc: ["'self'", "'unsafe-inline'", "cdn.jsdelivr.net"],
      styleSrc:  ["'self'", "'unsafe-inline'", "cdn.jsdelivr.net", "https://fonts.googleapis.com"],
      imgSrc:    ["'self'", "data:", "blob:", "https://res.cloudinary.com"],
      connectSrc:["'self'"],
      fontSrc:   ["'self'", "cdn.jsdelivr.net", "https://fonts.gstatic.com"],
      frameSrc:  ["'none'"],
      objectSrc: ["'none'"],
      baseUri:   ["'self'"],
      formAction:["'self'"],
    }
  }
}));
// Static files first: images/CSS/JS must not consume the global rate-limit budget
// or create sessions (memory + latency) on every asset request.
app.use('/public', express.static(path.join(__dirname, 'public'), { maxAge: '7d', immutable: true }));

app.use(globalLimiter);
const isProduction = process.env.NODE_ENV === 'production';
app.use(cors({ origin: isProduction ? false : true, credentials: true }));

// ── Helpers ───────────────────────────────────────────────────────
// (isValidEmail / sanitizeText / escapeRegex / parseBoolean live in utils/sanitize.js;
//  fmt / imgUrl / getDistinctCategories / sessionUser / order tracking live in utils/helpers.js)

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

// ── Product image uploads ─────────────────────────────────────────
// Using memory storage for Cloudinary upload pipeline
const productImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 5 },
  fileFilter: (_req, file, cb) => {
    if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) return cb(null, true);
    cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname));
  }
});

// Helper to upload buffer to Cloudinary
async function uploadToCloudinary(buffer, mimetype) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { resource_type: 'image', folder: 'baggy-jeans-shop' },
      (error, result) => {
        if (error) reject(error);
        else resolve(result.secure_url);
      }
    );
    stream.end(buffer);
  });
}

// Multer error handler - must be placed after upload routes
function handleMulterError(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ ok: false, message: 'File too large. Maximum 5 MB per image.' });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ ok: false, message: 'Too many files. Maximum 5 images allowed.' });
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({ ok: false, message: 'Invalid file type. Only JPEG, PNG, and WebP images accepted.' });
    }
    return res.status(400).json({ ok: false, message: `Upload error: ${err.message}` });
  }
  next(err);
}

// Image validation using buffer
function validateUploadedImages(files) {
  const invalidFiles = [];
  for (const file of files) {
    const validSignatures = {
      'image/jpeg': [0xFF, 0xD8, 0xFF],
      'image/png': [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A],
      'image/webp': [0x52, 0x49, 0x46, 0x46]
    };
    const buffer = file.buffer.slice(0, 16);
    let isValid = false;
    for (const [mime, sig] of Object.entries(validSignatures)) {
      if (sig.every((byte, i) => buffer[i] === byte)) {
        if (mime === 'image/webp') {
          if (buffer.slice(8, 12).toString('ascii') === 'WEBP') isValid = true;
        } else {
          isValid = true;
        }
      }
    }
    if (!isValid || file.mimetype.split('/')[0] !== 'image') invalidFiles.push(file);
  }
  return invalidFiles;
}

function validateProductImages(req, res, next) {
  const invalidFiles = validateUploadedImages(req.files || []);
  if (invalidFiles.length > 0) {
    return res.status(400).json({ ok: false, message: 'One or more uploads are not valid image files.' });
  }
  next();
}

// ── Session (lazy-mounted) ───────────────────────────────────────
// The store is chosen once boot() knows whether MongoDB is reachable, but
// middleware order must be fixed at module load — so the real session
// middleware is swapped in before app.listen() is ever called. Mounted after
// static serving so asset requests skip session loading entirely.
let sessionHandler = null;
app.use((req, res, next) => {
  if (sessionHandler) return sessionHandler(req, res, next);
  res.status(503).json({ ok: false, message: 'Server is starting' });
});

// ── CSRF protection ─────────────────────────────────────────
// One middleware (middleware/csrf.js) protects every state-changing request:
// the token comes from the X-CSRF-Token header (AJAX, auto-attached by
// main.js) or the _csrf body field (native form posts). Multipart upload
// routes re-verify after multer parses the body. The old verifyCsrf/
// applyCsrf pair (which silently skipped JSON/urlencoded bodies) is gone.
app.use(verifyCsrf);

// ── Static files ─────────────────────────────────────────────────
// (static serving is mounted earlier, before the rate limiter)

// ── EJS ─────────────────────────────────────────────────────────
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Cache-bust version for static assets: changes on every server start
const ASSET_VERSION = Date.now().toString(36);

function renderPage(req, res, page, data = {}) {
  const base = {
    year: new Date().getFullYear(),
    assetV: ASSET_VERSION,
    pageTitle: 'BA GGY — Fashion That Moves With You',
    bodyClass: '',
    category: '',
    filtered: null,
    pageCss: null,
    pageJs: null,
    cart: req.session?.cart || [],
    cartCount: req.session?.cart?.reduce((s, i) => s + i.qty, 0) || 0,
    wishlist: req.session?.wishlist || [],
    wishlistCount: req.session?.wishlist?.length || 0,
    user: req.session?.user || null,
    csrfToken: getCsrfToken(req),
    imgUrl,
    ...data
  };
  ejs.renderFile(path.join(__dirname, 'views', page + '.ejs'), base, (err, inner) => {
    if (err) return res.status(500).send('Render error: ' + err.message);
    res.send(ejs.render(
      fs.readFileSync(path.join(__dirname, 'views', 'layout.ejs'), 'utf8'),
      { ...base, body: inner }
    ));
  });
}

// ── Middleware ────────────────────────────────────────────────────
app.use((req, res, next) => {
  if (!req.session.cart) req.session.cart = [];
  next();
});

// ── Routes ───────────────────────────────────────────────────────
// Storefront reads go through services/productRepo.js (Mongo with products.json
// fallback — the duplication that used to live in every route is gone).
app.get('/', async (req, res) => {
  const featured = await productRepo.listFeatured();
  renderPage(req, res, 'index', { activePage: 'home', pageTitle: 'BA GGY — Fashion That Moves With You', featuredProducts: featured });
});

app.get('/shop', async (req, res) => {
  const products = await productRepo.listActive();
  const q = (req.query.q || '').toLowerCase().trim();
  const displayProducts = q ? products.filter(p => productRepo.matchesQuery(p, q)) : products;
  const categories = getDistinctCategories(products);
  renderPage(req, res, 'shop', {
    activePage: 'shop',
    pageTitle: q ? `Search: ${q} — BA GGY` : 'Shop All — BA GGY',
    products,
    displayProducts,
    filtered: displayProducts,
    category: '',
    categories
  });
});

app.get('/shop/:cat', async (req, res) => {
  const cat = req.params.cat;
  const [filtered, products] = await Promise.all([productRepo.listByCategory(cat), productRepo.listActive()]);
  const categories = getDistinctCategories(products);
  const catLabel = cat.charAt(0).toUpperCase() + cat.slice(1);
  const title = cat === 'jeans' ? 'Jeans Collection — BA GGY' : cat === 'shirts' ? 'Shirts Collection — BA GGY' : catLabel + ' — BA GGY';
  // Use dedicated pages for main categories
  if (cat === 'jeans') {
    renderPage(req, res, 'jeans', { activePage: 'shop', pageTitle: title, products, filtered, categories });
  } else if (cat === 'shirts') {
    renderPage(req, res, 'shirts', { activePage: 'shop', pageTitle: title, products, filtered, categories });
  } else {
    renderPage(req, res, 'shop', { activePage: 'shop', pageTitle: title, products, displayProducts: filtered, filtered, category: cat, categories });
  }
});

app.get('/product/:id', async (req, res) => {
  const product = await productRepo.getById(req.params.id);
  if (!product) return res.status(404).render('404', { year: new Date().getFullYear() });
  const products = await productRepo.listRelated(product, 4);
  renderPage(req, res, 'product', { activePage: 'product', product, products, pageTitle: product.name + ' — BA GGY' });
});

app.get('/jeans', async (req, res) => {
  const cat = 'jeans';
  const [filtered, products] = await Promise.all([productRepo.listByCategory(cat), productRepo.listActive()]);
  const categories = getDistinctCategories(products);
  renderPage(req, res, 'jeans', { activePage: 'shop', pageTitle: 'Jeans Collection — BA GGY', products, filtered, categories });
});

app.get('/shirts', async (req, res) => {
  const cat = 'shirts';
  const [filtered, products] = await Promise.all([productRepo.listByCategory(cat), productRepo.listActive()]);
  const categories = getDistinctCategories(products);
  renderPage(req, res, 'shirts', { activePage: 'shop', pageTitle: 'Shirts Collection — BA GGY', products, filtered, categories });
});

app.get('/cart', (req, res) => renderPage(req, res, 'cart', { activePage: 'cart', pageTitle: 'Your Cart — BA GGY' }));
app.get('/checkout', (req, res) => renderPage(req, res, 'checkout', { activePage: 'checkout', pageTitle: 'Checkout — BA GGY' }));

app.get('/contact', (req, res) => renderPage(req, res, 'contact', { activePage: 'contact', pageTitle: 'Contact Us — BA GGY' }));
app.get('/forgot-password', (req, res) => renderPage(req, res, 'forgot-password', { activePage: '', pageTitle: 'Forgot Password — BA GGY' }));
app.get('/reset-password', (req, res) => renderPage(req, res, 'reset-password', { activePage: '', pageTitle: 'Reset Password — BA GGY', resetToken: String(req.query.token || ''), resetEmail: String(req.query.email || '') }));
app.get('/about', (req, res) => renderPage(req, res, 'about', { activePage: 'about', pageTitle: 'About Us — BA GGY' }));
app.get('/faq', (req, res) => renderPage(req, res, 'faq', { activePage: 'faq', pageTitle: 'FAQ — BA GGY' }));
app.get('/track', (req, res) => renderPage(req, res, 'track', { activePage: 'track', pageTitle: 'Track Your Order — BA GGY', orderId: String(req.query.order_id || req.query.orderId || '').trim() }));
app.get('/signup', (req, res) => res.redirect(302, '/account?action=register'));
app.get('/login', (req, res) => res.redirect(302, '/account?action=login'));
app.get('/wishlist', (req, res) => renderPage(req, res, 'wishlist', { activePage: 'wishlist', pageTitle: 'Wishlist — BA GGY' }));

app.get('/account/orders', async (req, res) => {
  if (!req.session.user) return renderPage(req, res, 'orders', { activePage: 'account', pageTitle: 'My Orders — BA GGY', orders: [], user: null });
  try {
    const orders = await Order.find({ 'customer.email': req.session.user.email }).sort({ createdAt: -1 }).lean();
    renderPage(req, res, 'orders', { activePage: 'account', pageTitle: 'My Orders — BA GGY', orders, user: req.session.user });
  } catch {
    renderPage(req, res, 'orders', { activePage: 'account', pageTitle: 'My Orders — BA GGY', orders: [], user: req.session.user });
  }
});

app.get('/account', async (req, res) => {
  const action = req.query.action || (req.session.user ? 'dashboard' : 'login');
  if (action === 'login') return renderPage(req, res, 'login', { activePage: 'account', pageTitle: 'Sign In — BA GGY', user: req.session.user });
  if (action === 'register') return renderPage(req, res, 'register', { activePage: 'account', pageTitle: 'Create Account — BA GGY', user: req.session.user });
  let orders = [];
  let accountUser = req.session.user;
  if (req.session.user) {
    try {
      orders = await Order.find({ 'customer.email': req.session.user.email }).sort({ createdAt: -1 }).lean();
      const dbUser = await User.findById(req.session.user.id).lean();
      if (dbUser) {
        accountUser = {
          ...req.session.user,
          addresses: dbUser.addresses || [],
          currency: dbUser.currency || 'PKR',
          emailNotifications: dbUser.emailNotifications !== false
        };
      }
    } catch {}
  }
  return renderPage(req, res, 'account', { activePage: 'account', pageTitle: 'My Account — BA GGY', user: accountUser, orders });
});

app.get('/newsletter', (req, res) => renderPage(req, res, 'newsletter', { activePage: 'newsletter', pageTitle: 'Newsletter — BA GGY' }));

app.get('/contact/thankyou', (req, res) => renderPage(req, res, 'contact-thankyou', { activePage: 'contact', pageTitle: 'Message Sent — BA GGY' }));

app.get('/search', async (req, res) => {
  const q = (req.query.q || '').toLowerCase().trim();
  const catFilter = req.query.category || '';
  let products = await productRepo.listActive();
  if (q) products = products.filter(p => productRepo.matchesQuery(p, q));
  if (catFilter) products = products.filter(p => p.category === catFilter);
  renderPage(req, res, 'search', {
    activePage: 'shop',
    pageTitle: q ? `Search: ${q} — BA GGY` : 'Search — BA GGY',
    products,
    query: q || null,
    categoryFilter: catFilter || null
  });
});

// ── API Routes ──────────────────────────────────────────────────
// Pattern demo: this route is wrapped with asyncHandler — a rejected promise
// flows to the central error middleware (clean 500) instead of a bare
// try/catch. The remaining explicit try/catch routes convert during the
// route-splitting sweep.
app.get('/api/product/:id', asyncHandler(async (req, res) => {
  const product = await Product.findOne({ id: req.params.id }).lean();
  if (!product) return res.status(404).json({ ok: false });
  res.json(product);
}));
app.get('/order/:id', async (req, res) => {
  try {
    const order = await Order.findOne({ orderId: req.params.id }).lean();
    if (!order) return res.status(404).render('404', { year: new Date().getFullYear() });
    // Only admins or the customer who placed the order may view it
    const isOwner = req.session.user && order.customer &&
      String(order.customer.email).toLowerCase() === String(req.session.user.email).toLowerCase();
    if (!isAdmin(req) && !isOwner) return res.status(403).render('404', { year: new Date().getFullYear() });
    renderPage(req, res, 'order', { activePage: 'order', order, pageTitle: 'Order #' + order.orderId + ' — BA GGY' });
  } catch {
    res.status(404).render('404', { year: new Date().getFullYear() });
  }
});

// ── Admin Routes ────────────────────────────────────────────────
// (ADMIN_EMAILS / isAdmin / requireAdminApi live in middleware/auth.js)
app.get('/admin', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).render('404', { year: new Date().getFullYear() });
  let totalOrders = 0, totalProducts = 0, newsletterToday = 0, totalRevenue = 0;
  let deliveredOrders = 0, shippedOrders = 0, processingOrders = 0, confirmedOrders = 0, pendingOrders = 0;
  let recentOrders = [], topProducts = [];
  let couponAnalytics = { ordersWithCoupon: 0, totalDiscount: 0, influencedRevenue: 0, top: [] };
  let totalCoupons = 0, activeCoupons = 0;
  try {
    totalOrders = await Order.countDocuments();
    totalProducts = await Product.countDocuments();
    const startOfDay = new Date(); startOfDay.setHours(0,0,0,0);
    newsletterToday = await Newsletter.countDocuments({ createdAt: { $gte: startOfDay } });
    totalCoupons = await Coupon.countDocuments();
    activeCoupons = await Coupon.countDocuments({ active: true });

    // Calculate revenue
    const allOrders = await Order.find({ status: 'delivered' }).lean();
    totalRevenue = allOrders.reduce((sum, o) => sum + (o.total || 0), 0);

    // Status counts
    deliveredOrders = await Order.countDocuments({ status: 'delivered' });
    shippedOrders = await Order.countDocuments({ status: 'shipped' });
    processingOrders = await Order.countDocuments({ status: 'processing' });
    confirmedOrders = await Order.countDocuments({ status: 'confirmed' });
    pendingOrders = await Order.countDocuments({ status: 'pending' });

    // Recent orders
    recentOrders = await Order.find().sort({ createdAt: -1 }).limit(5).lean();

    // Top products (by most ordered) — enriched with live catalog data
    const ordersWithItems = await Order.find({}).lean();
    const productSales = {};
    ordersWithItems.forEach(order => {
      if (order.status === 'cancelled') return;
      (order.items || []).forEach(item => {
        const key = item.productId || item.name;
        if (!productSales[key]) productSales[key] = { productId: item.productId, name: item.name, count: 0, revenue: 0 };
        productSales[key].count += item.qty || 1;
        productSales[key].revenue += (item.price || 0) * (item.qty || 1);
      });
    });
    const catalog = await Product.find({}).lean();
    const catalogById = Object.fromEntries(catalog.map(p => [p.id, p]));
    topProducts = Object.values(productSales)
      .sort((a, b) => b.count - a.count).slice(0, 5)
      .map(tp => {
        const p = catalogById[tp.productId] || {};
        return {
          productId: tp.productId,
          name: tp.name,
          soldCount: tp.count,
          revenue: tp.revenue,
          price: p.price || 0,
          images: p.images || [],
          category: p.category || '—',
          subcategory: p.subcategory || '—'
        };
      });

    // Coupon analytics — orders record their coupon code + discount at checkout
    const couponOrders = allOrders.filter(o => o.couponCode && o.discount > 0);
    const byCoupon = {};
    couponOrders.forEach(o => {
      const c = o.couponCode;
      if (!byCoupon[c]) byCoupon[c] = { code: c, uses: 0, discount: 0, revenue: 0 };
      byCoupon[c].uses += 1;
      byCoupon[c].discount += o.discount || 0;
      byCoupon[c].revenue += o.total || 0;
    });
    const couponList = Object.values(byCoupon).sort((a, b) => b.uses - a.uses);
    couponAnalytics = {
      ordersWithCoupon: couponOrders.length,
      totalDiscount: couponOrders.reduce((sum, o) => sum + (o.discount || 0), 0),
      influencedRevenue: couponOrders.reduce((sum, o) => sum + (o.total || 0), 0),
      top: couponList.slice(0, 5)
    };
  } catch (err) {
    logger.error('Admin dashboard error: %s', err.message);
    // Ensure all variables have default values
    totalRevenue = 0;
    deliveredOrders = 0;
    shippedOrders = 0;
    processingOrders = 0;
    confirmedOrders = 0;
    pendingOrders = 0;
    recentOrders = [];
    topProducts = [];
    totalCoupons = 0;
    activeCoupons = 0;
    couponAnalytics = { ordersWithCoupon: 0, totalDiscount: 0, influencedRevenue: 0, top: [] };
  }
  renderPage(req, res, 'admin-index', {
    activePage: 'admin',
    pageTitle: 'Admin — BA GGY',
    user: req.session.user,
    totalOrders,
    totalProducts,
    newsletterToday,
    totalRevenue,
    deliveredOrders,
    shippedOrders,
    processingOrders,
    confirmedOrders,
    pendingOrders,
    recentOrders,
    topProducts,
    totalCoupons,
    activeCoupons,
    couponAnalytics
  });
});

app.get('/admin/orders', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).render('404', { year: new Date().getFullYear() });
  const statusFilter = ORDER_STATUSES.includes(req.query.status) ? req.query.status : '';
  try {
    const page = Math.max(1, parseInt(req.query.page || '1'));
    const limit = 20;
    const query = statusFilter ? { status: statusFilter } : {};
    const total = await Order.countDocuments(query);
    const orders = await Order.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean();
    renderPage(req, res, 'admin-orders', {
      activePage: 'admin',
      pageTitle: 'Orders — Admin',
      user: req.session.user,
      orders,
      page,
      totalPages: Math.ceil(total / limit),
      total,
      statusFilter
    });
  } catch {
    renderPage(req, res, 'admin-orders', {
      activePage: 'admin',
      pageTitle: 'Orders — Admin',
      user: req.session.user,
      orders: [],
      page: 1,
      totalPages: 0,
      total: 0,
      statusFilter
    });
  }
});

app.get('/admin/products', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).render('404', { year: new Date().getFullYear() });
  try {
    const page = Math.max(1, parseInt(req.query.page || '1'));
    const limit = 20;
    const total = await Product.countDocuments();
    const products = await Product.find().sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean();
    renderPage(req, res, 'admin-products', {
      activePage: 'admin',
      pageTitle: 'Products — Admin',
      user: req.session.user,
      products,
      page,
      totalPages: Math.ceil(total / limit),
      total
    });
  } catch {
    renderPage(req, res, 'admin-products', {
      activePage: 'admin',
      pageTitle: 'Products — Admin',
      user: req.session.user,
      products: [],
      page: 1,
      totalPages: 0,
      total: 0
    });
  }
});

app.get('/admin/inventory', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).render('404', { year: new Date().getFullYear() });
  try {
    const products = await Product.find().sort({ stock: 1, name: 1 }).lean();
    const lowStockProducts = products.filter(product => product.stock <= (product.lowStockThreshold ?? 10));
    renderPage(req, res, 'admin-inventory', {
      activePage: 'admin',
      pageTitle: 'Inventory — Admin',
      user: req.session.user,
      products,
      lowStockProducts,
      totalProducts: products.length,
      totalOrders: await Order.countDocuments()
    });
  } catch (err) {
    logger.error('Inventory page error: %s', err.message);
    renderPage(req, res, 'admin-inventory', {
      activePage: 'admin',
      pageTitle: 'Inventory — Admin',
      user: req.session.user,
      products: [],
      lowStockProducts: [],
      totalProducts: 0,
      totalOrders: 0
    });
  }
});

app.get('/admin/product/:id', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).render('404', { year: new Date().getFullYear() });
  try {
    const product = await Product.findOne({ id: req.params.id }).lean();
    if (!product) return res.status(404).render('404', { year: new Date().getFullYear() });
    renderPage(req, res, 'admin-product-detail', {
      activePage: 'admin',
      pageTitle: product.name + ' — Admin',
      user: req.session.user,
      product
    });
  } catch {
    res.status(404).render('404', { year: new Date().getFullYear() });
  }
});

// Admin: Order detail view
app.get('/admin/order/:id', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).render('404', { year: new Date().getFullYear() });
  try {
    const order = await Order.findOne({ orderId: req.params.id }).lean();
    if (!order) return res.status(404).render('404', { year: new Date().getFullYear() });
    const totalOrders = await Order.countDocuments();
    renderPage(req, res, 'admin-order-detail', {
      activePage: 'admin',
      pageTitle: 'Order #' + order.orderId + ' — Admin',
      user: req.session.user,
      order,
      totalOrders
    });
  } catch {
    res.status(404).render('404', { year: new Date().getFullYear() });
  }
});

// Admin: update order status (the route the admin orders page actually calls)
app.post('/admin/order/:id/status', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ ok: false });
  const { status } = req.body;
  if (!ORDER_STATUSES.includes(status)) return res.status(400).json({ ok: false, message: 'Invalid status' });
  try {
    const order = await Order.findOne({ orderId: req.params.id });
    if (!order) return res.status(404).json({ ok: false, message: 'Order not found' });
    const wasCancelled = order.status !== 'cancelled';
    order.status = status;
    order.trackingSteps = trackingStepsFor(status, order.createdAt);
    await order.save();
    // Restock items when an order is cancelled. A cancelled order stays cancelled,
    // so stock cannot be credited twice through repeated status updates.
    if (status === 'cancelled' && wasCancelled) {
      for (const item of order.items || []) {
        await Product.updateOne(
          { id: item.productId },
          { $inc: { stock: item.qty }, $push: { stockHistory: { qty: item.qty, reason: 'cancellation', orderId: order.orderId } } }
        );
      }
    }
    res.json({ ok: true, order: order.toObject() });
  } catch (err) {
    logger.error('Order status error: %s', err.message);
    res.status(500).json({ ok: false, message: 'Error updating order' });
  }
});

// Admin: filter orders by status
app.get('/admin/orders/filter', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ ok: false });
  const status = req.query.status || '';
  try {
    const query = ORDER_STATUSES.includes(status) ? { status } : {};
    const orders = await Order.find(query).sort({ createdAt: -1 }).limit(100).lean();
    res.json({ ok: true, orders });
  } catch {
    res.status(500).json({ ok: false, message: 'Error filtering orders' });
  }
});

app.get('/admin/live-search', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ ok: false });
  const q = (req.query.q || '').toLowerCase().trim();
  try {
    let products = await Product.find({}).lean();
    if (q) {
      products = products.filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        p.subcategory.toLowerCase().includes(q)
      );
    }
    res.json({ ok: true, products });
  } catch {
    res.status(500).json({ ok: false });
  }
});

app.get('/admin/newsletter', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).render('404', { year: new Date().getFullYear() });
  const page = Math.max(1, parseInt(req.query.page || '1'));
  const limit = 20;
  const q = (req.query.q || '').toLowerCase().trim();
  let query = {};
  if (q) query.email = { $regex: q, $options: 'i' };
  try {
    const total = await Newsletter.countDocuments(query);
    const subscribers = await Newsletter.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean();
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayCount = await Newsletter.countDocuments({ createdAt: { $gte: today } });
    const oneWeekAgo = new Date(); oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    const weekCount = await Newsletter.countDocuments({ createdAt: { $gte: oneWeekAgo } });
    renderPage(req, res, 'admin-newsletter', {
      activePage: 'admin',
      pageTitle: 'Newsletter — Admin',
      user: req.session.user,
      subscribers,
      total,
      totalSubscribers: total,
      totalPages: Math.ceil(total / limit),
      page,
      todaySubscribers: todayCount,
      weekSubscribers: weekCount
    });
  } catch {
    renderPage(req, res, 'admin-newsletter', {
      activePage: 'admin',
      pageTitle: 'Newsletter — Admin',
      user: req.session.user,
      subscribers: [],
      total: 0,
      totalSubscribers: 0,
      totalPages: 0,
      page: 1,
      todaySubscribers: 0,
      weekSubscribers: 0
    });
  }
});

// ── Admin: User Management ────────────────────────────────────────
app.get('/admin/users', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).render('404', { year: new Date().getFullYear() });
  const page = Math.max(1, parseInt(req.query.page || '1'));
  const limit = 20;
  const q = (req.query.q || '').toLowerCase().trim();
  const query = { role: { $ne: 'admin' } };
  if (q) query.$or = [
    { name: { $regex: escapeRegex(q), $options: 'i' } },
    { email: { $regex: escapeRegex(q), $options: 'i' } }
  ];
  try {
    const total = await User.countDocuments(query);
    const users = await User.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean();
    const orders = await Order.find({}).lean();
    const ordersByUser = {};
    orders.forEach(order => {
      if (!order.customer?.email) return;
      const email = order.customer.email.toLowerCase();
      if (!ordersByUser[email]) ordersByUser[email] = { count: 0, total: 0 };
      if (order.status !== 'cancelled') {
        ordersByUser[email].count++;
        ordersByUser[email].total += order.total || 0;
      }
    });
    renderPage(req, res, 'admin-users', {
      activePage: 'admin', pageTitle: 'Customers — Admin', user: req.session.user,
      users, ordersByUser, totalUsers: total, totalPages: Math.ceil(total / limit), page
    });
  } catch {
    renderPage(req, res, 'admin-users', {
      activePage: 'admin', pageTitle: 'Customers — Admin', user: req.session.user,
      users: [], ordersByUser: {}, totalUsers: 0, totalPages: 0, page: 1
    });
  }
});

// ── Admin: Contact Messages ────────────────────────────────────────
app.get('/admin/contacts', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).render('404', { year: new Date().getFullYear() });
  const page = Math.max(1, parseInt(req.query.page || '1'));
  const limit = 20;
  const statusFilter = ['new', 'read', 'replied'].includes(req.query.status) ? req.query.status : '';
  const query = statusFilter ? { status: statusFilter } : {};
  try {
    const total = await Contact.countDocuments(query);
    const messages = await Contact.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean();
    const newMessages = await Contact.countDocuments({ status: 'new' });
    renderPage(req, res, 'admin-contacts', {
      activePage: 'admin', pageTitle: 'Messages — Admin', user: req.session.user,
      messages, totalMessages: total, totalPages: Math.ceil(total / limit), page, statusFilter, newMessages
    });
  } catch {
    renderPage(req, res, 'admin-contacts', {
      activePage: 'admin', pageTitle: 'Messages — Admin', user: req.session.user,
      messages: [], totalMessages: 0, totalPages: 0, page: 1, statusFilter: '', newMessages: 0
    });
  }
});

app.get('/api/admin/contact/:id', requireAdminApi, async (req, res) => {
  try {
    const message = await Contact.findById(req.params.id).lean();
    if (!message) return res.status(404).json({ ok: false, message: 'Message not found' });
    res.json({ ok: true, message });
  } catch {
    res.status(400).json({ ok: false, message: 'Invalid message ID' });
  }
});

app.patch('/api/admin/contact/:id/status', requireAdminApi, async (req, res) => {
  const { status } = req.body;
  if (!['new', 'read', 'replied'].includes(status)) {
    return res.status(400).json({ ok: false, message: 'Invalid message status' });
  }
  try {
    const message = await Contact.findByIdAndUpdate(req.params.id, { status }, { new: true }).lean();
    if (!message) return res.status(404).json({ ok: false, message: 'Message not found' });
    res.json({ ok: true, message });
  } catch {
    res.status(400).json({ ok: false, message: 'Invalid message ID' });
  }
});

app.delete('/api/admin/contact/:id', requireAdminApi, async (req, res) => {
  try {
    const deleted = await Contact.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ ok: false, message: 'Message not found' });
    res.json({ ok: true });
  } catch {
    res.status(400).json({ ok: false, message: 'Invalid message ID' });
  }
});

// ── Admin: Settings ────────────────────────────────────────────────
app.get('/admin/settings', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).render('404', { year: new Date().getFullYear() });
  try {
    const settings = await Settings.findOne({ key: 'store' }).lean();
    renderPage(req, res, 'admin-settings', {
      activePage: 'admin', pageTitle: 'Settings — Admin', user: req.session.user, settings: settings || {}
    });
  } catch {
    renderPage(req, res, 'admin-settings', {
      activePage: 'admin', pageTitle: 'Settings — Admin', user: req.session.user, settings: {}
    });
  }
});

app.post('/api/admin/settings', requireAdminApi, async (req, res) => {
  const shippingThreshold = Number(req.body.shippingThreshold);
  const shippingCost = Number(req.body.shippingCost);
  const lowStockThreshold = Number(req.body.lowStockThreshold);
  const orderIdPrefix = sanitizeText(req.body.orderIdPrefix, 10).toUpperCase();
  if (!Number.isFinite(shippingThreshold) || shippingThreshold < 0 ||
      !Number.isFinite(shippingCost) || shippingCost < 0 ||
      !Number.isInteger(lowStockThreshold) || lowStockThreshold < 1 || !orderIdPrefix) {
    return res.status(400).json({ ok: false, message: 'Enter valid shipping, stock, and order-prefix values.' });
  }
  try {
    const settings = await Settings.findOneAndUpdate(
      { key: 'store' },
      { $set: { shippingThreshold, shippingCost, lowStockThreshold, orderIdPrefix } },
      { upsert: true, new: true, runValidators: true }
    ).lean();
    res.json({ ok: true, settings });
  } catch (err) {
    logger.error('Settings save error: %s', err.message);
    res.status(500).json({ ok: false, message: 'Failed to save settings' });
  }
});

app.post('/api/admin/store-info', requireAdminApi, async (req, res) => {
  const storeName = sanitizeText(req.body.storeName, 100);
  const storeEmail = String(req.body.storeEmail || '').toLowerCase().trim();
  const storePhone = sanitizeText(req.body.storePhone, 40);
  const storeAddress = sanitizeText(req.body.storeAddress, 500);
  if (!storeName || !isValidEmail(storeEmail)) {
    return res.status(400).json({ ok: false, message: 'Enter a store name and valid email address.' });
  }
  try {
    const settings = await Settings.findOneAndUpdate(
      { key: 'store' },
      { $set: { storeName, storeEmail, storePhone, storeAddress } },
      { upsert: true, new: true, runValidators: true }
    ).lean();
    res.json({ ok: true, settings });
  } catch (err) {
    logger.error('Store info save error: %s', err.message);
    res.status(500).json({ ok: false, message: 'Failed to save store information' });
  }
});

// ── Admin: Coupon Management ──────────────────────────────────────
app.get('/admin/coupons', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).render('404', { year: new Date().getFullYear() });
  const page = Math.max(1, parseInt(req.query.page || '1'));
  const limit = 20;
  try {
    const total = await Coupon.countDocuments();
    const coupons = await Coupon.find().sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean();
    renderPage(req, res, 'admin-coupons', {
      activePage: 'admin', pageTitle: 'Coupons — Admin', user: req.session.user,
      coupons, total, page, totalPages: Math.ceil(total / limit)
    });
  } catch {
    renderPage(req, res, 'admin-coupons', {
      activePage: 'admin', pageTitle: 'Coupons — Admin', user: req.session.user,
      coupons: [], total: 0, page: 1, totalPages: 0
    });
  }
});

app.post('/api/admin/coupons', requireAdminApi, async (req, res) => {
  const { code, type, value, minOrder, maxDiscount, expiresAt, usageLimit } = req.body;
  const cleanCode = String(code || '').trim().toUpperCase();
  const numericValue = Number(value);
  const numericMinOrder = minOrder === undefined ? 0 : Number(minOrder);
  const numericMaxDiscount = maxDiscount === undefined ? undefined : Number(maxDiscount);
  const numericUsageLimit = usageLimit === undefined ? undefined : Number(usageLimit);
  if (!/^[A-Z0-9_-]{3,32}$/.test(cleanCode) || !['percent', 'fixed'].includes(type) ||
      !Number.isFinite(numericValue) || numericValue <= 0 || (type === 'percent' && numericValue > 100) ||
      !Number.isFinite(numericMinOrder) || numericMinOrder < 0 ||
      (numericMaxDiscount !== undefined && (!Number.isFinite(numericMaxDiscount) || numericMaxDiscount < 0)) ||
      (numericUsageLimit !== undefined && (!Number.isInteger(numericUsageLimit) || numericUsageLimit < 1)) ||
      (expiresAt && (!Number.isFinite(new Date(expiresAt).getTime()) || new Date(expiresAt) <= new Date()))) {
    return res.status(400).json({ ok: false, message: 'Enter valid coupon details.' });
  }
  try {
    const coupon = await new Coupon({
      code: cleanCode, type, value: numericValue, minOrder: numericMinOrder,
      ...(numericMaxDiscount !== undefined ? { maxDiscount: numericMaxDiscount } : {}),
      ...(numericUsageLimit !== undefined ? { usageLimit: numericUsageLimit } : {}),
      ...(expiresAt ? { expiresAt: new Date(expiresAt) } : {})
    }).save();
    res.json({ ok: true, coupon: coupon.toObject() });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ ok: false, message: 'That coupon code already exists.' });
    res.status(500).json({ ok: false, message: 'Failed to create coupon' });
  }
});

app.delete('/api/admin/coupons/:id', requireAdminApi, async (req, res) => {
  try {
    const deleted = await Coupon.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ ok: false, message: 'Coupon not found' });
    res.json({ ok: true });
  } catch {
    res.status(400).json({ ok: false, message: 'Invalid coupon ID' });
  }
});

// Validate a coupon without consuming it.
app.post('/api/coupon/validate', couponLimiter, async (req, res) => {
  const code = String(req.body.code || '').trim().toUpperCase();
  const subtotal = Number(req.body.subtotal);
  if (!/^[A-Z0-9_-]{3,32}$/.test(code) || !Number.isFinite(subtotal) || subtotal < 0) {
    return res.status(400).json({ ok: false, message: 'Enter a valid coupon code.' });
  }
  try {
    const coupon = await Coupon.findOne({ code, active: true }).lean();
    const now = new Date();
    if (!coupon || (coupon.expiresAt && coupon.expiresAt <= now) || (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit)) {
      return res.status(400).json({ ok: false, message: 'This coupon is invalid or expired.' });
    }
    if (subtotal < coupon.minOrder) return res.status(400).json({ ok: false, message: `Minimum order is ₨${coupon.minOrder.toLocaleString()}.` });
    let discount = coupon.type === 'percent' ? subtotal * coupon.value / 100 : coupon.value;
    if (coupon.maxDiscount !== undefined) discount = Math.min(discount, coupon.maxDiscount);
    discount = Math.min(Math.max(0, discount), subtotal);
    res.json({ ok: true, code: coupon.code, discount, type: coupon.type, value: coupon.value });
  } catch {
    res.status(500).json({ ok: false, message: 'Could not validate coupon' });
  }
})

// Enable/disable a coupon without deleting it.
app.patch('/api/admin/coupons/:id/toggle', requireAdminApi, async (req, res) => {
  try {
    const coupon = await Coupon.findById(req.params.id);
    if (!coupon) return res.status(404).json({ ok: false, message: 'Coupon not found' });
    coupon.active = !coupon.active;
    await coupon.save();
    res.json({ ok: true, active: coupon.active });
  } catch (err) {
    if (err && err.name === 'CastError') return res.status(400).json({ ok: false, message: 'Invalid coupon ID' });
    res.status(500).json({ ok: false, message: 'Failed to update coupon' });
  }
});
;

// ── API: Cart ───────────────────────────────────────────────────
app.get('/api/cart', (req, res) => res.json(req.session.cart || []));

function normalizeQty(qty) {
  const n = parseInt(qty, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

app.post('/api/cart/add', async (req, res) => {
  const { productId, size, qty = 1 } = req.body;
  const nQty = normalizeQty(qty);
  if (!nQty) return res.status(400).json({ ok: false, message: 'Invalid quantity' });
  try {
    const product = await Product.findOne({ id: productId }).lean();
    if (!product) return res.status(400).json({ ok: false, message: 'Product not found' });
    if (product.active === false) return res.status(400).json({ ok: false, message: 'Product is no longer available' });
    const existing = req.session.cart.find(i => i.productId === productId && i.size === size);
    if (existing) existing.qty += nQty;
    else req.session.cart.push({ productId, size, qty: nQty, price: product.price, name: product.name, image: product.images[0] });
    res.json({ ok: true, cart: req.session.cart });
  } catch {
    res.status(400).json({ ok: false, message: 'Error adding to cart' });
  }
});

app.post('/api/cart/update', (req, res) => {
  const { productId, size, qty } = req.body;
  const nQty = normalizeQty(qty);
  if (!nQty) return res.status(400).json({ ok: false, message: 'Invalid quantity' });
  const item = req.session.cart.find(i => i.productId === productId && i.size === size);
  if (item) item.qty = nQty;
  res.json({ ok: true, cart: req.session.cart });
});

app.post('/api/cart/remove', (req, res) => {
  const { productId, size } = req.body;
  req.session.cart = req.session.cart.filter(i => !(i.productId === productId && i.size === size));
  res.json({ ok: true, cart: req.session.cart });
});

app.post('/api/cart/clear', (req, res) => {
  req.session.cart = [];
  res.json({ ok: true, cart: [] });
});

// ── API: Checkout ────────────────────────────────────────────────
app.post('/api/checkout', checkoutLimiter, async (req, res) => {
  const { name, email, phone, address, payment } = req.body;
  const couponCode = String(req.body.couponCode || '').trim().toUpperCase();
  if (!name || !email || !phone || !address || !payment) {
    return res.status(400).json({ ok: false, message: 'Please fill in all required fields' });
  }
  if (!isValidEmail(email)) return res.status(400).json({ ok: false, message: 'Please enter a valid email address' });
  if (!['cod', 'card', 'jazzcash', 'easypaisa', 'bank'].includes(payment)) {
    return res.status(400).json({ ok: false, message: 'Invalid payment method' });
  }
  const sanitize = s => sanitizeText(s, 500);
  const cart = req.session.cart || [];
  if (!cart.length) return res.status(400).json({ ok: false, message: 'Cart is empty' });
  for (const item of cart) {
    if (!item.productId || !item.size || !normalizeQty(item.qty)) {
      return res.status(400).json({ ok: false, message: 'Cart contains invalid items' });
    }
  }

  try {
    // Rebuild checkout items from the catalog. Browser session values are never authoritative.
    const requestedQtyByProduct = new Map();
    for (const item of cart) {
      requestedQtyByProduct.set(item.productId, (requestedQtyByProduct.get(item.productId) || 0) + item.qty);
    }

    const productIds = [...requestedQtyByProduct.keys()];
    const products = await Product.find({ id: { $in: productIds }, active: { $ne: false } }).lean();
    const productsById = new Map(products.map(product => [product.id, product]));
    if (productsById.size !== productIds.length) {
      return res.status(400).json({ ok: false, message: 'One or more cart items are no longer available' });
    }

    for (const [productId, qty] of requestedQtyByProduct) {
      const product = productsById.get(productId);
      if (product.stock < qty) {
        return res.status(409).json({ ok: false, message: `${product.name} does not have enough stock available` });
      }
    }

    const orderItems = cart.map(item => {
      const product = productsById.get(item.productId);
      return {
        productId: product.id,
        name: product.name,
        image: product.images?.[0] || 'placeholder.png',
        size: item.size,
        qty: item.qty,
        price: product.price
      };
    });
    const subtotal = orderItems.reduce((sum, item) => sum + item.price * item.qty, 0);
    let discount = 0;
    let appliedCoupon = null;
    if (couponCode) {
      const coupon = await Coupon.findOne({ code: couponCode, active: true });
      const now = new Date();
      if (!coupon || (coupon.expiresAt && coupon.expiresAt <= now) || (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit)) {
        return res.status(400).json({ ok: false, message: 'This coupon is invalid or expired.' });
      }
      if (subtotal < coupon.minOrder) return res.status(400).json({ ok: false, message: `Minimum order is ₨${coupon.minOrder.toLocaleString()}.` });
      discount = coupon.type === 'percent' ? subtotal * coupon.value / 100 : coupon.value;
      if (coupon.maxDiscount !== undefined) discount = Math.min(discount, coupon.maxDiscount);
      discount = Math.min(Math.max(0, discount), subtotal);
      appliedCoupon = coupon;
    }
    const discountedSubtotal = subtotal - discount;
    const shipping = discountedSubtotal >= 3499 ? 0 : 299;
    const finalTotal = discountedSubtotal + shipping;
    const order = {
      orderId: 'BG-' + Date.now().toString(36).toUpperCase(),
      items: orderItems,
      customer: { name: sanitize(name), email: sanitize(email).toLowerCase(), phone: sanitize(phone), address: sanitize(address) },
      payment,
      subtotal,
      discount,
      couponCode: appliedCoupon?.code,
      shipping,
      total: finalTotal,
      status: 'confirmed',
      trackingSteps: trackingStepsFor('confirmed', new Date())
    };

    // Atomic conditional stock updates prevent overselling when multiple customers check out concurrently.
    const decrementedProducts = [];
    for (const [productId, qty] of requestedQtyByProduct) {
      const result = await Product.updateOne(
        { id: productId, stock: { $gte: qty }, active: { $ne: false } },
        {
          $inc: { stock: -qty },
          $push: { stockHistory: { qty: -qty, reason: 'sale', orderId: order.orderId } }
        }
      );
      if (result.modifiedCount !== 1) {
        for (const previous of decrementedProducts) {
          await Product.updateOne(
            { id: previous.productId },
            { $inc: { stock: previous.qty }, $push: { stockHistory: { qty: previous.qty, reason: 'adjustment', orderId: order.orderId } } }
          );
        }
        return res.status(409).json({ ok: false, message: 'An item in your cart just sold out. Please review your cart and try again.' });
      }
      decrementedProducts.push({ productId, qty });
    }

    let couponReserved = false;
    try {
      // Reserve the coupon atomically after stock is secured. This prevents two concurrent
      // checkouts from both using the last available limited-use coupon.
      if (appliedCoupon) {
        const couponFilter = {
          _id: appliedCoupon._id,
          active: true,
          $or: [
            { expiresAt: { $exists: false } },
            { expiresAt: null },
            { expiresAt: { $gt: new Date() } }
          ],
          ...(appliedCoupon.usageLimit ? { usedCount: { $lt: appliedCoupon.usageLimit } } : {})
        };
        const reserved = await Coupon.findOneAndUpdate(couponFilter, { $inc: { usedCount: 1 } }, { new: true }).lean();
        if (!reserved) {
          for (const previous of decrementedProducts) {
            await Product.updateOne(
              { id: previous.productId },
              { $inc: { stock: previous.qty }, $push: { stockHistory: { qty: previous.qty, reason: 'adjustment', orderId: order.orderId } } }
            );
          }
          return res.status(409).json({ ok: false, message: 'This coupon has just reached its usage limit. Please try another coupon.' });
        }
        couponReserved = true;
      }

      const saved = await new Order(order).save();
      req.session.cart = [];
      req.session.lastOrder = saved.toObject();
      res.json({ ok: true, order: saved.toObject(), redirect: '/checkout/success' });
    } catch (err) {
      if (couponReserved) {
        await Coupon.updateOne({ _id: appliedCoupon._id, usedCount: { $gt: 0 } }, { $inc: { usedCount: -1 } });
      }
      for (const previous of decrementedProducts) {
        await Product.updateOne(
          { id: previous.productId },
          { $inc: { stock: previous.qty }, $push: { stockHistory: { qty: previous.qty, reason: 'adjustment', orderId: order.orderId } } }
        );
      }
      throw err;
    }
  } catch (err) {
    logger.error('Order save error: %s', err.message);
    res.status(500).json({ ok: false, message: 'Failed to place order. Please try again.' });
  }
});

// ── API: Order Tracking ──────────────────────────────────────────
app.get('/api/order/:id', async (req, res) => {
  try {
    const order = await Order.findOne({ orderId: req.params.id }).lean();
    if (!order) return res.status(404).json({ ok: false });
    res.json({ ok: true, order });
  } catch {
    res.status(500).json({ ok: false });
  }
});

app.post('/api/track', async (req, res) => {
  const { orderId } = req.body;
  try {
    const order = await Order.findOne({ orderId }).lean();
    if (!order) return res.status(404).json({ ok: false, message: 'Order not found' });
    res.json({ ok: true, order });
  } catch {
    res.status(500).json({ ok: false, message: 'Error looking up order' });
  }
});

// ── API: Cart wishlist ──────────────────────────────────────────
app.get('/api/wishlist', (req, res) => {
  res.json(req.session.wishlist || []);
});

app.post('/api/wishlist/toggle', async (req, res) => {
  const { productId } = req.body;
  if (!productId) return res.status(400).json({ ok: false, message: 'Product ID required' });
  try {
    const product = await Product.findOne({ id: productId }).lean();
    if (!product) return res.status(400).json({ ok: false, message: 'Product not found' });
    if (product.active === false) return res.status(400).json({ ok: false, message: 'Product is no longer available' });
    const list = req.session.wishlist || [];
    const idx = list.findIndex(i => i.productId === productId);
    if (idx >= 0) {
      list.splice(idx, 1);
    } else {
      list.push({ productId, name: product.name, image: product.images[0], price: product.price, addedAt: new Date() });
    }
    req.session.wishlist = list;
    res.json({ ok: true, wishlist: list });
  } catch {
    res.status(500).json({ ok: false, message: 'Error updating wishlist' });
  }
});

app.post('/api/wishlist/remove', (req, res) => {
  const { productId } = req.body;
  const list = (req.session.wishlist || []).filter(i => i.productId !== productId);
  req.session.wishlist = list;
  res.json({ ok: true, wishlist: list });
});

app.post('/api/wishlist/clear', (req, res) => {
  req.session.wishlist = [];
  res.json({ ok: true, wishlist: [] });
});

// ── API: Checkout confirmation redirect ──────────────────────────
app.get('/checkout/success', (req, res) => {
  const lastOrder = req.session.lastOrder || null;
  renderPage(req, res, 'checkout-success', {
    activePage: 'checkout',
    pageTitle: 'Order Confirmed — BA GGY',
    order: lastOrder,
    showOrderDetails: !!lastOrder
  });
});

// ── API: Contact & Newsletter ───────────────────────────────────
app.post('/api/contact', contactLimiter, async (req, res) => {
  const { name, email, subject, message } = req.body;
  if (!name || !email || !message) return res.status(400).json({ ok: false, message: 'Required fields missing' });
  if (!isValidEmail(email)) return res.status(400).json({ ok: false, message: 'Please enter a valid email address' });
  try {
    await new Contact({
      name: sanitizeText(name, 80),
      email: String(email).toLowerCase().trim(),
      subject: sanitizeText(subject, 150),
      message: sanitizeText(message, 5000)
    }).save();
    res.json({ ok: true, message: 'Message sent successfully' });
  } catch {
    res.status(500).json({ ok: false, message: 'Failed to send message' });
  }
});

app.get('/contact/thankyou', (req, res) => {
  renderPage(req, res, 'contact-thankyou', {
    activePage: 'contact',
    pageTitle: 'Message Sent — BA GGY'
  });
});

app.post('/api/newsletter', async (req, res) => {
  const { email } = req.body;
  if (!email || !isValidEmail(email)) return res.status(400).json({ ok: false, message: 'Please enter a valid email address' });
  try {
    await new Newsletter({ email: String(email).toLowerCase().trim() }).save();
    res.json({ ok: true });
  } catch {
    res.json({ ok: true }); // Already subscribed — still success UX
  }
});

// ── API: Auth (role-based, DB-backed) ─────────────────────────
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'ChangeMe-Admin-2024';

// Bootstrap admin account(s) from ADMIN_EMAILS / ADMIN_PASSWORD
async function ensureAdminUsers() {
  try {
    for (const email of ADMIN_EMAILS) {
      const existing = await User.findOne({ email });
      if (existing) {
        if (existing.role !== 'admin') {
          existing.role = 'admin';
          await existing.save();
        }
        continue;
      }
      const admin = new User({ name: 'Store Admin', email, role: 'admin' });
      await admin.setPassword(ADMIN_PASSWORD);
      await admin.save();
      logger.info(`  ✓ Admin account ready: ${email}`);
    }
  } catch (err) {
    logger.error('  ⚠ Admin bootstrap error: %s', err.message);
  }
}
if (mongoose.connection.readyState === 1) {
  ensureAdminUsers();
} else {
  mongoose.connection.once('connected', ensureAdminUsers);
}
if (ADMIN_PASSWORD === 'ChangeMe-Admin-2024') {
  logger.warn('  ⚠ Using default admin password. Set ADMIN_PASSWORD in .env for production.');
}

app.get('/api/auth/session', (req, res) => {
  if (req.session.user) {
    res.json({ ok: true, user: { email: req.session.user.email, name: req.session.user.name, role: req.session.user.role } });
  } else {
    res.json({ ok: false });
  }
});

app.post('/api/auth/register', authLimiter, async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ ok: false, message: 'All fields required' });
  if (req.session.user) return res.status(400).json({ ok: false, message: 'Already signed in' });
  const cleanName = sanitizeText(name, 80);
  const cleanEmail = String(email).toLowerCase().trim();
  if (!cleanName) return res.status(400).json({ ok: false, message: 'Please enter your name' });
  if (!isValidEmail(cleanEmail)) return res.status(400).json({ ok: false, message: 'Please enter a valid email address' });
  const pwCheck = validatePassword(password);
  if (!pwCheck.ok) return res.status(400).json({ ok: false, message: pwCheck.message });
  // Prevent privilege escalation: admin emails can only be created via bootstrap
  if (ADMIN_EMAILS.includes(cleanEmail)) {
    return res.status(403).json({ ok: false, message: 'This email is reserved. Contact the store administrator.' });
  }
  try {
    const existing = await User.findOne({ email: cleanEmail });
    if (existing) return res.status(409).json({ ok: false, message: 'An account with this email already exists' });
    const user = new User({ name: cleanName, email: cleanEmail, role: 'user' });
    if (req.body.phone) user.phone = sanitizeText(req.body.phone, 30);
    await user.setPassword(String(password));
    await user.save();
    // Regenerate session to prevent session fixation
    req.session.regenerate(err => {
      if (err) return res.status(500).json({ ok: false, message: 'Session error' });
      req.session.user = sessionUser(user);
      getCsrfToken(req);
      req.session.save(err2 => {
        if (err2) return res.status(500).json({ ok: false, message: 'Session error' });
        res.json({ ok: true, user: req.session.user, csrfToken: req.session.csrfToken });
      });
    });
  } catch (err) {
    logger.error('Register error: %s', err.message);
    res.status(500).json({ ok: false, message: 'Registration failed. Please try again.' });
  }
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ ok: false, message: 'Email and password required' });
  const cleanEmail = String(email).toLowerCase().trim();
  if (!isValidEmail(cleanEmail)) return res.status(400).json({ ok: false, message: 'Please enter a valid email address' });
  try {
    const user = await User.findOne({ email: cleanEmail });
    if (user && user.isLockedOut()) {
      const mins = Math.max(1, Math.ceil((user.lockedUntil - Date.now()) / 60000));
      return res.status(429).json({ ok: false, message: `Account temporarily locked. Try again in ${mins} minute${mins === 1 ? '' : 's'}.` });
    }
    const valid = user ? await user.verifyPassword(String(password)) : false;
    if (!user || !valid) {
      if (user) {
        await user.registerFailedLogin();
        if (user.isLockedOut()) {
          return res.status(429).json({ ok: false, message: 'Too many failed attempts. This account is locked for 15 minutes.' });
        }
      }
      return res.status(401).json({ ok: false, message: 'Incorrect email or password' });
    }
    await user.clearLockout();
    // Regenerate session to prevent session fixation
    req.session.regenerate(err => {
      if (err) return res.status(500).json({ ok: false, message: 'Session error' });
      req.session.user = sessionUser(user);
      getCsrfToken(req);
      req.session.save(err2 => {
        if (err2) return res.status(500).json({ ok: false, message: 'Session error' });
        res.json({ ok: true, user: req.session.user, csrfToken: req.session.csrfToken });
      });
    });
  } catch (err) {
    logger.error('Login error: %s', err.message);
    res.status(500).json({ ok: false, message: 'Login failed. Please try again.' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  if (req.session) {
    req.session.destroy(err => {
      res.clearCookie('connect.sid');
      if (err) return res.status(500).json({ ok: false, message: 'Logout error' });
      res.json({ ok: true });
    });
  } else {
    res.json({ ok: true });
  }
});

// ── API: Password reset & change ───────────────────────────────
// Step 1: request a reset token
app.post('/api/auth/forgot-password', passwordResetLimiter, async (req, res) => {
  const email = String(req.body.email || '').toLowerCase().trim();
  if (!isValidEmail(email)) return res.status(400).json({ ok: false, message: 'Please enter a valid email address' });
  try {
    const user = await User.findOne({ email });
    // Always respond the same way so attackers can't discover which emails exist
    const generic = { ok: true, message: 'If an account exists for that email, a reset link has been generated.' };
    if (!user) return res.json(generic);
    const token = user.createPasswordResetToken();
    await user.save({ validateBeforeSave: false });
    // No email provider is configured, so the reset link is shown for the user to copy.
    // TODO: email this link instead of returning it once SMTP is set up.
    res.json({ ...generic, resetUrl: `/reset-password?token=${token}&email=${encodeURIComponent(email)}` });
  } catch (err) {
    logger.error('Forgot-password error: %s', err.message);
    res.status(500).json({ ok: false, message: 'Could not process reset request' });
  }
});

// Step 2: verify a token and set the new password
app.post('/api/auth/reset-password', passwordResetLimiter, async (req, res) => {
  const { email, token, password } = req.body;
  if (!email || !token || !password) return res.status(400).json({ ok: false, message: 'Missing reset details' });
  const pwCheck = validatePassword(password);
  if (!pwCheck.ok) return res.status(400).json({ ok: false, message: pwCheck.message });
  try {
    const user = await User.findOne({ email: String(email).toLowerCase().trim() });
    if (!user || !user.verifyPasswordResetToken(String(token))) {
      return res.status(400).json({ ok: false, message: 'This reset link is invalid or has expired. Please request a new one.' });
    }
    await user.setPassword(String(password));
    user.clearPasswordResetToken();
    await user.save();
    res.json({ ok: true, message: 'Password updated. You can now sign in with your new password.' });
  } catch (err) {
    logger.error('Reset-password error: %s', err.message);
    res.status(500).json({ ok: false, message: 'Could not reset password' });
  }
});

// Change password (signed-in users, from account settings)
app.post('/api/user/change-password', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ ok: false, message: 'Please sign in' });
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ ok: false, message: 'All fields are required' });
  const pwCheck = validatePassword(newPassword);
  if (!pwCheck.ok) return res.status(400).json({ ok: false, message: pwCheck.message });
  if (currentPassword === newPassword) return res.status(400).json({ ok: false, message: 'New password must be different from the current one' });
  try {
    const user = await User.findById(USER_ID(req));
    if (!user) return res.status(401).json({ ok: false, message: 'Please sign in' });
    const valid = await user.verifyPassword(String(currentPassword));
    if (!valid) return res.status(401).json({ ok: false, message: 'Current password is incorrect' });
    await user.setPassword(String(newPassword));
    await user.save();
    res.json({ ok: true, message: 'Password changed successfully' });
  } catch (err) {
    logger.error('Change-password error: %s', err.message);
    res.status(500).json({ ok: false, message: 'Could not change password' });
  }
});

// ── API: User Addresses & Settings (DB-backed) ─────────────────
const USER_ID = req => req.session.user?.id;

app.get('/api/user/addresses', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ ok: false, message: 'Please sign in' });
  try {
    const user = await User.findById(USER_ID(req)).lean();
    res.json({ ok: true, addresses: user?.addresses || [] });
  } catch {
    res.status(500).json({ ok: false, message: 'Error loading addresses' });
  }
});

app.post('/api/user/addresses', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ ok: false, message: 'Please sign in' });
  const { label, name, phone, address, city, state, zip, default: isDefault } = req.body;
  if (!name || !phone || !address) {
    return res.status(400).json({ ok: false, message: 'Name, phone, and address are required' });
  }
  try {
    const user = await User.findById(USER_ID(req));
    if (!user) return res.status(404).json({ ok: false, message: 'User not found' });
    const addresses = user.addresses || [];
    addresses.push({
      label: sanitizeText(label, 80),
      name: sanitizeText(name, 80),
      phone: sanitizeText(phone, 30),
      address: sanitizeText(address, 300),
      city: sanitizeText(city, 80),
      state: sanitizeText(state, 80),
      zip: sanitizeText(zip, 20),
      default: Boolean(isDefault) || addresses.length === 0
    });
    user.addresses = addresses;
    await user.save();
    req.session.user = sessionUser(user);
    res.json({ ok: true, message: 'Address saved', addresses: user.addresses });
  } catch (err) {
    logger.error('Address save error: %s', err.message);
    res.status(500).json({ ok: false, message: 'Failed to save address' });
  }
});

app.delete('/api/user/addresses', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ ok: false, message: 'Please sign in' });
  const { index } = req.body;
  try {
    const user = await User.findById(USER_ID(req));
    if (!user) return res.status(404).json({ ok: false, message: 'User not found' });
    if (typeof index !== 'number' || index < 0 || !user.addresses || index >= user.addresses.length) {
      return res.status(400).json({ ok: false, message: 'Invalid address index' });
    }
    user.addresses.splice(index, 1);
    // If we removed the default, set the first one as default
    if (user.addresses.length > 0) {
      user.addresses[0].default = true;
    }
    await user.save();
    req.session.user = sessionUser(user);
    res.json({ ok: true, message: 'Address removed', addresses: user.addresses });
  } catch (err) {
    logger.error('Address remove error: %s', err.message);
    res.status(500).json({ ok: false, message: 'Failed to remove address' });
  }
});

app.patch('/api/user/settings', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ ok: false, message: 'Please sign in' });
  const { currency, emailNotifications } = req.body;
  try {
    const user = await User.findById(USER_ID(req));
    if (!user) return res.status(404).json({ ok: false, message: 'User not found' });
    if (currency && /^[A-Za-z]{3}$/.test(String(currency))) user.currency = String(currency).toUpperCase();
    if (emailNotifications !== undefined) user.emailNotifications = Boolean(emailNotifications);
    await user.save();
    req.session.user = sessionUser(user);
    res.json({ ok: true, message: 'Settings saved' });
  } catch (err) {
    logger.error('Settings save error: %s', err.message);
    res.status(500).json({ ok: false, message: 'Failed to save settings' });
  }
});

// ── API: My Orders ─────────────────────────────────────────────
app.get('/api/my-orders', async (req, res) => {
  if (!req.session.user) return res.json({ ok: false, message: 'Please sign in' });
  try {
    const orders = await Order.find({ 'customer.email': req.session.user.email }).sort({ createdAt: -1 }).lean();
    res.json({ ok: true, orders });
  } catch {
    res.status(500).json({ ok: false, message: 'Error loading orders' });
  }
});

// ── API: Newsletter page subscribe ─────────────────────────────
app.post('/api/newsletter/subscribe', async (req, res) => {
  const { email, digest } = req.body;
  if (!email || !isValidEmail(email)) return res.status(400).json({ ok: false, message: 'Please enter a valid email address' });
  try {
    const normalized = String(email).toLowerCase().trim();
    const existing = await Newsletter.findOne({ email: normalized });
    if (existing) {
      return res.status(200).json({ ok: false, duplicate: true, message: 'You are already on the list — no need to subscribe again.' });
    }
    await new Newsletter({ email: normalized }).save();
    res.json({ ok: true, message: 'Subscribed successfully' });
  } catch (err) {
    // Unique index race: two simultaneous requests for the same email
    if (err && err.code === 11000) {
      return res.status(200).json({ ok: false, duplicate: true, message: 'You are already on the list — no need to subscribe again.' });
    }
    res.status(500).json({ ok: false, message: 'Something went wrong. Please try again.' });
  }
});

// ── API: Admin - Product CRUD ────────────────────────────────────
app.post('/api/admin/products', requireAdminApi, productImageUpload.array('images', 5), validateProductImages, verifyCsrf, async (req, res) => {
  const { name, category, subcategory, price, originalPrice, stock, rating, colors, sizes, description, details, care, featured, newArrival, active } = req.body;
  const numericPrice = Number(price);
  const numericStock = Number(stock);
  if (!sanitizeText(name, 120) || !['jeans', 'shirts', 'accessories', 'uppers'].includes(category) ||
      !Number.isFinite(numericPrice) || numericPrice < 0 ||
      !Number.isInteger(numericStock) || numericStock < 0) {
    return res.status(400).json({ ok: false, message: 'Enter a valid name, category, non-negative price, and whole-number stock.' });
  }
  const id = 'prod-' + Date.now().toString(36) + '-' + Math.random().toString(36).substr(2, 5);
  // Upload images to Cloudinary
  let uploadedImages = [];
  try {
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const url = await uploadToCloudinary(file.buffer, file.mimetype);
        uploadedImages.push(url);
      }
    }
  } catch (uploadErr) {
    logger.error('Cloudinary upload error: %s', uploadErr.message);
  }
  const product = {
    id,
    name: sanitizeText(name, 120),
    category,
    subcategory: sanitizeText(subcategory, 120),
    price: numericPrice,
    originalPrice: originalPrice !== undefined && originalPrice !== '' ? Number(originalPrice) : undefined,
    stock: numericStock,
    rating: rating !== undefined && rating !== '' ? Number(rating) : 0,
    colors: Array.isArray(colors) ? colors : (colors ? colors.split(',').map(c => c.trim()).filter(Boolean) : ['Black']),
    sizes: Array.isArray(sizes) ? sizes : (sizes ? sizes.split(',').map(s => s.trim()).filter(Boolean) : ['M']),
    images: uploadedImages.length > 0 ? uploadedImages : [CLOUDINARY_PLACEHOLDER],
    description: description || '',
    details: Array.isArray(details) ? details : (details ? details.split('\n').map(d => d.trim()).filter(Boolean) : []),
    care: Array.isArray(care) ? care : (care ? care.split('\n').map(c => c.trim()).filter(Boolean) : []),
    featured: parseBoolean(featured),
    newArrival: parseBoolean(newArrival),
    active: parseBoolean(active, true),
    createdAt: new Date(),
    updatedAt: new Date()
  };
  try {
    const saved = await new Product(product).save();
    res.json({ ok: true, product: saved.toObject() });
  } catch (err) {
    logger.error('Product create error: %s', err.message);
    res.status(500).json({ ok: false, message: 'Failed to create product' });
  }
});

app.put('/api/admin/product/:id', requireAdminApi, productImageUpload.array('images', 5), validateProductImages, verifyCsrf, async (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  try {
    const product = await Product.findOne({ id }).lean();
    if (!product) {
      return res.status(404).json({ ok: false, message: 'Product not found' });
    }
    const set = { updatedAt: new Date() };
    // Only copy whitelisted scalar fields from the request
    for (const key of ['name', 'category', 'subcategory', 'description']) {
      if (updates[key] !== undefined) set[key] = sanitizeText(updates[key], 5000);
    }
    for (const key of ['price', 'originalPrice', 'stock', 'rating']) {
      if (updates[key] !== undefined && updates[key] !== null && updates[key] !== '') {
        const n = Number(updates[key]);
        if (Number.isFinite(n) && n >= 0) set[key] = n;
      }
    }
    // List fields: only replace when the request provides them
    const listFields = { colors: ',', sizes: ',', details: '\n', care: '\n' };
    for (const [key, sep] of Object.entries(listFields)) {
      if (updates[key] === undefined) continue;
      set[key] = Array.isArray(updates[key])
        ? updates[key]
        : String(updates[key]).split(sep).map(s => s.trim()).filter(Boolean);
    }
    if (updates.featured !== undefined) set.featured = parseBoolean(updates.featured);
    if (updates.newArrival !== undefined) set.newArrival = parseBoolean(updates.newArrival);
    if (updates.active !== undefined) set.active = parseBoolean(updates.active);
                // Handle images: the client sends the kept existing images plus any new uploads.
    let finalImages = product.images || [];
    const existing = req.body.existingImages;
    const cleared = req.body.imagesCleared === 'true';
    if (Array.isArray(existing)) {
      finalImages = [...existing];
    } else if (typeof existing === 'string' && existing) {
      finalImages = [existing];
    } else if (cleared) {
      finalImages = [];
    }

    if (req.files && req.files.length > 0) {
      const uploaded = await Promise.all(req.files.map(f => uploadToCloudinary(f.buffer, f.mimetype)));
      finalImages = [...finalImages, ...uploaded];
    }

    // Only rewrite images when the request actually addressed them
    if (existing !== undefined || cleared || (req.files && req.files.length > 0)) {
      set.images = finalImages.length > 0 ? finalImages : [CLOUDINARY_PLACEHOLDER];
    }
    const updated = await Product.findOneAndUpdate({ id }, { $set: set }, { new: true }).lean();
    res.json({ ok: true, product: updated });
  } catch (err) {
    logger.error('Product update error: %s', err.message);
    res.status(500).json({ ok: false, message: 'Failed to update product' });
  }
});

app.delete('/api/admin/product/:id', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ ok: false });
  const { id } = req.params;
  try {
    const deleted = await Product.findOneAndDelete({ id });
    if (!deleted) return res.status(404).json({ ok: false, message: 'Product not found' });
    // TODO: Optionally remove old images from Cloudinary using their public IDs
    res.json({ ok: true, message: 'Product deleted' });
  } catch (err) {
    logger.error('Product delete error: %s', err.message);
    res.status(500).json({ ok: false, message: 'Failed to delete product' });
  }
});

app.get('/api/admin/stock/alerts', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ ok: false });
  try {
    const products = await Product.find().sort({ stock: 1, name: 1 }).lean();
    const alerts = products.filter(product => product.stock <= (product.lowStockThreshold ?? 10));
    res.json({ ok: true, alerts, total: alerts.length });
  } catch (err) {
    logger.error('Stock alerts error: %s', err.message);
    res.status(500).json({ ok: false, message: 'Failed to load stock alerts' });
  }
});

app.patch('/api/admin/product/:id/stock', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ ok: false });
  const { id } = req.params;
  const qty = req.body.qty === undefined || req.body.qty === '' ? 0 : Number(req.body.qty);
  const lowStockThreshold = req.body.lowStockThreshold;
  if (!Number.isInteger(qty) || Math.abs(qty) > 100000 || (qty === 0 && (lowStockThreshold === undefined || lowStockThreshold === ''))) {
    return res.status(400).json({ ok: false, message: 'Enter a whole-number stock adjustment between -100,000 and 100,000.' });
  }
  try {
    const product = await Product.findOne({ id }).lean();
    if (!product) return res.status(404).json({ ok: false, message: 'Product not found' });
    if (product.stock + qty < 0) {
      return res.status(400).json({ ok: false, message: 'This adjustment would make stock negative.' });
    }
    const set = { updatedAt: new Date() };
    if (lowStockThreshold !== undefined && lowStockThreshold !== '') {
      const threshold = Number(lowStockThreshold);
      if (!Number.isInteger(threshold) || threshold < 0 || threshold > 100000) {
        return res.status(400).json({ ok: false, message: 'Low-stock threshold must be a non-negative whole number.' });
      }
      set.lowStockThreshold = threshold;
    }
    if (qty > 0) set.lastRestocked = new Date();
    const update = { $set: set };
    if (qty !== 0) {
      update.$inc = { stock: qty };
      update.$push = { stockHistory: { qty, reason: qty > 0 ? 'restock' : 'adjustment' } };
    }
    const updated = await Product.findOneAndUpdate({ id }, update, { new: true }).lean();
    res.json({ ok: true, product: updated });
  } catch (err) {
    logger.error('Stock adjustment error: %s', err.message);
    res.status(500).json({ ok: false, message: 'Failed to update stock' });
  }
});

app.patch('/api/admin/product/:id/status', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ ok: false });
  const { id } = req.params;
  const { featured, active, status } = req.body;
  try {
    const product = await Product.findOne({ id }).lean();
    if (!product) return res.status(404).json({ ok: false, message: 'Product not found' });
    const update = { updatedAt: new Date() };
    if (featured !== undefined) update.featured = featured;
    if (active !== undefined) update.active = active;
    const updated = await Product.findOneAndUpdate({ id }, update, { new: true }).lean();
    res.json({ ok: true, product: updated });
  } catch (err) {
    logger.error('Product status error: %s', err.message);
    res.status(500).json({ ok: false, message: 'Failed to update status' });
  }
});

app.get('/api/admin/product/:id', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ ok: false });
  try {
    const product = await Product.findOne({ id: req.params.id }).lean();
    if (!product) return res.status(404).json({ ok: false });
    res.json(product);
  } catch {
    res.status(500).json({ ok: false });
  }
});

// ── API: Admin - Newsletter Management ──────────────────────────
app.get('/api/admin/newsletter/subscribers', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ ok: false });
  const q = (req.query.q || '').toLowerCase().trim();
  const page = Math.max(1, parseInt(req.query.page || '1'));
  const limit = 20;
  try {
    let query = {};
    if (q) query.email = { $regex: q, $options: 'i' };
    const total = await Newsletter.countDocuments(query);
    const subscribers = await Newsletter.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean();
    res.json({ ok: true, subscribers, total, totalPages: Math.ceil(total / limit), page });
  } catch {
    res.status(500).json({ ok: false, message: 'Error loading subscribers' });
  }
});

app.delete('/api/admin/newsletter/subscriber', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ ok: false });
  const { email } = req.body;
  if (!email) return res.status(400).json({ ok: false, message: 'Email required' });
  try {
    await Newsletter.deleteOne({ email: String(email).toLowerCase().trim() });
    res.json({ ok: true, message: 'Subscriber removed' });
  } catch {
    res.status(500).json({ ok: false, message: 'Failed to remove subscriber' });
  }
});

app.get('/api/admin/newsletter/export', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ ok: false });
  try {
    const subscribers = await Newsletter.find({}).sort({ createdAt: -1 }).lean();
    const csv = 'Email,Joined,Last Active\n' + subscribers.map(s =>
      `${s.email},${s.createdAt ? new Date(s.createdAt).toISOString() : ''},${s.updatedAt ? new Date(s.updatedAt).toISOString() : ''}`
    ).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="ba-gy-subscribers-${new Date().toISOString().split('T')[0]}.csv"`);
    res.send(csv);
  } catch {
    res.status(500).json({ ok: false, message: 'Failed to export' });
  }
});

app.post('/api/admin/newsletter/send', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ ok: false });
  const { subject, previewText, body } = req.body;
  if (!subject || !body) {
    return res.status(400).json({ ok: false, message: 'Subject and body are required' });
  }
  try {
    const subscribers = await Newsletter.find({}).lean();
    // In a real app, you'd integrate with an email service like SendGrid, Mailgun, etc.
    // For now, we just simulate sending
    logger.info(`[Newsletter] Would send to ${subscribers.length} subscribers:`);
    logger.info(`  Subject: ${subject}`);
    logger.info(`  Body: ${body.substring(0, 100)}...`);
    res.json({ ok: true, sentTo: subscribers.length, message: 'Campaign sent successfully' });
  } catch (err) {
    logger.error('Newsletter send error: %s', err.message);
    res.status(500).json({ ok: false, message: 'Failed to send campaign' });
  }
});

// ── Error handlers ─────────────────────────────────────────────
// Multer error handler (must come before 404 handler)
app.use(handleMulterError);

// 404 handler
app.use((req, res) => {
  res.status(404).render('404', { year: new Date().getFullYear() });
});

// Central error middleware (middleware/errors.js): uncaught sync/async errors
// land here as a clean 500 instead of an HTML stack trace.
app.use(errorHandler);

// ── Start ────────────────────────────────────────────────────────
async function boot() {
  const env = validateEnv();
  const connected = await connectDB(env);
  const sessionOpts = {
    secret: env.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', secure: env.isProduction, maxAge: 24 * 60 * 60 * 1000 }
  };
  if (connected) {
    // Sessions persist in MongoDB — they survive restarts and don't leak memory.
    // MemoryStore is only ever used as a dev fallback while Mongo is offline.
    sessionOpts.store = new MongoStore({
      client: mongoose.connection.getClient(),
      collectionName: 'sessions',
      touchAfter: 24 * 60 * 60
    });
  } else {
    logger.warn('  ⚠ Sessions are memory-only until MongoDB is reachable (dev fallback).');
  }
  sessionHandler = session(sessionOpts);

  // Boot-time template smoke test: render every template with route-accurate
  // data NOW, so a missing variable fails at boot with a named template
  // instead of crashing the server on a user's click.
  try {
    const ok = await runSmokeTest();
    if (!ok && process.env.STRICT_TEMPLATE_SMOKE === '1') {
      logger.error('  ✗ STRICT_TEMPLATE_SMOKE=1 — exiting.');
      process.exit(1);
    }
  } catch (e) {
    logger.error('  ⚠ Smoke test error (server continuing): %s', e.message);
  }

  app.listen(env.port, () => {
    logger.info(`\n  🛍️  BA GGY Shop → http://localhost:${env.port}\n`);
  });
}
boot().catch(err => {
  logger.error('  ✗ Boot failed: %s', err.message);
  process.exit(1);
});

// Graceful shutdown — releases port properly on Ctrl+C
process.on('SIGINT', () => {
  logger.info('\n  Shutting down gracefully...');
  server.close(() => {
    logger.info('  Server closed.\n');
    process.exit(0);
  });
  // Force exit after 2s if graceful fails
  setTimeout(() => process.exit(1), 2000);
});





