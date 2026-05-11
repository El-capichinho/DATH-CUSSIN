'use strict';
/**
 * src/utils/index.js
 * Shared utility functions used across routes and middleware.
 */

const crypto = require('crypto');
const bcrypt = require('bcrypt');
const config = require('../config');

const BCRYPT_ROUNDS = 12;
const MAX_PAYLOAD_SIZE = 100000; // 100KB

// ── Password hashing (bcrypt - secure, slow by design) ───────────────────
function hashPassword(plain) {
  return bcrypt.hashSync(plain, BCRYPT_ROUNDS);
}

function checkPassword(plain, hash) {
  try {
    return bcrypt.compareSync(plain, hash);
  } catch (err) {
    return false; // Invalid hash format
  }
}

// ── Session ID + Order ID generators ─────────────────────────────────────
function generateSessionId() {
  return crypto.randomBytes(32).toString('hex');
}

function generateOrderId(source) {
  const prefix = source === 'pos' ? 'POS' : 'ORD';
  const hex = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `${prefix}-${Date.now()}-${hex}`;
}

function generateUserId() {
  return 'usr-' + crypto.randomBytes(6).toString('hex');
}

// ── HTTP response helpers with security headers ──────────────────────────
function sendJSON(res, data, status = 200, extraHeaders = {}) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'",
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    ...extraHeaders,
  });
  res.end(body);
}

function sendError(res, message, status = 400) {
  sendJSON(res, { success: false, message }, status);
}

// ── Request body parser with size limit ───────────────────────────────────
function parseBody(req) {
  return new Promise(resolve => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > MAX_PAYLOAD_SIZE) {
        req.destroy();
        resolve({});
      }
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

// ── Cookie helper ─────────────────────────────────────────────────────────
function parseCookies(cookieHeader) {
  if (!cookieHeader) return {};
  return Object.fromEntries(
    cookieHeader.split(';').map(c => {
      const [k, ...v] = c.trim().split('=');
      return [k.trim(), decodeURIComponent(v.join('='))];
    })
  );
}

function makeSessionCookie(sid) {
  return `dath_session=${encodeURIComponent(sid)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${config.SESSION_TTL / 1000}`;
}

function clearSessionCookie() {
  return 'dath_session=; HttpOnly; Path=/; Max-Age=0';
}

module.exports = {
  hashPassword,
  checkPassword,
  generateSessionId,
  generateOrderId,
  generateUserId,
  sendJSON,
  sendError,
  parseBody,
  parseCookies,
  makeSessionCookie,
  clearSessionCookie,
};
