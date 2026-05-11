'use strict';
/**
 * src/db/index.js
 * Hybrid database adapter - PostgreSQL with automatic SQLite fallback
 */

const { Pool } = require('pg');
const { DatabaseSync } = require('node:sqlite');
const crypto = require('crypto');
const config = require('../config');

let dbInstance = null;
let sqliteInstance = null;
let USE_POSTGRES = false;

// ── Initialize database (PostgreSQL or SQLite) ────────────────────────────
async function initDatabase() {
  // Try PostgreSQL first
  const pgPool = await tryPostgres();
  if (pgPool) {
    dbInstance = pgPool;
    USE_POSTGRES = true;
    await initPostgresSchema();
    await seedPostgres();
    return;
  }

  // Fallback to SQLite
  const sqlite = initSQLite();
  sqliteInstance = sqlite;
  USE_POSTGRES = false;
  initSQLiteSchema(sqlite);
  seedSQLite(sqlite);
}

// ── Try PostgreSQL connection ──────────────────────────────────────────────
async function tryPostgres() {
  const connectionString = process.env.DATABASE_URL || config.DATABASE_URL;
  if (!connectionString) return null;

  console.log('🔌 Attempting PostgreSQL connection...');
  const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    console.log('✅ PostgreSQL connected! Using Supabase.');
    return pool;
  } catch (err) {
    console.warn(`⚠️  PostgreSQL failed (${err.message}). SQLite fallback.`);
    await pool.end().catch(() => {});
    return null;
  }
}

// ── Initialize SQLite ────────────────────────────────────────────────────
function initSQLite() {
  console.log('🔌 Initializing SQLite...');
  try {
    const sqlite = new DatabaseSync(config.DB_PATH);
    sqlite.exec('PRAGMA journal_mode = WAL');
    sqlite.exec('PRAGMA foreign_keys = ON');
    sqlite.exec('PRAGMA synchronous = NORMAL');
    console.log('✅ SQLite initialized! Using local database.');
    return sqlite;
  } catch (err) {
    console.error('❌ SQLite initialization failed:', err);
    process.exit(1);
  }
}

// ── PostgreSQL schema ────────────────────────────────────────────────────
async function initPostgresSchema() {
  const pgClient = await dbInstance.connect();
  try {
    await pgClient.query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(255) PRIMARY KEY,
        username VARCHAR(255) NOT NULL UNIQUE,
        email VARCHAR(255) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL DEFAULT 'customer',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS menu_items (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        price NUMERIC(10,2) NOT NULL,
        category VARCHAR(255) NOT NULL,
        image_url TEXT,
        stock INTEGER NOT NULL DEFAULT 99,
        available BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS orders (
        id VARCHAR(255) PRIMARY KEY,
        user_id VARCHAR(255),
        source VARCHAR(50) NOT NULL DEFAULT 'online',
        status VARCHAR(50) NOT NULL DEFAULT 'pending',
        subtotal NUMERIC(10,2) NOT NULL,
        delivery_fee NUMERIC(10,2) NOT NULL DEFAULT 0,
        tax NUMERIC(10,2) NOT NULL,
        total NUMERIC(10,2) NOT NULL,
        notes TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        FOREIGN KEY (user_id) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS order_items (
        id SERIAL PRIMARY KEY,
        order_id VARCHAR(255) NOT NULL,
        menu_item_id INTEGER NOT NULL,
        name VARCHAR(255) NOT NULL,
        price NUMERIC(10,2) NOT NULL,
        quantity INTEGER NOT NULL,
        subtotal NUMERIC(10,2) NOT NULL,
        FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
        FOREIGN KEY (menu_item_id) REFERENCES menu_items(id)
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id VARCHAR(255) PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL,
        created_at BIGINT NOT NULL,
        expires_at BIGINT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS audit_log (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(255),
        action VARCHAR(255) NOT NULL,
        table_name VARCHAR(255),
        record_id VARCHAR(255),
        details JSONB,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS tables (
        id SERIAL PRIMARY KEY,
        table_number VARCHAR(50) NOT NULL UNIQUE,
        capacity INTEGER NOT NULL,
        price NUMERIC(10,2) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS reservations (
        id VARCHAR(255) PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL,
        table_id INTEGER NOT NULL,
        reservation_date DATE NOT NULL,
        reservation_time TIME NOT NULL,
        guest_count INTEGER NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'pending',
        customer_name VARCHAR(255),
        customer_phone VARCHAR(20),
        notes TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (table_id) REFERENCES tables(id)
      );
    `);
    console.log('✅ PostgreSQL schema created');
  } catch (err) {
    console.error('PostgreSQL schema error:', err);
  } finally {
    pgClient.release();
  }
}

// ── SQLite schema ────────────────────────────────────────────────────────
function initSQLiteSchema(sqlite) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'customer',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS menu_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      price REAL NOT NULL,
      category TEXT NOT NULL,
      image_url TEXT,
      stock INTEGER NOT NULL DEFAULT 99,
      available INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      source TEXT NOT NULL DEFAULT 'online',
      status TEXT NOT NULL DEFAULT 'pending',
      subtotal REAL NOT NULL,
      delivery_fee REAL NOT NULL DEFAULT 0,
      tax REAL NOT NULL,
      total REAL NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT NOT NULL,
      menu_item_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      price REAL NOT NULL,
      quantity INTEGER NOT NULL,
      subtotal REAL NOT NULL,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
      FOREIGN KEY (menu_item_id) REFERENCES menu_items(id)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      action TEXT NOT NULL,
      table_name TEXT,
      record_id TEXT,
      details TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tables (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_number TEXT NOT NULL UNIQUE,
      capacity INTEGER NOT NULL,
      price REAL NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS reservations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      table_id INTEGER NOT NULL,
      reservation_date TEXT NOT NULL,
      reservation_time TEXT NOT NULL,
      guest_count INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      customer_name TEXT,
      customer_phone TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (table_id) REFERENCES tables(id)
    );
  `);
  console.log('✅ SQLite schema created');
}

// ── Seed functions ──────────────────────────────────────────────────────
async function seedPostgres() {
  try {
    await require('./seed')(DB, config);
  } catch (err) {
    console.error('PostgreSQL seed error:', err);
  }
}

function seedSQLite(sqlite) {
  try {
    require('./seed')(sqlite, config);
  } catch (err) {
    console.error('SQLite seed error:', err);
  }
}

// ── Query adapter ────────────────────────────────────────────────────────
async function query(sql, params = []) {
  if (USE_POSTGRES) {
    return dbInstance.query(sql, params);
  } else {
    // Convert $1, $2 syntax to ? for SQLite
    let sqliteSQL = sql;
    for (let i = params.length; i > 0; i--) {
      sqliteSQL = sqliteSQL.replace(new RegExp('\\$' + i, 'g'), '?');
    }
    const stmt = sqliteInstance.prepare(sqliteSQL);
    const result = stmt.all(...params);
    return { rows: result };
  }
}

// ── Connect adapter ───────────────────────────────────────────────────────
async function connect() {
  if (USE_POSTGRES) {
    return dbInstance.connect();
  } else {
    // Return a pseudo-client for SQLite
    return {
      query: (sql, params) => query(sql, params),
      release: () => {},
    };
  }
}

// ── Transaction helper ────────────────────────────────────────────────────
async function txn(fn) {
  if (USE_POSTGRES) {
    const pgClient = await dbInstance.connect();
    try {
      await pgClient.query('BEGIN');
      const result = await fn(pgClient);
      await pgClient.query('COMMIT');
      return result;
    } catch (err) {
      await pgClient.query('ROLLBACK');
      throw err;
    } finally {
      pgClient.release();
    }
  } else {
    // SQLite transaction (synchronous)
    sqliteInstance.exec('BEGIN');
    try {
      const result = await fn({ query });
      sqliteInstance.exec('COMMIT');
      return result;
    } catch (err) {
      sqliteInstance.exec('ROLLBACK');
      throw err;
    }
  }
}

// ── Audit log helper ──────────────────────────────────────────────────────
async function audit(userId, action, tableName, recordId, details) {
  try {
    if (USE_POSTGRES) {
      await dbInstance.query(
        'INSERT INTO audit_log (user_id, action, table_name, record_id, details) VALUES ($1, $2, $3, $4, $5)',
        [userId || null, action, tableName || null, recordId ? String(recordId) : null, details || null]
      );
    } else {
      sqliteInstance.prepare(
        'INSERT INTO audit_log (user_id, action, table_name, record_id, details) VALUES (?,?,?,?,?)'
      ).run(
        userId || null,
        action,
        tableName || null,
        recordId ? String(recordId) : null,
        details ? JSON.stringify(details) : null
      );
    }
  } catch (err) {
    console.error('Audit log error:', err);
  }
}

// ── Graceful close ────────────────────────────────────────────────────────
async function close() {
  if (USE_POSTGRES && dbInstance) {
    await dbInstance.end();
  } else if (sqliteInstance) {
    try {
      sqliteInstance.exec('PRAGMA wal_checkpoint(FULL)');
      sqliteInstance.close();
    } catch {}
  }
}

// ── Initialize on module load ─────────────────────────────────────────────
initDatabase().catch(err => {
  console.error('❌ Database initialization failed:', err);
  process.exit(1);
});

// ── Export DB object with query/connect methods ─────────────────────────
const DB = { query, connect };

module.exports = { DB, txn, audit, close };
