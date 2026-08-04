'use strict';

const crypto = require('crypto');
const store = require('../data/store');

/** Data access for orders. Newest first when listed per restaurant. */
function byRestaurant(code) {
  return store
    .read()
    .orders.filter((o) => o.restaurantCode === String(code))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/** Orders for a restaurant placed by a given phone number (order history). */
function byRestaurantAndPhone(code, phone) {
  const p = String(phone || '').trim();
  if (!p) return [];
  return byRestaurant(code).filter((o) => o.customer && String(o.customer.phone) === p);
}

/** Orders whose status is one of `statuses` (dine-in kitchen/waiter queues). */
function byStatuses(code, statuses) {
  const set = new Set(statuses);
  return byRestaurant(code).filter((o) => set.has(o.status));
}

/**
 * Orders relevant to one waiter: everything assigned to them, plus the
 * unassigned pool (no waiter on shift when the order was placed) so any waiter
 * can pick them up. Closed/cancelled orders are excluded from the live view.
 */
function forWaiter(code, waiterId) {
  return byRestaurant(code).filter((o) => {
    if (o.status === 'closed' || o.status === 'cancelled') return false;
    return o.assignedWaiterId === waiterId || !o.assignedWaiterId;
  });
}

function findById(id) {
  return store.read().orders.find((o) => o.id === id) || null;
}

async function create(order) {
  const db = store.read();
  const record = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    ...order,
  };
  db.orders.push(record);
  await store.write(db);
  return record;
}

async function update(id, patch) {
  const db = store.read();
  const idx = db.orders.findIndex((o) => o.id === id);
  if (idx === -1) return null;
  db.orders[idx] = { ...db.orders[idx], ...patch, id };
  await store.write(db);
  return db.orders[idx];
}

module.exports = {
  byRestaurant,
  byRestaurantAndPhone,
  byStatuses,
  forWaiter,
  findById,
  create,
  update,
};
