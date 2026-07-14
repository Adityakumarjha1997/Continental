'use strict'; 
 
const config = require('../../config'); 
 
/** 
* Payment provider factory. The rest of the app imports THIS module and never 
* cares which provider is active. Add a new gateway (PhonePe PG, Stripe, etc.) 
* by dropping in another provider file and extending this switch. 
*/ 
let provider; 
 
if (config.payment.provider === 'razorpay' && config.payment.razorpay.keyId) { 
  provider = require('./razorpayProvider'); 
} else { 
  provider = require('./mockProvider'); 
} 
 
module.exports = provider; 
 

 
