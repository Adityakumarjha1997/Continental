'use strict';

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config');

/** Password hashing + JWT issuing/verifying for owners and admin. */
function hashPassword(plain) {
  return bcrypt.hashSync(plain, 10);
}

function verifyPassword(plain, hash) {
  if (!hash) return false;
  return bcrypt.compareSync(plain, hash);
}

function signToken(payload, expiresIn = '12h') {
  return jwt.sign(payload, config.jwtSecret, { expiresIn });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, config.jwtSecret);
  } catch {
    return null;
  }
}

/**
 * A short-lived, order-scoped token handed to the customer when they place an
 * order. It proves "I am the person who placed order X" without needing a
 * customer login, so only that customer can confirm payment for the order or
 * follow its live status. Everything is still verified server-side.
 */
function signOrderToken(orderId) {
  return jwt.sign({ oid: String(orderId), kind: 'order' }, config.jwtSecret, {
    expiresIn: '2d',
  });
}

function verifyOrderToken(token) {
  const payload = verifyToken(token);
  if (!payload || payload.kind !== 'order' || !payload.oid) return null;
  return payload;
}

module.exports = {
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  signOrderToken,
  verifyOrderToken,
};
