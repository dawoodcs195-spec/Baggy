'use strict';
// models/Review.js — customer product reviews.
//
// Status lifecycle: pending (default for new reviews) → approved (visible publicly)
// → hidden (moderated out, still kept for audit). The public product page only renders
// approved reviews; the admin moderation queue shows pending + hidden.
const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
  productId:   { type: String, required: true, index: true },
  name:        { type: String, required: true, trim: true, maxlength: 80 },
  text:        { type: String, required: true, trim: true, maxlength: 2000 },
  rating:      { type: Number, required: true, min: 1, max: 5 },
  verifiedPurchase: { type: Boolean, default: false },
  status:      { type: String, enum: ['pending', 'approved', 'hidden'], default: 'pending', index: true },
  authorIp:    { type: String, trim: true, maxlength: 45 },
  userEmail:   { type: String, lowercase: true, trim: true, index: true } // set when the reviewer is signed in
}, { timestamps: true });

reviewSchema.index({ productId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('Review', reviewSchema);
