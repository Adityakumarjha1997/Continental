'use strict';

const crypto = require('crypto');
const store = require('../data/store');

/**
 * Data access for staff accounts (waiters + kitchen), introduced by the 2026
 * dine-in update. Each staff member belongs to one restaurant `code` and has a
 * `role` of 'waiter' or 'kitchen'. Usernames are unique per restaurant.
 *
 * Waiters carry an `onShift` flag: the round-robin order assignment only hands
 * new orders to waiters who are currently on shift (clocked in).
 */
function byRestaurant(code) {
  return store.read().staff.filter((s) => s.restaurantCode === String(code));
}

function byRole(code, role) {
  return byRestaurant(code).filter((s) => s.role === role);
}

/** Waiters who are clocked in — the pool the assignment engine draws from. */
function activeWaiters(code) {
  return byRole(code, 'waiter').filter((s) => s.onShift);
}

function findById(id) {
  return store.read().staff.find((s) => s.id === id) || null;
}

/** Look up a login by restaurant code + username + role (case-insensitive user). */
function findLogin(code, username, role) {
  const u = String(username || '').trim().toLowerCase();
  return (
    store
      .read()
      .staff.find(
        (s) =>
          s.restaurantCode === String(code) &&
          s.role === role &&
          String(s.username).toLowerCase() === u
      ) || null
  );
}

function usernameTaken(code, username) {
  const u = String(username || '').trim().toLowerCase();
  return byRestaurant(code).some((s) => String(s.username).toLowerCase() === u);
}

async function create(staff) {
  const db = store.read();
  const record = {
    id: crypto.randomUUID(),
    onShift: false,
    createdAt: new Date().toISOString(),
    ...staff,
  };
  db.staff.push(record);
  await store.write(db);
  return record;
}

async function update(id, patch) {
  const db = store.read();
  const idx = db.staff.findIndex((s) => s.id === id);
  if (idx === -1) return null;
  db.staff[idx] = { ...db.staff[idx], ...patch, id };
  await store.write(db);
  return db.staff[idx];
}

async function remove(id) {
  const db = store.read();
  db.staff = db.staff.filter((s) => s.id !== id);
  await store.write(db);
}

module.exports = {
  byRestaurant,
  byRole,
  activeWaiters,
  findById,
  findLogin,
  usernameTaken,
  create,
  update,
  remove,
};
