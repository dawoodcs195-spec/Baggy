// All rate-limit buckets in one place (Phase 2).
const rateLimit = require('express-rate-limit');

// Global bucket for everything else
const globalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 300 });

// Stricter per-route buckets for sensitive endpoints (on top of the global bucket)
const checkoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false,
  message: { ok: false, message: 'Too many checkout attempts. Please wait a few minutes and try again.' }
});
const couponLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false,
  message: { ok: false, message: 'Too many coupon checks. Please wait a bit and try again.' }
});
const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false,
  message: { ok: false, message: 'Too many messages sent. Please try again later.' }
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false
});
const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false,
  message: { ok: false, message: 'Too many reset attempts. Try again later.' }
});

module.exports = { globalLimiter, checkoutLimiter, couponLimiter, contactLimiter, authLimiter, passwordResetLimiter };
