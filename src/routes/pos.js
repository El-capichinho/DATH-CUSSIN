'use strict';
/**
 * src/routes/pos.js
 * Point-of-Sale routes — staff / admin only (PostgreSQL version).
 *
 *   POST /api/pos/sale     → process in-person sale (no delivery fee, instant delivered)
 *   GET  /api/pos/summary  → dashboard stats (today, week, low stock, top items)
 */

const { DB, txn, audit }          = require('../db');
const { getSession, requireRole } = require('../middleware/auth');
const { sendJSON, sendError, parseBody, generateOrderId } = require('../utils');
const config = require('../config');

async function handle(req, res, method, pathname) {
  const session = await getSession(req);

  // ── POST /api/pos/sale ────────────────────────────────────────────────
  if (pathname === '/api/pos/sale' && method === 'POST') {
    if (!requireRole(session, ['admin', 'staff'], res)) return true;
    const { cart, notes, customerId } = await parseBody(req);

    if (!cart || cart.length === 0)
      return sendError(res, 'Cart is empty.', 400);

    let orderId;

    try {
      await txn(async (client) => {
        // ── Stock validation (Consistency) ───────────────────────────
        for (const ci of cart) {
          const miResult = await client.query(
            'SELECT * FROM menu_items WHERE id = $1 AND available = true',
            [ci.id]
          );
          const mi = miResult.rows[0];
          if (!mi)
            throw new Error(`"${ci.name}" is unavailable.`);
          if (mi.stock < ci.quantity)
            throw new Error(`Low stock: "${mi.name}" — only ${mi.stock} left.`);
        }

        const subtotal = cart.reduce((s, i) => s + i.price * i.quantity, 0);
        const tax      = parseFloat((subtotal * config.TAX_RATE).toFixed(2));
        const total    = parseFloat((subtotal + tax).toFixed(2));   // no delivery fee for POS

        orderId = generateOrderId('pos');

        await client.query(
          'INSERT INTO orders (id, user_id, source, status, subtotal, delivery_fee, tax, total, notes) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
          [orderId, customerId || null, 'pos', 'delivered', subtotal, 0, tax, total, notes || null]
        );

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

        await audit(session.user.id, 'POS_SALE', 'orders', orderId,
          { total, items: cart.length, cashier: session.user.username });
      });
    } catch (e) {
      return sendError(res, e.message, 422);
    }

    try {
      const orderResult = await DB.query('SELECT * FROM orders WHERE id = $1', [orderId]);
      const order = orderResult.rows[0];
      const itemsResult = await DB.query('SELECT * FROM order_items WHERE order_id = $1', [orderId]);
      return sendJSON(res, { success: true, order: { ...order, items: itemsResult.rows } }, 201);
    } catch (err) {
      console.error('Order fetch error:', err);
      return sendError(res, 'Order created but fetch failed.', 201);
    }
  }

  // ── GET /api/pos/summary ──────────────────────────────────────────────
  if (pathname === '/api/pos/summary' && method === 'GET') {
    if (!requireRole(session, ['admin', 'staff'], res)) return true;

    try {
      const todayTotalResult = await DB.query(`
        SELECT COALESCE(SUM(total), 0) AS v
        FROM orders
        WHERE DATE(created_at) = CURRENT_DATE AND status != 'cancelled'
      `);

      const todayCountResult = await DB.query(`
        SELECT COUNT(*) AS v
        FROM orders
        WHERE DATE(created_at) = CURRENT_DATE
      `);

      const weekTotalResult = await DB.query(`
        SELECT COALESCE(SUM(total), 0) AS v
        FROM orders
        WHERE created_at >= CURRENT_TIMESTAMP - INTERVAL '7 days' AND status != 'cancelled'
      `);

      const pendingResult = await DB.query(`
        SELECT COUNT(*) AS v
        FROM orders
        WHERE status IN ('pending', 'confirmed', 'preparing')
      `);

      const lowStockResult = await DB.query(
        'SELECT * FROM menu_items WHERE stock < 10 AND available = true ORDER BY stock ASC'
      );

      const recentOrdersResult = await DB.query(
        'SELECT * FROM orders ORDER BY created_at DESC LIMIT 15'
      );

      const topItemsResult = await DB.query(`
        SELECT oi.name,
               SUM(oi.quantity) AS qty,
               SUM(oi.subtotal) AS revenue
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id AND o.status != 'cancelled'
        GROUP BY oi.menu_item_id, oi.name
        ORDER BY qty DESC
        LIMIT 5
      `);

      const summary = {
        todayTotal: parseFloat(todayTotalResult.rows[0].v),
        todayCount: parseInt(todayCountResult.rows[0].v),
        weekTotal: parseFloat(weekTotalResult.rows[0].v),
        pending: parseInt(pendingResult.rows[0].v),
        lowStock: lowStockResult.rows,
        recentOrders: recentOrdersResult.rows,
        topItems: topItemsResult.rows,
      };

      return sendJSON(res, { success: true, summary });
    } catch (err) {
      console.error('Summary fetch error:', err);
      return sendError(res, 'Failed to fetch summary.', 500);
    }
  }

  return null;
}

module.exports = { handle };
