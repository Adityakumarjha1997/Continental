'use strict'; 
 
const crypto = require('crypto'); 
const Razorpay = require('razorpay'); 
const config = require('../../config'); 
 
/** 
* Real Razorpay provider (UPI / cards / netbanking). UPI has 0% fee. 
* Only loaded when RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET are set. 
*/ 
const client = new Razorpay({ 
  key_id: config.payment.razorpay.keyId, 
  key_secret: config.payment.razorpay.keySecret, 
}); 
 
module.exports = { 
  name: 'razorpay', 
 
  async createOrder({ amount, currency, receipt }) { 
    const order = await client.orders.create({ 
      amount: Math.round(amount * 100), // amount in paise 
      currency, 
      receipt, 
      payment_capture: 1, 
    }); 
    return { 
      id: order.id, 
      amount: order.amount, 
      currency: order.currency, 
      receipt, 
      provider: 'razorpay', 
    }; 
  }, 
 
  /** 
   * Verify the signature Razorpay returns to the browser after a successful 
   * payment. This proves the payment is genuine before we mark the order paid. 
   */ 
  verifyPayment({ razorpayOrderId, razorpayPaymentId, razorpaySignature }) { 
    if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) return false; 
    const expected = crypto 
      .createHmac('sha256', config.payment.razorpay.keySecret) 
      .update(`${razorpayOrderId}|${razorpayPaymentId}`) 
      .digest('hex'); 
    return expected === razorpaySignature; 
  }, 
}; 
 

 

 
