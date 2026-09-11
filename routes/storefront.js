'use strict';
// routes/storefront.js — Phase 2 split from server.js
// Factory: register(app, d) — d is the shared dependency bundle from server.js.
module.exports = function (app, d) {
  const { Product, Order, User, renderPage, getDistinctCategories, isAdmin, productRepo } = d;

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

app.get('/contact/thankyou', (req, res) => {
  renderPage(req, res, 'contact-thankyou', {
    activePage: 'contact',
    pageTitle: 'Message Sent — BA GGY'
  });
});
};
