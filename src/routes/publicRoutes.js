'use strict';

const express = require('express');
const router = express.Router();

const restaurantRepo = require('../repositories/restaurantRepository');
const menuRepo = require('../repositories/menuRepository');
const orderRepo = require('../repositories/orderRepository');
const orderService = require('../services/orderService');
const authService = require('../services/authService');
const geo = require('../services/geoService');
const { pushOrder } = require('../realtime/socket');

/** Look up a restaurant by its 3-digit code (customer entered it on the keypad). */
router.get('/restaurants/:code', (req, res) => {
  const r = restaurantRepo.findByCode(req.params.code);
  if (!r || !r.active) {
    return res.status(404).json({ error: 'No restaurant found for this code' });
  }
  res.json({ restaurant: orderService.publicRestaurant(r) });
});

/** Get the menu for a code. */
router.get('/restaurants/:code/menu', (req, res) => {
  const r = restaurantRepo.findByCode(req.params.code);
  if (!r || !r.active) {
    return res.status(404).json({ error: 'No restaurant found for this code' });
  }
  res.json({
    restaurant: orderService.publicRestaurant(r),
    menu: menuRepo.byRestaurant(req.params.code),
  });
});

/** Distance check so the UI can enable/disable the order button live. */
router.post('/restaurants/:code/geocheck', (req, res) => {
  const r = restaurantRepo.findByCode(req.params.code);
  if (!r) return res.status(404).json({ error: 'Not found' });
  const { lat, lng } = req.body || {};
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return res.status(400).json({ error: 'lat/lng required' });
  }
  const dist = geo.distanceMeters(r.location, { lat, lng });
  res.json({
    distanceMeters: Math.round(dist),
    radiusMeters: r.radiusMeters,
    withinRange: dist <= r.radiusMeters,
  });
});

/**
 * Order history for a customer (by phone) at one restaurant. Lightweight, no
 * login: returns only customer-safe fields. Used by the "My orders" screen.
 */
router.get('/restaurants/:code/orders', (req, res) => {
  const phone = req.query.phone;
  if (!phone) return res.json({ orders: [] });
  const orders = orderRepo
    .byRestaurantAndPhone(req.params.code, phone)
    .map(orderService.publicOrderView);
  res.json({ orders });
});

/**
 * Place a dine-in order (validates geofence + table + prices server-side, then
 * auto-assigns a waiter). Returns an order token so only the person who placed
 * it can follow its live status.
 */
router.post('/orders', async (req, res, next) => {
  try {
    const { restaurantCode, items, customer, location, tableNumber } = req.body || {};
    const result = await orderService.createOrder({
      restaurantCode,
      items,
      customer,
      location,
      tableNumber,
    });
    // Notify owner board + kitchen + the assigned/pool waiter(s) in real time.
    pushOrder(req.app.get('io'), result.order, 'order:new');
    res.status(201).json({
      order: orderService.publicOrderView(result.order),
      orderToken: authService.signOrderToken(result.order.id),
      restaurant: result.restaurant,
    });
  } catch (e) {
    next(e);
  }
});

/**
 * Live status of a single order, for the customer's tracking screen. Requires
 * the order token issued at creation (query ?token= or X-Order-Token header),
 * so only the person who placed the order can read it.
 */
router.get('/orders/:id', (req, res, next) => {
  try {
    const token = req.query.token || req.headers['x-order-token'];
    const payload = authService.verifyOrderToken(token);
    if (!payload || payload.oid !== req.params.id) {
      return res.status(401).json({ error: 'Invalid or missing order token' });
    }
    const order = orderService.getOrder(req.params.id);
    res.json({ order: orderService.publicOrderView(order) });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
