'use strict'; 
 
const express = require('express'); 
const router = express.Router(); 
 
const restaurantRepo = require('../repositories/restaurantRepository'); 
const menuRepo = require('../repositories/menuRepository'); 
const orderService = require('../services/orderService'); 
const geo = require('../services/geoService'); 
 
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
 
/** Place an order (validates geofence + prices server-side). */ 
router.post('/orders', async (req, res, next) => { 
  try { 
    const { restaurantCode, items, customer, location } = req.body || {}; 
    const result = await orderService.createOrder({ restaurantCode, items, customer, location }); 
    // Push the new order to the owner dashboard in real time 
    req.app.get('io').to('restaurant:' + result.order.restaurantCode).emit('order:new', result.order); 
    res.status(201).json(result); 
  } catch (e) { 
    next(e); 
  } 
}); 
 
/** Confirm payment after the customer pays. */ 
router.post('/orders/:id/confirm', async (req, res, next) => { 
  try { 
    const result = await orderService.confirmPayment({ 
      orderId: req.params.id, 
      paymentPayload: req.body, 
    }); 
    if (result.ok) { 
      req.app.get('io').to('restaurant:' + result.order.restaurantCode).emit('order:update', result.order); 
    } 
    res.json(result); 
  } catch (e) { 
    next(e); 
  } 
}); 
 
module.exports = router; 
 

 
