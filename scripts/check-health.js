#!/usr/bin/env node
// Lightweight health check for Docker.
const http = require('http');
const port = process.env.PORT || 3000;
const req = http.get(`http://localhost:${port}/api/auth/session`, (res) => {
  process.exit(res.statusCode < 500 ? 0 : 1);
});
req.on('error', () => process.exit(1));
req.setTimeout(3000, () => { req.destroy(); process.exit(1); });