/* Kitchen panel: live queue of confirmed orders. Start cooking -> mark ready.
   Marking ready notifies the assigned waiter to serve. */
(function () {
  const $ = (id) => document.getElementById(id);
  const money = (n) => '₹' + Number(n).toFixed(0);
  const state = { token: null, staff: null, restaurant: null, orders: [], socket: null };
  const IN_KITCHEN = ['confirmed', 'preparing'];

  /* ---------------------------- Login ----------------------------- */
  $('loginBtn').addEventListener('click', login);
  $('password').addEventListener('keydown', (e) => e.key === 'Enter' && login());

  async function login() {
    $('loginError').textContent = '';
    try {
      const data = await API.post('/kitchen/login', {
        code: $('code').value.trim(),
        username: $('username').value.trim(),
        password: $('password').value,
      });
      state.token = data.token;
      state.staff = data.staff;
      state.restaurant = data.restaurant;
      primeSound();
      requestNotifyPermission();
      startDashboard();
    } catch (e) {
      $('loginError').textContent = e.message;
    }
  }

  async function startDashboard() {
    $('loginScreen').classList.add('hidden');
    $('dashScreen').classList.remove('hidden');
    $('kName').textContent = state.staff.name;
    $('rName').textContent = state.restaurant ? state.restaurant.name : '';
    const data = await API.get('/kitchen/orders', state.token);
    state.orders = data.orders;
    render();
    connectSocket();
  }

  $('logoutBtn').addEventListener('click', () => location.reload());

  /* ---------------------------- Socket ---------------------------- */
  function connectSocket() {
    const socket = io();
    state.socket = socket;
    socket.on('connect', () => socket.emit('kitchen:subscribe', { token: state.token }));
    socket.on('subscribed', () => setOnline(true));
    socket.on('disconnect', () => setOnline(false));

    const handle = (o, isNew) => {
      const inKitchen = IN_KITCHEN.includes(o.status);
      const i = state.orders.findIndex((x) => x.id === o.id);
      if (!inKitchen) { if (i >= 0) state.orders.splice(i, 1); render(); return; }
      const fresh = i < 0;
      if (i >= 0) state.orders[i] = o; else state.orders.unshift(o);
      render();
      if (fresh) { flash(o.id); beep(); notify('New order to cook', 'Table ' + o.tableNumber); }
    };
    socket.on('order:new', (o) => handle(o, true));
    socket.on('order:update', (o) => handle(o, false));
  }

  function setOnline(on) {
    $('statusDot').textContent = on ? '● live' : '● offline';
    $('statusDot').style.color = on ? '#bbf7d0' : '#ffd0d0';
  }

  /* ---------------------------- Render ---------------------------- */
  function render() {
    const list = state.orders
      .filter((o) => IN_KITCHEN.includes(o.status))
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    $('emptyState').classList.toggle('hidden', list.length > 0);
    const grid = $('ordersGrid');
    grid.innerHTML = '';
    list.forEach((o) => grid.appendChild(card(o)));
  }

  function card(o) {
    const el = document.createElement('div');
    el.className = 'order-card';
    el.id = 'ord-' + o.id;
    const items = o.items.map((i) => '<li>' + i.qty + ' × ' + esc(i.name) + '</li>').join('');
    el.innerHTML =
      '<h4><span>Table ' + esc(String(o.tableNumber)) + '</span>' +
      '<span class="pill">' + esc(o.status) + '</span></h4>' +
      '<div class="muted" style="font-size:12px">' + timeAgo(o.createdAt) + '</div>' +
      '<ul class="order-items">' + items + '</ul>' +
      '<div class="status-row" id="sr-' + o.id + '"></div>';
    const row = el.querySelector('#sr-' + o.id);
    if (o.status === 'confirmed') {
      row.appendChild(btn('Start cooking', 'ghost', () => act(o.id, 'start')));
    }
    row.appendChild(btn('Mark ready', 'primary', () => act(o.id, 'ready')));
    return el;
  }

  async function act(id, path) {
    try {
      await API.patch('/kitchen/orders/' + id + '/' + path, null, state.token);
    } catch (e) {
      alert(e.message);
    }
  }

  /* ----------------------------- Sound ---------------------------- */
  let audioCtx = null;
  function primeSound() {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) {}
  }
  function beep() {
    if (!$('soundToggle').checked || !audioCtx) return;
    if (audioCtx.state === 'suspended') audioCtx.resume();
    [0, 0.18].forEach((offset) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain); gain.connect(audioCtx.destination);
      osc.type = 'sine'; osc.frequency.value = 720;
      const t = audioCtx.currentTime + offset;
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.exponentialRampToValueAtTime(0.4, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
      osc.start(t); osc.stop(t + 0.16);
    });
  }

  /* --------------------------- Helpers ---------------------------- */
  function btn(text, cls, onClick) {
    const b = document.createElement('button');
    b.className = cls; b.style.width = 'auto'; b.textContent = text; b.onclick = onClick;
    return b;
  }
  function flash(id) {
    const el = $('ord-' + id);
    if (el) { el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1200); }
  }
  function timeAgo(iso) {
    const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return s + 's ago';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    return Math.floor(s / 3600) + 'h ago';
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
})();
