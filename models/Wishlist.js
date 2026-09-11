const mongoose = require('mongoose');

const wishlistItemSchema = new mongoose.Schema({
  productId: { type: String, required: true, index: true },
  name:      { type: String, required: true, trim: true },
  image:     { type: String },
  price:     { type: Number, required: true, min: 0 },
  addedAt:   { type: Date, default: Date.now }
}, { timestamps: true });

const wishlistSchema = new mongoose.Schema({
  email:      { type: String, required: true, lowercase: true, trim: true, index: true },
  items:      [wishlistItemSchema],
  createdAt:  { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('Wishlist', wishlistSchema);
