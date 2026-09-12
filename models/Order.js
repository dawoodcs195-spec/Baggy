const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema({
  productId: { type: String, required: true },
  name:      { type: String, required: true },
  image:     { type: String },
  size:      { type: String, required: true },
  qty:       { type: Number, required: true, min: 1 },
  price:     { type: Number, required: true, min: 0 }
}, { _id: false });

const orderSchema = new mongoose.Schema({
  orderId:   { type: String, required: true, unique: true, index: true },
  items:     [orderItemSchema],
  customer: {
    name:    { type: String, required: true, trim: true },
    email:   { type: String, required: true, lowercase: true, trim: true },
    phone:   { type: String, required: true, trim: true },
    address: { type: String, required: true, trim: true }
  },
  payment: { type: String, required: true, enum: ['cod', 'card', 'jazzcash', 'easypaisa', 'bank'] },
  // Card orders are created UNPAID and only marked paid once Stripe confirms the
  // session (webhook) or the success page reconciles it — never on the client's word.
  paymentStatus: { type: String, default: 'unpaid', enum: ['unpaid', 'paid', 'refund_due', 'refunded'] },
  stripeSessionId: { type: String, default: null, index: true },
  paidAt: { type: Date, default: null },
  subtotal: { type: Number, required: true, min: 0 },
  discount: { type: Number, default: 0, min: 0 },
  couponCode: { type: String, trim: true, uppercase: true, default: null },
  shipping: { type: Number, default: 0, min: 0 },
  total:    { type: Number, required: true, min: 0 },
  status:   { type: String, default: 'pending', enum: ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'] },
  trackingSteps: [{
    label: { type: String },
    completed: { type: Boolean, default: false },
    date:   { type: Date }
  }]
}, { timestamps: true });

// Indexes: admin dashboards/order lists filter by status and sort by date;
// customers load their own orders by email.
orderSchema.index({ status: 1, createdAt: -1 });
orderSchema.index({ 'customer.email': 1, createdAt: -1 });
orderSchema.index({ paymentStatus: 1 });

module.exports = mongoose.model('Order', orderSchema);