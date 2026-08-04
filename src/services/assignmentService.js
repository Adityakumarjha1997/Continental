'use strict';

const staffRepo = require('../repositories/staffRepository');

/**
 * Round-robin waiter assignment.
 *
 * When a customer places an order it is handed to the "next" active (on-shift)
 * waiter for that restaurant, cycling evenly through them so the load is spread
 * (matches the 4A / 4B distribution in the design notes). If NO waiter is on
 * shift the order is left unassigned and drops into a shared pool that any
 * waiter can claim from their panel.
 *
 * The rotation pointer is kept in memory per restaurant. That is intentional:
 * it does not need to survive restarts, and on the single-instance free tier it
 * behaves deterministically.
 */
const pointers = Object.create(null); // restaurantCode -> next index

function nextWaiter(code) {
  const active = staffRepo.activeWaiters(code);
  if (!active.length) return null;

  const start = pointers[code] || 0;
  const idx = start % active.length;
  pointers[code] = (idx + 1) % active.length;
  return active[idx];
}

module.exports = { nextWaiter };
