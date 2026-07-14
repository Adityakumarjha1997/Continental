'use strict'; 
 
const crypto = require('crypto'); 
const store = require('../data/store'); 
 
/** Data access for menu items. Each item belongs to one restaurant `code`. */ 
function byRestaurant(code) { 
  return store.read().menuItems.filter((m) => m.restaurantCode === String(code)); 
} 
 
function findById(id) { 
  return store.read().menuItems.find((m) => m.id === id) || null; 
} 
 
async function create(item) { 
  const db = store.read(); 
  const record = { id: crypto.randomUUID(), ...item }; 
  db.menuItems.push(record); 
  await store.write(db); 
  return record; 
} 
 
async function update(id, patch) { 
  const db = store.read(); 
  const idx = db.menuItems.findIndex((m) => m.id === id); 
  if (idx === -1) return null; 
  db.menuItems[idx] = { ...db.menuItems[idx], ...patch, id }; 
  await store.write(db); 
  return db.menuItems[idx]; 
} 
 
async function remove(id) { 
  const db = store.read(); 
  db.menuItems = db.menuItems.filter((m) => m.id !== id); 
  await store.write(db); 
} 
 
module.exports = { byRestaurant, findById, create, update, remove }; 
 

 
