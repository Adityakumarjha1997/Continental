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
    setInterval(refresh, 7000); // safety-net if a socket event is missed
  }

  async function refresh() {
    try {
      const data = await API.get('/kitchen/orders', state.token);
      state.orders = data.orders;
      render();
    } catch (_) {}
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
    renderSummary(list);
    const grid = $('ordersGrid');
    grid.innerHTML = '';
    list.forEach((o) => grid.appendChild(card(o)));
  }

  // Big-picture aggregate: total quantity of each dish still to cook. Recomputed
  // every render, so counts drop as orders are marked ready.
  function renderSummary(list) {
    const totals = {};
    list.forEach((o) => (o.items || []).forEach((it) => {
      totals[it.name] = (totals[it.name] || 0) + it.qty;
    }));
    const names = Object.keys(totals).sort((a, b) => totals[b] - totals[a]);
    const el = $('kitchenSummary');
    if (!names.length) { el.classList.add('hidden'); el.innerHTML = ''; return; }
    el.classList.remove('hidden');
    el.innerHTML =
      '<div class="ks-title">Big picture — to cook</div>' +
      '<div class="ks-chips">' +
      names.map((n) => '<span class="ks-chip"><b>' + totals[n] + '</b> ' + esc(n) + '</span>').join('') +
      '</div>';
  }

  function card(o) {
    const actions = [];
    if (o.status === 'confirmed') actions.push({ label: 'Start cooking', cls: 'ghost', onClick: () => act(o.id, 'start') });
    actions.push({ label: 'Mark ready', cls: 'primary', onClick: () => act(o.id, 'ready') });
    return makeOrderRow({
      id: o.id,
      title: 'Table ' + o.tableNumber,
      sub: timeAgo(o.createdAt),
      statusText: o.status,
      items: o.items,
      actions: actions,
    });
  }

  async function act(id, path) {
    try {
      const res = await API.patch('/kitchen/orders/' + id + '/' + path, null, state.token);
      if (res && res.order) {
        const inKitchen = IN_KITCHEN.includes(res.order.status);
        const i = state.orders.findIndex((x) => x.id === res.order.id);
        if (!inKitchen) { if (i >= 0) state.orders.splice(i, 1); }
        else if (i >= 0) state.orders[i] = res.order;
        render();
      }
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
