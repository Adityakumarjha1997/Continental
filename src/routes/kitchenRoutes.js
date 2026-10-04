'use strict';

const express = require('express');
const router = express.Router();

const restaurantRepo = require('../repositories/restaurantRepository');
const orderRepo = require('../repositories/orderRepository');
const staffRepo = require('../repositories/staffRepository');
const orderService = require('../services/orderService');
const authService = require('../services/authService');
const { requireKitchen } = require('../middleware/auth');
const { pushOrder } = require('../realtime/socket');

/** Kitchen login: restaurant code + username + password (owner-created). */
router.post('/login', (req, res) => {
  const { code, username, password } = req.body || {};
  const staff = staffRepo.findLogin(code, username, 'kitchen');
  if (!staff || !authService.verifyPassword(password || '', staff.passwordHash)) {
    return res.status(401).json({ error: 'Invalid code, username or password' });
  }
  const restaurant = restaurantRepo.findByCode(code);
  const token = authService.signToken({ role: 'kitchen', code: String(code), sid: staff.id, name: staff.name });
  res.json({
    token,
    staff: { id: staff.id, name: staff.name },
    restaurant: restaurant ? orderService.publicRestaurant(restaurant) : null,
  });
});

/**
 * The kitchen queue. In the full (waiter) model it holds confirmed + preparing
 * orders. In the small (owner + kitchen) model there is no waiter to confirm, so
 * newly placed orders land in the kitchen directly: placed + preparing.
 */
router.get('/orders', requireKitchen, (req, res) => {
  const restaurant = restaurantRepo.findByCode(req.kitchen.code);
  const statuses = orderService.isSmallMode(restaurant)
    ? ['placed', 'preparing']
    : ['confirmed', 'preparing'];
  const orders = orderRepo
    .byStatuses(req.kitchen.code, statuses)
    .map(orderService.staffOrderView);
  res.json({ orders });
});

function loadOrder(req, res) {
  const order = orderRepo.findById(req.params.id);
  if (!order || order.restaurantCode !== req.kitchen.code) {
    res.status(404).json({ error: 'Order not found' });
    return null;
  }
  return order;
}

/**
 * Start cooking (-> preparing). Full model starts from a waiter-confirmed order;
 * small model starts straight from a freshly placed order.
 */
router.patch('/orders/:id/start', requireKitchen, async (req, res, next) => {
  try {
    const order = loadOrder(req, res);
    if (!order) return;
    const restaurant = restaurantRepo.findByCode(req.kitchen.code);
    const startable = orderService.isSmallMode(restaurant) ? ['placed', 'confirmed'] : ['confirmed'];
    if (!startable.includes(order.status)) {
      return res.status(409).json({ error: 'This order cannot be started yet' });
    }
    const updated = await orderService.updateStatus(order.id, 'preparing');
    pushOrder(req.app.get('io'), updated);
    res.json({ order: orderService.staffOrderView(updated) });
  } catch (e) {
    next(e);
  }
});

/** Food is ready; the assigned waiter is notified (confirmed/preparing -> ready). */
router.patch('/orders/:id/ready', requireKitchen, async (req, res, next) => {
  try {
    const order = loadOrder(req, res);
    if (!order) return;
    if (order.status !== 'confirmed' && order.status !== 'preparing') {
      return res.status(409).json({ error: 'Order is not in the kitchen' });
    }
    const updated = await orderService.updateStatus(order.id, 'ready');
    pushOrder(req.app.get('io'), updated);
    res.json({ order: orderService.staffOrderView(updated) });
  } catch (e) {
    next(e);
  }
});

/**
 * Small-model only: the kitchen serves the order itself and closes it (there is
 * no waiter to hand off to). Marks it paid and closed in one step.
 */
router.post('/orders/:id/close', requireKitchen, async (req, res, next) => {
  try {
    const order = loadOrder(req, res);
    if (!order) return;
    const restaurant = restaurantRepo.findByCode(req.kitchen.code);
    if (!orderService.isSmallMode(restaurant)) {
      return res.status(403).json({ error: 'Only available in the owner + kitchen model' });
    }
    if (!['placed', 'confirmed', 'preparing'].includes(order.status)) {
      return res.status(409).json({ error: 'This order is already closed' });
    }
    const method = orderService.PAYMENT_METHODS.includes(req.body.method) ? req.body.method : 'cash';
    const updated = await orderService.settleOrder(order.id, method);
    pushOrder(req.app.get('io'), updated);
    res.json({ order: orderService.staffOrderView(updated) });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
