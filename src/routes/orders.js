'use strict';
/**
 * src/routes/orders.js
 * Order CRUD — all writes are wrapped in ACID transactions (PostgreSQL version).
 *
 *   GET    /api/orders        → list (admin/staff see all; customer sees own)
 *   POST   /api/orders        → place new order (validates stock, deducts atomically)
 *   GET    /api/orders/:id    → read single
 *   PATCH  /api/orders/:id    → update status (admin/staff)
 *   DELETE /api/orders/:id    → cancel & restore stock (admin)
 */

const { DB, txn, audit }           = require('../db');
const { getSession, requireAuth, requireRole } = require('../middleware/auth');
const { sendJSON, sendError, parseBody, generateOrderId } = require('../utils');
const config = require('../config');

// ── Helper: attach items array to an order row ────────────────────────────
async function withItems(order) {
  const itemsResult = await DB.query('SELECT * FROM order_items WHERE order_id = $1', [order.id]);
  return {
    ...order,
    items: itemsResult.rows,
  };
}

async function handle(req, res, method, pathname) {
  const session = await getSession(req);

  // ── GET /api/orders ───────────────────────────────────────────────────
  if (pathname === '/api/orders' && method === 'GET') {
    if (!requireAuth(session, res)) return true;

    try {
      const query = ['admin', 'staff'].includes(session.user.role)
        ? 'SELECT * FROM orders ORDER BY created_at DESC'
        : 'SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC';

      const params = ['admin', 'staff'].includes(session.user.role)
        ? []
        : [session.user.id];

      const result = await DB.query(query, params);
      const ordersWithItems = await Promise.all(result.rows.map(withItems));
      return sendJSON(res, { success: true, orders: ordersWithItems });
    } catch (err) {
      console.error('Orders fetch error:', err);
      return sendError(res, 'Failed to fetch orders.', 500);
    }
  }

  // ── POST /api/orders ──────────────────────────────────────────────────
  if (pathname === '/api/orders' && method === 'POST') {
    const { cart, notes } = await parseBody(req);

    if (!cart || cart.length === 0)
      return sendError(res, 'Cart is empty.', 400);

    let orderId;

    try {
      await txn(async (client) => {
        // ── Validate stock (Consistency) ────────────────────────────
        for (const ci of cart) {
          const miResult = await client.query(
            'SELECT * FROM menu_items WHERE id = $1 AND available = true',
            [ci.id]
          );
          const mi = miResult.rows[0];
          if (!mi)
            throw new Error(`"${ci.name}" is no longer available.`);
          if (mi.stock < ci.quantity)
            throw new Error(`Insufficient stock for "${mi.name}". Available: ${mi.stock}.`);
        }

        // ── Calculate totals ─────────────────────────────────────────
        const subtotal     = cart.reduce((s, i) => s + i.price * i.quantity, 0);
        const deliveryFee  = config.DELIVERY_FEE;
        const tax          = parseFloat((subtotal * config.TAX_RATE).toFixed(2));
        const total        = parseFloat((subtotal + deliveryFee + tax).toFixed(2));

        orderId = generateOrderId('online');

        // ── Insert order ─────────────────────────────────────────────
        await client.query(
          'INSERT INTO orders (id, user_id, source, status, subtotal, delivery_fee, tax, total, notes) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
          [orderId, session?.user.id || null, 'online', 'confirmed', subtotal, deliveryFee, tax, total, notes || null]
        );

        // ── Insert order items + deduct stock (Atomicity) ────────────
        for (const ci of cart) {
          await client.query(
            'INSERT INTO order_items (order_id, menu_item_id, name, price, quantity, subtotal) VALUES ($1, $2, $3, $4, $5, $6)',
            [orderId, ci.id, ci.name, ci.price, ci.quantity, ci.price * ci.quantity]
          );

          await client.query(
            'UPDATE menu_items SET stock = stock - $1, updated_at = NOW() WHERE id = $2',
            [ci.quantity, ci.id]
          );
        }

        await audit(session?.user.id || null, 'CREATE', 'orders', orderId,
          { total, source: 'online', items: cart.length });
      });
    } catch (e) {
      return sendError(res, e.message, 422);
    }

    try {
      const orderResult = await DB.query('SELECT * FROM orders WHERE id = $1', [orderId]);
      const order = orderResult.rows[0];
      return sendJSON(res, {
        success: true,
        order: await withItems(order),
      }, 201);
    } catch (err) {
      console.error('Order fetch error:', err);
      return sendError(res, 'Order created but fetch failed.', 201);
    }
  }

  // ── Routes that need an order ID ──────────────────────────────────────
  const match = pathname.match(/^\/api\/orders\/([A-Z0-9\-]+)$/);
  if (!match) return null;
  const orderId = match[1];

  // ── GET /api/orders/:id ───────────────────────────────────────────────
  if (method === 'GET') {
    if (!requireAuth(session, res)) return true;
    try {
      const result = await DB.query('SELECT * FROM orders WHERE id = $1', [orderId]);
      const order = result.rows[0];
      if (!order) return sendError(res, 'Order not found.', 404);

      // Customers can only see their own orders
      if (order.user_id !== session.user.id && !['admin', 'staff'].includes(session.user.role))
        return sendError(res, 'Forbidden.', 403);

      return sendJSON(res, { success: true, order: await withItems(order) });
    } catch (err) {
      console.error('Order fetch error:', err);
      return sendError(res, 'Failed to fetch order.', 500);
    }
  }

  // ── PATCH /api/orders/:id  (update status) ────────────────────────────
  if (method === 'PATCH') {
    if (!requireRole(session, ['admin', 'staff'], res)) return true;
    const { status } = await parseBody(req);

    const valid = ['pending', 'confirmed', 'preparing', 'ready', 'delivered', 'cancelled'];
    if (!valid.includes(status))
      return sendError(res, `Invalid status. Must be one of: ${valid.join(', ')}.`, 400);

    try {
      await txn(async (client) => {
        await client.query(
          'UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2',
          [status, orderId]
        );
        await audit(session.user.id, 'UPDATE_STATUS', 'orders', orderId, { status });
      });

      const result = await DB.query('SELECT * FROM orders WHERE id = $1', [orderId]);
      const updated = result.rows[0];
      if (!updated) return sendError(res, 'Order not found.', 404);
      return sendJSON(res, { success: true, order: await withItems(updated) });
    } catch (err) {
      console.error('Order update error:', err);
      return sendError(res, 'Failed to update order.', 500);
    }
  }

  // ── DELETE /api/orders/:id  (cancel + restore stock) ─────────────────
  if (method === 'DELETE') {
    if (!requireRole(session, ['admin'], res)) return true;

    try {
      await txn(async (client) => {
        // Restore stock for every item in this order (Atomicity)
        const itemsResult = await client.query('SELECT * FROM order_items WHERE order_id = $1', [orderId]);
        for (const item of itemsResult.rows) {
          await client.query(
            'UPDATE menu_items SET stock = stock + $1, updated_at = NOW() WHERE id = $2',
            [item.quantity, item.menu_item_id]
          );
        }
        // ON DELETE CASCADE removes order_items automatically
        await client.query('DELETE FROM orders WHERE id = $1', [orderId]);
        await audit(session.user.id, 'DELETE', 'orders', orderId, {});
      });

      return sendJSON(res, { success: true, message: 'Order deleted and stock restored.' });
    } catch (err) {
      console.error('Order delete error:', err);
      return sendError(res, 'Failed to delete order.', 500);
    }
  }

  return null;
}

module.exports = { handle };
