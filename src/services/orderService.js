'use strict'; 
 
const restaurantRepo = require('../repositories/restaurantRepository'); 
const menuRepo = require('../repositories/menuRepository'); 
const orderRepo = require('../repositories/orderRepository'); 
const geo = require('./geoService'); 
const payment = require('./payment'); 
const config = require('../config'); 
 
const ORDER_STATUSES = [ 
  'placed', 
  'confirmed', 
  'preparing', 
  'ready', 
  'completed', 
  'cancelled', 
]; 
 
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
  }; 
} 
 
/** 
* Create an order. Enforces two critical server-side rules that the browser 
* must never be trusted to do itself: 
*   1. The customer must be within the restaurant's geofence radius. 
*   2. Prices/totals are computed from the DB, not from the client payload. 
*/ 
async function createOrder({ restaurantCode, items, customer, location }) { 
  const restaurant = restaurantRepo.findByCode(restaurantCode); 
  if (!restaurant) throw httpError('Restaurant not found', 404); 
  if (!restaurant.active) throw httpError('This restaurant is not accepting orders', 403); 
 
  // 1. Geofence check 
  if (!location || typeof location.lat !== 'number' || typeof location.lng !== 'number') { 
    throw httpError('Your location is required to place an order', 400); 
  } 
  const radius = restaurant.radiusMeters || config.defaultRadiusMeters; 
  if (!geo.isWithin(restaurant.location, location, radius)) { 
    throw httpError(`You must be within ${radius}m of the restaurant to order`, 403); 
  } 
 
  // 2. Rebuild the cart from trusted server data 
  if (!Array.isArray(items) || items.length === 0) { 
    throw httpError('Your cart is empty', 400); 
  } 
  const lineItems = []; 
  let total = 0; 
  for (const it of items) { 
    const menuItem = menuRepo.findById(it.itemId); 
    if (!menuItem || menuItem.restaurantCode !== String(restaurantCode)) { 
      throw httpError('Your cart contains an invalid item', 400); 
    } 
    if (!menuItem.available) { 
      throw httpError(`${menuItem.name} is currently unavailable`, 400); 
    } 
    const qty = Math.max(1, parseInt(it.qty, 10) || 1); 
    total += menuItem.price * qty; 
    lineItems.push({ itemId: menuItem.id, name: menuItem.name, price: menuItem.price, qty }); 
  } 
 
  // Create the payment order with the active provider (mock or razorpay) 
  const receipt = 'rcpt_' + Date.now(); 
  const paymentOrder = await payment.createOrder({ 
    amount: total, 
    currency: restaurant.currency || config.payment.currency, 
    receipt, 
  }); 
 
  const order = await orderRepo.create({ 
    restaurantCode: String(restaurantCode), 
    items: lineItems, 
    total, 
    currency: restaurant.currency || config.payment.currency, 
    customer: { name: customer?.name || 'Guest', phone: customer?.phone || '' }, 
    status: 'placed', 
    paymentStatus: 'pending', 
    paymentProvider: payment.name, 
    paymentOrderId: paymentOrder.id, 
    location, 
  }); 
 
  return { 
    order, 
    paymentOrder, 
    provider: payment.name, 
    keyId: config.payment.razorpay.keyId, // needed by the Razorpay browser widget 
    restaurant: publicRestaurant(restaurant), 
  }; 
} 
 
/** Confirm payment after the customer pays (verifies signature in razorpay mode). */ 
async function confirmPayment({ orderId, paymentPayload }) { 
  const order = orderRepo.findById(orderId); 
  if (!order) throw httpError('Order not found', 404); 
 
  const ok = payment.verifyPayment({ 
    razorpayOrderId: order.paymentOrderId, 
    razorpayPaymentId: paymentPayload?.razorpay_payment_id, 
    razorpaySignature: paymentPayload?.razorpay_signature, 
  }); 
 
  const updated = await orderRepo.update(orderId, { 
    paymentStatus: ok ? 'paid' : 'failed', 
    paymentId: paymentPayload?.razorpay_payment_id || null, 
    status: ok ? 'confirmed' : 'placed', 
  }); 
 
  return { ok, order: updated }; 
} 
 
async function updateStatus(orderId, status) { 
  if (!ORDER_STATUSES.includes(status)) throw httpError('Invalid order status', 400); 
  return orderRepo.update(orderId, { status }); 
} 
 
module.exports = { 
  createOrder, 
  confirmPayment, 
  updateStatus, 
  publicRestaurant, 
  ORDER_STATUSES, 
}; 
 

 
