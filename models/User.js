const mongoose = require('mongoose');
const crypto = require('crypto');
const { promisify } = require('util');

const scryptAsync = promisify(crypto.scrypt);

// OWASP-recommended scrypt cost factors (N=2^14, r=8, p=1)
const SCRYPT_OPTS = { N: 16384, r: 8, p: 1 };
const KEY_LEN = 64;

const addressSchema = new mongoose.Schema({
  label:   { type: String, trim: true },
  name:    { type: String, required: true, trim: true },
  phone:   { type: String, required: true, trim: true },
  address: { type: String, required: true, trim: true },
  city:    { type: String, trim: true },
  state:   { type: String, trim: true },
  zip:     { type: String, trim: true },
  default: { type: Boolean, default: false }
}, { _id: false });

const userSchema = new mongoose.Schema({
  name:              { type: String, required: true, trim: true },
  email:             { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
  phone:             { type: String, trim: true },
  passwordHash:      { type: String, required: true },
  salt:              { type: String, required: true },
  role:              { type: String, enum: ['user', 'admin'], default: 'user', index: true },
  addresses:         [addressSchema],
  currency:          { type: String, default: 'PKR' },
  emailNotifications:{ type: Boolean, default: true },
  resetTokenHash:    { type: String, default: null },
  resetTokenExpires: { type: Date, default: null },
  // Account lockout: 5 failed logins lock the account for 15 minutes
  failedAttempts:    { type: Number, default: 0, min: 0 },
  lockedUntil:       { type: Date, default: null }
}, { timestamps: true });

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000;

userSchema.methods.isLockedOut = function () {
  return Boolean(this.lockedUntil && this.lockedUntil > new Date());
};

// Count a failed login; lock the account when the threshold is reached.
userSchema.methods.registerFailedLogin = async function () {
  this.failedAttempts = (this.failedAttempts || 0) + 1;
  if (this.failedAttempts >= MAX_FAILED_ATTEMPTS) {
    this.lockedUntil = new Date(Date.now() + LOCK_DURATION_MS);
    this.failedAttempts = 0;
  }
  await this.save({ validateBeforeSave: false });
};

// Reset lockout state after a successful login
userSchema.methods.clearLockout = async function () {
  if (!this.failedAttempts && !this.lockedUntil) return;
  this.failedAttempts = 0;
  this.lockedUntil = null;
  await this.save({ validateBeforeSave: false });
};

// Hash a plaintext password onto the user document (salt + scrypt hash)
userSchema.methods.setPassword = async function (password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await scryptAsync(password, salt, KEY_LEN, SCRYPT_OPTS);
  this.salt = salt;
  this.passwordHash = hash.toString('hex');
};

// Create a single-use password reset token (valid 15 minutes).
// Returns the plaintext token to email to the user; only its SHA-256 hash is stored.
userSchema.methods.createPasswordResetToken = function () {
  const token = crypto.randomBytes(32).toString('hex');
  this.resetTokenHash = crypto.createHash('sha256').update(token).digest('hex');
  this.resetTokenExpires = new Date(Date.now() + 15 * 60 * 1000);
  return token;
};

// Check a plaintext reset token against the stored hash and expiry
userSchema.methods.verifyPasswordResetToken = function (token) {
  if (!token || !this.resetTokenHash || !this.resetTokenExpires) return false;
  if (Date.now() > this.resetTokenExpires.getTime()) return false;
  const candidate = crypto.createHash('sha256').update(String(token)).digest('hex');
  const a = Buffer.from(candidate);
  const b = Buffer.from(this.resetTokenHash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

// Clear reset token state after a successful reset
userSchema.methods.clearPasswordResetToken = function () {
  this.resetTokenHash = null;
  this.resetTokenExpires = null;
};

// Constant-time verification of a plaintext password
userSchema.methods.verifyPassword = async function (password) {
  if (!this.salt || !this.passwordHash || !password) return false;
  try {
    const hash = await scryptAsync(String(password), this.salt, KEY_LEN, SCRYPT_OPTS);
    const expected = Buffer.from(this.passwordHash, 'hex');
    return hash.length === expected.length && crypto.timingSafeEqual(hash, expected);
  } catch {
    return false;
  }
};

userSchema.methods.toSafeJSON = function () {
  return {
    id: this._id.toString(),
    name: this.name,
    email: this.email,
    role: this.role,
    addresses: this.addresses || [],
    currency: this.currency || 'PKR',
    emailNotifications: this.emailNotifications !== false
  };
};

module.exports = mongoose.model('User', userSchema);