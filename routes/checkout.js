'use strict';
// routes/checkout.js — Phase 2 split from server.js
// Factory: register(app, d) — d is the shared dependency bundle from server.js.
module.exports = function (app, d) {
  // NOTE: the service is bound as `mailer` because the /api/checkout handler
  // destructures the customer's `email` string from req.body.
  const { Product, Order, Coupon, renderPage, isValidEmail, sanitizeText, normalizeQty, trackingStepsFor, checkoutLimiter, couponLimiter, logger, email: mailer, stripe } = d;

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
      // Confirmation email is fire-and-forget: a mail outage must never fail an
      // order that is already saved (services/email.js never rejects).
      if (mailer) mailer.sendOrderConfirmation(saved.toObject()).catch(() => {});
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

// ── API: Card checkout (Stripe hosted Checkout) ──────────────────
// The order is created UNPAID and no stock is deducted until Stripe confirms
// payment, so a card order is never fulfilled on the browser's word alone.
app.post('/api/stripe/checkout', checkoutLimiter, async (req, res) => {
  if (!stripe || !stripe.isConfigured()) {
    return res.status(503).json({ ok: false, message: 'Card payments are unavailable right now — please choose cash on delivery.' });
  }
  const { name, phone, address } = req.body;
  const buyerEmail = req.body.email;
  const couponCode = String(req.body.couponCode || '').trim().toUpperCase();
  if (!name || !buyerEmail || !phone || !address) {
    return res.status(400).json({ ok: false, message: 'Please fill in all required fields' });
  }
  if (!isValidEmail(buyerEmail)) return res.status(400).json({ ok: false, message: 'Please enter a valid email address' });
  const cart = req.session.cart || [];
  if (!cart.length) return res.status(400).json({ ok: false, message: 'Cart is empty' });
  for (const item of cart) {
    if (!item.productId || !item.size || !normalizeQty(item.qty)) {
      return res.status(400).json({ ok: false, message: 'Cart contains invalid items' });
    }
  }
  try {
    // Prices and totals come from the catalog — the browser is never trusted.
    const requestedQty = new Map();
    for (const item of cart) requestedQty.set(item.productId, (requestedQty.get(item.productId) || 0) + item.qty);
    const products = await Product.find({ id: { $in: [...requestedQty.keys()] }, active: { $ne: false } }).lean();
    const byId = new Map(products.map(p => [p.id, p]));
    if (byId.size !== requestedQty.size) {
      return res.status(400).json({ ok: false, message: 'One or more cart items are no longer available' });
    }
    for (const [id, qty] of requestedQty) {
      const product = byId.get(id);
      if (product.stock < qty) {
        return res.status(409).json({ ok: false, message: `${product.name} does not have enough stock available` });
      }
    }
    const items = cart.map(item => {
      const product = byId.get(item.productId);
      return {
        productId: product.id,
        name: product.name,
        image: product.images?.[0] || 'placeholder.png',
        size: item.size,
        qty: item.qty,
        price: product.price
      };
    });
    const subtotal = items.reduce((sum, item) => sum + item.price * item.qty, 0);
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
    const discounted = subtotal - discount;
    const shipping = discounted >= 3499 ? 0 : 299;
    const orderId = 'BG-' + Date.now().toString(36).toUpperCase();
    const order = new Order({
      orderId,
      items,
      customer: {
        name: sanitizeText(name, 500),
        email: String(buyerEmail).toLowerCase().trim(),
        phone: sanitizeText(phone, 500),
        address: sanitizeText(address, 500)
      },
      payment: 'card',
      paymentStatus: 'unpaid',
      subtotal,
      discount,
      couponCode: appliedCoupon?.code,
      shipping,
      total: discounted + shipping,
      status: 'pending',
      trackingSteps: trackingStepsFor('pending', new Date())
    });

    const base = (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
    const session = await stripe.createCheckoutSession({
      orderId,
      items,
      shipping,
      discount,
      customerEmail: order.customer.email,
      successUrl: `${base}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${base}/checkout?payment=cancelled`,
      metadata: { orderId }
    });
    order.stripeSessionId = session.id;
    await order.save();
    res.json({ ok: true, url: session.url, orderId });
  } catch (err) {
    logger.error('Stripe checkout error: %s', err.message);
    res.status(500).json({ ok: false, message: 'Could not start card payment. Please try again or choose cash on delivery.' });
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

// ── API: Checkout confirmation + Stripe reconciliation ───────────
// Returning from Stripe carries ?session_id=…; the session is fetched from
// Stripe (not trusted from the query string) and a paid session fulfils the
// order. Idempotent, so it is safe alongside the webhook.
app.get('/checkout/success', async (req, res) => {
  let lastOrder = req.session.lastOrder || null;
  const sessionId = String(req.query.session_id || '').trim();
  if (sessionId && stripe && stripe.isConfigured()) {
    try {
      const session = await stripe.retrieveCheckoutSession(sessionId);
      const orderId = session.client_reference_id || (session.metadata && session.metadata.orderId);
      if (orderId) {
        let order = await Order.findOne({ orderId });
        if (order && session.payment_status === 'paid') {
          await confirmStripeOrder(d, order, session);
          order = await Order.findOne({ orderId });
        }
        if (order) {
          lastOrder = order.toObject();
          req.session.lastOrder = lastOrder;
          req.session.cart = [];
        }
      }
    } catch (err) {
      logger.error('Stripe success reconciliation failed: %s', err.message);
    }
  }
  renderPage(req, res, 'checkout-success', {
    activePage: 'checkout',
    pageTitle: 'Order Confirmed — BA GGY',
    order: lastOrder,
    showOrderDetails: !!lastOrder
  });
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
};

// ── Stripe fulfilment helpers ────────────────────────────────────
// Module scope (not inside the factory) so server.js can mount the webhook
// route early — before express.json() consumes the raw request stream that
// signature verification needs.

/**
 * Fulfil a card order once Stripe confirms payment. Idempotent: a paid order is
 * returned untouched, so the webhook and the success redirect can race safely.
 */
async function confirmStripeOrder(d, order, session) {
  const { Product, Coupon, email, logger } = d;
  if (!order || order.paymentStatus === 'paid') return order;

  const qtyByProduct = new Map();
  for (const item of order.items || []) {
    qtyByProduct.set(item.productId, (qtyByProduct.get(item.productId) || 0) + item.qty);
  }

  const decremented = [];
  for (const [productId, qty] of qtyByProduct) {
    const result = await Product.updateOne(
      { id: productId, stock: { $gte: qty }, active: { $ne: false } },
      { $inc: { stock: -qty }, $push: { stockHistory: { qty: -qty, reason: 'sale', orderId: order.orderId } } }
    );
    if (result.modifiedCount !== 1) {
      // Roll back anything already taken so stock stays truthful.
      for (const previous of decremented) {
        await Product.updateOne(
          { id: previous.productId },
          { $inc: { stock: previous.qty }, $push: { stockHistory: { qty: previous.qty, reason: 'adjustment', orderId: order.orderId } } }
        );
      }
      // Money was captured but the goods are gone — surface it for a refund.
      order.paymentStatus = 'refund_due';
      order.status = 'cancelled';
      order.trackingSteps = trackingStepsFor('cancelled', order.createdAt);
      await order.save();
      logger.error('Paid order %s could not be fulfilled (stock) — refund due', order.orderId);
      return order;
    }
    decremented.push({ productId, qty });
  }

  if (order.couponCode) {
    await Coupon.updateOne(
      { code: order.couponCode, active: true, $or: [{ expiresAt: { $exists: false } }, { expiresAt: null }, { expiresAt: { $gt: new Date() } }] },
      { $inc: { usedCount: 1 } }
    ).catch(() => {});
  }

  order.paymentStatus = 'paid';
  order.paidAt = new Date();
  if (session && session.id) order.stripeSessionId = session.id;
  if (order.status === 'pending') {
    order.status = 'confirmed';
    order.trackingSteps = trackingStepsFor('confirmed', order.createdAt);
  }
  await order.save();
  if (email) email.sendOrderConfirmation(order.toObject()).catch(() => {});
  return order;
}

// POST /api/stripe/webhook — mounted in server.js with express.raw().
async function handleStripeWebhook(req, res, d) {
  const { stripe, Order, logger } = d;
  const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : (typeof req.body === 'string' ? req.body : '');
  const event = stripe.verifyWebhook(raw, req.headers['stripe-signature']);
  if (!event) {
    // No STRIPE_WEBHOOK_SECRET (or a bad signature) — never act on an
    // unverified money event.
    logger.warn('Stripe webhook rejected: missing/invalid signature');
    return res.status(400).json({ ok: false });
  }
  try {
    const session = event.data && event.data.object ? event.data.object : null;
    const orderId = session && (session.client_reference_id || (session.metadata && session.metadata.orderId));
    if (event.type === 'checkout.session.completed' && orderId) {
      const order = await Order.findOne({ orderId });
      if (order && session.payment_status === 'paid') await confirmStripeOrder(d, order, session);
    } else if (event.type === 'checkout.session.expired' && orderId) {
      // Abandoned unpaid card order: cancel it so it stops showing as pending.
      const order = await Order.findOne({ orderId });
      if (order && order.paymentStatus === 'unpaid') {
        order.status = 'cancelled';
        order.trackingSteps = trackingStepsFor('cancelled', order.createdAt);
        await order.save();
      }
    }
    res.json({ received: true });
  } catch (err) {
    logger.error('Stripe webhook error: %s', err.message);
    res.status(500).json({ ok: false });
  }
}

module.exports.stripeWebhook = handleStripeWebhook;
module.exports.confirmStripeOrder = confirmStripeOrder;
