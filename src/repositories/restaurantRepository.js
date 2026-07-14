'use strict'; 
 
const store = require('../data/store'); 
 
/** 
* Data access for restaurants (tenants). Each restaurant is identified by its 
* unique 3-digit `code`. Swap `store` for a real DB driver here later. 
*/ 
function all() { 
  return store.read().restaurants; 
} 
 
function findByCode(code) { 
  return store.read().restaurants.find((r) => r.code === String(code)) || null; 
} 
 
async function create(restaurant) { 
  const db = store.read(); 
  db.restaurants.push(restaurant); 
  await store.write(db); 
  return restaurant; 
} 
 
async function update(code, patch) { 
  const db = store.read(); 
  const idx = db.restaurants.findIndex((r) => r.code === String(code)); 
  if (idx === -1) return null; 
  db.restaurants[idx] = { 
    ...db.restaurants[idx], 
    ...patch, 
    code: db.restaurants[idx].code, // code is immutable 
  }; 
  await store.write(db); 
  return db.restaurants[idx]; 
} 
 
async function remove(code) { 
  const db = store.read(); 
  db.restaurants = db.restaurants.filter((r) => r.code !== String(code)); 
  db.menuItems = db.menuItems.filter((m) => m.restaurantCode !== String(code)); 
  await store.write(db); 
} 
 
module.exports = { all, findByCode, create, update, remove }; 
 

 
