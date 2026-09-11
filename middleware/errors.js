// Central error handling (Phase 2).
// asyncHandler wraps async route handlers so rejections reach the error
// middleware instead of crashing the process or hanging the request.
// NOTE: the remaining explicit try/catch blocks in server.js return precise
// JSON messages and stay until the route-splitting sweep converts them.
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// Must be mounted last (after all routes, before/after the 404 handler).
// API callers get JSON; page navigations get the 404-style error page.
function errorHandler(err, req, res, next) {
  const logger = require('../services/logger');
  logger.error({ err: err.stack || err.message, path: (req.method || '?') + ' ' + (req.originalUrl || req.url || '?') }, 'Unhandled request error');
  if (res.headersSent) return next(err);
  const isApi = String(req.originalUrl || req.url || '').startsWith('/api/');
  if (isApi) {
    return res.status(500).json({ ok: false, message: 'Something went wrong. Please try again.' });
  }
  res.status(500).send('Something went wrong. Please try again.');
}

module.exports = { asyncHandler, errorHandler };
