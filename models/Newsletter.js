const mongoose = require('mongoose');

const contactSchema = new mongoose.Schema({
  name:    { type: String, required: true, trim: true },
  email:   { type: String, required: true, lowercase: true, trim: true },
  subject: { type: String, trim: true },
  message: { type: String, required: true, trim: true },
  status:  { type: String, default: 'new', enum: ['new', 'read', 'replied'] }
}, { timestamps: true });

const newsletterSchema = new mongoose.Schema({
  email:   { type: String, required: true, unique: true, lowercase: true, trim: true },
  active:  { type: Boolean, default: true }
}, { timestamps: true });

const messageSchema = new mongoose.Schema({
  orderId:  { type: String, required: true, index: true },
  email:    { type: String, required: true },
  message:  { type: String, required: true, maxlength: 2000 },
  direction:{ type: String, enum: ['customer', 'admin'], default: 'customer' }
}, { timestamps: true });

// Indexes: the admin inbox and newsletter views sort by date; contacts filter by status.
contactSchema.index({ createdAt: -1 });
contactSchema.index({ status: 1, createdAt: -1 });
newsletterSchema.index({ createdAt: -1 });
messageSchema.index({ orderId: 1, createdAt: 1 });

module.exports = {
  Contact:     mongoose.model('Contact', contactSchema),
  Newsletter:  mongoose.model('Newsletter', newsletterSchema),
  OrderMessage:mongoose.model('OrderMessage', messageSchema)
};