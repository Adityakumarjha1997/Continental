'use strict';

const express = require('express');
const router = express.Router();

const restaurantRepo = require('../repositories/restaurantRepository');
const menuRepo = require('../repositories/menuRepository');
const orderRepo = require('../repositories/orderRepository');
const customerRepo = require('../repositories/customerRepository');
const orderService = require('../services/orderService');
const authService = require('../services/authService');
const geo = require('../services/geoService');
const { pushOrder } = require('../realtime/socket');
const { getToken } = require('../middleware/auth');

/** Returns the signed-in customer payload {uid, username} or null. */
function customerFromReq(req) {
  const p = authService.verifyToken(getToken(req));
  return p && p.role === 'customer' ? p : null;
}

/* --------------------------- Customer auth ----------------------------- */

/** Sign up a new customer account. */
router.post('/signup', async (req, res, next) => {
  try {
    const { username, password, confirmPassword } = req.body || {};
    const u = String(username || '').trim();
    if (u.length < 3) return res.status(400).json({ error: 'Username must be at least 3 characters' });
    if (!password || String(password).length < 4) {
      return res.status(400).json({ error: 'Password must be at least 4 characters' });
    }
    if (password !== confirmPassword) return res.status(400).json({ error: 'Passwords do not match' });
    if (customerRepo.findByUsername(u)) return res.status(409).json({ error: 'That username is already taken' });

    const customer = await customerRepo.create({
      username: u,
      passwordHash: authService.hashPassword(String(password)),
    });
    const token = authService.signToken({ role: 'customer', uid: customer.id, username: customer.username }, '30d');
    res.status(201).json({ token, username: customer.username });
  } catch (e) {
    next(e);
  }
});

/** Log in an existing customer. */
router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  const c = customerRepo.findByUsername(username);
  if (!c || !authService.verifyPassword(password || '', c.passwordHash)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  const token = authService.signToken({ role: 'customer', uid: c.id, username: c.username }, '30d');
  res.json({ token, username: c.username });
});

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

/**
 * Which table numbers are free vs occupied. A table occupied by the requesting
 * customer's OWN live order is NOT reported as occupied to them (so they can add
 * another round), and is returned in `myTables`.
 */
router.get('/restaurants/:code/tables', (req, res) => {
  const r = restaurantRepo.findByCode(req.params.code);
  if (!r) return res.status(404).json({ error: 'Not found' });
  const uid = (customerFromReq(req) || {}).uid;

  const byTable = {};
  orderRepo.byRestaurant(req.params.code).forEach((o) => {
    if (o.status !== 'closed' && o.status !== 'cancelled' && o.tableNumber != null) {
      (byTable[o.tableNumber] = byTable[o.tableNumber] || []).push(o);
    }
  });
  const occupied = [];
  const myTables = [];
  Object.keys(byTable).forEach((t) => {
    const mine = byTable[t].every((o) => o.customer && o.customer.uid && o.customer.uid === uid);
    if (mine) myTables.push(Number(t));
    else occupied.push(Number(t));
  });
  res.json({ tables: Number(r.tables) || 0, occupied, myTables });
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
    const cust = customerFromReq(req);
    if (!cust) return res.status(401).json({ error: 'Please sign in to place an order' });
    const { restaurantCode, items, location, tableNumber } = req.body || {};
    const result = await orderService.createOrder({
      restaurantCode,
      items,
      customer: { uid: cust.uid, name: cust.username },
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
