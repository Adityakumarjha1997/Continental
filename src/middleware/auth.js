'use strict'; 
 
const authService = require('../services/authService'); 
 
function getToken(req) { 
  const h = req.headers.authorization || ''; 
  return h.startsWith('Bearer ') ? h.slice(7) : null; 
} 
 
function requireOwner(req, res, next) { 
  const payload = authService.verifyToken(getToken(req)); 
  if (!payload || payload.role !== 'owner') { 
    return res.status(401).json({ error: 'Unauthorized' }); 
  } 
  req.owner = payload; // { role, code } 
  next(); 
} 
 
function requireAdmin(req, res, next) { 
  const payload = authService.verifyToken(getToken(req)); 
  if (!payload || payload.role !== 'admin') { 
    return res.status(401).json({ error: 'Unauthorized' }); 
  } 
  req.admin = payload; 
  next(); 
} 
 
module.exports = { requireOwner, requireAdmin, getToken }; 
 

 
