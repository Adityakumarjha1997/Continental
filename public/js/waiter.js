/* Waiter panel: login + shift, live auto-assigned orders, confirm -> kitchen,
   serve, and settle (cash / UPI QR) to close the bill. */
(function () {
  const $ = (id) => document.getElementById(id);
  const money = (n) => '₹' + Number(n).toFixed(0);
  const state = { token: null, staff: null, restaurant: null, orders: [], socket: null };

  const LANES = {
    new: ['placed'],
    kitchen: ['confirmed', 'preparing'],
    ready: ['ready'],
    served: ['served'],
  };

  /* ---------------------------- Login ----------------------------- */
  $('loginBtn').addEventListener('click', login);
  $('password').addEventListener('keydown', (e) => e.key === 'Enter' && login());

  async function login() {
    $('loginError').textContent = '';
    try {
      const data = await API.post('/waiter/login', {
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
    $('waiterName').textContent = state.staff.name;
    $('rName').textContent = state.restaurant ? state.restaurant.name : '';
    const data = await API.get('/waiter/orders', state.token);
    state.orders = data.orders;
    render();
    connectSocket();
  }

  /* ------------------------- Shift toggle ------------------------- */
  $('shiftToggle').addEventListener('change', async (e) => {
    try {
      await API.patch('/waiter/shift', { onShift: e.target.checked }, state.token);
    } catch (err) {
      alert(err.message);
      e.target.checked = !e.target.checked;
    }
  });
  $('logoutBtn').addEventListener('click', async () => {
    try { await API.patch('/waiter/shift', { onShift: false }, state.token); } catch (_) {}
    location.reload();
  });

  /* ---------------------------- Socket ---------------------------- */
  function mine(o) {
    return o.assignedWaiterId === state.staff.id || !o.assignedWaiterId;
  }
  function isActive(o) {
    return o.status !== 'closed' && o.status !== 'cancelled';
  }

  function connectSocket() {
    const socket = io();
    state.socket = socket;
    socket.on('connect', () => socket.emit('waiter:subscribe', { token: state.token }));
    socket.on('subscribed', () => setOnline(true));
    socket.on('disconnect', () => setOnline(false));

    socket.on('order:new', (o) => {
      if (!mine(o) || !isActive(o)) return;
      upsert(o);
      render();
      flash(o.id);
      beep();
      notify('New order', 'Table ' + o.tableNumber + ' · ' + money(o.total));
    });
    socket.on('order:update', (o) => {
      // ready = kitchen finished my order -> alert me to serve
      const wasReady = o.status === 'ready' && mine(o);
      upsert(o);
      render();
      if (wasReady) { beep(); notify('Order ready', 'Table ' + o.tableNumber + ' is ready to serve'); }
    });
  }

  function upsert(o) {
    const keep = mine(o) && isActive(o);
    const i = state.orders.findIndex((x) => x.id === o.id);
    if (!keep) {
      if (i >= 0) state.orders.splice(i, 1);
      return;
    }
    if (i >= 0) state.orders[i] = o;
    else state.orders.unshift(o);
  }

  function setOnline(on) {
    $('statusDot').textContent = on ? '● live' : '● offline';
    $('statusDot').style.color = on ? '#bbf7d0' : '#ffd0d0';
  }

  /* ---------------------------- Render ---------------------------- */
  function render() {
    let total = 0;
    Object.keys(LANES).forEach((lane) => {
      const grid = $('lane-' + lane);
      grid.innerHTML = '';
      const list = state.orders.filter((o) => LANES[lane].includes(o.status));
      total += list.length;
      list
        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
        .forEach((o) => grid.appendChild(card(o, lane)));
    });
    $('emptyState').classList.toggle('hidden', total > 0);
  }

  function card(o, lane) {
    const el = document.createElement('div');
    el.className = 'order-card';
    el.id = 'ord-' + o.id;
    const items = o.items.map((i) => '<li>' + i.qty + ' × ' + esc(i.name) + '</li>').join('');
    const unassigned = !o.assignedWaiterId;

    el.innerHTML =
      '<h4><span>Table ' + esc(String(o.tableNumber)) + '</span>' +
      '<span class="pill">' + esc(o.status) + '</span></h4>' +
      '<div class="muted" style="font-size:12px">' + esc(o.customer.name || 'Guest') +
      ' · ' + timeAgo(o.createdAt) + (unassigned ? ' · <b>pool</b>' : '') + '</div>' +
      '<ul class="order-items">' + items + '</ul>' +
      '<div><strong>' + money(o.total) + '</strong></div>' +
      '<div class="status-row" id="sr-' + o.id + '"></div>';

    const row = el.querySelector('#sr-' + o.id);
    if (lane === 'new') {
      row.appendChild(btn('Confirm & send to kitchen', 'primary', () => act(o.id, 'PATCH', 'confirm')));
    } else if (lane === 'kitchen') {
      const wait = document.createElement('span');
      wait.className = 'muted';
      wait.style.fontSize = '13px';
      wait.textContent = o.status === 'preparing' ? 'Cooking…' : 'Sent to kitchen…';
      row.appendChild(wait);
    } else if (lane === 'ready') {
      row.appendChild(btn('Mark served', 'primary', () => act(o.id, 'PATCH', 'serve')));
    } else if (lane === 'served') {
      row.appendChild(btn('Settle & close', 'primary', () => openSettle(o)));
    }
    if (isActive(o) && o.status !== 'served') {
      row.appendChild(btn('Cancel', 'ghost', () => {
        if (confirm('Cancel this order?')) act(o.id, 'PATCH', 'cancel');
      }));
    }
    return el;
  }

  async function act(id, method, path, body) {
    try {
      await API.req(method, '/waiter/orders/' + id + '/' + path, body || null, state.token);
      // socket order:update refreshes the board
    } catch (e) {
      alert(e.message);
    }
  }

  /* -------------------------- Settlement -------------------------- */
  function openSettle(o) {
    const qrs = (state.restaurant && state.restaurant.paymentQRs) || [];
    const qrHtml = qrs.length
      ? '<div class="qr-list">' + qrs.map((q) =>
          '<div class="qr-card">' +
          (q.imageUrl ? '<img src="' + esc(q.imageUrl) + '" alt="QR" />' : '<div class="qr-ph">QR</div>') +
          '<div><strong>' + esc(q.label) + '</strong>' +
          (q.upiId ? '<div class="muted" style="font-size:12px">' + esc(q.upiId) + '</div>' : '') +
          '</div></div>').join('') + '</div>'
      : '<div class="banner warn">No UPI QR saved. Ask the owner to add one, or take cash.</div>';

    openModal(
      'Settle — Table ' + o.tableNumber + ' · ' + money(o.total),
      '<p class="muted">Customer picks a method. Confirm once you have received payment.</p>' +
        '<div class="pay-tabs"><button class="tab active" data-m="upi">UPI QR</button>' +
        '<button class="tab" data-m="cash">Cash</button></div>' +
        '<div id="payUpi">' + qrHtml + '</div>' +
        '<div id="payCash" class="hidden"><div class="banner ok">Collect ' + money(o.total) + ' in cash.</div></div>' +
        '<button class="primary" id="confirmPay">Mark paid &amp; close</button>',
      (root) => {
        let method = 'upi';
        root.querySelectorAll('.pay-tabs .tab').forEach((t) =>
          t.addEventListener('click', () => {
            method = t.dataset.m;
            root.querySelectorAll('.pay-tabs .tab').forEach((x) => x.classList.toggle('active', x === t));
            root.querySelector('#payUpi').classList.toggle('hidden', method !== 'upi');
            root.querySelector('#payCash').classList.toggle('hidden', method !== 'cash');
          })
        );
        root.querySelector('#confirmPay').addEventListener('click', async () => {
          try {
            await API.post('/waiter/orders/' + o.id + '/settle', { method }, state.token);
            closeModal();
          } catch (e) {
            alert(e.message);
          }
        });
      }
    );
  }

  /* ----------------------------- Modal ---------------------------- */
  function openModal(title, bodyHtml, wire) {
    $('modalTitle').textContent = title;
    $('modalBody').innerHTML = bodyHtml;
    $('modalBackdrop').classList.remove('hidden');
    if (wire) wire($('modalBody'));
  }
  function closeModal() { $('modalBackdrop').classList.add('hidden'); }
  $('modalCancel').addEventListener('click', closeModal);
  $('modalBackdrop').addEventListener('click', (e) => { if (e.target === $('modalBackdrop')) closeModal(); });

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
      osc.type = 'sine'; osc.frequency.value = 880;
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
