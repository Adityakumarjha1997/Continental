'use strict'; 
 
const { Server } = require('socket.io'); 
const authService = require('../services/authService'); 
 
/** 
* Real-time layer. Owners subscribe to a private room named after their 
* restaurant code (only after presenting a valid owner token). New orders and 
* status changes are emitted to that room so the dashboard updates instantly. 
*/ 
function initSocket(server) { 
  const io = new Server(server, { cors: { origin: '*' } }); 
 
  io.on('connection', (socket) => { 
    socket.on('owner:subscribe', ({ token } = {}) => { 
      const payload = authService.verifyToken(token); 
      if (payload && payload.role === 'owner') { 
        socket.join('restaurant:' + payload.code); 
        socket.emit('subscribed', { code: payload.code }); 
      } else { 
        socket.emit('error_msg', { error: 'Unauthorized socket subscription' }); 
      } 
    }); 
  }); 
 
  return io; 
} 
 
module.exports = { initSocket }; 
 

 
