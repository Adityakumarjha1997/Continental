'use strict';

require('dotenv').config();

const credentials = require('./credentials');

/**
* Central configuration. Everything reads from here, never from process.env
* directly, so swapping environments later is a one-file change.
*
* Precedence for shared secrets: environment variable  >  credentials.json  >
* built-in default. On the deployed server you set env vars; locally you edit
* credentials.json.
*/
const razorpayKeyId = process.env.RAZORPAY_KEY_ID || '';
const razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET || '';

// If keys are present we default to razorpay; otherwise the free mock provider.
const paymentProvider =
  process.env.PAYMENT_PROVIDER || (razorpayKeyId ? 'razorpay' : 'mock');

const config = {
  port: Number(process.env.PORT) || 3000,
  jwtSecret: process.env.JWT_SECRET || 'dev-insecure-secret-change-me',
  adminPassword: process.env.ADMIN_PASSWORD || credentials.admin.password || 'admin123',
  defaultRadiusMeters: Number(process.env.DEFAULT_RADIUS_METERS) || 100,
  // Database: when MONGODB_URI is set the app uses MongoDB (Atlas); otherwise
  // it falls back to a local JSON file. See src/data/store.js.
  mongo: {
    uri: process.env.MONGODB_URI || '',
    dbName: process.env.MONGODB_DB || 'foodorder',
  },
  payment: {
    provider: paymentProvider,
    currency: process.env.CURRENCY || 'INR',
    razorpay: {
      keyId: razorpayKeyId,
      keySecret: razorpayKeySecret,
    },
  },
};

module.exports = config;
