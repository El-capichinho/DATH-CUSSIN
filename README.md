# 🍽️ DATH CUSSIN

Full-stack Ghanaian food ordering system with customer storefront, admin POS terminal, and SQLite database — **zero npm dependencies**.

---

## 📁 Project Structure

```
dathcussin/
│
├── server.js                  ← Entry point — starts the HTTP server
├── package.json
├── .env                       ← Local config (never commit)
├── .env.example               ← Safe template to share with team
├── .gitignore
│
├── src/                       ← All server-side logic
│   ├── config.js              ← Loads .env, exports settings
│   ├── router.js              ← Central request dispatcher
│   │
│   ├── db/
│   │   ├── index.js           ← DB connection, ACID setup, txn() helper
│   │   └── seed.js            ← Default users + menu items
│   │
│   ├── middleware/
│   │   ├── auth.js            ← Session resolution + role guards
│   │   └── static.js          ← Static file server with MIME types
│   │
│   ├── routes/
│   │   ├── auth.js            ← Login / signup / logout / me
│   │   ├── menu.js            ← Menu items CRUD
│   │   ├── orders.js          ← Orders CRUD (with stock transactions)
│   │   ├── pos.js             ← POS sale + dashboard summary
│   │   └── admin.js           ← User management + audit log
│   │
│   └── utils/
│       └── index.js           ← Crypto, HTTP helpers, body parser
│
├── public/                    ← Static frontend (served as-is)
│   ├── index.html             ← Login page (root)
│   ├── css/
│   │   └── styles.css         ← Shared auth page styles
│   ├── pages/
│   │   ├── home.html          ← Customer menu / shop
│   │   ├── cart.html          ← Shopping cart + checkout
│   │   ├── signup.html        ← New account registration
│   │   └── success.html       ← Order confirmation page
│   ├── pos/
│   │   └── index.html         ← POS terminal (staff / admin)
│   └── js/                    ← (reserved for shared JS modules)
│
└── data/
    └── dathcussin.db          ← SQLite database (auto-created on first run)
```

---

## 🚀 Quick Start

```bash
# Requires Node.js ≥ 22
node server.js

# Or with auto-restart on file changes (dev mode):
node --watch server.js
```

Then open:
- **Customer store** → http://localhost:3000
- **POS terminal**  → http://localhost:3000/pos/

---

## 🗄️ Database Setup

### Current Status: SQLite ✅
The system currently runs on **SQLite** with **automatic PostgreSQL fallback**. The hybrid database layer (`src/db/index.js`) attempts a PostgreSQL connection and gracefully falls back to SQLite on failure.

**File:** `.env`
```env
DATABASE_URL=postgresql://postgres:PASSWORD@db.caqepvxlykeilovpcsjg.supabase.co:5432/postgres
```

### Option 1: Continue with SQLite (Development) ✅ RECOMMENDED
**Status:** Ready to go — no additional setup needed.
- Database: `data/dathcussin.db` (auto-created)
- No external dependencies
- Full ACID compliance with WAL mode
- Demo users pre-seeded

### Option 2: Upgrade to PostgreSQL (Production) 🔧 IN PROGRESS

#### Step 1: Contact Supabase Support ← **ACTION REQUIRED**
The current issue: Supabase hostname resolves to **IPv6 only**, blocking Windows systems with IPv4-only stacks.

**Action:**
1. Go to [Supabase Dashboard](https://app.supabase.com)
2. Select your project: `db.caqepvxlykeilovpcsjg.supabase.co`
3. Open **Settings** → **Database** → **Connection Pooling**
4. Submit support ticket requesting:
   - IPv4 connection option
   - Or IPv6-compatible connection string

**Expected response time:** 1-3 business days

#### Step 2: Fix Windows IPv6 (Optional) 🖥️
If you want to keep the current IPv6 connection:

```powershell
# Check current IPv6 status
ipconfig /all

# Enable IPv6 (if disabled)
netsh int ipv6 set state enabled

# Test connection to Supabase
Test-NetConnection -ComputerName db.caqepvxlykeilovpcsjg.supabase.co -Port 5432
```

#### Step 3: Update .env with PostgreSQL Credentials ✅
Once Supabase provides a working connection string:

```bash
# Replace with actual credentials from Supabase
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@YOUR_HOST:5432/postgres

# Then restart server
node server.js
```

**What happens:**
- Server attempts PostgreSQL connection (5-second timeout)
- If successful: Uses Supabase PostgreSQL ✅
- If timeout/failed: Falls back to SQLite automatically ✅

---

## 🔑 Demo Accounts

| Role    | Email                    | Password   |
|---------|--------------------------|------------|
| Admin   | admin@dathcussin.com     | admin1234  |
| Staff   | cook@gmail.com           | cook1234   |
| Customer| *(register via signup)*  | —          |

---

## 🔌 API Reference

### Auth
| Method | Route             | Access  | Description         |
|--------|-------------------|---------|---------------------|
| POST   | /api/auth/login   | Public  | Login               |
| POST   | /api/auth/signup  | Public  | Register            |
| POST   | /api/auth/logout  | Any     | Clear session       |
| GET    | /api/auth/me      | Any     | Current user info   |

### Menu (CRUD)
| Method | Route                    | Access       | Description      |
|--------|--------------------------|--------------|------------------|
| GET    | /api/menu                | Public       | List all items   |
| POST   | /api/menu                | Staff/Admin  | Create item      |
| GET    | /api/menu/:id            | Public       | Get single item  |
| PUT    | /api/menu/:id            | Staff/Admin  | Replace item     |
| PATCH  | /api/menu/:id/stock      | Staff/Admin  | Update stock     |
| DELETE | /api/menu/:id            | Admin only   | Delete item      |

### Orders (CRUD)
| Method | Route             | Access       | Description                 |
|--------|-------------------|--------------|-----------------------------|
| GET    | /api/orders       | Auth         | List orders (role-filtered) |
| POST   | /api/orders       | Public       | Place online order          |
| GET    | /api/orders/:id   | Auth         | Get single order            |
| PATCH  | /api/orders/:id   | Staff/Admin  | Update status               |
| DELETE | /api/orders/:id   | Admin only   | Delete + restore stock      |

### POS
| Method | Route              | Access      | Description         |
|--------|--------------------|-------------|---------------------|
| POST   | /api/pos/sale      | Staff/Admin | Process in-store sale|
| GET    | /api/pos/summary   | Staff/Admin | Dashboard stats     |

### Admin
| Method | Route                    | Access | Description       |
|--------|--------------------------|--------|-------------------|
| GET    | /api/admin/users         | Admin  | List all users    |
| PATCH  | /api/admin/users/:id     | Admin  | Update user role  |
| GET    | /api/admin/audit         | Admin  | Audit log         |

---

## 🔒 ACID Compliance

| Property    | Implementation                                                         |
|-------------|------------------------------------------------------------------------|
| Atomicity   | All order writes use `BEGIN / COMMIT / ROLLBACK` — stock and order insert succeed together or not at all |
| Consistency | `CHECK` constraints on prices, stock, status; oversell validation inside the transaction |
| Isolation   | SQLite WAL mode allows concurrent reads; writes are serialised          |
| Durability  | WAL journal + `PRAGMA synchronous=NORMAL`; DB survives crashes          |

---

## 🗄️ Database Schema

```
users          — id, username, email, password_hash, role, timestamps
menu_items     — id, name, description, price, category, image_url, stock, available
orders         — id, user_id (FK), source, status, subtotal, delivery_fee, tax, total, notes
order_items    — id, order_id (FK), menu_item_id (FK), name, price, quantity, subtotal
sessions       — id, user_id (FK), created_at, expires_at
audit_log      — id, user_id, action, table_name, record_id, details, created_at
```

---

## 🔧 Production Checklist

- [ ] Set a strong `SESSION_SECRET` in `.env`
- [ ] Set `NODE_ENV=production`
- [ ] Put behind a reverse proxy (nginx) with HTTPS
- [ ] Replace SHA-256 hashing with `bcrypt` (add as dependency)
- [ ] Move sessions to Redis for multi-process deployments
- [ ] Add rate limiting on auth endpoints
