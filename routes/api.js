'use strict';
// routes/api.js — Phase 2 split from server.js
// Factory: register(app, d) — d is the shared dependency bundle from server.js.
module.exports = function (app, d) {
  // Service bound as `mailer`: several handlers destructure the customer's
  // `email` string from req.body, which would shadow a binding named `email`.
  const { Product, Contact, Newsletter, asyncHandler, isValidEmail, sanitizeText, contactLimiter, logger, email: mailer } = d;

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

// ── API: Contact & Newsletter ───────────────────────────────────
app.post('/api/contact', contactLimiter, async (req, res) => {
  const { name, email, subject, message } = req.body;
  if (!name || !email || !message) return res.status(400).json({ ok: false, message: 'Required fields missing' });
  if (!isValidEmail(email)) return res.status(400).json({ ok: false, message: 'Please enter a valid email address' });
  try {
    const clean = {
      name: sanitizeText(name, 80),
      email: String(email).toLowerCase().trim(),
      subject: sanitizeText(subject, 150),
      message: sanitizeText(message, 5000)
    };
    await new Contact(clean).save();
    // Acknowledge to the customer (fire-and-forget — mail must not fail the send).
    if (mailer) mailer.sendContactAck(clean).catch(() => {});
    res.json({ ok: true, message: 'Message sent successfully' });
  } catch {
    res.status(500).json({ ok: false, message: 'Failed to send message' });
  }
});

app.post('/api/newsletter', async (req, res) => {
  const { email } = req.body;
  if (!email || !isValidEmail(email)) return res.status(400).json({ ok: false, message: 'Please enter a valid email address' });
  try {
    await new Newsletter({ email: String(email).toLowerCase().trim() }).save();
    if (mailer) mailer.sendNewsletterWelcome(String(email).toLowerCase().trim()).catch(() => {});
    res.json({ ok: true });
  } catch {
    res.json({ ok: true }); // Already subscribed — still success UX
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
    if (mailer) mailer.sendNewsletterWelcome(normalized).catch(() => {});
    res.json({ ok: true, message: 'Subscribed successfully' });
  } catch (err) {
    // Unique index race: two simultaneous requests for the same email
    if (err && err.code === 11000) {
      return res.status(200).json({ ok: false, duplicate: true, message: 'You are already on the list — no need to subscribe again.' });
    }
    res.status(500).json({ ok: false, message: 'Something went wrong. Please try again.' });
  }
});
};
