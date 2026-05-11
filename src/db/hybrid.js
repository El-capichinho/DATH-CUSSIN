'use strict';
/**
 * src/db/hybrid.js
 * Hybrid database layer: PostgreSQL (Supabase) with automatic SQLite fallback
 * Auto-detects connectivity and uses whichever backend is available
 */

const { Pool } = require('pg');
const { DatabaseSync } = require('node:sqlite');
const crypto = require('crypto');
const config = require('../config');

let DB = null;
let USE_POSTGRES = false;

// ── Initialize database (PostgreSQL or SQLite) ────────────────────────────
async function initDB() {
  // Try PostgreSQL first
  const pgPool = await tryPostgres();
  if (pgPool) {
    DB = pgPool;
    USE_POSTGRES = true;
    await initPostgresSchema();
    return DB;
  }

  // Fallback to SQLite
  const sqlite = initSQLite();
  DB = createSQLiteAdapter(sqlite);
  USE_POSTGRES = false;
  initSQLiteSchema(sqlite);
  return DB;
}

// ── Try to connect to PostgreSQL ──────────────────────────────────────────
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
    console.log('✅ PostgreSQL connected! Using Supabase backend.');
    return pool;
  } catch (err) {
    console.warn(`⚠️  PostgreSQL failed (${err.message}). Falling back to SQLite.`);
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

// ── Create adapter for SQLite to match PostgreSQL API ─────────────────────
function createSQLiteAdapter(sqlite) {
  return {
    async query(sql, params = []) {
      try {
        // Convert PostgreSQL $1, $2 syntax to SQLite ? syntax
        let sqliteSQL = sql;
        for (let i = params.length; i > 0; i--) {
          sqliteSQL = sqliteSQL.replace(new RegExp('\\$' + i, 'g'), '?');
        }
        
        const stmt = sqlite.prepare(sqliteSQL);
        const result = stmt.all(...params);
        return { rows: result };
      } catch (err) {
        throw err;
      }
    },

    async connect() {
      // Return a "client" that delegates to the sqlite instance
      return {
        query: this.query,
        release: () => {},
      };
    },

    async end() {
      try {
        sqlite.exec('PRAGMA wal_checkpoint(FULL)');
        sqlite.close();
      } catch (err) {
        console.error('SQLite close error:', err);
      }
    },
  };
}

// ── PostgreSQL schema ────────────────────────────────────────────────────
async function initPostgresSchema() {
  const client = await DB.connect();
  try {
    await client.query(`
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
    console.log('✅ PostgreSQL schema initialized');
  } catch (err) {
    console.error('PostgreSQL schema error:', err);
  } finally {
    client.release();
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
  console.log('✅ SQLite schema initialized');

  // Run seed
  require('./seed')(sqlite, config);
}

// ── Transaction helper ────────────────────────────────────────────────────
async function txn(fn) {
  if (USE_POSTGRES) {
    const client = await DB.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } else {
    // SQLite transaction via the adapter
    const client = await DB.connect();
    try {
      // For SQLite, we need direct access - this is handled by seed
      return await fn(DB);
    } catch (err) {
      throw err;
    }
  }
}

// ── Audit log helper ───────────────────────────────────────────────────────
async function audit(userId, action, tableName, recordId, details) {
  try {
    if (USE_POSTGRES) {
      await DB.query(
        'INSERT INTO audit_log (user_id, action, table_name, record_id, details) VALUES ($1, $2, $3, $4, $5)',
        [userId || null, action, tableName || null, recordId ? String(recordId) : null, details || null]
      );
    } else {
      // SQLite version
      const sqlite = findSQLiteInstance();
      if (sqlite) {
        sqlite.prepare(
          'INSERT INTO audit_log (user_id, action, table_name, record_id, details) VALUES (?,?,?,?,?)'
        ).run(
          userId || null,
          action,
          tableName || null,
          recordId ? String(recordId) : null,
          details ? JSON.stringify(details) : null
        );
      }
    }
  } catch (err) {
    console.error('Audit log error:', err);
  }
}

// Helper to get SQLite instance
let sqliteInstance = null;
function setSQLiteInstance(instance) {
  sqliteInstance = instance;
}
function findSQLiteInstance() {
  return sqliteInstance;
}

// ── Graceful close ────────────────────────────────────────────────────────
async function close() {
  if (DB && USE_POSTGRES) {
    await DB.end();
  } else if (sqliteInstance) {
    try {
      sqliteInstance.exec('PRAGMA wal_checkpoint(FULL)');
      sqliteInstance.close();
    } catch {}
  }
}

// ── Initialize on module load ────────────────────────────────────────────
let initPromise = null;
function getDB() {
  if (!initPromise) {
    initPromise = initDB();
  }
  return initPromise;
}

module.exports = { 
  getDB, 
  txn, 
  audit,
  close, 
  setSQLiteInstance,
  isPostgres: () => USE_POSTGRES,
};
