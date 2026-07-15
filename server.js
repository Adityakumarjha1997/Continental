'use strict';

const http = require('http');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const config = require('./src/config');
const routes = require('./src/routes');
const { notFound, errorHandler } = require('./src/middleware/errorHandler');
const { initSocket } = require('./src/realtime/socket');
const store = require('./src/data/store');
const { ensureSeed } = require('./src/data/seed');
const payment = require('./src/services/payment');

const app = express();
const server = http.createServer(app);

// Real-time engine, exposed to routes via app.get('io')
const io = initSocket(server);
app.set('io', io);

// Security + parsing. CSP is disabled so the Razorpay widget + inline demo
// scripts load without extra config during testing.
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '1mb' }));

// Basic abuse protection on the API
app.use('/api', rateLimit({ windowMs: 60 * 1000, max: 120 }));
app.use('/api', routes);
app.use('/api', notFound);

// Static frontend (customer / owner / admin pages)
app.use(express.static(path.join(__dirname, 'public')));

app.use(errorHandler);

// Connect to the data backend (MongoDB if MONGODB_URI is set, else JSON file),
// seed demo data on first run, then start listening.
store
  .init()
  .then(() => ensureSeed())
  .then(() => {
    server.listen(config.port, () => {
      console.log(`
  Food ordering server is running`);
      console.log('  --------------------------------------------------');
      console.log(`  Customer app : http://localhost:${config.port}/`);
      console.log(`  Owner login  : http://localhost:${config.port}/owner.html`);
      console.log(`  Admin panel  : http://localhost:${config.port}/admin.html`);
      console.log(`  Data store   : ${store.backendName()}`);
      console.log(`  Payment mode : ${payment.name}`);
      console.log(`  --------------------------------------------------
`);
    });
  })
  .catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
