'use strict';

const express = require('express');
const router = express.Router();

const restaurantRepo = require('../repositories/restaurantRepository');
const menuRepo = require('../repositories/menuRepository');
const orderRepo = require('../repositories/orderRepository');
const staffRepo = require('../repositories/staffRepository');
const orderService = require('../services/orderService');
const authService = require('../services/authService');
const { requireWaiter } = require('../middleware/auth');
const { pushOrder, pushStaff } = require('../realtime/socket');

/**
 * Waiter login: restaurant code + username + password (owner-created account).
 * Logging in clocks the waiter ON shift so the round-robin engine starts
 * handing them new orders.
 */
router.post('/login', async (req, res) => {
  const { code, username, password } = req.body || {};
  const staff = staffRepo.findLogin(code, username, 'waiter');
  if (!staff || !authService.verifyPassword(password || '', staff.passwordHash)) {
    return res.status(401).json({ error: 'Invalid code, username or password' });
  }
  await staffRepo.update(staff.id, { onShift: true });
  pushStaff(req.app.get('io'), code);
  const restaurant = restaurantRepo.findByCode(code);
  const token = authService.signToken({ role: 'waiter', code: String(code), sid: staff.id, name: staff.name });
  res.json({
    token,
    staff: { id: staff.id, name: staff.name, onShift: true },
    restaurant: restaurant ? orderService.publicRestaurant(restaurant) : null,
  });
});

/** Toggle on/off shift. Off shift = the assignment engine skips this waiter. */
router.patch('/shift', requireWaiter, async (req, res, next) => {
  try {
    const onShift = req.body.onShift !== false;
    await staffRepo.update(req.waiter.sid, { onShift });
    pushStaff(req.app.get('io'), req.waiter.code);
    res.json({ onShift });
  } catch (e) {
    next(e);
  }
});

/** Live orders for this waiter: assigned to them + the unassigned pool. */
router.get('/orders', requireWaiter, (req, res) => {
  const orders = orderRepo
    .forWaiter(req.waiter.code, req.waiter.sid)
    .map(orderService.staffOrderView);
  res.json({ orders });
});

/** The menu, so the waiter can edit / add items to an order. */
router.get('/menu', requireWaiter, (req, res) => {
  res.json({ menu: menuRepo.byRestaurant(req.waiter.code) });
});

/**
 * Replace an order's items (edit / add-on-top at the customer's request). Allowed
 * until the food is served; totals are always recomputed server-side.
 */
router.patch('/orders/:id/items', requireWaiter, async (req, res, next) => {
  try {
    const order = orderRepo.findById(req.params.id);
    if (!order || order.restaurantCode !== req.waiter.code) {
      return res.status(404).json({ error: 'Order not found' });
    }
    if (['served', 'closed', 'cancelled'].includes(order.status)) {
      return res.status(409).json({ error: 'This order can no longer be edited' });
    }
    const updated = await orderService.setOrderItems(order.id, req.waiter.code, req.body.items);
    pushOrder(req.app.get('io'), updated);
    res.json({ order: orderService.staffOrderView(updated) });
  } catch (e) {
    next(e);
  }
});

/** Load + ownership guard shared by the transition handlers below. */
function loadOrder(req, res) {
  const order = orderRepo.findById(req.params.id);
  if (!order || order.restaurantCode !== req.waiter.code) {
    res.status(404).json({ error: 'Order not found' });
    return null;
  }
  return order;
}

/** Claim an unassigned order from the shared pool. */
router.post('/orders/:id/claim', requireWaiter, async (req, res, next) => {
  try {
    const order = loadOrder(req, res);
    if (!order) return;
    if (order.assignedWaiterId && order.assignedWaiterId !== req.waiter.sid) {
      return res.status(409).json({ error: 'Already assigned to another waiter' });
    }
    const updated = await orderRepo.update(order.id, {
      assignedWaiterId: req.waiter.sid,
      assignedWaiterName: req.waiter.name,
    });
    pushOrder(req.app.get('io'), updated);
    res.json({ order: orderService.staffOrderView(updated) });
  } catch (e) {
    next(e);
  }
});

/** Confirm the order and send it to the kitchen (placed -> confirmed). */
router.patch('/orders/:id/confirm', requireWaiter, async (req, res, next) => {
  try {
    const order = loadOrder(req, res);
    if (!order) return;
    if (order.status !== 'placed') {
      return res.status(409).json({ error: 'Only new orders can be confirmed' });
    }
    // Auto-claim if it was still in the pool.
    const patch = { status: 'confirmed' };
    if (!order.assignedWaiterId) {
      patch.assignedWaiterId = req.waiter.sid;
      patch.assignedWaiterName = req.waiter.name;
    }
    const updated = await orderRepo.update(order.id, patch);
    pushOrder(req.app.get('io'), updated);
    res.json({ order: orderService.staffOrderView(updated) });
  } catch (e) {
    next(e);
  }
});

/** Mark the food delivered to the table (ready -> served). */
router.patch('/orders/:id/serve', requireWaiter, async (req, res, next) => {
  try {
    const order = loadOrder(req, res);
    if (!order) return;
    if (order.status !== 'ready') {
      return res.status(409).json({ error: 'Order is not ready to serve yet' });
    }
    const updated = await orderService.updateStatus(order.id, 'served');
    pushOrder(req.app.get('io'), updated);
    res.json({ order: orderService.staffOrderView(updated) });
  } catch (e) {
    next(e);
  }
});

/** Settle the bill and close the order (served -> closed, paid). */
router.post('/orders/:id/settle', requireWaiter, async (req, res, next) => {
  try {
    const order = loadOrder(req, res);
    if (!order) return;
    if (order.status !== 'served' && order.status !== 'ready') {
      return res.status(409).json({ error: 'Serve the order before settling the bill' });
    }
    const updated = await orderService.settleOrder(order.id, req.body.method);
    pushOrder(req.app.get('io'), updated);
    res.json({ order: orderService.staffOrderView(updated) });
  } catch (e) {
    next(e);
  }
});

/** Cancel an order (e.g. customer left). */
router.patch('/orders/:id/cancel', requireWaiter, async (req, res, next) => {
  try {
    const order = loadOrder(req, res);
    if (!order) return;
    const updated = await orderService.updateStatus(order.id, 'cancelled');
    pushOrder(req.app.get('io'), updated);
    res.json({ order: orderService.staffOrderView(updated) });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
