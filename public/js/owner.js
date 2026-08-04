/* Owner dashboard: live monitoring board (dine-in flow driven by waiter/kitchen),
   sales analytics, staff management, and settings (tables + payment QR codes). */
(function () {
  const $ = (id) => document.getElementById(id);
  const money = (n) => '₹' + Number(n).toFixed(0);
  const state = { token: null, restaurant: null, orders: [], staff: [], socket: null };

  /* ---------------------------- Login ----------------------------- */
  $('loginBtn').addEventListener('click', login);
  $('ownerPass').addEventListener('keydown', (e) => e.key === 'Enter' && login());

  async function login() {
    $('loginError').textContent = '';
    try {
      const data = await API.post('/owner/login', {
        code: $('ownerCode').value.trim(),
        password: $('ownerPass').value,
      });
      state.token = data.token;
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
    $('rName').textContent = state.restaurant.name;
    $('rCode').textContent = state.restaurant.code;
    const data = await API.get('/owner/orders', state.token);
    state.orders = data.orders;
    renderAll();
    connectSocket();
  }

  /* ---------------------------- Tabs ------------------------------ */
  const TABS = {
    Orders: ['ordersView', tabNoop],
    Analytics: ['analyticsView', loadAnalytics],
    Staff: ['staffView', loadStaff],
    Settings: ['settingsView', loadSettings],
  };
  function tabNoop() {}
  const tabBtns = { Orders: 'tabOrders', Analytics: 'tabAnalytics', Staff: 'tabStaff', Settings: 'tabSettings' };
  Object.keys(tabBtns).forEach((name) =>
    $(tabBtns[name]).addEventListener('click', () => switchTab(name))
  );

  function switchTab(name) {
    Object.keys(TABS).forEach((n) => {
      $(tabBtns[n]).classList.toggle('active', n === name);
      $(TABS[n][0]).classList.toggle('hidden', n !== name);
    });
    TABS[name][1]();
  }

  /* ---------------------------- Socket ---------------------------- */
  function connectSocket() {
    const socket = io();
    state.socket = socket;
    socket.on('connect', () => socket.emit('owner:subscribe', { token: state.token }));
    socket.on('subscribed', () => setOnline(true));
    socket.on('disconnect', () => setOnline(false));

    socket.on('order:new', (o) => {
      state.orders.unshift(o);
      renderAll();
      flash(o.id);
      beep();
      notify('New order', 'Table ' + o.tableNumber + ' · ' + money(o.total));
      if (!$('analyticsView').classList.contains('hidden')) loadAnalytics();
    });
    socket.on('order:update', (o) => {
      const i = state.orders.findIndex((x) => x.id === o.id);
      if (i >= 0) state.orders[i] = o; else state.orders.unshift(o);
      renderAll();
      if (!$('analyticsView').classList.contains('hidden')) loadAnalytics();
    });
  }
  function setOnline(on) {
    $('statusDot').textContent = on ? '● live' : '● offline';
    $('statusDot').style.color = on ? '#bbf7d0' : '#ffd0d0';
  }

  /* -------------------------- Orders board ------------------------ */
  function renderAll() {
    const active = state.orders.filter((o) => o.status !== 'closed' && o.status !== 'cancelled');
    $('emptyState').classList.toggle('hidden', state.orders.length > 0);
    const grid = $('ordersGrid');
    grid.innerHTML = '';
    const ordered = [...active, ...state.orders.filter((o) => !active.includes(o))];
    ordered.forEach((o) => grid.appendChild(card(o)));
  }

  function card(o) {
    const el = document.createElement('div');
    el.className = 'order-card';
    el.id = 'ord-' + o.id;
    const items = o.items.map((i) => '<li>' + i.qty + ' × ' + esc(i.name) + '</li>').join('');
    const payClass = o.paymentStatus === 'paid' ? 'paid' : 'pending';
    const payText = o.paymentStatus === 'paid'
      ? 'paid' + (o.paymentMethod ? ' · ' + o.paymentMethod : '')
      : 'unpaid';

    el.innerHTML =
      '<h4><span>Table ' + esc(String(o.tableNumber != null ? o.tableNumber : '?')) + '</span>' +
      '<span class="pill ' + payClass + '">' + payText + '</span></h4>' +
      '<div class="muted" style="font-size:12px">' + esc(o.customer.name || 'Guest') + ' · ' + timeAgo(o.createdAt) +
      (o.assignedWaiterName ? ' · 🧑‍💼 ' + esc(o.assignedWaiterName) : ' · <i>unassigned</i>') + '</div>' +
      '<ul class="order-items">' + items + '</ul>' +
      '<div><strong>' + money(o.total) + '</strong> · <span class="pill">' + esc(o.status) + '</span></div>' +
      '<div class="status-row" id="sr-' + o.id + '"></div>';

    if (o.status !== 'closed' && o.status !== 'cancelled') {
      const c = document.createElement('button');
      c.className = 'ghost';
      c.style.width = 'auto';
      c.textContent = 'Cancel';
      c.onclick = () => { if (confirm('Cancel this order?')) updateStatus(o.id, 'cancelled'); };
      el.querySelector('#sr-' + o.id).appendChild(c);
    }
    return el;
  }

  async function updateStatus(id, status) {
    try {
      await API.patch('/owner/orders/' + id, { status }, state.token);
    } catch (e) { alert(e.message); }
  }

  /* -------------------------- Analytics --------------------------- */
  async function loadAnalytics() {
    try {
      const { analytics: a } = await API.get('/owner/analytics', state.token);
      const cur = (n) => '₹' + Number(n || 0).toFixed(0);
      const stat = (label, value) =>
        '<div class="stat"><div class="stat-value">' + value + '</div>' +
        '<div class="stat-label">' + label + '</div></div>';
      $('statsGrid').innerHTML =
        stat("Today's orders", a.todayOrders) +
        stat("Today's revenue", cur(a.todayRevenue)) +
        stat('Total orders', a.totalOrders) +
        stat('Total revenue', cur(a.revenue)) +
        stat('Paid orders', a.paidOrders) +
        stat('Avg order', cur(a.avgOrderValue));
      const body = $('topItemsBody');
      body.innerHTML = a.topItems.length
        ? a.topItems.map((it) => '<tr><td>' + esc(it.name) + '</td><td>' + it.qty + '</td><td>' + cur(it.revenue) + '</td></tr>').join('')
        : '<tr><td colspan="3" class="muted">No paid orders yet.</td></tr>';
    } catch (e) {
      $('statsGrid').innerHTML = '<div class="banner danger">' + esc(e.message) + '</div>';
    }
  }

  /* ---------------------------- Staff ----------------------------- */
  async function loadStaff() {
    try {
      const data = await API.get('/owner/staff', state.token);
      state.staff = data.staff;
      renderStaff();
    } catch (e) {
      $('staffList').innerHTML = '<div class="banner danger">' + esc(e.message) + '</div>';
    }
  }
  function renderStaff() {
    const wrap = $('staffList');
    if (!state.staff.length) {
      wrap.innerHTML = '<div class="banner warn">No staff yet. Add waiters and a kitchen login above.</div>';
      return;
    }
    wrap.innerHTML = '';
    state.staff.forEach((s) => {
      const el = document.createElement('div');
      el.className = 'card';
      el.style.padding = '14px 16px';
      el.innerHTML =
        '<div style="display:flex;justify-content:space-between;align-items:center">' +
        '<div><strong>' + esc(s.name) + '</strong> <span class="pill">' + esc(s.role) + '</span>' +
        (s.role === 'waiter' ? ' <span class="pill ' + (s.onShift ? 'paid' : 'pending') + '">' + (s.onShift ? 'on shift' : 'off') + '</span>' : '') +
        '<div class="muted" style="font-size:12px;margin-top:4px">@' + esc(s.username) + '</div></div>' +
        '<div></div></div>';
      const b = document.createElement('button');
      b.className = 'ghost'; b.style.width = 'auto'; b.textContent = 'Remove';
      b.onclick = async () => {
        if (!confirm('Remove ' + s.name + '?')) return;
        try { await API.del('/owner/staff/' + s.id, state.token); loadStaff(); }
        catch (e) { alert(e.message); }
      };
      el.querySelector('div > div:last-child').appendChild(b);
      wrap.appendChild(el);
    });
  }
  $('addStaffBtn').addEventListener('click', async () => {
    $('staffError').textContent = '';
    try {
      await API.post('/owner/staff', {
        role: $('sRole').value,
        name: $('sName').value.trim(),
        username: $('sUser').value.trim(),
        password: $('sPass').value,
      }, state.token);
      ['sName', 'sUser', 'sPass'].forEach((id) => ($(id).value = ''));
      loadStaff();
    } catch (e) { $('staffError').textContent = e.message; }
  });

  /* --------------------------- Settings --------------------------- */
  function loadSettings() {
    $('setTables').value = state.restaurant.tables || '';
    renderQRs();
  }
  $('saveTablesBtn').addEventListener('click', async () => {
    try {
      const data = await API.patch('/owner/settings', { tables: parseInt($('setTables').value, 10) || 0 }, state.token);
      state.restaurant = data.restaurant;
      alert('Tables saved.');
    } catch (e) { alert(e.message); }
  });

  function renderQRs() {
    const wrap = $('qrList');
    const qrs = state.restaurant.paymentQRs || [];
    if (!qrs.length) { wrap.innerHTML = '<div class="banner warn" style="margin-bottom:10px">No QR codes yet.</div>'; return; }
    wrap.innerHTML = '';
    qrs.forEach((q) => {
      const el = document.createElement('div');
      el.className = 'qr-card';
      el.innerHTML =
        (q.imageUrl ? '<img src="' + esc(q.imageUrl) + '" alt="QR" />' : '<div class="qr-ph">QR</div>') +
        '<div style="flex:1"><strong>' + esc(q.label) + '</strong>' +
        (q.upiId ? '<div class="muted" style="font-size:12px">' + esc(q.upiId) + '</div>' : '') + '</div>';
      const b = document.createElement('button');
      b.className = 'ghost'; b.style.width = 'auto'; b.textContent = 'Remove';
      b.onclick = () => saveQRs(qrs.filter((x) => x !== q));
      el.appendChild(b);
      wrap.appendChild(el);
    });
  }
  $('addQrBtn').addEventListener('click', () => {
    $('qrError').textContent = '';
    const label = $('qLabel').value.trim();
    const upiId = $('qUpi').value.trim();
    const imageUrl = $('qImg').value.trim();
    if (!label) return ($('qrError').textContent = 'Give the QR a label');
    if (!upiId && !imageUrl) return ($('qrError').textContent = 'Add a UPI ID or an image URL');
    const next = (state.restaurant.paymentQRs || []).concat([{ label, upiId, imageUrl }]);
    saveQRs(next);
    ['qLabel', 'qUpi', 'qImg'].forEach((id) => ($(id).value = ''));
  });
  async function saveQRs(list) {
    try {
      const data = await API.patch('/owner/settings', { paymentQRs: list }, state.token);
      state.restaurant = data.restaurant;
      renderQRs();
    } catch (e) { $('qrError').textContent = e.message; }
  }

  /* ---------------------------- Sound ----------------------------- */
  let audioCtx = null;
  function primeSound() { try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) {} }
  function beep() {
    if (!$('soundToggle').checked || !audioCtx) return;
    if (audioCtx.state === 'suspended') audioCtx.resume();
    [0, 0.18].forEach((offset) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain); gain.connect(audioCtx.destination);
      osc.type = 'sine'; osc.frequency.value = 880;
      const t = audioCtx.currentTime + offset;
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.exponentialRampToValueAtTime(0.4, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
      osc.start(t); osc.stop(t + 0.16);
    });
  }

  /* --------------------------- Helpers ---------------------------- */
  $('logoutBtn').addEventListener('click', () => location.reload());
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
