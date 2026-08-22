'use strict';

const restaurantRepo = require('../repositories/restaurantRepository');
const menuRepo = require('../repositories/menuRepository');
const orderRepo = require('../repositories/orderRepository');
const geo = require('./geoService');
const assignment = require('./assignmentService');
const config = require('../config');

/**
 * Dine-in order lifecycle (2026 update). A seated customer places an order for
 * their table; it is auto-assigned to an on-shift waiter (round-robin) and then
 * flows:
 *
 *   placed -> confirmed -> preparing -> ready -> served -> closed
 *
 *   placed     customer placed it; auto-assigned to a waiter (or pooled)
 *   confirmed  waiter accepted it and sent it to the kitchen
 *   preparing  kitchen is cooking it
 *   ready      kitchen finished; the waiter is notified to serve
 *   served     waiter delivered the food to the table
 *   closed     waiter took payment (cash / UPI QR) and closed the bill
 *   cancelled  cancelled by the waiter or owner
 *
 * Payment is taken at the table at settlement time, so no online payment is
 * created up front (unlike a delivery app).
 */
const ORDER_STATUSES = [
  'placed',
  'confirmed',
  'preparing',
  'ready',
  'served',
  'closed',
  'cancelled',
];

const PAYMENT_METHODS = ['cash', 'upi'];

function httpError(message, status) {
  const e = new Error(message);
  e.status = status;
  return e;
}

/** Strip secrets before sending a restaurant object to the browser. */
function publicRestaurant(r) {
  return {
    code: r.code,
    name: r.name,
    description: r.description,
    currency: r.currency,
    location: r.location,
    radiusMeters: r.radiusMeters,
    upiId: r.upiId,
    active: r.active,
    // Dine-in additions:
    tables: Number(r.tables) || 0,
    paymentQRs: Array.isArray(r.paymentQRs) ? r.paymentQRs : [],
    // Menu "sections" (grid tiles) designed by admin; dishes reference a grid id.
    grids: Array.isArray(r.grids) ? r.grids : [],
  };
}

/**
 * A customer-safe view of an order (no internal ids / raw location). Used by the
 * live order-tracking endpoint and the socket updates the customer receives.
 */
function publicOrderView(o) {
  if (!o) return null;
  return {
    id: o.id,
    restaurantCode: o.restaurantCode,
    items: o.items,
    total: o.total,
    currency: o.currency,
    status: o.status,
    paymentStatus: o.paymentStatus,
    paymentMethod: o.paymentMethod || null,
    tableNumber: o.tableNumber,
    assignedWaiterName: o.assignedWaiterName || null,
    createdAt: o.createdAt,
    customer: { name: o.customer && o.customer.name },
  };
}

/**
 * A staff-facing view of an order (waiter / kitchen panels). Includes the table,
 * assigned waiter and customer contact, but never the raw GPS location.
 */
function staffOrderView(o) {
  if (!o) return null;
  return {
    id: o.id,
    restaurantCode: o.restaurantCode,
    tableNumber: o.tableNumber,
    items: o.items,
    total: o.total,
    currency: o.currency,
    status: o.status,
    paymentStatus: o.paymentStatus,
    paymentMethod: o.paymentMethod || null,
    assignedWaiterId: o.assignedWaiterId || null,
    assignedWaiterName: o.assignedWaiterName || null,
    customer: { name: o.customer && o.customer.name, phone: o.customer && o.customer.phone },
    createdAt: o.createdAt,
    closedAt: o.closedAt || null,
  };
}

/**
 * Rebuild a cart from trusted server data: verify each item belongs to the
 * restaurant and is available, and compute the total from DB prices (never the
 * client's numbers). Shared by order creation and waiter order editing.
 */
function priceItems(restaurantCode, items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw httpError('The order is empty', 400);
  }
  const lineItems = [];
  let total = 0;
  for (const it of items) {
    const menuItem = menuRepo.findById(it.itemId);
    if (!menuItem || menuItem.restaurantCode !== String(restaurantCode)) {
      throw httpError('The order contains an invalid item', 400);
    }
    if (!menuItem.available) {
      throw httpError(`${menuItem.name} is currently unavailable`, 400);
    }
    const qty = Math.max(1, parseInt(it.qty, 10) || 1);
    total += menuItem.price * qty;
    lineItems.push({ itemId: menuItem.id, name: menuItem.name, price: menuItem.price, qty });
  }
  return { lineItems, total };
}

/** Replace an order's items and re-price it (waiter edit / add-on-top). */
async function setOrderItems(orderId, restaurantCode, items) {
  const { lineItems, total } = priceItems(restaurantCode, items);
  return orderRepo.update(orderId, { items: lineItems, total });
}

/**
 * Create a dine-in order. Enforces the rules the browser must never be trusted
 * to do itself:
 *   1. The customer must be within the restaurant's geofence (presence check).
 *   2. A valid, unoccupied table number must be given (one live order/table).
 *   3. Prices/totals are computed from the DB, not from the client payload.
 * Then it auto-assigns the order to an on-shift waiter (round-robin).
 */
async function createOrder({ restaurantCode, items, customer, location, tableNumber }) {
  const restaurant = restaurantRepo.findByCode(restaurantCode);
  if (!restaurant) throw httpError('Restaurant not found', 404);
  if (!restaurant.active) throw httpError('This restaurant is not accepting orders', 403);

  // 1. Geofence presence check
  if (!location || typeof location.lat !== 'number' || typeof location.lng !== 'number') {
    throw httpError('Your location is required to place an order', 400);
  }
  const radius = restaurant.radiusMeters || config.defaultRadiusMeters;
  if (!geo.isWithin(restaurant.location, location, radius)) {
    throw httpError(`You must be within ${radius}m of the restaurant to order`, 403);
  }

  // 2. Table number — must be valid and not already occupied by a live order.
  const tableCount = Number(restaurant.tables) || 0;
  const table = parseInt(tableNumber, 10);
  if (!table || table < 1 || (tableCount && table > tableCount)) {
    throw httpError('Please select a valid table number', 400);
  }
  // A table is "occupied" only for OTHER guests. The same signed-in customer may
  // place additional orders on their own table (multiple rounds).
  const uid = customer && customer.uid;
  const activeOnTable = orderRepo.activeOrdersByTable(String(restaurantCode), table);
  const allMine = activeOnTable.length > 0 &&
    activeOnTable.every((o) => o.customer && o.customer.uid && o.customer.uid === uid);
  if (activeOnTable.length && !allMine) {
    throw httpError(`Table ${table} is currently occupied by another guest. Please pick another table or ask staff.`, 409);
  }

  // 3. Rebuild the cart from trusted server data (prices from the DB).
  const { lineItems, total } = priceItems(restaurantCode, items);

  // Round-robin assignment to an on-shift waiter (null => unassigned pool).
  const waiter = assignment.nextWaiter(String(restaurantCode));

  const order = await orderRepo.create({
    restaurantCode: String(restaurantCode),
    tableNumber: table,
    items: lineItems,
    total,
    currency: restaurant.currency || config.payment.currency,
    customer: { name: customer?.name || 'Guest', uid: customer?.uid || null },
    status: 'placed',
    paymentStatus: 'unpaid',
    paymentMethod: null,
    assignedWaiterId: waiter ? waiter.id : null,
    assignedWaiterName: waiter ? waiter.name : null,
    location,
  });

  return { order, restaurant: publicRestaurant(restaurant) };
}

/** Generic status change, validated against the known lifecycle. */
async function updateStatus(orderId, status) {
  if (!ORDER_STATUSES.includes(status)) throw httpError('Invalid order status', 400);
  const patch = { status };
  // Stamp when an order reaches a conclusive state (for History reporting).
  if (status === 'closed' || status === 'cancelled') patch.closedAt = new Date().toISOString();
  return orderRepo.update(orderId, patch);
}

/** Settle the bill at the table: record method, mark paid, close the order. */
async function settleOrder(orderId, method) {
  if (!PAYMENT_METHODS.includes(method)) {
    throw httpError('Payment method must be cash or upi', 400);
  }
  return orderRepo.update(orderId, {
    paymentStatus: 'paid',
    paymentMethod: method,
    status: 'closed',
    closedAt: new Date().toISOString(),
  });
}

/** Read a single order (used by the customer live-tracking endpoint). */
function getOrder(orderId) {
  const o = orderRepo.findById(orderId);
  if (!o) throw httpError('Order not found', 404);
  return o;
}

/**
 * Sales analytics for one restaurant, computed on the fly from its orders.
 * Kept simple and dependency-free (no analytics DB needed).
 */
function analytics(code) {
  const orders = orderRepo.byRestaurant(code);
  const paid = orders.filter((o) => o.paymentStatus === 'paid');
  const revenue = paid.reduce((s, o) => s + (o.total || 0), 0);

  const todayStr = new Date().toISOString().slice(0, 10);
  const todayOrders = orders.filter((o) => String(o.createdAt || '').slice(0, 10) === todayStr);
  const todayRevenue = todayOrders
    .filter((o) => o.paymentStatus === 'paid')
    .reduce((s, o) => s + (o.total || 0), 0);

  const statusCounts = {};
  ORDER_STATUSES.forEach((s) => (statusCounts[s] = 0));
  orders.forEach((o) => {
    statusCounts[o.status] = (statusCounts[o.status] || 0) + 1;
  });

  const itemMap = {};
  paid.forEach((o) =>
    (o.items || []).forEach((it) => {
      const key = it.name;
      itemMap[key] = itemMap[key] || { name: it.name, qty: 0, revenue: 0 };
      itemMap[key].qty += it.qty;
      itemMap[key].revenue += it.price * it.qty;
    })
  );
  const topItems = Object.values(itemMap)
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 5);

  return {
    totalOrders: orders.length,
    paidOrders: paid.length,
    revenue,
    avgOrderValue: paid.length ? Math.round(revenue / paid.length) : 0,
    todayOrders: todayOrders.length,
    todayRevenue,
    statusCounts,
    topItems,
    currency: (orders[0] && orders[0].currency) || config.payment.currency,
  };
}

module.exports = {
  createOrder,
  setOrderItems,
  updateStatus,
  settleOrder,
  getOrder,
  analytics,
  publicRestaurant,
  publicOrderView,
  staffOrderView,
  ORDER_STATUSES,
  PAYMENT_METHODS,
};
