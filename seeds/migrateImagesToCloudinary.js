// One-time migration: upload locally-referenced product images to Cloudinary
// and rewrite Product.images to secure Cloudinary URLs. Idempotent: records
// already holding absolute URLs are skipped. Usage: node seeds/migrateImagesToCloudinary.js
require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const cloudinary = require('cloudinary').v2;
const connectDB = require('../config/db');
const Product = require('../models/Product');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const IMAGES_DIR = path.join(__dirname, '..', 'public', 'images');
const FOLDER = 'baggy-jeans-shop';

function isAbsoluteUrl(s) {
  return s.indexOf('http://') === 0 || s.indexOf('https://') === 0;
}

function uploadFile(absPath, publicId) {
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload_stream(
      { resource_type: 'image', folder: FOLDER, public_id: publicId, overwrite: false },
      (err, result) => err ? reject(err) : resolve(result.secure_url)
    ).end(fs.readFileSync(absPath));
  });
}

(async () => {
  await connectDB();
  const products = await Product.find({}).lean();
  let touched = 0, uploaded = 0, skipped = 0;
  for (const p of products) {
    const imgs = Array.isArray(p.images) ? p.images : [];
    if (imgs.length === 0 || imgs.every(u => isAbsoluteUrl(String(u)))) { skipped++; continue; }
    const next = [];
    let changed = false;
    for (const ref of imgs) {
      const s = String(ref || '').trim();
      if (!s) { changed = true; continue; }
      if (isAbsoluteUrl(s)) { next.push(s); continue; }
      const bare = s.split('/').pop();
      const rootDir = path.join(__dirname, '..');
      const abs = s.startsWith('uploads/') ? path.join(rootDir, 'public', s) : (fs.existsSync(path.join(IMAGES_DIR, bare)) ? path.join(IMAGES_DIR, bare) : null);
      const dotAt = bare.lastIndexOf('.');
      const publicId = dotAt === -1 ? bare : bare.slice(0, dotAt);
      if (!abs) { console.log("  ! missing local file, keeping as-is: " + s + " (product " + p.id + ")"); next.push(s); continue; }
      const url = await uploadFile(abs, publicId);
      next.push(url); uploaded++; changed = true;
      console.log("  ^ uploaded " + bare + " -> " + url);
    }
    if (changed) {
      await Product.updateOne({ _id: p._id }, { $set: { images: next } });
      touched++;
      console.log("  = updated product " + p.id + " (" + p.name + ")");
    }
  }
  console.log("Migration done. Products updated: " + touched + " | files uploaded: " + uploaded + " | already-cloudinary: " + skipped);
  await mongoose.connection.close();
})().catch(err => { console.error('Migration failed:', err.message); process.exit(1); });
