'use strict';

const crypto = require('crypto');
const restaurantRepo = require('../repositories/restaurantRepository');
const menuRepo = require('../repositories/menuRepository');
const staffRepo = require('../repositories/staffRepository');
const customerRepo = require('../repositories/customerRepository');
const authService = require('../services/authService');
const credentials = require('../config/credentials');

/**
 * Seeds demo data the first time the app runs so you can test immediately.
 * Does nothing if any restaurant already exists.
 *
 * Owner logins come from the single credentials file (credentials.json). The
 * first owner listed gets the demo menu, dine-in tables, a demo payment QR, and
 * a couple of demo staff logins (waiters + kitchen) so the whole dine-in flow
 * can be exercised end-to-end without any manual setup.
 *
 *   Default location : Bangalore (12.9716, 77.5946)
 *
 * Demo staff logins (restaurant code = first owner's code):
 *   Waiter : waiter1 / waiter123   and   waiter2 / waiter123
 *   Kitchen: kitchen1 / kitchen123
 */
async function ensureSeed() {
  if (restaurantRepo.all().length > 0) return;

  const owners = credentials.owners.length
    ? credentials.owners
    : [{ code: '481', restaurantName: 'Demo Diner', password: 'owner123' }];

  const firstCode = String(owners[0].code);

  // Demo menu "sections" (grid tiles) for the first restaurant, so the grid
  // view works out of the box on a fresh install. Admin can edit these later.
  const gridDefs = [
    { name: 'Pizza', description: 'Wood-fired classics' },
    { name: 'Main Course', description: 'Hearty mains & curries' },
    { name: 'Rice', description: 'Biryani & rice bowls' },
    { name: 'South Indian', description: 'Dosa, idli & more' },
    { name: 'Desserts', description: 'Sweet endings' },
    { name: 'Beverages', description: 'Drinks & coolers' },
  ];
  const grids = gridDefs.map((g) => ({ id: crypto.randomUUID(), name: g.name, description: g.description }));
  const gridId = (name) => (grids.find((g) => g.name === name) || {}).id || null;

  // Create every owner from the credentials file. The first one gets 12 tables,
  // a demo UPI QR and the demo sections; the rest start empty.
  for (const o of owners) {
    const isFirst = String(o.code) === firstCode;
    await restaurantRepo.create({
      code: String(o.code),
      name: o.restaurantName || `Restaurant ${o.code}`,
      description: 'A sample restaurant seeded for testing.',
      upiId: 'demo@upi',
      ownerPasswordHash: authService.hashPassword(o.password || 'owner123'),
      location: { lat: 12.9716, lng: 77.5946 },
      radiusMeters: 100,
      currency: 'INR',
      active: true,
      tables: isFirst ? 12 : 0,
      paymentQRs: isFirst
        ? [{ id: crypto.randomUUID(), label: 'Restaurant UPI', upiId: 'demo@upi', imageUrl: '' }]
        : [],
      grids: isFirst ? grids : [],
    });
  }

  // Demo menu for the first restaurant (rich fields + a section per item).
  const items = [
    { name: 'Margherita Pizza', price: 199, category: 'Pizza', isVeg: true, tags: ['Bestseller'] },
    { name: 'Paneer Butter Masala', price: 220, category: 'Main Course', isVeg: true, spicy: true, tags: ['Chef special'] },
    { name: 'Veg Biryani', price: 180, category: 'Rice', isVeg: true, spicy: true },
    { name: 'Chicken Biryani', price: 240, category: 'Rice', isVeg: false, spicy: true, tags: ['Bestseller'] },
    { name: 'Masala Dosa', price: 90, category: 'South Indian', isVeg: true },
    { name: 'Gulab Jamun (2 pcs)', price: 60, category: 'Desserts', isVeg: true },
    { name: 'Cold Coffee', price: 120, category: 'Beverages', isVeg: true },
  ];
  for (const it of items) {
    await menuRepo.create({
      restaurantCode: firstCode,
      description: '',
      available: true,
      imageUrl: '',
      isVeg: true,
      spicy: false,
      tags: [],
      gridId: gridId(it.category),
      ...it,
    });
  }

  // Demo staff for the first restaurant.
  const demoStaff = [
    { role: 'waiter', name: 'Ravi', username: 'waiter1', password: 'waiter123' },
    { role: 'waiter', name: 'Meena', username: 'waiter2', password: 'waiter123' },
    { role: 'kitchen', name: 'Main Kitchen', username: 'kitchen1', password: 'kitchen123' },
  ];
  for (const s of demoStaff) {
    await staffRepo.create({
      restaurantCode: firstCode,
      role: s.role,
      name: s.name,
      username: s.username,
      passwordHash: authService.hashPassword(s.password),
      onShift: false,
    });
  }

  // A demo customer account so login works out of the box (or just sign up).
  await customerRepo.create({
    username: 'test',
    passwordHash: authService.hashPassword('test123'),
  });

  console.log(
    `  Seeded ${owners.length} restaurant(s) + demo staff + demo customer (test/test123)  ->  first: code ${firstCode}`
  );
}

module.exports = { ensureSeed };
