'use strict';

const authService = require('../services/authService');

function getToken(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

function requireOwner(req, res, next) {
  const payload = authService.verifyToken(getToken(req));
  if (!payload || payload.role !== 'owner') {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  req.owner = payload; // { role, code }
  next();
}

/** Waiter guard. Token payload: { role:'waiter', code, sid, name }. */
function requireWaiter(req, res, next) {
  const payload = authService.verifyToken(getToken(req));
  if (!payload || payload.role !== 'waiter') {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  req.waiter = payload;
  next();
}

/** Kitchen guard. Token payload: { role:'kitchen', code, sid, name }. */
function requireKitchen(req, res, next) {
  const payload = authService.verifyToken(getToken(req));
  if (!payload || payload.role !== 'kitchen') {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  req.kitchen = payload;
  next();
}

module.exports = { requireOwner, requireWaiter, requireKitchen, getToken };
