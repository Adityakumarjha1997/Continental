'use strict';

const crypto = require('crypto');
const store = require('../data/store');

/**
 * Customer accounts (sign-up / login). Global across all hotels — one shared
 * collection. Usernames are unique (case-insensitive). Passwords are bcrypt
 * hashed by the caller before create().
 */
function findByUsername(username) {
  const u = String(username || '').trim().toLowerCase();
  if (!u) return null;
  return store.read().customers.find((c) => String(c.username).toLowerCase() === u) || null;
}

function findById(id) {
  return store.read().customers.find((c) => c.id === id) || null;
}

async function create(customer) {
  const db = store.read();
  const record = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    ...customer,
  };
  db.customers.push(record);
  await store.write(db);
  return record;
}

module.exports = { findByUsername, findById, create };
