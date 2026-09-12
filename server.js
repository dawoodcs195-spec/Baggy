require('dotenv').config();
const express    = require('express');
const path       = require('path');
const helmet     = require('helmet');
const compression = require('compression');
const cors       = require('cors');
const fs         = require('fs');
const mongoose   = require('mongoose');
const ejs        = require('ejs');
const cloudinaryService = require('./services/cloudinary');
cloudinaryService.configure();

const Product    = require('./models/Product');
const Order      = require('./models/Order');
const Wishlist   = require('./models/Wishlist');
const User       = require('./models/User');
const Settings   = require('./models/Settings');
const Coupon     = require('./models/Coupon');
const Review     = require('./models/Review');
const { runSmokeTest } = require('./scripts/smoke-templates');
const { Contact, Newsletter, OrderMessage } = require('./models/Newsletter');

const session = require('express-session');
const MongoStore = require('connect-mongo');
const { validateEnv } = require('./config/env');
const connectDB = require('./config/db');
const { getCsrfToken, verifyCsrf } = require('./middleware/csrf');
const { validatePassword } = require('./utils/password');
const { isValidEmail, sanitizeText, escapeRegex, parseBoolean } = require('./utils/sanitize');
const { imgUrl, getDistinctCategories, sessionUser, ORDER_STATUSES, trackingStepsFor, CLOUDINARY_PLACEHOLDER, normalizeQty } = require('./utils/helpers');
const { ADMIN_EMAILS, isAdmin, requireAdminApi } = require('./middleware/auth');
const { globalLimiter, checkoutLimiter, couponLimiter, contactLimiter, authLimiter, passwordResetLimiter } = require('./middleware/rateLimiters');
const { asyncHandler, errorHandler } = require('./middleware/errors');
const productRepo = require('./services/productRepo');
const logger = require('./services/logger');
const email = require('./services/email');
const stripe = require('./services/stripe');
const checkoutRoutes = require('./routes/checkout');

const app = express();
let server; // assigned in boot() — used by the SIGINT handler for graceful shutdown

// Behind a reverse proxy this makes req.protocol reflect the real scheme, so
// canonical URLs and Stripe redirects are https in production.
app.set('trust proxy', 1);


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
// gzip/brotli-style compression for responses over 1 KB. Placed before static so
// HTML *and* CSS/JS ship compressed; images are already compressed formats and
// are skipped by the threshold.
app.use(compression({ threshold: 1024 }));

// Static files first: images/CSS/JS must not consume the global rate-limit budget
// or create sessions (memory + latency) on every asset request.
app.use('/public', express.static(path.join(__dirname, 'public'), { maxAge: '7d', immutable: true }));

app.use(globalLimiter);
const isProduction = process.env.NODE_ENV === 'production';
app.use(cors({ origin: isProduction ? false : true, credentials: true }));

// ── Helpers ───────────────────────────────────────────────────────
// (isValidEmail / sanitizeText / escapeRegex / parseBoolean live in utils/sanitize.js;
//  fmt / imgUrl / getDistinctCategories / sessionUser / order tracking live in utils/helpers.js)

// ── Shared dependency bundle ─────────────────────────────────────
// Every routes/* module is a factory: (app, d). Defined up here (before the body
// parsers) so the Stripe webhook can be mounted ahead of express.json().
const d = {
  Product, Order, Wishlist, User, Settings, Coupon, Newsletter, Contact, OrderMessage, Review,
  renderPage, imgUrl, getDistinctCategories, sessionUser, ORDER_STATUSES, trackingStepsFor,
  CLOUDINARY_PLACEHOLDER, normalizeQty,
  sanitizeText, isValidEmail, escapeRegex, parseBoolean, validatePassword,
  isAdmin, requireAdminApi, verifyCsrf, asyncHandler, getCsrfToken,
  checkoutLimiter, couponLimiter, contactLimiter, authLimiter, passwordResetLimiter,
  productRepo, logger, email, stripe,
  productImageUpload: cloudinaryService.productImageUpload,
  validateProductImages: cloudinaryService.validateProductImages,
  uploadToCloudinary: cloudinaryService.uploadToCloudinary,
  ADMIN_EMAILS
};

// ── Stripe webhook (raw body) ────────────────────────────────────
// MUST be mounted before express.json(): Stripe signs the raw request bytes, so
// this route has to claim the stream first to verify the signature.
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), (req, res) =>
  checkoutRoutes.stripeWebhook(req, res, d)
);

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));


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
    page,
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
    // SEO defaults — routes can override any of these per page.
    canonicalUrl: `${req.protocol}://${req.get('host')}${String(req.originalUrl || '/').split('?')[0]}`,
    // Never let search engines index admin screens or private/transactional pages.
    noIndex: /^admin/.test(page) || [
      '404', 'cart', 'checkout', 'checkout-success', 'account', 'login', 'register',
      'orders', 'forgot-password', 'reset-password', 'track', 'contact-thankyou'
    ].includes(page),
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

// ── Routes (split from the monolith — Phase 2) ─────────────────
// The shared dependency bundle `d` is defined above, next to the body parsers.
require('./routes/storefront')(app, d);
require('./routes/api')(app, d);
require('./routes/cart')(app, d);
require('./routes/checkout')(app, d);
require('./routes/auth')(app, d);
require('./routes/admin')(app, d);
require('./routes/order-chat')(app, d);

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

// ── Error handlers ─────────────────────────────────────────────
// Multer error handler (must come before 404 handler)
app.use(cloudinaryService.handleMulterError);

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

    // Skip listening in test mode — Supertest handles this internally
  if (process.env.NODE_ENV !== 'test') {
    server = app.listen(env.port, () => {
      logger.info(`\n  🛍️  BA GGY Shop → http://localhost:${env.port}\n`);
    });
  }
}

// Export app + boot for testing (Supertest); boot() not called on import
module.exports = { app, boot, get server() { return server; } };

// Only boot when run directly (not when imported by tests / CI)
if (require.main === module) {
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
}






