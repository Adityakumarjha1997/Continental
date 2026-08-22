'use strict';

const { Server } = require('socket.io');
const authService = require('../services/authService');
const orderService = require('../services/orderService');
const config = require('../config');

/**
 * Real-time layer. Rooms:
 *   - restaurant:<code>       owners (live order board + analytics)
 *   - kitchen:<code>          kitchen screens for that restaurant
 *   - waiters:<code>          every waiter of the restaurant (unassigned pool)
 *   - waiter:<code>:<sid>     one specific waiter (their assigned orders)
 *   - order:<oid>             the customer who placed order <oid> (live tracking)
 *
 * Every subscription is authorised with the caller's JWT before the socket is
 * allowed to join. CORS is driven by config.corsOrigin (empty => reflect
 * same-origin) instead of the previous wide-open '*'.
 */
function initSocket(server) {
  const allowed = config.corsOrigin
    ? config.corsOrigin.split(',').map((s) => s.trim()).filter(Boolean)
    : true; // reflect request origin

  const io = new Server(server, { cors: { origin: allowed } });

  io.on('connection', (socket) => {
    socket.on('owner:subscribe', ({ token } = {}) => {
      const p = authService.verifyToken(token);
      if (p && p.role === 'owner') {
        socket.join('restaurant:' + p.code);
        socket.emit('subscribed', { code: p.code });
      } else {
        socket.emit('error_msg', { error: 'Unauthorized socket subscription' });
      }
    });

    socket.on('waiter:subscribe', ({ token } = {}) => {
      const p = authService.verifyToken(token);
      if (p && p.role === 'waiter') {
        socket.join('waiters:' + p.code);
        socket.join('waiter:' + p.code + ':' + p.sid);
        socket.emit('subscribed', { code: p.code, role: 'waiter' });
      } else {
        socket.emit('error_msg', { error: 'Unauthorized socket subscription' });
      }
    });

    socket.on('kitchen:subscribe', ({ token } = {}) => {
      const p = authService.verifyToken(token);
      if (p && p.role === 'kitchen') {
        socket.join('kitchen:' + p.code);
        socket.emit('subscribed', { code: p.code, role: 'kitchen' });
      } else {
        socket.emit('error_msg', { error: 'Unauthorized socket subscription' });
      }
    });

    // Public: anyone on the checkout screen can watch table availability change.
    socket.on('tables:subscribe', ({ code } = {}) => {
      if (code) {
        socket.join('tables:' + code);
        socket.emit('tables:subscribed', { code: String(code) });
      }
    });

    socket.on('order:subscribe', ({ token } = {}) => {
      const p = authService.verifyOrderToken(token);
      if (p && p.oid) {
        socket.join('order:' + p.oid);
        socket.emit('order:subscribed', { orderId: p.oid });
      } else {
        socket.emit('error_msg', { error: 'Invalid order token' });
      }
    });
  });

  return io;
}

/**
 * Broadcast an order to everyone who cares about it:
 *   - the owner board (raw order)
 *   - the kitchen screen and the waiter panels (raw order)
 *   - the customer's tracking screen (sanitised public view)
 *
 * `event` is 'order:new' for a freshly placed order, otherwise 'order:update'.
 * Staff rooms always receive 'order:update' for changes; 'order:new' additionally
 * fires so panels can play their alert sound for arrivals.
 */
function pushOrder(io, order, event = 'order:update') {
  if (!io || !order) return;
  const code = order.restaurantCode;

  io.to('restaurant:' + code).emit(event, order);
  io.to('kitchen:' + code).emit(event, order);
  io.to('waiters:' + code).emit(event, order);
  if (order.assignedWaiterId) {
    io.to('waiter:' + code + ':' + order.assignedWaiterId).emit(event, order);
  }
  io.to('order:' + order.id).emit('order:update', orderService.publicOrderView(order));
  // Any order change may free/occupy a table — nudge checkout screens to refresh.
  io.to('tables:' + code).emit('tables:update', { code: String(code) });
}

/**
 * Signal the owner board that this restaurant's staff changed (a waiter clocked
 * on/off, or a staff member was added/removed) so it can refresh instantly.
 */
function pushStaff(io, code) {
  if (!io || !code) return;
  io.to('restaurant:' + code).emit('staff:update', { code: String(code) });
}

module.exports = { initSocket, pushOrder, pushStaff };
