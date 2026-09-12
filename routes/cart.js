'use strict';
// routes/cart.js — Phase 2 split from server.js
// Factory: register(app, d) — d is the shared dependency bundle from server.js.
module.exports = function (app, d) {
  const { Product, Wishlist, normalizeQty } = d;

// ── API: Cart ───────────────────────────────────────────────────
app.get('/api/cart', (req, res) => res.json(req.session.cart || []));



app.post('/api/cart/add', async (req, res) => {
  const { productId, size, qty = 1 } = req.body;
  const nQty = normalizeQty(qty);
  if (!nQty) return res.status(400).json({ ok: false, message: 'Invalid quantity' });
  try {
    const product = await Product.findOne({ id: productId }).lean();
    if (!product) return res.status(400).json({ ok: false, message: 'Product not found' });
    if (product.active === false) return res.status(400).json({ ok: false, message: 'Product is no longer available' });
    const existing = req.session.cart.find(i => i.productId === productId && i.size === size);
    if (existing) existing.qty += nQty;
    else req.session.cart.push({ productId, size, qty: nQty, price: product.price, name: product.name, image: product.images[0] });
    res.json({ ok: true, cart: req.session.cart });
  } catch {
    res.status(400).json({ ok: false, message: 'Error adding to cart' });
  }
});

app.post('/api/cart/update', (req, res) => {
  const { productId, size, qty } = req.body;
  const nQty = normalizeQty(qty);
  if (!nQty) return res.status(400).json({ ok: false, message: 'Invalid quantity' });
  const item = req.session.cart.find(i => i.productId === productId && i.size === size);
  if (item) item.qty = nQty;
  res.json({ ok: true, cart: req.session.cart });
});

app.post('/api/cart/remove', (req, res) => {
  const { productId, size } = req.body;
  req.session.cart = req.session.cart.filter(i => !(i.productId === productId && i.size === size));
  res.json({ ok: true, cart: req.session.cart });
});

app.post('/api/cart/clear', (req, res) => {
  req.session.cart = [];
  res.json({ ok: true, cart: [] });
});
// ── API: Wishlist (always backed by the persisted Wishlist collection for
// signed-in users, falling back to the session-only copy for guests).
app.get('/api/wishlist', async (req, res) => {
  try {
    const user = req.session?.user;
    if (user && user.email) {
      const doc = await Wishlist.findOne({ email: user.email }).lean();
      const items = Array.isArray(doc?.items) ? doc.items : [];
      req.session.wishlist = items.map(i => ({ productId: i.productId, name: i.name, image: i.image, price: i.price, addedAt: i.addedAt }));
      return res.json({ wishlist: req.session.wishlist });
    }
    res.json({ wishlist: req.session.wishlist || [] });
  } catch {
    res.json({ wishlist: req.session?.wishlist || [] });
  }
});

app.post('/api/wishlist/toggle', async (req, res) => {
  const { productId } = req.body;
  if (!productId) return res.status(400).json({ ok: false, message: 'Product ID required' });
  try {
    const product = await Product.findOne({ id: productId }).lean();
    if (!product) return res.status(400).json({ ok: false, message: 'Product not found' });
    if (product.active === false) return res.status(400).json({ ok: false, message: 'Product is no longer available' });
    const user = req.session?.user;
    // Signed-in: mutate the persisted Wishlist document (deduped by productId).
    if (user && user.email) {
      let doc = await Wishlist.findOne({ email: user.email });
      if (!doc) {
        doc = new Wishlist({ email: user.email, items: [] });
      }
      const idx = doc.items.findIndex(i => i.productId === productId);
      if (idx >= 0) {
        doc.items.splice(idx, 1);
      } else {
        doc.items.push({ productId, name: product.name, image: product.images[0], price: product.price, addedAt: new Date() });
      }
      await doc.save();
      const items = Array.isArray(doc.items) ? doc.items : [];
      req.session.wishlist = items.map(i => ({ productId: i.productId, name: i.name, image: i.image, price: i.price, addedAt: i.addedAt }));
      return res.json({ ok: true, wishlist: req.session.wishlist });
    }
    // Guest: session-only (mirrors the cart guest path).
    const list = req.session.wishlist || [];
    const idx = list.findIndex(i => i.productId === productId);
    if (idx >= 0) {
      list.splice(idx, 1);
    } else {
      list.push({ productId, name: product.name, image: product.images[0], price: product.price, addedAt: new Date() });
    }
    req.session.wishlist = list;
    res.json({ ok: true, wishlist: list });
  } catch {
    res.status(500).json({ ok: false, message: 'Error updating wishlist' });
  }
});

app.post('/api/wishlist/remove', (req, res) => {
  const { productId } = req.body;
  const list = (req.session.wishlist || []).filter(i => i.productId !== productId);
  req.session.wishlist = list;
  res.json({ ok: true, wishlist: list });
});

app.post('/api/wishlist/clear', (req, res) => {
  req.session.wishlist = [];
  res.json({ ok: true, wishlist: [] });
});
};
