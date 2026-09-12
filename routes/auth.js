'use strict';
// routes/auth.js — Phase 2 split from server.js
// Factory: register(app, d) — d is the shared dependency bundle from server.js.
module.exports = function (app, d) {
  const { User, Wishlist, sessionUser, getCsrfToken, authLimiter, passwordResetLimiter, isValidEmail, sanitizeText, validatePassword, ADMIN_EMAILS, logger, email } = d;

// ── Guest → account merge ───────────────────────────────────────
// A signing-in visitor may have filled a cart/wishlist as a guest. Login
// regenerates the session (session-fixation defence), which would silently
// wipe that state — so it is captured before and restored after, and the
// wishlist is folded into the account's saved one instead of being thrown away.
function plainWishlist(items) {
  return (items || []).map(i => ({
    productId: i.productId,
    name: i.name,
    image: i.image,
    price: i.price,
    addedAt: i.addedAt
  }));
}

async function mergeGuestWishlist(userEmail, guestItems) {
  const guest = (guestItems || []).filter(i => i && i.productId);
  let doc = await Wishlist.findOne({ email: userEmail });
  if (!doc) {
    if (!guest.length) return [];
    doc = await new Wishlist({ email: userEmail, items: guest }).save();
    return plainWishlist(doc.items);
  }
  const have = new Set((doc.items || []).map(i => i.productId));
  const additions = guest.filter(i => !have.has(i.productId));
  if (additions.length) {
    doc.items.push(...additions);
    await doc.save();
  }
  return plainWishlist(doc.items);
}

// Shared post-login session rebuild (used by login and register).
async function adoptUserSession(req, user, guestCart, guestWishlist) {
  req.session.user = sessionUser(user);
  const cart = Array.isArray(guestCart) ? guestCart.filter(i => i && i.productId) : [];
  req.session.cart = cart;
  try {
    req.session.wishlist = await mergeGuestWishlist(user.email, guestWishlist);
  } catch (err) {
    logger.error('Wishlist merge failed: %s', err.message);
    req.session.wishlist = guestWishlist || [];
  }
  getCsrfToken(req);
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
    const guestCart = req.session.cart || [];
    const guestWishlist = req.session.wishlist || [];
    // Regenerate session to prevent session fixation
    req.session.regenerate(async (err) => {
      if (err) return res.status(500).json({ ok: false, message: 'Session error' });
      await adoptUserSession(req, user, guestCart, guestWishlist);
      req.session.save(err2 => {
        if (err2) return res.status(500).json({ ok: false, message: 'Session error' });
        res.json({ ok: true, user: req.session.user, csrfToken: req.session.csrfToken, wishlistCount: (req.session.wishlist || []).length });
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
    // Keep whatever the guest collected, then fold the wishlist into the account.
    const guestCart = req.session.cart || [];
    const guestWishlist = req.session.wishlist || [];
    // Regenerate session to prevent session fixation
    req.session.regenerate(async (err) => {
      if (err) return res.status(500).json({ ok: false, message: 'Session error' });
      await adoptUserSession(req, user, guestCart, guestWishlist);
      req.session.save(err2 => {
        if (err2) return res.status(500).json({ ok: false, message: 'Session error' });
        res.json({ ok: true, user: req.session.user, csrfToken: req.session.csrfToken, cartCount: req.session.cart.length, wishlistCount: (req.session.wishlist || []).length });
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
  // Named cleanEmail (not `email`) so the mailer service imported from `d`
  // isn't shadowed by the customer's address string.
  const cleanEmail = String(req.body.email || '').toLowerCase().trim();
  if (!isValidEmail(cleanEmail)) return res.status(400).json({ ok: false, message: 'Please enter a valid email address' });
  try {
    const user = await User.findOne({ email: cleanEmail });
    // Always respond the same way so attackers can't discover which emails exist
    const generic = { ok: true, message: 'If an account exists for that email, a reset link has been generated.' };
    if (!user) return res.json(generic);
    const token = user.createPasswordResetToken();
    await user.save({ validateBeforeSave: false });
    const resetUrl = `/reset-password?token=${token}&email=${encodeURIComponent(cleanEmail)}`;
    // Emailed when RESEND_API_KEY is set; while it isn't, the link comes back in
    // the response so the reset flow stays testable locally (never in production).
    const delivered = email ? await email.sendPasswordReset(user, resetUrl) : { ok: false };
    if (delivered.ok || process.env.NODE_ENV === 'production') {
      return res.json({ ...generic, message: 'If an account exists for that email, a reset link has been sent.' });
    }
    res.json({ ...generic, resetUrl });
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
};
