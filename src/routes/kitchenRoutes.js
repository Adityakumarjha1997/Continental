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

/** The kitchen queue: confirmed (to start) + preparing (in progress). */
router.get('/orders', requireKitchen, (req, res) => {
  const orders = orderRepo
    .byStatuses(req.kitchen.code, ['confirmed', 'preparing'])
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

/** Start cooking (confirmed -> preparing). */
router.patch('/orders/:id/start', requireKitchen, async (req, res, next) => {
  try {
    const order = loadOrder(req, res);
    if (!order) return;
    if (order.status !== 'confirmed') {
      return res.status(409).json({ error: 'Only confirmed orders can be started' });
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

module.exports = router;
