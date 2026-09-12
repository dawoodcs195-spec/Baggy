// Boot-time template smoke test — renders every template with route-accurate
// data so a missing variable fails AT BOOT with a named template, not on a
// user's click inside a live server.
//
// Called from server.js after the DB connect attempt. Behavior:
//   - failures are printed with template name + first error line
//   - SKIP_TEMPLATE_SMOKE=1 skips entirely (fast dev restarts)
//   - set STRICT_TEMPLATE_SMOKE=1 to make failures exit the process (CI)
'use strict';
const fs = require('fs');
const path = require('path');

// Route-accurate variable sets, mirroring what each route actually passes
// (plus renderPage's base defaults, applied to every template).
function baseVars() {
  return {
    year: new Date().getFullYear(),
    assetV: 'smoke',
    pageTitle: 'BA GGY — Fashion That Moves With You',
    bodyClass: '',
    category: '',
    filtered: null,
    pageCss: null,
    pageJs: null,
    cart: [],
    cartCount: 0,
    wishlist: [],
    wishlistCount: 0,
    user: null,
    csrfToken: 'smoke-csrf',
    activePage: '',
    path: '/',
    query: {},
    body: '<div></div>',
    imgUrl: (src) => {
      const s = String(src || '').trim();
      if (!s) return '/public/images/placeholder.png';
      if (s.startsWith('http://') || s.startsWith('https://') || s.startsWith('/')) return s;
      return '/public/images/' + s;
    }
  };
}

// Shared empty page of catalog results — mirrors services/productRepo.listCatalog().
const catalogStub = { products: [], total: 0, page: 1, pages: 1, perPage: 24, from: 0, to: 0, hasPrev: false, hasNext: false };

const user = { id: 'u1', name: 'Smoke User', email: 'smoke@baggy.pk', role: 'admin' };

const routeData = {
  index: { activePage: 'home', featuredProducts: [] },
  shop: { activePage: 'shop', pageTitle: 'Shop All — BA GGY', products: [], displayProducts: [], filtered: [], category: '', categories: [], sort: 'featured', query: null, catalog: catalogStub },
  jeans: { activePage: 'shop', pageTitle: 'Jeans — BA GGY', products: [], filtered: [], categories: [] },
  shirts: { activePage: 'shop', pageTitle: 'Shirts — BA GGY', products: [], filtered: [], categories: [] },
  product: { activePage: 'product', product: { id: 'x', name: 'Smoke Product', price: 1000, images: [], sizes: ['M'], details: ['Detail one'], colors: ['Black'], description: '', category: 'jeans', subcategory: 'baggy', rating: 0, reviewCount: 0, reviews: [] }, products: [], pageTitle: 'Product — BA GGY', user: user },
  cart: { activePage: 'cart', pageTitle: 'Your Cart — BA GGY' },
  checkout: { activePage: 'checkout', pageTitle: 'Checkout — BA GGY' },
  'checkout-success': { activePage: 'checkout', pageTitle: 'Order Confirmed — BA GGY', order: null, showOrderDetails: false },
  contact: { activePage: 'contact', pageTitle: 'Contact Us — BA GGY' },
  'contact-thankyou': { activePage: 'contact', pageTitle: 'Message Sent — BA GGY' },
  'forgot-password': { activePage: '', pageTitle: 'Forgot Password — BA GGY' },
  'reset-password': { activePage: '', pageTitle: 'Reset Password — BA GGY', resetToken: 't', resetEmail: 'e@e.com' },
  about: { activePage: 'about', pageTitle: 'About Us — BA GGY' },
  faq: { activePage: 'faq', pageTitle: 'FAQ — BA GGY' },
  track: { activePage: 'track', pageTitle: 'Track Your Order — BA GGY', orderId: '' },
  wishlist: { activePage: 'wishlist', pageTitle: 'Wishlist — BA GGY' },
  orders: { activePage: 'account', pageTitle: 'My Orders — BA GGY', orders: [] },
  login: { activePage: 'account', pageTitle: 'Sign In — BA GGY' },
  register: { activePage: 'account', pageTitle: 'Create Account — BA GGY' },
  account: { activePage: 'account', pageTitle: 'My Account — BA GGY', orders: [] },
  newsletter: { activePage: 'newsletter', pageTitle: 'Newsletter — BA GGY' },
  search: { activePage: 'shop', pageTitle: 'Search — BA GGY', products: [], query: null, categoryFilter: null, sort: 'featured', catalog: catalogStub },
  order: { activePage: 'order', order: { orderId: 'BG-SMOKE', items: [], customer: { name: 'x', email: 'x@x.com', phone: 'x', address: 'x' }, subtotal: 0, discount: 0, couponCode: null, shipping: 0, total: 0, payment: 'cod', status: 'confirmed', trackingSteps: [] }, pageTitle: 'Order — BA GGY' },
  '404': {},
  'admin-index': { activePage: 'admin', pageTitle: 'Admin — BA GGY', user, totalOrders: 0, totalProducts: 0, newsletterToday: 0, totalRevenue: 0, deliveredOrders: 0, shippedOrders: 0, processingOrders: 0, confirmedOrders: 0, pendingOrders: 0, cancelledOrders: 0, recentOrders: [], topProducts: [], totalCoupons: 0, activeCoupons: 0, couponAnalytics: { ordersWithCoupon: 0, totalDiscount: 0, influencedRevenue: 0, top: [] } },
  'admin-orders': { activePage: 'admin', pageTitle: 'Orders — Admin', user, orders: [], page: 1, totalPages: 0, total: 0, statusFilter: '' },
  'admin-products': { activePage: 'admin', pageTitle: 'Products — Admin', user, products: [], page: 1, totalPages: 0, total: 0, totalProducts: 0 },
  'admin-inventory': { activePage: 'admin', pageTitle: 'Inventory — Admin', user, products: [], lowStockProducts: [], totalProducts: 0, totalOrders: 0 },
  'admin-product-detail': { activePage: 'admin', pageTitle: 'Product — Admin', user, product: { id: 'x', name: 'Smoke Product', price: 1000, images: [], sizes: ['M'], stock: 5, category: 'jeans', subcategory: 'baggy', stockHistory: [] }, reviews: [], productNames: {} },
  'admin-order-detail': { activePage: 'admin', pageTitle: 'Order — Admin', user, order: { orderId: 'BG-SMOKE', items: [], customer: { name: 'x', email: 'x@x.com', phone: 'x', address: 'x' }, subtotal: 0, discount: 0, couponCode: null, shipping: 0, total: 0, payment: 'cod', status: 'confirmed', trackingSteps: [] }, csrfToken: 'smoke-csrf' },
  'admin-newsletter': { activePage: 'admin', pageTitle: 'Newsletter — Admin', user, subscribers: [], page: 1, totalPages: 0, total: 0, totalSubscribers: 0, todaySubscribers: 0, weekSubscribers: 0 },
  'admin-users': { activePage: 'admin', pageTitle: 'Users — Admin', user, users: [], ordersByUser: {}, page: 1, totalPages: 0, totalUsers: 0 },
  'admin-contacts': { activePage: 'admin', pageTitle: 'Contacts — Admin', user, messages: [], page: 1, totalPages: 0, totalMessages: 0, newMessages: 0, statusFilter: '' },
  'admin-settings': { activePage: 'admin', pageTitle: 'Settings — Admin', user, settings: {}, success: null, error: null },
  'admin-coupons': { activePage: 'admin', pageTitle: 'Coupons — Admin', user, coupons: [], page: 1, totalPages: 0, total: 0 }
};

async function runSmokeTest() {
  if (process.env.SKIP_TEMPLATE_SMOKE === '1') {
    console.log('  ⏭ Template smoke test skipped (SKIP_TEMPLATE_SMOKE=1)');
    return true;
  }
  const ejs = require('ejs');
  const viewsDir = path.join(__dirname, '..', 'views');
  const allViews = fs.readdirSync(viewsDir).filter(f => f.endsWith('.ejs')).map(f => f.replace(/\.ejs$/, ''));
  const layoutSrc = fs.readFileSync(path.join(viewsDir, 'layout.ejs'), 'utf8');

  const failures = [];
  const untested = [];
  for (const tpl of allViews) {
    const data = routeData[tpl];
    if (!data) { untested.push(tpl); continue; }
    try {
      const inner = await ejs.renderFile(path.join(viewsDir, tpl + '.ejs'), { ...baseVars(), ...data, user: data.user || user }, { async: true });
      await ejs.render(layoutSrc, { ...baseVars(), ...data, user: data.user || user, body: inner }, { async: true });
    } catch (err) {
      failures.push({ tpl, error: err.message.split('\n')[0] });
    }
  }

  if (untested.length) {
    console.log(`  ⚠ No route data defined for: ${untested.join(', ')} (partials/includes are fine if only used via other templates)`);
  }
  if (failures.length) {
    console.error('\n  ✗ TEMPLATE SMOKE TEST FAILED — these pages would crash on visit:\n');
    failures.forEach(f => console.error(`      ${f.tpl}.ejs → ${f.error}`));
    console.error('\n  Fix the routes/templates above. Set SKIP_TEMPLATE_SMOKE=1 to bypass (not recommended).\n');
    if (process.env.STRICT_TEMPLATE_SMOKE === '1') return false;
    return false; // always report failure; caller decides process behavior
  }
  console.log(`  ✓ Template smoke test passed (${allViews.length - untested.length} templates rendered)`);
  return true;
}

module.exports = { runSmokeTest };

// CLI: node scripts/smoke-templates.js
if (require.main === module) {
  (async () => {
    const ok = await runSmokeTest();
    process.exit(ok ? 0 : 1);
  })();
}
