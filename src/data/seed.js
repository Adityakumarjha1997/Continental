'use strict';

const restaurantRepo = require('../repositories/restaurantRepository');
const menuRepo = require('../repositories/menuRepository');
const authService = require('../services/authService');
const credentials = require('../config/credentials');

/**
* Seeds demo data the first time the app runs so you can test immediately.
* Does nothing if any restaurant already exists.
*
* Owner logins come from the single credentials file (credentials.json) - edit
* that file to change the seeded owner code/password. The first owner listed
* gets the demo menu below; extra owners are created as empty restaurants.
*
*   Default location : Bangalore (12.9716, 77.5946)
*
* TIP: to test ordering from your own machine, edit a restaurant's location
* in the Admin panel using the "Use my current location" button.
*/
async function ensureSeed() {
  if (restaurantRepo.all().length > 0) return;

  const owners = credentials.owners.length
    ? credentials.owners
    : [{ code: '481', restaurantName: 'Demo Diner', password: 'owner123' }];

  // Create every owner from the credentials file.
  for (const o of owners) {
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
    });
  }

  // The first owner gets a demo menu so there is something to order.
  const code = String(owners[0].code);

  const items = [
    { name: 'Margherita Pizza', price: 199, category: 'Pizza' },
    { name: 'Paneer Butter Masala', price: 220, category: 'Main Course' },
    { name: 'Veg Biryani', price: 180, category: 'Rice' },
    { name: 'Masala Dosa', price: 90, category: 'South Indian' },
    { name: 'Gulab Jamun (2 pcs)', price: 60, category: 'Dessert' },
    { name: 'Cold Coffee', price: 120, category: 'Beverages' },
  ];
  for (const it of items) {
    await menuRepo.create({
      restaurantCode: code,
      description: '',
      available: true,
      ...it,
    });
  }

  console.log(
    `  Seeded ${owners.length} restaurant(s) from credentials.json  ->  first: code ${code}`
  );
}

module.exports = { ensureSeed };
