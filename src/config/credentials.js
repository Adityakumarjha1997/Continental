'use strict';

const fs = require('fs');
const path = require('path');

/**
* Loads the single test-credentials file (credentials.json at the project root).
* Falls back to credentials.example.json, then to hard defaults, so the app
* always boots even if the file is missing.
*
* Environment variables still override individual values (see config/index.js
* and data/seed.js) - that is what the deployed server uses.
*/
const ROOT = path.join(__dirname, '..', '..');
const DEFAULTS = {
  admin: { password: 'admin123' },
  owners: [{ code: '481', restaurantName: 'Demo Diner', password: 'owner123' }],
  customers: [],
};

function loadFrom(file) {
  try {
    const raw = fs.readFileSync(path.join(ROOT, file), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const loaded = loadFrom('credentials.json') || loadFrom('credentials.example.json') || {};

const credentials = {
  admin: { ...DEFAULTS.admin, ...(loaded.admin || {}) },
  owners: Array.isArray(loaded.owners) && loaded.owners.length ? loaded.owners : DEFAULTS.owners,
  customers: Array.isArray(loaded.customers) ? loaded.customers : DEFAULTS.customers,
};

module.exports = credentials;
