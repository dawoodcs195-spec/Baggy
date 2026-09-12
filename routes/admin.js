'use strict';
// routes/admin.js — Phase 2 split from server.js
// Factory: register(app, d) — d is the shared dependency bundle from server.js.
module.exports = function (app, d) {
  const { Product, Order, User, Settings, Coupon, Newsletter, Contact, OrderMessage, Review, renderPage, isAdmin, requireAdminApi, escapeRegex, sanitizeText, isValidEmail, parseBoolean, ORDER_STATUSES, trackingStepsFor, sessionUser, CLOUDINARY_PLACEHOLDER, productImageUpload, validateProductImages, verifyCsrf, uploadToCloudinary, logger, email } = d;

// Enable/disable a coupon without deleting it.
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
    const reviews = await Review.find({ productId: req.params.id }).sort({ createdAt: -1 }).lean();
    const productNames = { [req.params.id]: product.name };
    renderPage(req, res, 'admin-product-detail', {
      activePage: 'admin',
      pageTitle: product.name + ' — Admin',
      user: req.session.user,
      product,
      reviews,
      productNames
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
    const previousStatus = order.status;
    order.status = status;
    order.trackingSteps = trackingStepsFor(status, order.createdAt);
    await order.save();
    // Tell the customer, but only on a real change (the admin UI can re-post the
    // same status). Fire-and-forget: email trouble never fails the update.
    if (email && previousStatus !== status) {
      email.sendOrderStatus(order.toObject(), status).catch(() => {});
    }
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
    // If the admin touched rating/stock directly, recompute from reviewed data where
    // sensible — but never overwrite a manually-set rating with a recompute when the
    // product has no reviews (keep the existing value).
    if (set.rating === undefined && updated.reviewCount > 0) {
      try {
        const agg = await Review.aggregate([
          { $match: { productId: id, status: 'approved' } },
          { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } }
        ]);
        if (agg.length) {
          await Product.findOneAndUpdate({ id }, { $set: { rating: Math.round((agg[0].avg || 0) * 10) / 10 } });
        }
      } catch (err) { logger.warn('Review rating recompute on save failed: %s', err.message); }
    }
    res.json({ ok: true, product: await Product.findOne({ id }).lean() });
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

// ── Review moderation (admin) ──────────────────────────────────
app.get('/api/admin/reviews', requireAdminApi, async (req, res) => {
  try {
    let { status, productId } = req.query;
    const query = {};
    if (status) query.status = status;
    if (productId) query.productId = productId;
    const reviews = await Review.find(query).sort({ createdAt: -1 }).lean();
    const productMap = {};
    for (const r of reviews) {
      if (!productMap[r.productId]) {
        const p = await Product.findOne({ id: r.productId }).lean();
        productMap[r.productId] = p ? p.name : r.productId;
      }
    }
    res.json({ ok: true, reviews, productNames: productMap });
  } catch (err) {
    logger.error('Review list error: %s', err.message);
    res.status(500).json({ ok: false, message: 'Failed to load reviews' });
  }
});

app.patch('/api/admin/reviews/:id/status', requireAdminApi, async (req, res) => {
  const { status } = req.body || {};
  if (!['approved', 'hidden'].includes(status)) {
    return res.status(400).json({ ok: false, message: 'Status must be approved or hidden.' });
  }
  try {
    const review = await Review.findById(req.params.id);
    if (!review) return res.status(404).json({ ok: false, message: 'Review not found' });
    review.status = status;
    await review.save();
    await recomputeProductRating(review.productId);
    res.json({ ok: true, review: review.toObject() });
  } catch (err) {
    logger.error('Review status error: %s', err.message);
    res.status(500).json({ ok: false, message: 'Failed to update review' });
  }
});

app.delete('/api/admin/reviews/:id', requireAdminApi, async (req, res) => {
  try {
    const review = await Review.findByIdAndDelete(req.params.id);
    if (!review) return res.status(404).json({ ok: false, message: 'Review not found' });
    await recomputeProductRating(review.productId);
    res.json({ ok: true, message: 'Review deleted' });
  } catch (err) {
    logger.error('Review delete error: %s', err.message);
    res.status(500).json({ ok: false, message: 'Failed to delete review' });
  }
});

function recomputeProductRating(productId) {
  return Review.aggregate([
    { $match: { productId, status: 'approved' } },
    { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } }
  ]).then(agg => {
    if (!agg.length) return null;
    return Product.findOneAndUpdate(
      { id: productId },
      { $set: { rating: Math.round((agg[0].avg || 0) * 10) / 10, reviewCount: agg[0].count } },
      { setDefaultsOnInsert: false }
    );
  });
}

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

// -- Export orders: Excel (CSV) ------------------------------
app.get("/admin/orders/export", d.asyncHandler(async (req, res) => {
  if (!isAdmin(req)) return res.status(403).send("Forbidden");
  const statusFilter = String(req.query.status || "").trim();
  const match = statusFilter ? { status: statusFilter } : {};
  const orders = await Order.find(match).sort({ createdAt: -1 }).lean();

  const esc = (v) => {
    const s = String(v == null ? "" : v).replace(/"/g, '""');
    return /[",\n]/.test(s) ? `"${s}"` : s;
  };
  const rows = [["Order ID","Date","Customer","Email","Phone","Items","Subtotal","Discount","Shipping","Total","Payment","Status"]];
  for (const o of orders) {
    const items = (o.items || []).map((i) => `${i.name}(${i.size})x${i.qty}`).join("; ");
    rows.push([
      o.orderId, new Date(o.createdAt).toISOString().slice(0,10),
      o.customer?.name, o.customer?.email, o.customer?.phone,
      items, o.subtotal, o.discount || 0, o.shipping, o.total, o.payment, o.status
    ]);
  }
  const csv = rows.map((r) => r.map(esc).join(",")).join("\r\n");
  const name = `baggy-orders-${new Date().toISOString().slice(0,10)}.csv`;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
  res.send("?" + csv); // BOM so Excel reads UTF-8
}));

// -- Print-friendly orders page (Save as PDF) ----------------
app.get("/admin/orders/print", d.asyncHandler(async (req, res) => {
  if (!isAdmin(req)) return res.status(403).render("404", { year: new Date().getFullYear() });
  const statusFilter = String(req.query.status || "").trim();
  const match = statusFilter ? { status: statusFilter } : {};
  const orders = await Order.find(match).sort({ createdAt: -1 }).lean();
  const total = orders.length;
  const year = new Date().getFullYear();

  const itemRows = (items) => (items || []).map((i) =>
    `<tr><td>${(i.name||"").replace(/</g,"&lt;")}</td><td>${i.size||""}</td><td>${i.qty||1}</td><td>?${(i.price||0).toLocaleString("en-PK")}</td></tr>`
  ).join("");

  const orderCards = orders.map((o) => `
    <div class="po-order">
      <div class="po-head">
        <div><strong>#${o.orderId}</strong> <span class="po-date">${new Date(o.createdAt).toLocaleString("en-PK")}</span></div>
        <span class="po-status po-${o.status}">${(o.status||"").toUpperCase()}</span>
      </div>
      <div class="po-customer">${(o.customer?.name||"").replace(/</g,"&lt;")} � ${(o.customer?.email||"").replace(/</g,"&lt;")} � ${(o.customer?.phone||"").replace(/</g,"&lt;")}</div>
      <table class="po-table"><thead><tr><th>Item</th><th>Size</th><th>Qty</th><th>Price</th></tr></thead>
      <tbody>${itemRows(o.items)}</tbody></table>
      <div class="po-totals">
        <span>Subtotal: <strong>?${(o.subtotal||0).toLocaleString("en-PK")}</strong></span>
        <span>Discount: <strong>?${(o.discount||0).toLocaleString("en-PK")}</strong></span>
        <span>Shipping: <strong>${o.shipping ? "?"+o.shipping.toLocaleString("en-PK") : "Free"}</strong></span>
        <span>Total: <strong>?${(o.total||0).toLocaleString("en-PK")}</strong></span>
        <span>Payment: <strong>${(o.payment||"").toUpperCase()}</strong></span>
      </div>
    </div>`).join("");

  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Orders � BA GGY</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#0a0a0a;padding:32px;font-size:12px}
  h1{font-family:Georgia,serif;letter-spacing:0.1em;margin-bottom:4px}
  .po-meta{color:#666;margin-bottom:24px}
  .po-order{border:1px solid #ddd;padding:16px;margin-bottom:16px;page-break-inside:avoid;border-radius:4px}
  .po-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}
  .po-date{color:#666;font-size:11px}
  .po-status{font-size:10px;font-weight:700;padding:2px 8px;border-radius:2px;text-transform:uppercase;background:#eee}
  .po-delivered{background:#16a34a;color:#fff}.po-shipped{background:#2563eb;color:#fff}.po-cancelled{background:#b8002f;color:#fff}
  .po-processing{background:#d97706;color:#fff}.po-confirmed{background:#7c3aed;color:#fff}.po-pending{background:#6b7280;color:#fff}
  .po-customer{color:#666;font-size:11px;margin-bottom:10px}
  .po-table{width:100%;border-collapse:collapse;margin-bottom:10px}
  .po-table th,.po-table td{border-bottom:1px solid #eee;padding:4px 8px;text-align:left;font-size:11px}
  .po-table th{border-bottom:2px solid #0a0a0a;font-weight:600}
  .po-totals{display:flex;gap:16px;flex-wrap:wrap;border-top:1px solid #eee;padding-top:8px;font-size:11px}
  .po-totals strong{display:block;font-size:13px}
  @media print{body{padding:16px}.po-order{break-inside:avoid}}
</style></head><body>
<h1>BA GGY</h1>
<div class="po-meta">${total} order(s)${statusFilter ? " � status: "+statusFilter : ""} � printed ${new Date().toLocaleString("en-PK")}</div>
${orderCards}
<script>window.onload=function(){window.print()}</script>
</body></html>`;

  res.type("html").send(html);
}));
};
