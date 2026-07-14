'use strict'; 
 
const express = require('express'); 
const router = express.Router(); 
 
const config = require('../config'); 
const restaurantRepo = require('../repositories/restaurantRepository'); 
const menuRepo = require('../repositories/menuRepository'); 
const authService = require('../services/authService'); 
const { requireAdmin } = require('../middleware/auth'); 
 
/** Never leak the password hash to the browser. */ 
function sanitize(r) { 
  const { ownerPasswordHash, ...rest } = r; 
  return { ...rest, hasOwnerPassword: !!ownerPasswordHash }; 
} 
 
/** Admin login (company owner). Single shared admin password from .env. */ 
router.post('/login', (req, res) => { 
  const { password } = req.body || {}; 
  if (password !== config.adminPassword) { 
    return res.status(401).json({ error: 'Invalid admin password' }); 
  } 
  res.json({ token: authService.signToken({ role: 'admin' }, '24h') }); 
}); 
 
/* ----------------------------- Restaurants ----------------------------- */ 
 
router.get('/restaurants', requireAdmin, (req, res) => { 
  res.json({ restaurants: restaurantRepo.all().map(sanitize) }); 
}); 
 
router.post('/restaurants', requireAdmin, async (req, res, next) => { 
  try { 
    const { code, name, description, upiId, ownerPassword, lat, lng, radiusMeters, currency } = req.body || {}; 
    if (!/^\d{3}$/.test(String(code || ''))) { 
      return res.status(400).json({ error: 'Code must be exactly 3 digits' }); 
    } 
    if (restaurantRepo.findByCode(code)) { 
      return res.status(409).json({ error: 'That code is already in use' }); 
    } 
    if (!name) return res.status(400).json({ error: 'Name is required' }); 
    if (!ownerPassword) return res.status(400).json({ error: 'Owner password is required' }); 
    if (typeof lat !== 'number' || typeof lng !== 'number') { 
      return res.status(400).json({ error: 'Valid location (lat/lng) is required' }); 
    } 
 
    const restaurant = await restaurantRepo.create({ 
      code: String(code), 
      name, 
      description: description || '', 
      upiId: upiId || '', 
      ownerPasswordHash: authService.hashPassword(ownerPassword), 
      location: { lat, lng }, 
      radiusMeters: Number(radiusMeters) || config.defaultRadiusMeters, 
      currency: currency || config.payment.currency, 
      active: true, 
    }); 
    res.status(201).json({ restaurant: sanitize(restaurant) }); 
  } catch (e) { 
    next(e); 
  } 
}); 
 
router.patch('/restaurants/:code', requireAdmin, async (req, res, next) => { 
  try { 
    const patch = { ...req.body }; 
    if (patch.ownerPassword) { 
      patch.ownerPasswordHash = authService.hashPassword(patch.ownerPassword); 
    } 
    delete patch.ownerPassword; 
    if (patch.lat != null && patch.lng != null) { 
      patch.location = { lat: Number(patch.lat), lng: Number(patch.lng) }; 
    } 
    delete patch.lat; 
    delete patch.lng; 
    if (patch.radiusMeters != null) patch.radiusMeters = Number(patch.radiusMeters); 
    delete patch.code; 
 
    const updated = await restaurantRepo.update(req.params.code, patch); 
    if (!updated) return res.status(404).json({ error: 'Not found' }); 
    res.json({ restaurant: sanitize(updated) }); 
  } catch (e) { 
    next(e); 
  } 
}); 
 
router.delete('/restaurants/:code', requireAdmin, async (req, res, next) => { 
  try { 
    await restaurantRepo.remove(req.params.code); 
    res.json({ ok: true }); 
  } catch (e) { 
    next(e); 
  } 
}); 
 
/* -------------------------------- Menu --------------------------------- */ 
 
router.get('/restaurants/:code/menu', requireAdmin, (req, res) => { 
  res.json({ menu: menuRepo.byRestaurant(req.params.code) }); 
}); 
 
router.post('/restaurants/:code/menu', requireAdmin, async (req, res, next) => { 
  try { 
    const { name, description, price, category, available } = req.body || {}; 
    if (!name || price == null) { 
      return res.status(400).json({ error: 'Name and price are required' }); 
    } 
    const item = await menuRepo.create({ 
      restaurantCode: String(req.params.code), 
      name, 
      description: description || '', 
      price: Number(price), 
      category: category || 'General', 
      available: available !== false, 
    }); 
    res.status(201).json({ item }); 
  } catch (e) { 
    next(e); 
  } 
}); 
 
router.patch('/menu/:id', requireAdmin, async (req, res, next) => { 
  try { 
    const patch = { ...req.body }; 
    if (patch.price != null) patch.price = Number(patch.price); 
    const item = await menuRepo.update(req.params.id, patch); 
    if (!item) return res.status(404).json({ error: 'Not found' }); 
    res.json({ item }); 
  } catch (e) { 
    next(e); 
  } 
}); 
 
router.delete('/menu/:id', requireAdmin, async (req, res, next) => { 
  try { 
    await menuRepo.remove(req.params.id); 
    res.json({ ok: true }); 
  } catch (e) { 
    next(e); 
  } 
}); 
 
module.exports = router; 
 

 
