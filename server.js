'use strict';

const http = require('http');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const config = require('./src/config');
const routes = require('./src/routes');
const { notFound, errorHandler } = require('./src/middleware/errorHandler');
const { initSocket, pushOrder } = require('./src/realtime/socket');
const store = require('./src/data/store');
const { ensureSeed } = require('./src/data/seed');
const payment = require('./src/services/payment');
const orderService = require('./src/services/orderService');

const app = express();
const server = http.createServer(app);

// Real-time engine, exposed to routes via app.get('io')
const io = initSocket(server);
app.set('io', io);

// Security headers. A real Content-Security-Policy is now ENABLED (it used to be
// disabled). It allows: the app's own assets, the inline handlers/styles the
// pages use, the Razorpay checkout widget, remote menu images over https, and
// the same-origin Socket.IO websocket. If anything ever fails to load after a
// deploy, you can temporarily set `contentSecurityPolicy: false` to isolate it.
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'script-src': ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'https://checkout.razorpay.com'],
        'style-src': ["'self'", "'unsafe-inline'"],
        'img-src': ["'self'", 'data:', 'https:'],
        'font-src': ["'self'", 'data:'],
        'connect-src': ["'self'", 'https://*.razorpay.com', 'ws:', 'wss:'],
        'frame-src': ['https://*.razorpay.com', 'https://checkout.razorpay.com'],
        'worker-src': ["'self'"],
        // Do not force https upgrades (keeps http://localhost working in dev).
        'upgrade-insecure-requests': null,
      },
    },
  })
);
app.use(express.json({ limit: '1mb' }));

// Basic abuse protection on the API
app.use('/api', rateLimit({ windowMs: 60 * 1000, max: 120 }));
app.use('/api', routes);
app.use('/api', notFound);

// Static frontend (customer / owner / admin pages). The PWA service worker is
// served from the site root (public/sw.js -> /sw.js) so it can control the
// whole origin.
app.use(express.static(path.join(__dirname, 'public')));

app.use(errorHandler);

/**
 * Housekeeping: auto-cancel orders that were placed but never confirmed by a
 * waiter within 2 hours. Runs every 5 minutes.
 */
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
async function sweepStaleOrders() {
  try {
    const now = Date.now();
    const stale = (store.read().orders || []).filter(
      (o) => o.status === 'placed' && now - new Date(o.createdAt).getTime() > TWO_HOURS_MS
    );
    for (const o of stale) {
      const updated = await orderService.updateStatus(o.id, 'cancelled');
      if (updated) pushOrder(io, updated);
    }
    if (stale.length) console.log(`Auto-cancelled ${stale.length} unconfirmed order(s) older than 2h`);
  } catch (e) {
    console.error('Stale-order sweep failed:', e.message);
  }
}

// Connect to the data backend (MongoDB if MONGODB_URI is set, else JSON file),
// seed demo data on first run, then start listening.
store
  .init()
  .then(() => ensureSeed())
  .then(() => {
    server.listen(config.port, () => {
      console.log('\n  Food ordering server is running');
      console.log('  --------------------------------------------------');
      console.log(`  Customer app : http://localhost:${config.port}/`);
      console.log(`  Owner login  : http://localhost:${config.port}/owner.html`);
      console.log(`  Admin panel  : http://localhost:${config.port}/admin.html`);
      console.log(`  Data store   : ${store.backendName()}`);
      console.log(`  Payment mode : ${payment.name}`);
      console.log('  --------------------------------------------------\n');
    });
    setInterval(sweepStaleOrders, 5 * 60 * 1000);
  })
  .catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
