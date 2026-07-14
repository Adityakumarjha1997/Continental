'use strict'; 
 
const express = require('express'); 
const router = express.Router(); 
 
router.get('/health', (req, res) => res.json({ ok: true })); 
router.use('/public', require('./publicRoutes')); 
router.use('/owner', require('./ownerRoutes')); 
router.use('/admin', require('./adminRoutes')); 
 
module.exports = router; 
 

 
