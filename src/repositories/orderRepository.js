'use strict'; 
 
const crypto = require('crypto'); 
const store = require('../data/store'); 
 
/** Data access for orders. Newest first when listed per restaurant. */ 
function byRestaurant(code) { 
  return store 
    .read() 
    .orders.filter((o) => o.restaurantCode === String(code)) 
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)); 
} 
 
function findById(id) { 
  return store.read().orders.find((o) => o.id === id) || null; 
} 
 
async function create(order) { 
  const db = store.read(); 
  const record = { 
    id: crypto.randomUUID(), 
    createdAt: new Date().toISOString(), 
    ...order, 
  }; 
  db.orders.push(record); 
  await store.write(db); 
  return record; 
} 
 
async function update(id, patch) { 
  const db = store.read(); 
  const idx = db.orders.findIndex((o) => o.id === id); 
  if (idx === -1) return null; 
  db.orders[idx] = { ...db.orders[idx], ...patch, id }; 
  await store.write(db); 
  return db.orders[idx]; 
} 
 
module.exports = { byRestaurant, findById, create, update }; 
 

 
