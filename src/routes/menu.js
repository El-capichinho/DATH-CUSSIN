'use strict';
/**
 * src/routes/menu.js
 * Menu item CRUD (PostgreSQL version):
 *   GET    /api/menu          → list all
 *   POST   /api/menu          → create (admin/staff)
 *   GET    /api/menu/:id      → read one
 *   PUT    /api/menu/:id      → replace (admin/staff)
 *   PATCH  /api/menu/:id/stock→ update stock/availability (admin/staff)
 *   DELETE /api/menu/:id      → delete (admin only)
 */

const { DB, txn, audit } = require('../db');
const { getSession, requireRole } = require('../middleware/auth');
const { sendJSON, sendError, parseBody } = require('../utils');

async function handle(req, res, method, pathname) {
  const session = await getSession(req);

  // ── GET /api/menu ─────────────────────────────────────────────────────
  if (pathname === '/api/menu' && method === 'GET') {
    try {
      const result = await DB.query(
        'SELECT * FROM menu_items ORDER BY category, name'
      );
      return sendJSON(res, { success: true, items: result.rows });
    } catch (err) {
      console.error('Menu fetch error:', err);
      return sendError(res, 'Failed to fetch menu.', 500);
    }
  }

  // ── POST /api/menu ────────────────────────────────────────────────────
  if (pathname === '/api/menu' && method === 'POST') {
    if (!requireRole(session, ['admin', 'staff'], res)) return true;
    const b = await parseBody(req);

    if (!b.name || b.price == null || !b.category)
      return sendError(res, 'name, price and category are required.', 400);
    if (b.price < 0)
      return sendError(res, 'Price cannot be negative.', 400);

    try {
      let newId;
      await txn(async (client) => {
        const r = await client.query(
          'INSERT INTO menu_items (name, description, price, category, image_url, stock) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
          [
            b.name,
            b.description || null,
            b.price,
            b.category,
            b.image_url || null,
            b.stock != null ? b.stock : 99
          ]
        );
        newId = r.rows[0].id;
        await audit(session.user.id, 'CREATE', 'menu_items', newId, { name: b.name, price: b.price });
      });

      const itemResult = await DB.query('SELECT * FROM menu_items WHERE id = $1', [newId]);
      const item = itemResult.rows[0];
      return sendJSON(res, { success: true, item }, 201);
    } catch (err) {
      console.error('Menu create error:', err);
      return sendError(res, 'Failed to create menu item.', 500);
    }
  }

  // ── Routes that need an ID ─────────────────────────────────────────────
  const singleMatch = pathname.match(/^\/api\/menu\/(\d+)$/);
  const stockMatch  = pathname.match(/^\/api\/menu\/(\d+)\/stock$/);

  // ── PATCH /api/menu/:id/stock ─────────────────────────────────────────
  if (stockMatch && method === 'PATCH') {
    if (!requireRole(session, ['admin', 'staff'], res)) return true;
    const id = parseInt(stockMatch[1]);
    const b  = await parseBody(req);

    try {
      await txn(async (client) => {
        if (b.stock != null)
          await client.query('UPDATE menu_items SET stock = $1, updated_at = NOW() WHERE id = $2', [b.stock, id]);
        if (b.available != null)
          await client.query('UPDATE menu_items SET available = $1, updated_at = NOW() WHERE id = $2', [b.available, id]);
        await audit(session.user.id, 'STOCK_UPDATE', 'menu_items', id, b);
      });

      const itemResult = await DB.query('SELECT * FROM menu_items WHERE id = $1', [id]);
      const item = itemResult.rows[0];
      if (!item) return sendError(res, 'Item not found.', 404);
      return sendJSON(res, { success: true, item });
    } catch (err) {
      console.error('Stock update error:', err);
      return sendError(res, 'Failed to update stock.', 500);
    }
  }

  if (!singleMatch) return null; // not our route
  const id = parseInt(singleMatch[1]);

  // ── GET /api/menu/:id ─────────────────────────────────────────────────
  if (method === 'GET') {
    try {
      const result = await DB.query('SELECT * FROM menu_items WHERE id = $1', [id]);
      const item = result.rows[0];
      return item
        ? sendJSON(res, { success: true, item })
        : sendError(res, 'Not found.', 404);
    } catch (err) {
      console.error('Menu item fetch error:', err);
      return sendError(res, 'Failed to fetch menu item.', 500);
    }
  }

  // ── PUT /api/menu/:id ─────────────────────────────────────────────────
  if (method === 'PUT') {
    if (!requireRole(session, ['admin', 'staff'], res)) return true;
    const b = await parseBody(req);

    if (!b.name || b.price == null)
      return sendError(res, 'name and price are required.', 400);

    try {
      await txn(async (client) => {
        await client.query(`
          UPDATE menu_items
          SET name=$1, description=$2, price=$3, category=$4, image_url=$5, stock=$6, available=$7,
              updated_at=NOW()
          WHERE id=$8
        `, [
          b.name,
          b.description || null,
          b.price,
          b.category || 'lunch',
          b.image_url || null,
          b.stock != null ? b.stock : 99,
          b.available != null ? b.available : true,
          id
        ]);
        await audit(session.user.id, 'UPDATE', 'menu_items', id, { name: b.name, price: b.price });
      });

      const itemResult = await DB.query('SELECT * FROM menu_items WHERE id = $1', [id]);
      const item = itemResult.rows[0];
      if (!item) return sendError(res, 'Item not found.', 404);
      return sendJSON(res, { success: true, item });
    } catch (err) {
      console.error('Menu update error:', err);
      return sendError(res, 'Failed to update menu item.', 500);
    }
  }

  // ── DELETE /api/menu/:id ──────────────────────────────────────────────
  if (method === 'DELETE') {
    if (!requireRole(session, ['admin'], res)) return true;

    try {
      await txn(async (client) => {
        await client.query('DELETE FROM menu_items WHERE id = $1', [id]);
        await audit(session.user.id, 'DELETE', 'menu_items', id, {});
      });

      return sendJSON(res, { success: true, message: 'Item deleted.' });
    } catch (err) {
      console.error('Menu delete error:', err);
      return sendError(res, 'Failed to delete menu item.', 500);
    }
  }

  return null;
}

module.exports = { handle };
