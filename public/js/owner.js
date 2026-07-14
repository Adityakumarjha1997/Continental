/* Owner dashboard: login, live order feed via Socket.IO, sound alert. */ 
(function () { 
  const $ = (id) => document.getElementById(id); 
  const money = (n) => 'â‚¹' + Number(n).toFixed(0); 
  const NEXT = { 
    placed: 'confirmed', 
    confirmed: 'preparing', 
    preparing: 'ready', 
    ready: 'completed', 
  }; 
 
  const state = { token: null, restaurant: null, orders: [], socket: null }; 
 
  /* ---------------------------- Login ----------------------------- */ 
  $('loginBtn').addEventListener('click', login); 
  $('ownerPass').addEventListener('keydown', (e) => e.key === 'Enter' && login()); 
 
  async function login() { 
    $('loginError').textContent = ''; 
    const code = $('ownerCode').value.trim(); 
    const password = $('ownerPass').value; 
    try { 
      const data = await API.post('/owner/login', { code, password }); 
      state.token = data.token; 
      state.restaurant = data.restaurant; 
      primeSound(); // login click is our user gesture to unlock audio 
      startDashboard(); 
    } catch (e) { 
      $('loginError').textContent = e.message; 
    } 
  } 
 
  /* -------------------------- Dashboard --------------------------- */ 
  async function startDashboard() { 
    $('loginScreen').classList.add('hidden'); 
    $('dashScreen').classList.remove('hidden'); 
    $('rName').textContent = state.restaurant.name; 
    $('rCode').textContent = state.restaurant.code; 
 
    const data = await API.get('/owner/orders', state.token); 
    state.orders = data.orders; 
    renderAll(); 
    connectSocket(); 
  } 
 
  function connectSocket() { 
    const socket = io(); 
    state.socket = socket; 
    socket.on('connect', () => { 
      socket.emit('owner:subscribe', { token: state.token }); 
    }); 
    socket.on('subscribed', () => setOnline(true)); 
    socket.on('disconnect', () => setOnline(false)); 
 
    socket.on('order:new', (order) => { 
      state.orders.unshift(order); 
      renderAll(); 
      flash(order.id); 
      beep(); 
    }); 
    socket.on('order:update', (order) => { 
      const i = state.orders.findIndex((o) => o.id === order.id); 
      if (i >= 0) state.orders[i] = order; 
      else state.orders.unshift(order); 
      renderAll(); 
    }); 
  } 
 
  function setOnline(on) { 
    $('statusDot').textContent = on ? 'â— live' : 'â— offline'; 
    $('statusDot').style.color = on ? '#bbf7d0' : '#ffd0d0'; 
  } 
 
  /* --------------------------- Render ----------------------------- */ 
  function renderAll() { 
    const active = state.orders.filter( 
      (o) => o.status !== 'completed' && o.status !== 'cancelled' 
    ); 
    $('emptyState').classList.toggle('hidden', state.orders.length > 0); 
 
    const grid = $('ordersGrid'); 
    grid.innerHTML = ''; 
    // Active first, then finished 
    const ordered = [...active, ...state.orders.filter((o) => !active.includes(o))]; 
    ordered.forEach((o) => grid.appendChild(card(o))); 
  } 
 
  function card(o) { 
    const el = document.createElement('div'); 
    el.className = 'order-card'; 
    el.id = 'ord-' + o.id; 
 
    const items = o.items 
      .map((i) => '<li>' + i.qty + ' Ã— ' + esc(i.name) + '</li>') 
      .join(''); 
 
    const payClass = o.paymentStatus === 'paid' ? 'paid' : 'pending'; 
    const next = NEXT[o.status]; 
 
    el.innerHTML = 
      '<h4><span>' + esc(o.customer.name) + '</span><span class="pill ' + payClass + '">' + 
      o.paymentStatus + '</span></h4>' + 
      '<div class="muted" style="font-size:12px">' + timeAgo(o.createdAt) + 
      (o.customer.phone ? ' Â· ' + esc(o.customer.phone) : '') + '</div>' + 
      '<ul class="order-items">' + items + '</ul>' + 
      '<div><strong>' + money(o.total) + '</strong> Â· <span class="pill">' + o.status + '</span></div>' + 
      '<div class="status-row" id="sr-' + o.id + '"></div>'; 
 
    const row = el.querySelector('#sr-' + o.id); 
    if (next) { 
      const b = document.createElement('button'); 
      b.className = 'primary'; 
      b.style.width = 'auto'; 
      b.textContent = 'Mark ' + next; 
      b.onclick = () => updateStatus(o.id, next); 
      row.appendChild(b); 
    } 
    if (o.status !== 'cancelled' && o.status !== 'completed') { 
      const c = document.createElement('button'); 
      c.className = 'ghost'; 
      c.textContent = 'Cancel'; 
      c.onclick = () => updateStatus(o.id, 'cancelled'); 
      row.appendChild(c); 
    } 
    return el; 
  } 
 
  async function updateStatus(id, status) { 
    try { 
      await API.patch('/owner/orders/' + id, { status }, state.token); 
      // The socket 'order:update' will refresh the card 
    } catch (e) { 
      alert(e.message); 
    } 
  } 
 
  function flash(id) { 
    const el = $('ord-' + id); 
    if (el) { 
      el.classList.add('flash'); 
      setTimeout(() => el.classList.remove('flash'), 1200); 
    } 
  } 
 
  /* ---------------------------- Sound ----------------------------- */ 
  let audioCtx = null; 
  function primeSound() { 
    try { 
      audioCtx = new (window.AudioContext || window.webkitAudioContext)(); 
    } catch (_) {} 
  } 
  function beep() { 
    if (!$('soundToggle').checked || !audioCtx) return; 
    if (audioCtx.state === 'suspended') audioCtx.resume(); 
    [0, 0.18].forEach((offset) => { 
      const osc = audioCtx.createOscillator(); 
      const gain = audioCtx.createGain(); 
      osc.connect(gain); 
      gain.connect(audioCtx.destination); 
      osc.type = 'sine'; 
      osc.frequency.value = 880; 
      const t = audioCtx.currentTime + offset; 
      gain.gain.setValueAtTime(0.001, t); 
      gain.gain.exponentialRampToValueAtTime(0.4, t + 0.02); 
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15); 
      osc.start(t); 
      osc.stop(t + 0.16); 
    }); 
  } 
 
  /* --------------------------- Helpers ---------------------------- */ 
  $('logoutBtn').addEventListener('click', () => location.reload()); 
 
  function timeAgo(iso) { 
    const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000); 
    if (s < 60) return s + 's ago'; 
    if (s < 3600) return Math.floor(s / 60) + 'm ago'; 
    return Math.floor(s / 3600) + 'h ago'; 
  } 
  function esc(s) { 
    return String(s).replace(/[&<>"]/g, (c) => 
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]) 
    ); 
  } 
})(); 
 

 
