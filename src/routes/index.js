'use strict';

const express = require('express');
const router = express.Router();

const store = require('../data/store');

/** Health check for uptime monitors / load balancers (Render, etc.). */
router.get('/health', (req, res) =>
  res.json({
    ok: true,
    status: 'up',
    backend: store.backendName(),
    uptimeSeconds: Math.round(process.uptime()),
    time: new Date().toISOString(),
  })
);

router.use('/public', require('./publicRoutes'));
router.use('/owner', require('./ownerRoutes'));
router.use('/waiter', require('./waiterRoutes'));
router.use('/kitchen', require('./kitchenRoutes'));

module.exports = router;
