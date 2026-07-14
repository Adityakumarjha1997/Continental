'use strict'; 
 
const bcrypt = require('bcryptjs'); 
const jwt = require('jsonwebtoken'); 
const config = require('../config'); 
 
/** Password hashing + JWT issuing/verifying for owners and admin. */ 
function hashPassword(plain) { 
  return bcrypt.hashSync(plain, 10); 
} 
 
function verifyPassword(plain, hash) { 
  if (!hash) return false; 
  return bcrypt.compareSync(plain, hash); 
} 
 
function signToken(payload, expiresIn = '12h') { 
  return jwt.sign(payload, config.jwtSecret, { expiresIn }); 
} 
 
function verifyToken(token) { 
  try { 
    return jwt.verify(token, config.jwtSecret); 
  } catch { 
    return null; 
  } 
} 
 
module.exports = { hashPassword, verifyPassword, signToken, verifyToken }; 
 

 
