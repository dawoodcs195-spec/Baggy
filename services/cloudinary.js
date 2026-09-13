'use strict';
// services/cloudinary.js — Cloudinary config + product-image upload pipeline (Phase 2 split).
const cloudinary = require('cloudinary').v2;
const multer = require('multer');

function configure() {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key:    process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });
}

// ── Product image uploads ─────────────────────────────────────────
// Using memory storage for Cloudinary upload pipeline
const productImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 5 },
  fileFilter: (_req, file, cb) => {
    if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) return cb(null, true);
    cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname));
  }
});

// Helper to upload buffer to Cloudinary
async function uploadToCloudinary(buffer, _mimetype) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { resource_type: 'image', folder: 'baggy-jeans-shop' },
      (error, result) => {
        if (error) reject(error);
        else resolve(result.secure_url);
      }
    );
    stream.end(buffer);
  });
}

// Multer error handler - must be placed after upload routes
function handleMulterError(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ ok: false, message: 'File too large. Maximum 5 MB per image.' });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ ok: false, message: 'Too many files. Maximum 5 images allowed.' });
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({ ok: false, message: 'Invalid file type. Only JPEG, PNG, and WebP images accepted.' });
    }
    return res.status(400).json({ ok: false, message: `Upload error: ${err.message}` });
  }
  next(err);
}

// Image validation using buffer
function validateUploadedImages(files) {
  const invalidFiles = [];
  for (const file of files) {
    const validSignatures = {
      'image/jpeg': [0xFF, 0xD8, 0xFF],
      'image/png': [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A],
      'image/webp': [0x52, 0x49, 0x46, 0x46]
    };
    const buffer = file.buffer.slice(0, 16);
    let isValid = false;
    for (const [mime, sig] of Object.entries(validSignatures)) {
      if (sig.every((byte, i) => buffer[i] === byte)) {
        if (mime === 'image/webp') {
          if (buffer.slice(8, 12).toString('ascii') === 'WEBP') isValid = true;
        } else {
          isValid = true;
        }
      }
    }
    if (!isValid || file.mimetype.split('/')[0] !== 'image') invalidFiles.push(file);
  }
  return invalidFiles;
}

function validateProductImages(req, res, next) {
  const invalidFiles = validateUploadedImages(req.files || []);
  if (invalidFiles.length > 0) {
    return res.status(400).json({ ok: false, message: 'One or more uploads are not valid image files.' });
  }
  next();
}

module.exports = { configure, productImageUpload, uploadToCloudinary, handleMulterError, validateProductImages };
