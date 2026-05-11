'use strict';
/**
 * src/config.js
 * Loads .env file and exports all application configuration.
 */

const fs = require('fs');
const path = require('path');


// ── Load .env ─────────────────────────────────────────────────────────────
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) return;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (key && val && !(key in process.env)) process.env[key] = val;
  });
}

// ── Export config ─────────────────────────────────────────────────────────
module.exports = {
  PORT: process.env.PORT || 3000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  SESSION_SECRET: process.env.SESSION_SECRET || (() => { throw new Error('SESSION_SECRET must be set in .env'); })(),
  DATABASE_URL: process.env.DATABASE_URL,
  DB_PATH: process.env.DB_PATH || require('path').join(__dirname, '..', 'data', 'dathcussin.db'),
  PUBLIC_DIR: require('path').join(__dirname, '..', 'public'),
  TAX_RATE: 0.125,
  DELIVERY_FEE: 10.00,
  SESSION_TTL: 86400000,   // 24 hours in ms
};
