const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  id:           { type: String, required: true, unique: true, index: true },
  name:         { type: String, required: true, trim: true },
  category:     { type: String, required: true, enum: ['jeans', 'shirts', 'accessories', 'uppers'], index: true },
  subcategory:  { type: String, required: true },
  price:        { type: Number, required: true, min: 0 },
  originalPrice:{ type: Number, min: 0 },
  stock:        { type: Number, required: true, default: 0, min: 0 },
  sizes:        [{ type: String }],
  colors:       [{ type: String }],
  images:       [{ type: String }],
  description:  { type: String, required: true },
  details:      [{ type: String }],
  care:         [{ type: String }],
  featured:     { type: Boolean, default: false },
  newArrival:   { type: Boolean, default: false },
  active:       { type: Boolean, default: true },
  rating:       { type: Number, default: 4.5, min: 0, max: 5 },
  reviewCount:  { type: Number, default: 0, min: 0 },
  lowStockThreshold: { type: Number, default: 10, min: 0 },
  lastRestocked: { type: Date },
  stockHistory: [{
    qty: { type: Number },
    reason: { type: String, enum: ['sale', 'restock', 'adjustment', 'cancellation'], default: 'adjustment' },
    orderId: { type: String },
    createdAt: { type: Date, default: Date.now }
  }]
}, { timestamps: true });

module.exports = mongoose.model('Product', productSchema);