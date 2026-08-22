/* Customer flow (dine-in): login -> keypad -> menu -> (geofence) -> pick table ->
   place order -> live track -> pay at table (cash / UPI QR, waiter confirms).
   Also: menu photos + veg/spicy/dietary tags, order history + reorder. */
(function () {
  const state = {
    code: '',
    restaurant: null,
    menu: [],
    cart: {}, // itemId -> qty
    view: 'grouped', // 'tiles' | 'section' | 'grouped'
    currentGrid: null,
    location: null,
    withinRange: false,
    orderToken: null,
    currentOrder: null,
    trackSocket: null,
  };

  const HKEY = 'avenza_orders'; // local order history (this device)
  const PKEY = 'avenza_phone';
  const $ = (id) => document.getElementById(id);
  const money = (n) => '₹' + Number(n).toFixed(0);

  /* ---------------------------- Login ----------------------------- */
  $('googleBtn').addEventListener('click', () => show('keypadScreen'));
  $('loginBtn').addEventListener('click', () => {
    const u = $('loginUser').value.trim();
    const p = $('loginPass').value.trim();
    if (!u || !p) {
      $('loginError').textContent = 'Enter any username and password to continue';
      return;
    }
    $('loginError').textContent = '';
    show('keypadScreen');
  });

  /* ---------------------------- Keypad ---------------------------- */
  const codeDisplay = $('codeDisplay');
  document.querySelectorAll('.key').forEach((key) => {
    key.addEventListener('click', () => onKey(key.dataset.k));
  });

  function onKey(k) {
    $('keypadError').textContent = '';
    if (k === 'del') {
      state.code = state.code.slice(0, -1);
    } else if (k === 'ok') {
      if (state.code.length === 3) return loadRestaurant();
      return;
    } else if (/^\d$/.test(k) && state.code.length < 3) {
      state.code += k;
    }
    codeDisplay.textContent = state.code;
    if (state.code.length === 3) loadRestaurant();
  }

  async function loadRestaurant(codeArg) {
    const code = codeArg || state.code;
    try {
      const data = await API.get('/public/restaurants/' + code + '/menu');
      state.code = code;
      state.restaurant = data.restaurant;
      state.menu = data.menu;
      $('restaurantNameTop').textContent = data.restaurant.name;
      $('hotelBox').classList.remove('hidden');
      $('appTopbar').classList.add('menu-mode');
      show('menuScreen');
      renderMenu();
      checkLocation();
    } catch (e) {
      $('keypadError').textContent = e.message;
      state.code = '';
      codeDisplay.textContent = '';
    }
  }

  /* ---------------------------- Menu ------------------------------ */
  function thumb(item) {
    if (item.imageUrl) {
      return '<div class="mi-thumb" style="background-image:url(\'' + esc(item.imageUrl) + '\')"></div>';
    }
    return '<div class="mi-thumb placeholder">' + esc((item.name || '?').charAt(0).toUpperCase()) + '</div>';
  }
  function badges(item) {
    let html = '';
    const veg = item.isVeg !== false;
    html += '<span class="veg-dot ' + (veg ? 'veg' : 'nonveg') + '" title="' + (veg ? 'Veg' : 'Non-veg') + '"></span>';
    if (item.spicy) html += '<span class="spicy" title="Spicy">🌶️</span>';
    return html;
  }
  function tagPills(item) {
    if (!Array.isArray(item.tags) || !item.tags.length) return '';
    return '<div class="mi-tags">' + item.tags.map((t) => '<span class="tag">' + esc(t) + '</span>').join('') + '</div>';
  }

  /* Build one dish row (shared by section view + legacy grouped view). */
  function itemRow(item) {
    const row = document.createElement('div');
    row.className = 'menu-item' + (item.available ? '' : ' unavailable');
    const qty = state.cart[item.id] || 0;
    row.innerHTML =
      '<div class="mi-main">' + thumb(item) +
      '<div class="mi-info">' +
      '<div class="name">' + badges(item) + esc(item.name) + (item.available ? '' : ' · sold out') + '</div>' +
      tagPills(item) + '<div class="price">' + money(item.price) + '</div>' +
      '</div></div>';
    const controls = document.createElement('div');
    if (item.available) {
      controls.className = 'qty';
      controls.innerHTML =
        '<button class="round-btn" data-dec="' + item.id + '">−</button>' +
        '<span>' + qty + '</span>' +
        '<button class="round-btn brand" data-inc="' + item.id + '">+</button>';
    }
    row.appendChild(controls);
    return row;
  }
  function wireQty(container) {
    container.querySelectorAll('[data-inc]').forEach((b) => b.addEventListener('click', () => changeQty(b.dataset.inc, 1)));
    container.querySelectorAll('[data-dec]').forEach((b) => b.addEventListener('click', () => changeQty(b.dataset.dec, -1)));
  }
  function grids() { return (state.restaurant && state.restaurant.grids) || []; }
  function itemsForGrid(g) {
    if (g.__more) return state.menu.filter((m) => !m.gridId && !grids().some((x) => x.name === m.category));
    return state.menu.filter((m) => m.gridId === g.id || (!m.gridId && m.category === g.name));
  }

  /* Entry point: section tiles if the restaurant has sections, else a flat list. */
  function renderMenu() {
    if (grids().length) { state.view = 'tiles'; showTiles(); }
    else { state.view = 'grouped'; renderGrouped(); }
  }

  function showTiles() {
    state.view = 'tiles';
    state.currentGrid = null;
    const tiles = $('gridTiles');
    tiles.innerHTML = '';
    const gs = grids().slice();
    const more = state.menu.filter((m) => !m.gridId && !gs.some((x) => x.name === m.category));
    if (more.length) gs.push({ id: '__more__', name: 'More', description: 'Other items', __more: true });
    gs.forEach((g) => {
      const count = itemsForGrid(g).filter((i) => i.available).length;
      const el = document.createElement('button');
      el.className = 'grid-tile';
      el.innerHTML =
        (g.image
          ? '<div class="gt-img" style="background-image:url(\'' + esc(g.image) + '\')"></div>'
          : '<div class="gt-img gt-img-ph">' + esc((g.name || '?').charAt(0).toUpperCase()) + '</div>') +
        '<div class="gt-body">' +
        '<div class="gt-name">' + esc(g.name) + '</div>' +
        (g.description ? '<div class="gt-desc">' + esc(g.description) + '</div>' : '') +
        '<div class="gt-count">' + count + (count === 1 ? ' item' : ' items') + '</div>' +
        '</div>';
      el.onclick = () => openSection(g);
      tiles.appendChild(el);
    });
    tiles.classList.remove('hidden');
    $('menuList').classList.add('hidden');
    $('sectionsBackBtn').classList.add('hidden');
    $('sectionTitle').classList.add('hidden');
    renderCartBar();
  }

  function openSection(g) {
    state.view = 'section';
    state.currentGrid = g;
    renderSection();
    $('gridTiles').classList.add('hidden');
    $('menuList').classList.remove('hidden');
    $('sectionsBackBtn').classList.remove('hidden');
    const t = $('sectionTitle');
    t.textContent = g.name;
    t.classList.remove('hidden');
  }
  function renderSection() {
    const list = itemsForGrid(state.currentGrid);
    const wrap = $('menuList');
    wrap.innerHTML = '';
    if (!list.length) wrap.innerHTML = '<div class="banner warn">No items in this section yet.</div>';
    list.forEach((it) => wrap.appendChild(itemRow(it)));
    wireQty(wrap);
    renderCartBar();
  }
  function renderGrouped() {
    const list = $('menuList');
    list.innerHTML = '';
    const groups = {};
    state.menu.forEach((m) => { (groups[m.category] = groups[m.category] || []).push(m); });
    Object.keys(groups).forEach((cat) => {
      const title = document.createElement('div');
      title.className = 'category-title';
      title.textContent = cat;
      list.appendChild(title);
      groups[cat].forEach((it) => list.appendChild(itemRow(it)));
    });
    wireQty(list);
    list.classList.remove('hidden');
    $('gridTiles').classList.add('hidden');
    renderCartBar();
  }
  function rerender() {
    if (state.view === 'section') renderSection();
    else if (state.view === 'grouped') renderGrouped();
    else showTiles();
  }

  function changeQty(id, delta) {
    const next = (state.cart[id] || 0) + delta;
    if (next <= 0) delete state.cart[id];
    else state.cart[id] = next;
    rerender();
  }
  function cartLines() {
    return Object.keys(state.cart).map((id) => {
      const m = state.menu.find((x) => x.id === id);
      return { itemId: id, name: m.name, price: m.price, qty: state.cart[id] };
    });
  }
  function cartTotal() { return cartLines().reduce((s, l) => s + l.price * l.qty, 0); }
  function renderCartBar() {
    const lines = cartLines();
    const count = lines.reduce((s, l) => s + l.qty, 0);
    const bar = $('cartBar');
    if (count === 0) return bar.classList.add('hidden');
    bar.classList.remove('hidden');
    $('cartSummary').textContent = count + (count === 1 ? ' item' : ' items');
    $('cartTotal').textContent = money(cartTotal());
    bar.onclick = goCheckout;
  }

  /* ------------------------- Geolocation -------------------------- */
  // Compact geo indicator: a small ✓ / ⚠️ chip at the top (tap ⚠️ for details).
  function setGeo(ok, msg) {
    const el = $('geoBanner');
    el.className = 'geo-chip ' + (ok ? 'ok' : 'warn');
    el.textContent = ok ? '✓' : '⚠️';
    el.title = msg;
    el.onclick = ok ? null : () => alert(msg);
  }
  async function checkLocation() {
    try {
      state.location = await getPosition();
      const res = await API.post('/public/restaurants/' + state.code + '/geocheck', state.location);
      state.withinRange = res.withinRange;
      if (res.withinRange) setGeo(true, 'You are at ' + state.restaurant.name + ' — you can order.');
      else setGeo(false, 'You are ~' + res.distanceMeters + 'm away. You must be within ' +
        res.radiusMeters + 'm (inside the restaurant) to order.');
    } catch (e) {
      state.withinRange = false;
      setGeo(false, 'Location unavailable — ordering is blocked. Enable location and reload the page.');
    }
    renderCartBar();
  }

  /* --------------------------- Checkout --------------------------- */
  async function populateTables() {
    const sel = $('tableSelect');
    const n = Number(state.restaurant && state.restaurant.tables) || 0;
    const max = n > 0 ? n : 20;
    $('tableHint').textContent = n > 0 ? '(1–' + n + ')' : '';
    let occupied = [];
    try {
      const d = await API.get('/public/restaurants/' + state.code + '/tables');
      occupied = d.occupied || [];
    } catch (_) {}
    sel.innerHTML = '<option value="">Select table…</option>';
    for (let i = 1; i <= max; i++) {
      const taken = occupied.indexOf(i) !== -1;
      sel.innerHTML += '<option value="' + i + '"' + (taken ? ' disabled' : '') + '>Table ' + i +
        (taken ? ' — occupied' : '') + '</option>';
    }
  }

  function goCheckout() {
    if (!state.withinRange) { alert('You must be inside the restaurant to order.'); return; }
    if (cartLines().length === 0) return;
    const box = $('checkoutItems');
    box.innerHTML =
      cartLines().map((l) => '<div class="menu-item"><span>' + esc(l.name) + ' × ' + l.qty +
        '</span><strong>' + money(l.price * l.qty) + '</strong></div>').join('') +
      '<div class="menu-item"><strong>Total</strong><strong>' + money(cartTotal()) + '</strong></div>';
    populateTables();
    const savedPhone = localStorage.getItem(PKEY);
    if (savedPhone && !$('custPhone').value) $('custPhone').value = savedPhone;
    show('checkoutScreen');
  }
  $('backToMenu').addEventListener('click', () => show('menuScreen'));
  $('sectionsBackBtn').addEventListener('click', () => showTiles());

  $('payBtn').addEventListener('click', async () => {
    $('checkoutError').textContent = '';
    const name = $('custName').value.trim();
    const phone = $('custPhone').value.trim();
    const tableNumber = parseInt($('tableSelect').value, 10);
    if (!tableNumber) return ($('checkoutError').textContent = 'Please select your table number');
    if (!name) return ($('checkoutError').textContent = 'Please enter your name');
    if (phone) localStorage.setItem(PKEY, phone);

    $('payBtn').disabled = true;
    try {
      const data = await API.post('/public/orders', {
        restaurantCode: state.code,
        items: cartLines().map((l) => ({ itemId: l.itemId, qty: l.qty })),
        customer: { name, phone },
        location: state.location,
        tableNumber,
      });
      startTracking(data.order, data.orderToken);
    } catch (e) {
      $('checkoutError').textContent = e.message;
    } finally {
      $('payBtn').disabled = false;
    }
  });

  /* ----------------------- Live order tracking -------------------- */
  const STEPS = ['placed', 'confirmed', 'preparing', 'ready', 'served', 'closed'];
  const STEP_LABELS = {
    placed: 'Order placed',
    confirmed: 'Confirmed by waiter',
    preparing: 'In the kitchen',
    ready: 'Ready — being served',
    served: 'Served',
    closed: 'Paid · thank you!',
  };

  function renderTrackCard(o) {
    $('trackCard').innerHTML =
      '<div class="muted">Table</div><div><strong>' + esc(String(o.tableNumber != null ? o.tableNumber : '—')) + '</strong></div>' +
      '<div class="muted" style="margin-top:8px">Order</div><div>#' + o.id.slice(0, 8) + '</div>' +
      '<div class="muted" style="margin-top:8px">Total</div><div>' + money(o.total) + '</div>' +
      (o.assignedWaiterName ? '<div class="muted" style="margin-top:8px">Your waiter</div><div>' + esc(o.assignedWaiterName) + '</div>' : '');
  }

  function renderTimeline(status) {
    const tl = $('trackTimeline');
    if (status === 'cancelled') { tl.innerHTML = '<div class="banner danger">This order was cancelled.</div>'; return; }
    const idx = STEPS.indexOf(status);
    tl.innerHTML = STEPS.map((s, i) => {
      const cls = i < idx ? 'done' : i === idx ? 'active' : '';
      return '<div class="timeline-step ' + cls + '"><span class="dot"></span><span class="lbl">' + STEP_LABELS[s] + '</span></div>';
    }).join('');
  }

  function upiLink(scheme, upiId, name, amount, note) {
    return scheme + 'pa=' + encodeURIComponent(upiId) + '&pn=' + encodeURIComponent(name || 'Restaurant') +
      '&am=' + Number(amount) + '&cu=INR&tn=' + encodeURIComponent(note);
  }
  function renderPayPanel(o) {
    const panel = $('payPanel');
    if (o.paymentStatus === 'paid') {
      panel.classList.remove('hidden');
      panel.innerHTML = '<div class="banner ok">Paid' + (o.paymentMethod ? ' via ' + esc(o.paymentMethod) : '') + '. Thank you!</div>';
      return;
    }
    if (o.status === 'ready' || o.status === 'served') {
      const r = state.restaurant || {};
      const qrs = r.paymentQRs || [];
      const upiId = r.upiId || (qrs.find((q) => q.upiId) || {}).upiId || '';
      const note = 'Table ' + o.tableNumber + ' #' + o.id.slice(0, 6);

      const appBtns = upiId
        ? '<div class="pay-apps">' +
          '<a class="pay-app gpay" href="' + esc(upiLink('tez://upi/pay?', upiId, r.name, o.total, note)) + '">Pay with GPay</a>' +
          '<a class="pay-app phonepe" href="' + esc(upiLink('phonepe://pay?', upiId, r.name, o.total, note)) + '">Pay with PhonePe</a>' +
          '<a class="pay-app anyupi" href="' + esc(upiLink('upi://pay?', upiId, r.name, o.total, note)) + '">Any UPI app</a>' +
          '</div>' +
          '<div class="muted" style="font-size:11px;margin-top:4px">Paying to ' + esc(upiId) + ' · opens your UPI app on a phone</div>'
        : '';

      const qrList = qrs.length
        ? '<div class="qr-list">' + qrs.map((q) =>
            '<div class="qr-card">' +
            (q.imageUrl ? '<img src="' + esc(q.imageUrl) + '" alt="QR" />' : '<div class="qr-ph">QR</div>') +
            '<div><strong>' + esc(q.label) + '</strong>' +
            (q.upiId ? '<div class="muted" style="font-size:12px">' + esc(q.upiId) + '</div>' : '') +
            '</div></div>').join('') + '</div>'
        : '';

      panel.classList.remove('hidden');
      panel.innerHTML =
        '<h4>Pay ' + money(o.total) + '</h4>' +
        '<p class="muted" style="font-size:13px;margin-top:0">Pay via a UPI app or scan a QR — or pay cash. Your waiter confirms and closes the bill.</p>' +
        appBtns + qrList +
        (!appBtns && !qrList ? '<div class="banner warn">Ask your waiter for payment details.</div>' : '');
      return;
    }
    panel.classList.add('hidden');
  }

  function startTracking(order, token) {
    state.currentOrder = order;
    state.orderToken = token;
    saveHistory(order, token);
    renderTrackCard(order);
    renderTimeline(order.status);
    renderPayPanel(order);
    show('trackScreen');
    requestNotifyPermission();

    if (state.trackSocket) { try { state.trackSocket.disconnect(); } catch (_) {} state.trackSocket = null; }
    try {
      if (typeof io === 'function') {
        const socket = io();
        state.trackSocket = socket;
        socket.on('connect', () => socket.emit('order:subscribe', { token }));
        socket.on('order:update', (o) => {
          if (!o || o.id !== order.id) return;
          state.currentOrder = o;
          renderTrackCard(o);
          renderTimeline(o.status);
          renderPayPanel(o);
          updateHistoryStatus(o.id, o.status, o.paymentStatus);
          notify('Order update', 'Your order is now: ' + (STEP_LABELS[o.status] || o.status));
        });
      }
    } catch (_) {}

    API.get('/public/orders/' + order.id + '?token=' + encodeURIComponent(token))
      .then((d) => { if (d.order) { renderTrackCard(d.order); renderTimeline(d.order.status); renderPayPanel(d.order); } })
      .catch(() => {});
  }
  // Place another order: keep the session (same restaurant), clear the cart and
  // go back to the menu instead of logging out.
  $('newOrderBtn').addEventListener('click', () => {
    if (state.trackSocket) { try { state.trackSocket.disconnect(); } catch (_) {} state.trackSocket = null; }
    state.cart = {};
    state.currentOrder = null;
    state.orderToken = null;
    $('payPanel').classList.add('hidden');
    if (state.menu && state.menu.length) {
      renderMenu();
      show('menuScreen');
    } else {
      show('keypadScreen');
    }
  });

  /* --------------------- Order history + reorder ------------------ */
  function loadHistory() { try { return JSON.parse(localStorage.getItem(HKEY) || '[]'); } catch (_) { return []; } }
  function saveHistory(o, token) {
    const list = loadHistory().filter((x) => x.id !== o.id);
    list.unshift({
      id: o.id, token: token,
      restaurantCode: o.restaurantCode,
      restaurantName: state.restaurant ? state.restaurant.name : '',
      tableNumber: o.tableNumber,
      items: o.items, total: o.total,
      createdAt: o.createdAt || new Date().toISOString(),
      status: o.status, paymentStatus: o.paymentStatus,
    });
    localStorage.setItem(HKEY, JSON.stringify(list.slice(0, 20)));
  }
  function updateHistoryStatus(id, status, paymentStatus) {
    const list = loadHistory().map((x) =>
      x.id === id ? Object.assign({}, x, { status, paymentStatus: paymentStatus || x.paymentStatus }) : x
    );
    localStorage.setItem(HKEY, JSON.stringify(list));
  }

  // Bottom nav: My orders + change restaurant.
  $('navOrders').addEventListener('click', () => { renderMyOrders(); show('ordersScreen'); });
  $('ordersBackBtn').addEventListener('click', () => show('menuScreen'));

  // Change restaurant: clear the current code/cart and go back to the keypad.
  $('navBack').addEventListener('click', () => {
    state.code = '';
    state.cart = {};
    state.restaurant = null;
    state.menu = [];
    codeDisplay.textContent = '';
    $('hotelBox').classList.add('hidden');
    $('appTopbar').classList.remove('menu-mode');
    show('keypadScreen');
  });

  function renderMyOrders() {
    const list = loadHistory();
    const wrap = $('ordersList');
    if (!list.length) { wrap.innerHTML = '<div class="banner warn">No past orders on this device yet.</div>'; return; }
    wrap.innerHTML = '';
    list.forEach((o) => {
      const el = document.createElement('div');
      el.className = 'card';
      const items = o.items.map((i) => i.qty + ' × ' + esc(i.name)).join(', ');
      el.innerHTML =
        '<div style="display:flex;justify-content:space-between;align-items:center">' +
        '<strong>' + esc(o.restaurantName || 'Code ' + o.restaurantCode) + '</strong>' +
        '<span class="pill">' + esc(o.status || '') + '</span></div>' +
        '<div class="muted" style="font-size:12px;margin:6px 0">' + timeAgo(o.createdAt) + ' · ' + money(o.total) +
        (o.tableNumber ? ' · Table ' + esc(String(o.tableNumber)) : '') + '</div>' +
        '<div style="font-size:13px">' + items + '</div>' +
        '<div class="status-row"></div>';
      const row = el.querySelector('.status-row');
      const t = document.createElement('button');
      t.className = 'ghost'; t.textContent = 'Track';
      t.onclick = () => {
        state.restaurant = state.restaurant || { name: o.restaurantName, code: o.restaurantCode, paymentQRs: [] };
        startTracking(o, o.token);
      };
      const r = document.createElement('button');
      r.className = 'primary'; r.style.width = 'auto'; r.textContent = 'Reorder';
      r.onclick = () => reorder(o);
      row.appendChild(t); row.appendChild(r);
      wrap.appendChild(el);
    });
  }

  async function reorder(o) {
    if (o.restaurantCode !== state.code || !state.menu.length) await loadRestaurant(o.restaurantCode);
    else show('menuScreen');
    const cart = {};
    (o.items || []).forEach((it) => {
      const m = state.menu.find((x) => x.id === it.itemId && x.available);
      if (m) cart[it.itemId] = (cart[it.itemId] || 0) + it.qty;
    });
    state.cart = cart;
    renderMenu();
    if (Object.keys(cart).length === 0) alert('Those items are no longer available at this restaurant.');
  }

  /* --------------------------- Helpers ---------------------------- */
  function show(id) {
    ['loginScreen', 'keypadScreen', 'menuScreen', 'checkoutScreen', 'trackScreen', 'ordersScreen'].forEach((s) =>
      $(s).classList.toggle('hidden', s !== id)
    );
    // Bottom nav is only relevant while browsing the menu.
    $('bottomNav').classList.toggle('hidden', id !== 'menuScreen');
  }
  function timeAgo(iso) {
    const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return s + 's ago';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
})();
