const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, default: 'store' },
  shippingThreshold: { type: Number, min: 0, default: 3499 },
  shippingCost: { type: Number, min: 0, default: 299 },
  lowStockThreshold: { type: Number, min: 1, default: 10 },
  orderIdPrefix: { type: String, trim: true, maxlength: 10, default: 'BG' },
  storeName: { type: String, trim: true, maxlength: 100, default: 'BA GGY' },
  storeEmail: { type: String, trim: true, lowercase: true, maxlength: 200, default: 'support@baggy.pk' },
  storePhone: { type: String, trim: true, maxlength: 40, default: '' },
  storeAddress: { type: String, trim: true, maxlength: 500, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('Settings', settingsSchema);
