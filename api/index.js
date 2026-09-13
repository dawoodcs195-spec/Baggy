// Vercel serverless adapter — mounts the BA GGY Express app for serverless.
// Vercel sets NODE_ENV=production and VERCEL=1; server.js skips app.listen()
// in that case, so this adapter just boots once and hands requests to Express.
const { app, boot } = require("../server");

let ready = false;
let bootPromise = null;

async function ensureBooted() {
  if (ready) return;
  if (!bootPromise) {
    bootPromise = boot().then(() => { ready = true; }).catch((err) => {
      bootPromise = null; // allow retry on next request
      throw err;
    });
  }
  return bootPromise;
}

module.exports = async function handler(req, res) {
  try {
    await ensureBooted();
  } catch (err) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ ok: false, message: "Server boot failed: " + err.message }));
  }
  return app(req, res);
};