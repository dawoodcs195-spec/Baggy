const mongoose = require('mongoose');

const couponSchema = new mongoose.Schema({
  code: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    uppercase: true,
    match: /^[A-Z0-9_-]{3,32}$/,
    index: true
  },
  type: { type: String, enum: ['percent', 'fixed'], required: true, default: 'percent' },
  value: { type: Number, required: true, min: 0 },
  minOrder: { type: Number, min: 0, default: 0 },
  maxDiscount: { type: Number, min: 0 },
  expiresAt: { type: Date },
  usageLimit: { type: Number, min: 1 },
  usedCount: { type: Number, min: 0, default: 0 },
  active: { type: Boolean, default: true }
}, { timestamps: true });

couponSchema.path('value').validate(function (value) {
  return this.type !== 'percent' || value <= 100;
}, 'Percentage coupons cannot exceed 100.');

module.exports = mongoose.model('Coupon', couponSchema);
