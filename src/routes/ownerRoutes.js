'use strict'; 
 
const express = require('express'); 
const router = express.Router(); 
 
const restaurantRepo = require('../repositories/restaurantRepository'); 
const orderRepo = require('../repositories/orderRepository'); 
const orderService = require('../services/orderService'); 
const authService = require('../services/authService'); 
const { requireOwner } = require('../middleware/auth'); 
 
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
 
/** All orders for the logged-in owner's restaurant. */ 
router.get('/orders', requireOwner, (req, res) => { 
  res.json({ orders: orderRepo.byRestaurant(req.owner.code) }); 
}); 
 
/** Advance / change an order's status. */ 
router.patch('/orders/:id', requireOwner, async (req, res, next) => { 
  try { 
    const order = orderRepo.findById(req.params.id); 
    if (!order || order.restaurantCode !== req.owner.code) { 
      return res.status(404).json({ error: 'Order not found' }); 
    } 
    const updated = await orderService.updateStatus(req.params.id, req.body.status); 
    req.app.get('io').to('restaurant:' + req.owner.code).emit('order:update', updated); 
    res.json({ order: updated }); 
  } catch (e) { 
    next(e); 
  } 
}); 
 
module.exports = router; 
 

 
