/* Owner dashboard: live monitoring board (dine-in flow driven by waiter/kitchen),
   sales analytics, staff management, and settings (tables + payment QR codes). */
(function () {
  const $ = (id) => document.getElementById(id);
  const money = (n) => '₹' + Number(n).toFixed(0);
  const state = {
    token: null, restaurant: null, orders: [], staff: [], menu: [], history: [], socket: null,
    newItemImage: '', newSectionImage: '', signupLocation: null, started: false,
  };
  const isSmall = () => state.restaurant && state.restaurant.mode === 'small';

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
      afterAuth();
    } catch (e) {
      $('loginError').textContent = e.message;
    }
  }

  // After login or signup: first-time owners pick a service model; everyone else
  // goes straight to the dashboard.
  function afterAuth() {
    if (!state.restaurant || !state.restaurant.setupComplete) showSetup();
    else startDashboard();
  }

  /* --------------------------- Sign up ---------------------------- */
  function showScreen(id) {
    ['loginScreen', 'signupScreen', 'setupScreen', 'dashScreen'].forEach((s) =>
      $(s).classList.toggle('hidden', s !== id)
    );
  }
  $('showSignupBtn').addEventListener('click', () => { $('signupError').textContent = ''; showScreen('signupScreen'); });
  $('backToLoginBtn').addEventListener('click', () => showScreen('loginScreen'));

  $('suUseLoc').addEventListener('click', async () => {
    $('suLocStatus').textContent = 'Getting your location…';
    try {
      state.signupLocation = await getPosition();
      $('suLocStatus').textContent = '✓ Location captured (' +
        state.signupLocation.lat.toFixed(5) + ', ' + state.signupLocation.lng.toFixed(5) + ')';
    } catch (_) {
      state.signupLocation = null;
      $('suLocStatus').textContent = '✗ Could not get location — allow location access and try again.';
    }
  });

  $('doSignupBtn').addEventListener('click', async () => {
    $('signupError').textContent = '';
    if (!state.signupLocation) return ($('signupError').textContent = 'Tap "Use my current location" first.');
    try {
      const data = await API.post('/owner/register', {
        code: $('suCode').value.trim(),
        name: $('suName').value.trim(),
        description: $('suDesc').value.trim(),
        password: $('suPass').value,
        radiusMeters: parseInt($('suRadius').value, 10) || undefined,
        lat: state.signupLocation.lat,
        lng: state.signupLocation.lng,
      });
      state.token = data.token;
      state.restaurant = data.restaurant;
      primeSound();
      requestNotifyPermission();
      afterAuth(); // new restaurant -> setup screen
    } catch (e) {
      $('signupError').textContent = e.message;
    }
  });

  /* ---------------------- Setup (service model) ------------------- */
  function showSetup() { showScreen('setupScreen'); }
  async function chooseMode(mode) {
    $('setupError').textContent = '';
    try {
      const data = await API.patch('/owner/setup', { mode }, state.token);
      state.restaurant = data.restaurant;
      startDashboard();
    } catch (e) {
      $('setupError').textContent = e.message;
    }
  }
  $('modeFull').addEventListener('click', () => chooseMode('full'));
  $('modeSmall').addEventListener('click', () => chooseMode('small'));

  // Hide controls that don't apply to the small (owner + kitchen) model.
  function applyModeUI() {
    const small = isSmall();
    const waiterOpt = $('sRoleWaiter');
    if (waiterOpt) {
      waiterOpt.classList.toggle('hidden', small);
      waiterOpt.disabled = small;
      if (small && $('sRole').value === 'waiter') $('sRole').value = 'kitchen';
    }
    // Staff help line: hide entirely in small mode (it only confuses the owner);
    // show the full waiter + kitchen hint in full mode.
    const help = $('staffHelp');
    if (help) {
      help.classList.toggle('hidden', small);
      if (!small) {
        help.innerHTML = 'Waiters log in at <b>/waiter.html</b>, kitchen at <b>/kitchen.html</b> with the restaurant code + these credentials.';
      }
    }
    // Service model + Tables settings aren't relevant to a small counter shop.
    const svc = $('serviceModelCard');
    if (svc) svc.classList.toggle('hidden', small);
    const tbl = $('tablesCard');
    if (tbl) tbl.classList.toggle('hidden', small);
  }

  async function startDashboard() {
    showScreen('dashScreen');
    $('rName').textContent = state.restaurant.name;
    $('rCode').textContent = state.restaurant.code;
    applyModeUI();
    if (state.started) return; // avoid double socket/interval if re-entered
    state.started = true;
    const data = await API.get('/owner/orders', state.token);
    state.orders = data.orders;
    renderAll();
    connectSocket();
    // Live refresh: orders always; the staff list too while the Staff tab is open
    // (so waiter on-shift/off-shift status updates without switching tabs).
    setInterval(() => {
      refreshOrders();
      if (!$('staffView').classList.contains('hidden')) loadStaff();
    }, 6000);
  }

  async function refreshOrders() {
    try {
      const data = await API.get('/owner/orders', state.token);
      state.orders = data.orders;
      renderAll();
    } catch (_) {}
  }

  /* ---------------------------- Tabs ------------------------------ */
  const TABS = {
    Orders: ['ordersView', tabNoop],
    Menu: ['menuView', loadMenu],
    Analytics: ['analyticsView', loadAnalytics],
    Staff: ['staffView', loadStaff],
    Settings: ['settingsView', loadSettings],
    History: ['historyView', tabNoop],
  };
  function tabNoop() {}
  const tabBtns = { Orders: 'tabOrders', Menu: 'tabMenu', Analytics: 'tabAnalytics', Staff: 'tabStaff', Settings: 'tabSettings', History: 'tabHistory' };
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
      notify('New order', (o.tableNumber != null ? 'Table ' + o.tableNumber : 'Order #' + o.id.slice(0, 6)) + ' · ' + money(o.total));
      if (!$('analyticsView').classList.contains('hidden')) loadAnalytics();
    });
    socket.on('order:update', (o) => {
      const i = state.orders.findIndex((x) => x.id === o.id);
      if (i >= 0) state.orders[i] = o; else state.orders.unshift(o);
      renderAll();
      if (!$('analyticsView').classList.contains('hidden')) loadAnalytics();
    });
    // Instant staff status: a waiter clocked on/off, or staff added/removed.
    socket.on('staff:update', () => {
      if (!$('staffView').classList.contains('hidden')) loadStaff();
    });
  }
  function setOnline(on) {
    $('statusDot').textContent = on ? '● live' : '● offline';
    $('statusDot').style.color = on ? '#bbf7d0' : '#ffd0d0';
  }

  /* -------------------------- Orders board ------------------------ */
  // Live board shows only ACTIVE orders; concluded ones live in the History tab.
  function renderAll() {
    const active = state.orders.filter((o) => o.status !== 'closed' && o.status !== 'cancelled');
    $('emptyState').classList.toggle('hidden', active.length > 0);
    const grid = $('ordersGrid');
    grid.innerHTML = '';
    active
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .forEach((o) => grid.appendChild(card(o)));
  }

  function card(o) {
    const payText = o.paymentStatus === 'paid'
      ? 'paid' + (o.paymentMethod ? ' · ' + o.paymentMethod : '') : 'unpaid';
    // No waiter concept in the small model, so skip the assigned/unassigned note.
    const waiterNote = isSmall() ? '' : (o.assignedWaiterName ? ' · 🧑‍💼 ' + esc(o.assignedWaiterName) : ' · <i>unassigned</i>');
    const sub = esc(o.customer.name || 'Guest') + ' · ' + timeAgo(o.createdAt) + waiterNote;
    const actions = [];
    // Small model: the owner verifies the UPI/cash payment and marks it paid,
    // which lets the kitchen close it.
    if (isSmall() && o.paymentStatus !== 'paid') {
      actions.push({
        label: 'Mark paid', cls: 'primary',
        onClick: () => { if (confirm('Confirm payment received for this order?')) markPaid(o.id); },
      });
    }
    actions.push({
      label: 'Cancel', cls: 'ghost',
      onClick: () => { if (confirm('Cancel this order?')) updateStatus(o.id, 'cancelled'); },
    });
    return makeOrderRow({
      id: o.id,
      title: o.tableNumber != null ? 'Table ' + o.tableNumber : 'Order #' + o.id.slice(0, 6),
      sub: sub,
      statusText: o.status,
      statusClass: '',
      items: o.items,
      extraDetailHtml:
        '<div style="margin:6px 0"><strong>' + money(o.total) + '</strong> · ' +
        '<span class="pill ' + (o.paymentStatus === 'paid' ? 'paid' : 'pending') + '">' + payText + '</span></div>',
      actions: actions,
    });
  }

  /* --------------------------- History ---------------------------- */
  $('hLoad').addEventListener('click', loadHistory);
  $('hCsv').addEventListener('click', downloadHistoryCsv);
  async function loadHistory() {
    $('historyError').textContent = '';
    try {
      const q = [];
      if ($('hFrom').value) q.push('from=' + $('hFrom').value);
      if ($('hTo').value) q.push('to=' + $('hTo').value);
      const data = await API.get('/owner/history' + (q.length ? '?' + q.join('&') : ''), state.token);
      state.history = data.orders;
      renderHistory();
    } catch (e) { $('historyError').textContent = e.message; }
  }
  function renderHistory() {
    const wrap = $('historyList');
    if (!state.history.length) {
      wrap.innerHTML = '<div class="muted">No concluded orders in this range. Pick a range and Load.</div>';
      return;
    }
    wrap.innerHTML =
      '<table><thead><tr><th>When</th><th>Table</th><th>Status</th><th>Payment</th><th>Total</th></tr></thead><tbody>' +
      state.history.map((o) =>
        '<tr><td>' + esc(fmtDate(o.closedAt || o.createdAt)) + '</td>' +
        '<td>' + esc(String(o.tableNumber)) + '</td>' +
        '<td>' + esc(o.status) + '</td>' +
        '<td>' + esc(o.paymentStatus + (o.paymentMethod ? ' · ' + o.paymentMethod : '')) + '</td>' +
        '<td>' + money(o.total) + '</td></tr>').join('') +
      '</tbody></table>';
  }
  function downloadHistoryCsv() {
    if (!state.history.length) { $('historyError').textContent = 'Load a range first.'; return; }
    const cell = (v) => {
      v = String(v == null ? '' : v);
      return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    };
    const header = ['Order ID', 'Table', 'Status', 'Payment', 'Method', 'Total', 'Items', 'Placed', 'Closed', 'Customer'];
    const lines = [header.join(',')];
    state.history.forEach((o) => {
      const items = (o.items || []).map((i) => i.qty + 'x ' + i.name).join('; ');
      lines.push([o.id, o.tableNumber, o.status, o.paymentStatus, o.paymentMethod || '', o.total,
        items, o.createdAt, o.closedAt || '', (o.customer && o.customer.name) || ''].map(cell).join(','));
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'avenza-history-' + state.restaurant.code + '.csv';
    a.click();
    URL.revokeObjectURL(url);
  }
  function fmtDate(iso) {
    const d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleString();
  }

  async function updateStatus(id, status) {
    try {
      await API.patch('/owner/orders/' + id, { status }, state.token);
    } catch (e) { alert(e.message); }
  }

  // Small model: owner confirms a payment; the live refresh/socket updates the board.
  async function markPaid(id) {
    try {
      await API.post('/owner/orders/' + id + '/pay', { method: 'upi' }, state.token);
      refreshOrders();
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
      // Show a live status pill for both roles: waiters "on shift/off", kitchen
      // "online/offline" (a cook is online once they have logged in).
      const statusLabel = s.onShift
        ? (s.role === 'waiter' ? 'on shift' : 'online')
        : (s.role === 'waiter' ? 'off' : 'offline');
      const statusPill = ' <span class="pill ' + (s.onShift ? 'paid' : 'pending') + '">' + statusLabel + '</span>';
      el.innerHTML =
        '<div style="display:flex;justify-content:space-between;align-items:center">' +
        '<div><strong>' + esc(s.name) + '</strong> <span class="pill">' + esc(s.role) + '</span>' +
        statusPill +
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
    $('setMode').value = isSmall() ? 'small' : 'full';
    $('setTables').value = state.restaurant.tables || '';
    $('setUpi').value = state.restaurant.upiId || '';
    renderQRs();
  }
  $('saveUpiBtn').addEventListener('click', async () => {
    try {
      const data = await API.patch('/owner/settings', { upiId: $('setUpi').value.trim() }, state.token);
      state.restaurant = data.restaurant;
      alert('UPI ID saved. Customers will see a QR generated from it.');
    } catch (e) { alert(e.message); }
  });
  $('saveModeBtn').addEventListener('click', async () => {
    try {
      const data = await API.patch('/owner/setup', { mode: $('setMode').value }, state.token);
      state.restaurant = data.restaurant;
      applyModeUI();
      alert('Service model saved.');
    } catch (e) { alert(e.message); }
  });
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

  /* ----------------------------- Menu ----------------------------- */
  async function loadMenu() {
    // Refresh sections in case the admin changed them since login.
    try {
      const r = await API.get('/owner/restaurant', state.token);
      if (r && r.restaurant) state.restaurant = r.restaurant;
    } catch (_) {}
    renderSections();
    populateSections();
    try {
      const data = await API.get('/owner/menu', state.token);
      state.menu = data.menu;
      renderMenu();
    } catch (e) {
      $('menuBody').innerHTML = '<tr><td colspan="5" class="banner danger">' + esc(e.message) + '</td></tr>';
    }
  }

  function grids() { return (state.restaurant && state.restaurant.grids) || []; }

  // Section picker for the add-dish form: dropdown of sections, else free text.
  function populateSections() {
    const gs = grids();
    const sel = $('mGrid');
    const txt = $('mCategory');
    if (gs.length) {
      sel.classList.remove('hidden');
      txt.classList.add('hidden');
      sel.innerHTML = gs.map((g) => '<option value="' + g.id + '">' + esc(g.name) + '</option>').join('');
    } else {
      sel.classList.add('hidden');
      txt.classList.remove('hidden');
    }
  }

  /* --------------------- Sections (owner-managed) ----------------- */
  function renderSections() {
    const wrap = $('sectionsList');
    const gs = grids();
    if (!gs.length) {
      wrap.innerHTML = '<div class="banner warn" style="margin-bottom:10px">No sections yet. Add tiles like "Biryani", "Starters", "Drinks".</div>';
      return;
    }
    wrap.innerHTML = '';
    gs.forEach((g) => {
      const el = document.createElement('div');
      el.className = 'menu-item';
      el.innerHTML =
        '<div class="mi-main">' +
        (g.image ? '<div class="mi-thumb" style="background-image:url(\'' + esc(g.image) + '\')"></div>'
                 : '<div class="mi-thumb placeholder">' + esc((g.name || '?').charAt(0).toUpperCase()) + '</div>') +
        '<div class="mi-info"><div class="name">' + esc(g.name) + '</div>' +
        (g.description ? '<div class="muted" style="font-size:12px">' + esc(g.description) + '</div>' : '') +
        '</div></div>';
      const b = document.createElement('button');
      b.className = 'ghost'; b.style.width = 'auto'; b.textContent = 'Remove';
      b.onclick = () => {
        if (!confirm('Remove section "' + g.name + '"? (dishes stay, but lose this section)')) return;
        saveGrids(gs.filter((x) => x.id !== g.id));
      };
      el.appendChild(b);
      wrap.appendChild(el);
    });
  }
  async function saveGrids(list) {
    try {
      const data = await API.patch('/owner/grids', { grids: list }, state.token);
      state.restaurant = data.restaurant;
      renderSections();
      populateSections();
    } catch (e) { $('sectionsError').textContent = e.message; }
  }
  // Image attach: sections
  $('gImgFile').addEventListener('change', async (e) => {
    $('sectionsError').textContent = '';
    const f = e.target.files && e.target.files[0];
    if (!f) { state.newSectionImage = ''; $('gImgPreview').classList.add('hidden'); return; }
    try {
      state.newSectionImage = await readImageAsDataURL(f);
      $('gImgPreview').src = state.newSectionImage;
      $('gImgPreview').classList.remove('hidden');
    } catch (err) { $('sectionsError').textContent = err.message; }
  });
  $('addSectionBtn').addEventListener('click', () => {
    $('sectionsError').textContent = '';
    const name = $('gName').value.trim();
    if (!name) return ($('sectionsError').textContent = 'Enter a section name');
    const next = grids().concat([{ name, description: $('gDesc').value.trim(), image: state.newSectionImage }]);
    saveGrids(next);
    $('gName').value = ''; $('gDesc').value = ''; $('gImgFile').value = '';
    state.newSectionImage = ''; $('gImgPreview').classList.add('hidden');
  });
  // Image attach: dishes
  $('mImgFile').addEventListener('change', async (e) => {
    $('menuError').textContent = '';
    const f = e.target.files && e.target.files[0];
    if (!f) { state.newItemImage = ''; $('mImgPreview').classList.add('hidden'); return; }
    try {
      state.newItemImage = await readImageAsDataURL(f);
      $('mImgPreview').src = state.newItemImage;
      $('mImgPreview').classList.remove('hidden');
    } catch (err) { $('menuError').textContent = err.message; }
  });
  function renderMenu() {
    const body = $('menuBody');
    if (!state.menu.length) {
      body.innerHTML = '<tr><td colspan="5" class="muted">No items yet. Add your first dish above.</td></tr>';
      return;
    }
    body.innerHTML = '';
    state.menu.forEach((it) => {
      const tr = document.createElement('tr');
      const veg = it.isVeg !== false;
      tr.innerHTML =
        '<td><span class="veg-dot ' + (veg ? 'veg' : 'nonveg') + '"></span>' + esc(it.name) +
        (it.spicy ? ' 🌶️' : '') + '</td>' +
        '<td>₹' + it.price + '</td>' +
        '<td>' + esc(it.category) + '</td>' +
        '<td>' + (it.available ? 'Yes' : '<span class="muted">Sold out</span>') + '</td>' +
        '<td></td>';
      const actions = tr.querySelector('td:last-child');
      actions.appendChild(mkMini(it.available ? 'Sold out' : 'Restock', async () => {
        await API.patch('/owner/menu/' + it.id, { available: !it.available }, state.token);
        loadMenu();
      }));
      actions.appendChild(mkMini('Delete', async () => {
        if (!confirm('Delete ' + it.name + '?')) return;
        await API.del('/owner/menu/' + it.id, state.token);
        loadMenu();
      }));
      body.appendChild(tr);
    });
  }
  function mkMini(text, onClick) {
    const b = document.createElement('button');
    b.className = 'ghost'; b.style.width = 'auto'; b.style.marginLeft = '6px'; b.style.fontSize = '12px';
    b.textContent = text; b.onclick = onClick;
    return b;
  }
  $('addItemBtn').addEventListener('click', async () => {
    $('menuError').textContent = '';
    const usingGrids = !$('mGrid').classList.contains('hidden');
    if (usingGrids && !$('mGrid').value) {
      return ($('menuError').textContent = 'No sections yet — add a section above first.');
    }
    const payload = {
      name: $('mName').value.trim(),
      price: parseFloat($('mPrice').value),
      imageUrl: state.newItemImage,
      isVeg: $('mVeg').checked,
      spicy: $('mSpicy').checked,
      tags: $('mTags').value.trim(),
    };
    if (usingGrids) payload.gridId = $('mGrid').value;
    else payload.category = $('mCategory').value.trim() || 'General';
    try {
      await API.post('/owner/menu', payload, state.token);
      ['mName', 'mPrice', 'mCategory', 'mTags'].forEach((id) => ($(id).value = ''));
      $('mVeg').checked = true; $('mSpicy').checked = false;
      $('mImgFile').value = ''; state.newItemImage = ''; $('mImgPreview').classList.add('hidden');
      loadMenu();
    } catch (e) { $('menuError').textContent = e.message; }
  });

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
