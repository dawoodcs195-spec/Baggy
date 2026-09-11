// Coupon seed — creates a representative set of coupons for testing the
// admin coupons page, dashboard coupon stats, and the Coupon Performance panel.
//
//   npm run seed:coupons                 → upsert 5 coupons (idempotent)
//   npm run seed:coupons -- --with-orders → also insert 6 sample orders
//                                           (2 with coupon, contrast rows without)
//                                           — skipped if seed orders already exist
//
// Sample orders use the orderId prefix BG-SEED so they are easy to identify
// and clean:  db.orders.deleteMany({ orderId: /^BG-SEED/ })
'use strict';
require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const Coupon = require('../models/Coupon');
const Order = require('../models/Order');

const coupons = [
  { code: 'WELCOME10', type: 'percent', value: 10, minOrder: 0,    maxDiscount: 500,  active: true },
  { code: 'SAVE500',   type: 'fixed',   value: 500, minOrder: 2500,                    active: true },
  { code: 'MEGA25',    type: 'percent', value: 25,  minOrder: 5000, maxDiscount: 2000, active: true },
  // Expired + paused examples so the admin table shows every state
  { code: 'EXPIRED10', type: 'percent', value: 10, minOrder: 0, active: true, expiresAt: new Date('2026-08-01T00:00:00Z') },
  { code: 'PAUSED15',  type: 'percent', value: 15, minOrder: 1000, active: false }
];

const withOrders = process.argv.includes('--with-orders');

// Delivered/confirmed orders recorded WITH coupon fields — this is exactly the
// data the dashboard Coupon Performance panel aggregates (couponCode + discount).
// deliveredOrders usedCount increments mirror what real checkout does.
const sampleOrders = [
  { code: 'WELCOME10', subtotal: 4200, discount: 420,  shipping: 299, status: 'delivered', name: 'Ayesha K.' },
  { code: 'WELCOME10', subtotal: 3800, discount: 380,  shipping: 0,   status: 'delivered', name: 'Bilal R.' },
  { code: 'SAVE500',   subtotal: 5200, discount: 500,  shipping: 0,   status: 'delivered', name: 'Hassan M.' },
  { code: 'MEGA25',    subtotal: 9000, discount: 2000, shipping: 0,   status: 'delivered', name: 'Zara S.' },
  { code: 'MEGA25',    subtotal: 6500, discount: 1625, shipping: 0,   status: 'confirmed', name: 'Omar T.' },
  { code: null,        subtotal: 3000, discount: 0,    shipping: 299, status: 'delivered', name: 'No Coupon N.' }
];

const trackingFor = (status, placedAt) => {
  const idx = { pending: 0, confirmed: 1, processing: 2, shipped: 3, delivered: 4 }[status];
  const now = new Date();
  const labels = ['Order Placed', 'Confirmed', 'Processing', 'Shipped', 'Delivered'];
  return labels.map((label, i) => ({
    label,
    completed: idx !== undefined && i <= idx,
    date: idx !== undefined && i <= idx ? (i === 0 ? placedAt : now) : null
  }));
};

(async () => {
  await connectDB();

  // ── Coupons (always) ──
  try {
    for (const c of coupons) {
      const existing = await Coupon.findOne({ code: c.code });
      if (existing) {
        await Coupon.updateOne({ code: c.code }, { $set: { ...c, code: c.code } });
        console.log(`  ↻ Updated: ${c.code}`);
      } else {
        await new Coupon(c).save();
        console.log(`  ✓ Seeded: ${c.code}`);
      }
    }
    console.log(`\n  ✓ ${coupons.length} coupons ensured (existing codes left intact)\n`);
  } catch (err) {
    console.error('  ✗ Coupon seed error:', err.message);
  }

  // ── Sample orders (only with --with-orders, once) ──
  if (withOrders) {
    try {
      const existing = await Order.countDocuments({ orderId: /^BG-SEED/ });
      if (existing > 0) {
        console.log(`  = ${existing} seed orders already present — skipping (delete them with db.orders.deleteMany({ orderId: /^BG-SEED/ }))\n`);
      } else {
        // Use a real product image if the catalog has one, for nicer admin tables
        let image = null;
        try {
          const p = await mongoose.connection.db.collection('products').findOne({});
          image = p && (p.images && p.images[0] || p.image) || null;
        } catch (_) { /* catalog empty — fine */ }

        for (const [i, o] of sampleOrders.entries()) {
          const placedAt = new Date(Date.now() - (i + 1) * 36e5 * 24); // i days ago
          const total = o.subtotal - o.discount + o.shipping;
          await new Order({
            orderId: 'BG-SEED' + (100 + i),
            items: [{ productId: 'seed-item-' + (i + 1), name: 'Baggy Sample ' + (i + 1), image, size: 'M', qty: 1, price: o.subtotal }],
            customer: { name: o.name, email: 'seed' + (i + 1) + '@example.com', phone: '0300123456' + i, address: 'Seed Address ' + (i + 1) + ', Lahore' },
            payment: 'cod',
            subtotal: o.subtotal,
            discount: o.discount,
            couponCode: o.code || null,
            shipping: o.shipping,
            total,
            status: o.status,
            trackingSteps: trackingFor(o.status, placedAt),
            createdAt: placedAt
          }).save();
          if (o.code) await Coupon.updateOne({ code: o.code }, { $inc: { usedCount: 1 } });
          console.log(`  ✓ Order BG-SEED${100 + i} — ${o.code ? o.code + ' (−₨' + o.discount + ')' : 'no coupon'} — ${o.status}`);
        }
        console.log(`\n  ✓ ${sampleOrders.length} sample orders inserted\n`);
      }
    } catch (err) {
      console.error('  ✗ Order seed error:', err.message);
    }
  }

  await mongoose.connection.close();
})();
