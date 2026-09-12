'use strict';
// routes/storefront.js — Phase 2 split from server.js
// Factory: register(app, d) — d is the shared dependency bundle from server.js.
module.exports = function (app, d) {
  const { Product, Order, User, Review, renderPage, getDistinctCategories, isAdmin, productRepo, stripe, imgUrl, logger, sanitizeText } = d;

// ── Routes ───────────────────────────────────────────────────────
// Storefront reads go through services/productRepo.js (Mongo with products.json
// fallback — the duplication that used to live in every route is gone).
app.get('/', async (req, res) => {
  const featured = await productRepo.listFeatured();
  renderPage(req, res, 'index', {
    activePage: 'home',
    pageTitle: 'BA GGY — Fashion That Moves With You',
    pageDescription: 'Baggy jeans, oversized tees, accessories and uppers — built to move, made to last. Free delivery over ₨3,499.',
    pageImage: '/public/images/home.png',
    // The editorial hero is the LCP element — start fetching it with the HTML.
    preloadImage: '/public/images/hero.png',
    featuredProducts: featured
  });
});

// ── SEO: robots + sitemap ────────────────────────────────────────
app.get('/robots.txt', (req, res) => {
  const base = `${req.protocol}://${req.get('host')}`;
  res.type('text/plain').send(
    'User-agent: *\n' +
    'Allow: /\n' +
    'Disallow: /admin\n' +
    'Disallow: /api/\n' +
    'Disallow: /account\n' +
    'Disallow: /cart\n' +
    'Disallow: /checkout\n' +
    'Disallow: /wishlist\n' +
    'Disallow: /orders\n' +
    '\n' +
    `Sitemap: ${base}/sitemap.xml\n`
  );
});

app.get('/sitemap.xml', async (req, res) => {
  try {
    const base = `${req.protocol}://${req.get('host')}`;
    const products = await productRepo.listActive();
    const staticPaths = [
      ['/', '1.0', 'weekly'],
      ['/shop', '0.9', 'weekly'],
      ['/jeans', '0.8', 'weekly'],
      ['/shirts', '0.8', 'weekly'],
      ['/shop/accessories', '0.8', 'weekly'],
      ['/shop/uppers', '0.8', 'weekly'],
      ['/about', '0.5', 'monthly'],
      ['/faq', '0.5', 'monthly'],
      ['/contact', '0.5', 'monthly'],
      ['/newsletter', '0.6', 'monthly']
    ];
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const today = new Date().toISOString().slice(0, 10);
    const urls = [
      ...staticPaths.map(([path, priority, changefreq]) =>
        `  <url><loc>${esc(base + path)}</loc><lastmod>${today}</lastmod><changefreq>${changefreq}</changefreq><priority>${priority}</priority></url>`),
      ...products.map((p) =>
        `  <url><loc>${esc(base + '/product/' + p.id)}</loc><lastmod>${(p.updatedAt ? new Date(p.updatedAt).toISOString() : today).slice(0, 10)}</lastmod><changefreq>weekly</changefreq><priority>0.7</priority></url>`)
    ];
    res.type('application/xml').send(
      '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      urls.join('\n') + '\n</urlset>\n'
    );
  } catch (err) {
    logger.error('Sitemap error: %s', err.message);
    res.status(500).type('text/plain').send('Sitemap unavailable');
  }
});

app.get('/shop', async (req, res) => {
  const q = String(req.query.q || '').trim();
  const category = String(req.query.category || '').trim();
  const sort = String(req.query.sort || 'featured');
  // Filtering, sorting and paging happen in the database (services/productRepo).
  // `products` stays the full active set — the sidebar uses it for counts.
  const [catalog, products] = await Promise.all([
    productRepo.listCatalog({ q, category, sort, page: req.query.page, limit: 24 }),
    productRepo.listActive()
  ]);
  const categories = getDistinctCategories(products);
  const catLabel = category ? category.charAt(0).toUpperCase() + category.slice(1) : '';
  renderPage(req, res, 'shop', {
    activePage: 'shop',
    pageTitle: q ? `Search: ${q} — BA GGY` : (catLabel ? catLabel + ' — BA GGY' : 'Shop All — BA GGY'),
    products,
    displayProducts: catalog.products,
    filtered: catalog.products,
    category,
    categories,
    catalog,
    query: q || null,
    sort
  });
});

app.get('/shop/:cat', async (req, res) => {
  const cat = req.params.cat;
  const sort = String(req.query.sort || 'featured');
  const catLabel = cat.charAt(0).toUpperCase() + cat.slice(1);
  const title = cat === 'jeans' ? 'Jeans Collection — BA GGY' : cat === 'shirts' ? 'Shirts Collection — BA GGY' : catLabel + ' — BA GGY';
  // Jeans and shirts have their own editorial pages...
  if (cat === 'jeans' || cat === 'shirts') {
    const [filtered, products] = await Promise.all([productRepo.listByCategory(cat), productRepo.listActive()]);
    const categories = getDistinctCategories(products);
    renderPage(req, res, cat, { activePage: 'shop', pageTitle: title, products, filtered, categories });
    return;
  }
  // ...everything else (accessories, uppers) uses the shop grid with the
  // category pinned on, so sorting and paging work there too.
  const [catalog, products] = await Promise.all([
    productRepo.listCatalog({ category: cat, sort, page: req.query.page, limit: 24 }),
    productRepo.listActive()
  ]);
  const categories = getDistinctCategories(products);
  renderPage(req, res, 'shop', {
    activePage: 'shop',
    pageTitle: title,
    products,
    displayProducts: catalog.products,
    filtered: catalog.products,
    category: cat,
    categories,
    catalog,
    query: null,
    sort
  });
});

app.get('/product/:id', async (req, res) => {
  const product = await productRepo.getById(req.params.id);
  if (!product) return res.status(404).render('404', { year: new Date().getFullYear() });
  const products = await productRepo.listRelated(product, 4);
  const canonical = `${req.protocol}://${req.get('host')}/product/${product.id}`;
  // Product structured data (rich results): price, stock and live rating.
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: product.description,
    sku: product.id,
    category: product.category,
    brand: { '@type': 'Brand', name: 'BA GGY' },
    image: (product.images || []).map(imgUrl),
    offers: {
      '@type': 'Offer',
      url: canonical,
      priceCurrency: 'PKR',
      price: product.price,
      availability: product.stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      itemCondition: 'https://schema.org/NewCondition'
    },
    ...(product.reviewCount ? {
      aggregateRating: {
        '@type': 'AggregateRating',
        ratingValue: product.rating,
        reviewCount: product.reviewCount
      }
    } : {})
  };
  renderPage(req, res, 'product', {
    activePage: 'product',
    bodyClass: 'page-product',
    product,
    products,
    pageTitle: product.name + ' — BA GGY',
    pageDescription: product.description,
    pageImage: product.images && product.images[0] ? imgUrl(product.images[0]) : undefined,
    preloadImage: product.images && product.images[0] ? imgUrl(product.images[0]) : undefined,
    structuredData,
    reviews: (product.reviews || []).filter(r => r.status === 'approved').sort((a, b) => b.createdAt - a.createdAt)
  });
});

app.get('/jeans', async (req, res) => {
  const cat = 'jeans';
  const [filtered, products] = await Promise.all([productRepo.listByCategory(cat), productRepo.listActive()]);
  const categories = getDistinctCategories(products);
  renderPage(req, res, 'jeans', { activePage: 'shop', pageTitle: 'Jeans Collection — BA GGY', products, filtered, categories });
});

// ── Reviews API (storefront) ──────────────────────────────────────
// POST /api/reviews — submit a review for a product. Authenticated users get a
// verifiedPurchase flag; guests are recorded by IP and held as pending.
app.post('/api/reviews', async (req, res) => {
  const body = req.body || {};
  const { productId, rating, text, name } = body;
  if (!productId || !rating || !text) {
    return res.status(400).json({ ok: false, message: 'Product, rating and review text are required.' });
  }
  const n = Number(rating);
  if (!Number.isInteger(n) || n < 1 || n > 5) {
    return res.status(400).json({ ok: false, message: 'Rating must be a whole number between 1 and 5.' });
  }
  try {
    const product = await Product.findOne({ id: productId }).lean();
    if (!product) return res.status(404).json({ ok: false, message: 'Product not found.' });
    if (product.active === false) return res.status(400).json({ ok: false, message: 'This product is no longer available.' });
    const user = req.session?.user;
    const review = new Review({
      productId,
      name: user ? user.name : (sanitizeText(name, 80) || 'Anonymous Customer'),
      text: sanitizeText(String(text), 2000),
      rating: n,
      verifiedPurchase: Boolean(user),
      status: 'approved',
      authorIp: req.ip || '',
      userEmail: user ? user.email : undefined
    });
    await review.save();
    // Recompute the product's cached rating from all approved reviews.
    await recomputeProductRating(productId);
    res.json({ ok: true, message: 'Review posted. It may take a moment to appear.' });
  } catch (err) {
    logger.error('Review submission error: %s', err.message);
    res.status(500).json({ ok: false, message: 'Could not post your review. Please try again.' });
  }
});

// Recompute a product's rating from its approved reviews and persist it.
async function recomputeProductRating(productId) {
  const agg = await Review.aggregate([
    { $match: { productId, status: 'approved' } },
    { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } }
  ]);
  const next = agg.length ? { rating: Math.round((agg[0].avg || 0) * 10) / 10, reviewCount: agg[0].count } : { rating: 0, reviewCount: 0 };
  await Product.findOneAndUpdate({ id: productId }, { $set: { rating: next.rating, reviewCount: next.reviewCount } }, { setDefaultsOnInsert: false });
}

app.get('/shirts', async (req, res) => {
  const cat = 'shirts';
  const [filtered, products] = await Promise.all([productRepo.listByCategory(cat), productRepo.listActive()]);
  const categories = getDistinctCategories(products);
  renderPage(req, res, 'shirts', { activePage: 'shop', pageTitle: 'Shirts Collection — BA GGY', products, filtered, categories });
});

app.get('/cart', (req, res) => renderPage(req, res, 'cart', { activePage: 'cart', pageTitle: 'Your Cart — BA GGY' }));
app.get('/checkout', (req, res) => renderPage(req, res, 'checkout', {
  activePage: 'checkout',
  pageTitle: 'Checkout — BA GGY',
  // Card option only appears when the Stripe gateway is actually configured
  cardPaymentsEnabled: Boolean(stripe && stripe.isConfigured()),
  paymentCancelled: req.query.payment === 'cancelled'
}));

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
  const q = String(req.query.q || '').trim();
  const catFilter = String(req.query.category || '').trim();
  const sort = String(req.query.sort || 'featured');
  // `products` is the result set on this page (the template counts by category).
  const catalog = await productRepo.listCatalog({ q, category: catFilter, sort, page: req.query.page, limit: 24 });
  renderPage(req, res, 'search', {
    activePage: 'shop',
    pageTitle: q ? `Search: ${q} — BA GGY` : 'Search — BA GGY',
    products: catalog.products,
    query: q || null,
    categoryFilter: catFilter || null,
    catalog,
    sort
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
