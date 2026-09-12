'use strict';
// routes/order-chat.js — per-order messaging between customer and admin.
//
// Customers message an order they own (verified by session email == order email).
// Admins read the thread and reply. Replies arrive in the customer's inbox on
// the order detail page (and by email if the mailer is configured).
module.exports = function (app, d) {
  const { Order, OrderMessage, renderPage, isAdmin, asyncHandler, logger, email } = d;

  // ── Customer: send a message on one of my orders ────────────────
  // Mounted before the admin routes so the ownership check applies.
  app.post('/api/order-message', asyncHandler(async (req, res) => {
    const user = req.session?.user;
    const orderId = String(req.body.orderId || '').trim();
    const text = String(req.body.message || '').trim();
    if (!orderId || !text) {
      return res.status(400).json({ ok: false, message: 'Order and message are required.' });
    }
    if (text.length > 2000) {
      return res.status(400).json({ ok: false, message: 'Message is too long (max 2000 chars).' });
    }
    const order = await Order.findOne({ orderId }).lean();
    if (!order) return res.status(404).json({ ok: false, message: 'Order not found.' });

    // Ownership: logged-in user must match the order email; guests can't message.
    const emailAddr = user?.email?.toLowerCase();
    if (!emailAddr || emailAddr !== order.customer.email.toLowerCase()) {
      return res.status(403).json({ ok: false, message: 'You can only message your own orders.' });
    }

    const msg = await OrderMessage.create({
      orderId,
      email: emailAddr,
      message: text,
      direction: 'customer',
    });

    logger.info('Order message %s on %s', msg._id, orderId);
    res.json({ ok: true, message: 'Message sent.', id: String(msg._id) });
  }));

  // ── Customer: read the thread for one of my orders ───────────────
  app.get('/api/order-message/:orderId', asyncHandler(async (req, res) => {
    const user = req.session?.user;
    const { orderId } = req.params;
    if (!user) return res.status(401).json({ ok: false, message: 'Sign in to view messages.' });
    const order = await Order.findOne({ orderId }).lean();
    if (!order) return res.status(404).json({ ok: false, message: 'Order not found.' });
    if (user.email.toLowerCase() !== order.customer.email.toLowerCase() && user.role !== 'admin') {
      return res.status(403).json({ ok: false, message: 'Not your order.' });
    }
    const messages = await OrderMessage.find({ orderId }).sort({ createdAt: 1 }).lean();
    res.json({ ok: true, orderId, messages });
  }));

  // ── Admin: read the thread for any order ─────────────────────────
  app.get('/admin/order/:id/messages', asyncHandler(async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ ok: false });
    const order = await Order.findOne({ orderId: req.params.id }).lean();
    if (!order) return res.status(404).json({ ok: false, message: 'Order not found.' });
    const messages = await OrderMessage.find({ orderId: order.orderId }).sort({ createdAt: 1 }).lean();
    res.json({ ok: true, messages });
  }));

  // ── Admin: reply on an order (creates a message + emails customer) ─
  app.post('/admin/order/:id/reply', asyncHandler(async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ ok: false });
    const text = String(req.body.message || '').trim();
    if (!text) return res.status(400).json({ ok: false, message: 'Message is required.' });
    if (text.length > 2000) {
      return res.status(400).json({ ok: false, message: 'Message is too long (max 2000 chars).' });
    }
    const order = await Order.findOne({ orderId: req.params.id }).lean();
    if (!order) return res.status(404).json({ ok: false, message: 'Order not found.' });

    const msg = await OrderMessage.create({
      orderId: order.orderId,
      email: 'admin@baggy.com',
      message: text,
      direction: 'admin',
    });

    // Fire-and-forget email; never block the admin UI on it.
    if (email && email.send) {
      email.send({
        to: order.customer.email,
        subject: `Update on order #${order.orderId} — BA GGY`,
        text: `Hi ${order.customer.name},\n\n${text}\n\n— BA GGY\nTrack your order: ${process.env.APP_URL || 'http://localhost:3000'}/track?order_id=${order.orderId}`,
      }).catch((err) => logger.error('Order-reply email failed: %s', err.message));
    }

    logger.info('Admin replied on order %s (msg %s)', order.orderId, msg._id);
    res.json({ ok: true, message: 'Reply sent.', id: String(msg._id) });
  }));
};
