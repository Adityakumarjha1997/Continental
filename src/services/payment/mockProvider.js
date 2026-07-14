'use strict'; 
 
const crypto = require('crypto'); 
 
/** 
* Free "mock" payment provider. Lets the whole order flow run with NO Razorpay 
* account and NO real money. Every payment is treated as successful. This is 
* the default provider until you add Razorpay keys to your .env. 
*/ 
module.exports = { 
  name: 'mock', 
 
  async createOrder({ amount, currency, receipt }) { 
    return { 
      id: 'mock_order_' + crypto.randomBytes(6).toString('hex'), 
      amount: Math.round(amount * 100), 
      currency, 
      receipt, 
      provider: 'mock', 
    }; 
  }, 
 
  // In mock mode any confirmation succeeds. 
  verifyPayment() { 
    return true; 
  }, 
}; 
 

 
