'use strict';

const crypto = require('crypto');
const express = require('express');
const router = express.Router();

const restaurantRepo = require('../repositories/restaurantRepository');
const orderRepo = require('../repositories/orderRepository');
const staffRepo = require('../repositories/staffRepository');
const orderService = require('../services/orderService');
const authService = require('../services/authService');
const { requireOwner } = require('../middleware/auth');
const { pushOrder } = require('../realtime/socket');

/** Never leak the password hash of a staff account to the browser. */
function sanitizeStaff(s) {
  return {
    id: s.id,
    role: s.role,
    name: s.name,
    username: s.username,
    onShift: !!s.onShift,
    createdAt: s.createdAt,
  };
}

/** Owner login: 3-digit code + password. */
router.post('/login', (req, res) => {
  const { code, password } = req.body || {};
  const r = restaurantRepo.findByCode(code);
  if (!r || !authService.verifyPassword(password || '', r.ownerPasswordHash)) {
    return res.status(401).json({ error: 'Invalid code or password' });
  }
  const token = authService.signToken({ role: 'owner', code: r.code });
  res.json({ token, restaurant: orderService.publicRestaurant(r) });
});

/** All orders for the logged-in owner's restaurant (live monitoring board). */
router.get('/orders', requireOwner, (req, res) => {
  res.json({ orders: orderRepo.byRestaurant(req.owner.code) });
});

/** Sales analytics for the logged-in owner's restaurant. */
router.get('/analytics', requireOwner, (req, res) => {
  res.json({ analytics: orderService.analytics(req.owner.code) });
});

/** Owner can cancel / override an order's status; broadcasts the change live. */
router.patch('/orders/:id', requireOwner, async (req, res, next) => {
  try {
    const order = orderRepo.findById(req.params.id);
    if (!order || order.restaurantCode !== req.owner.code) {
      return res.status(404).json({ error: 'Order not found' });
    }
    const updated = await orderService.updateStatus(req.params.id, req.body.status);
    pushOrder(req.app.get('io'), updated);
    res.json({ order: updated });
  } catch (e) {
    next(e);
  }
});

/* ------------------------------- Staff --------------------------------- */
/* Owners manage their own waiters + kitchen accounts. */

router.get('/staff', requireOwner, (req, res) => {
  res.json({ staff: staffRepo.byRestaurant(req.owner.code).map(sanitizeStaff) });
});

router.post('/staff', requireOwner, async (req, res, next) => {
  try {
    const { role, name, username, password } = req.body || {};
    if (role !== 'waiter' && role !== 'kitchen') {
      return res.status(400).json({ error: 'Role must be waiter or kitchen' });
    }
    if (!name || !username || !password) {
      return res.status(400).json({ error: 'Name, username and password are required' });
    }
    if (staffRepo.usernameTaken(req.owner.code, username)) {
      return res.status(409).json({ error: 'That username is already used at this restaurant' });
    }
    const staff = await staffRepo.create({
      restaurantCode: req.owner.code,
      role,
      name: String(name).trim(),
      username: String(username).trim(),
      passwordHash: authService.hashPassword(String(password)),
      onShift: false,
    });
    res.status(201).json({ staff: sanitizeStaff(staff) });
  } catch (e) {
    next(e);
  }
});

router.delete('/staff/:id', requireOwner, async (req, res, next) => {
  try {
    const s = staffRepo.findById(req.params.id);
    if (!s || s.restaurantCode !== req.owner.code) {
      return res.status(404).json({ error: 'Staff member not found' });
    }
    await staffRepo.remove(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

/* ------------------------------ Settings ------------------------------- */
/* Table count + saved UPI payment QR codes used at settlement. */

router.patch('/settings', requireOwner, async (req, res, next) => {
  try {
    const patch = {};
    if (req.body.tables != null) {
      const t = parseInt(req.body.tables, 10);
      if (isNaN(t) || t < 0 || t > 500) {
        return res.status(400).json({ error: 'Tables must be a number between 0 and 500' });
      }
      patch.tables = t;
    }
    if (req.body.paymentQRs != null) {
      if (!Array.isArray(req.body.paymentQRs)) {
        return res.status(400).json({ error: 'paymentQRs must be a list' });
      }
      // Re-key server-side so the browser can't forge ids; keep only known fields.
      patch.paymentQRs = req.body.paymentQRs.slice(0, 20).map((q) => ({
        id: q.id || crypto.randomUUID(),
        label: String(q.label || 'UPI').slice(0, 60),
        upiId: String(q.upiId || '').slice(0, 120),
        imageUrl: String(q.imageUrl || '').slice(0, 2000),
      }));
    }
    const updated = await restaurantRepo.update(req.owner.code, patch);
    if (!updated) return res.status(404).json({ error: 'Restaurant not found' });
    res.json({ restaurant: orderService.publicRestaurant(updated) });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
