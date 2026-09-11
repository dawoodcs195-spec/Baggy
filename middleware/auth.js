// Admin authorization: session role + the ADMIN_EMAILS allowlist.
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'admin@baggy.pk').split(',').map(s => s.trim().toLowerCase());

function isAdmin(req) {
  return req.session.user && req.session.user.role === 'admin' && ADMIN_EMAILS.includes(req.session.user.email);
}

function requireAdminApi(req, res, next) {
  if (!isAdmin(req)) return res.status(403).json({ ok: false, message: 'Forbidden' });
  next();
}

module.exports = { ADMIN_EMAILS, isAdmin, requireAdminApi };
