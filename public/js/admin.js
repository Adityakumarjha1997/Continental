/* Admin panel: manage restaurants (codes, locations, owner passwords) + menus
   (now with photo, veg/non-veg, spicy and dietary tags). */
(function () {
  const $ = (id) => document.getElementById(id);
  const state = { token: null, restaurants: [], editingCode: null, editingGrids: [], gridsCode: null };

  /* ---------------------------- Login ----------------------------- */
  $('loginBtn').addEventListener('click', login);
  $('adminPass').addEventListener('keydown', (e) => e.key === 'Enter' && login());
  $('logoutBtn').addEventListener('click', () => location.reload());

  async function login() {
    $('loginError').textContent = '';
    try {
      const data = await API.post('/admin/login', { password: $('adminPass').value });
      state.token = data.token;
      $('loginScreen').classList.add('hidden');
      $('panelScreen').classList.remove('hidden');
      loadRestaurants();
    } catch (e) {
      $('loginError').textContent = e.message;
    }
  }

  /* ------------------------- Restaurants -------------------------- */
  async function loadRestaurants() {
    const data = await API.get('/admin/restaurants', state.token);
    state.restaurants = data.restaurants;
    renderRestaurants();
  }

  function renderRestaurants() {
    const wrap = $('restaurantList');
    if (state.restaurants.length === 0) {
      wrap.innerHTML = '<div class="banner warn">No restaurants yet. Add one below.</div>';
      return;
    }
    wrap.innerHTML = '';
    state.restaurants.forEach((r) => {
      const el = document.createElement('div');
      el.className = 'card';
      el.innerHTML =
        '<div style="display:flex;justify-content:space-between;align-items:center">' +
        '<div><strong>' + esc(r.name) + '</strong> ' +
        '<span class="pill">code ' + r.code + '</span> ' +
        '<span class="pill ' + (r.active ? 'paid' : 'pending') + '">' +
        (r.active ? 'active' : 'paused') + '</span>' +
        '<div class="muted" style="font-size:12px;margin-top:4px">' +
        r.location.lat.toFixed(4) + ', ' + r.location.lng.toFixed(4) +
        ' · radius ' + r.radiusMeters + 'm</div></div>' +
        '<div class="admin-actions"></div></div>';

      const btns = el.querySelector('div > div:last-child');
      btns.appendChild(mkBtn('Sections', 'ghost', () => openSections(r.code, r.name)));
      btns.appendChild(mkBtn('Menu', 'primary', () => openMenu(r.code, r.name)));
      btns.appendChild(mkBtn(r.active ? 'Pause' : 'Activate', 'ghost', () =>
        patchRestaurant(r.code, { active: !r.active })
      ));
      btns.appendChild(mkBtn('Password', 'ghost', () => setPassword(r.code, r.name)));
      btns.appendChild(mkBtn('Delete', 'ghost', () => del(r.code)));
      wrap.appendChild(el);
    });
  }

  /** Update a restaurant's owner login password after creation. */
  async function setPassword(code, name) {
    const p = prompt('Set a new owner password for "' + name + '" (code ' + code + '):');
    if (p == null) return;
    if (!p.trim()) return alert('Password cannot be empty.');
    try {
      await API.patch('/admin/restaurants/' + code, { ownerPassword: p }, state.token);
      alert('Owner password updated for ' + name + '.');
    } catch (e) {
      alert(e.message);
    }
  }

  function mkBtn(text, cls, onClick) {
    const b = document.createElement('button');
    b.className = cls;
    b.style.width = 'auto';
    b.style.marginLeft = '6px';
    b.textContent = text;
    b.onclick = onClick;
    return b;
  }

  async function patchRestaurant(code, patch) {
    await API.patch('/admin/restaurants/' + code, patch, state.token);
    loadRestaurants();
  }

  async function del(code) {
    if (!confirm('Delete restaurant ' + code + ' and its menu?')) return;
    await API.del('/admin/restaurants/' + code, state.token);
    loadRestaurants();
  }

  /* --------------------- Create restaurant ------------------------ */
  $('useLocBtn').addEventListener('click', async () => {
    try {
      const p = await getPosition();
      $('nLat').value = p.lat.toFixed(6);
      $('nLng').value = p.lng.toFixed(6);
    } catch (e) {
      alert('Could not read location: ' + e.message);
    }
  });

  $('addBtn').addEventListener('click', async () => {
    $('addError').textContent = '';
    try {
      await API.post(
        '/admin/restaurants',
        {
          code: $('nCode').value.trim(),
          name: $('nName').value.trim(),
          description: $('nDesc').value.trim(),
          ownerPassword: $('nOwnerPass').value,
          upiId: $('nUpi').value.trim(),
          lat: parseFloat($('nLat').value),
          lng: parseFloat($('nLng').value),
          radiusMeters: parseInt($('nRadius').value, 10) || 100,
        },
        state.token
      );
      ['nCode', 'nName', 'nDesc', 'nOwnerPass', 'nUpi', 'nLat', 'nLng', 'nRadius'].forEach(
        (id) => ($(id).value = '')
      );
      loadRestaurants();
    } catch (e) {
      $('addError').textContent = e.message;
    }
  });

  /* ------------------------- Sections (grids) --------------------- */
  function openSections(code, name) {
    const r = state.restaurants.find((x) => x.code === code);
    state.gridsCode = code;
    state.editingGrids = (r && Array.isArray(r.grids) ? r.grids : []).map((g) => ({ ...g }));
    $('sectionsTitle').textContent = 'Sections · ' + name + ' (code ' + code + ')';
    $('sectionsEditor').classList.remove('hidden');
    $('sectionsEditor').scrollIntoView({ behavior: 'smooth' });
    renderSections();
  }
  function renderSections() {
    const wrap = $('sectionsList');
    if (!state.editingGrids.length) {
      wrap.innerHTML = '<div class="banner warn">No sections yet. Add tiles like "Biryani", "Starters", "Drinks".</div>';
      return;
    }
    wrap.innerHTML = '';
    state.editingGrids.forEach((g, i) => {
      const el = document.createElement('div');
      el.className = 'menu-item';
      el.innerHTML = '<div><strong>' + esc(g.name) + '</strong>' +
        (g.description ? '<div class="muted" style="font-size:12px">' + esc(g.description) + '</div>' : '') + '</div>';
      const b = mkBtn('Remove', 'ghost', () => { state.editingGrids.splice(i, 1); saveSections(); });
      el.appendChild(b);
      wrap.appendChild(el);
    });
  }
  async function saveSections() {
    try {
      const data = await API.patch('/admin/restaurants/' + state.gridsCode + '/grids',
        { grids: state.editingGrids }, state.token);
      // keep the local restaurant copy + editor in sync with the server ids
      const r = state.restaurants.find((x) => x.code === state.gridsCode);
      if (r) r.grids = data.restaurant.grids;
      state.editingGrids = data.restaurant.grids.map((g) => ({ ...g }));
      renderSections();
    } catch (e) { $('sectionsError').textContent = e.message; }
  }
  $('addSectionBtn').addEventListener('click', () => {
    $('sectionsError').textContent = '';
    const name = $('gName').value.trim();
    if (!name) return ($('sectionsError').textContent = 'Enter a section name');
    state.editingGrids.push({ name, description: $('gDesc').value.trim() });
    $('gName').value = ''; $('gDesc').value = '';
    saveSections();
  });
  $('closeSections').addEventListener('click', () => $('sectionsEditor').classList.add('hidden'));

  /* --------------------------- Menu ------------------------------- */
  async function openMenu(code, name) {
    state.editingCode = code;
    $('menuTitle').textContent = 'Menu · ' + name + ' (code ' + code + ')';
    $('menuEditor').classList.remove('hidden');
    $('menuEditor').scrollIntoView({ behavior: 'smooth' });
    await refreshMenu();
  }

  async function refreshMenu() {
    const data = await API.get('/admin/restaurants/' + state.editingCode + '/menu', state.token);
    const body = $('menuBody');
    body.innerHTML = '';
    if (data.menu.length === 0) {
      body.innerHTML = '<tr><td colspan="6" class="muted">No items yet.</td></tr>';
    }
    data.menu.forEach((it) => {
      const veg = it.isVeg !== false;
      const typeCell =
        '<span class="veg-dot ' + (veg ? 'veg' : 'nonveg') + '"></span>' +
        (it.spicy ? ' 🌶️' : '') +
        (Array.isArray(it.tags) && it.tags.length
          ? '<div class="muted" style="font-size:11px">' + esc(it.tags.join(', ')) + '</div>'
          : '');
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + esc(it.name) + '</td>' +
        '<td>₹' + it.price + '</td>' +
        '<td>' + typeCell + '</td>' +
        '<td>' + esc(it.category) + '</td>' +
        '<td>' + (it.available ? 'Yes' : 'No') + '</td>' +
        '<td></td>';
      const actions = tr.querySelector('td:last-child');
      actions.appendChild(
        mkBtn(it.available ? 'Sold out' : 'Restock', 'ghost', async () => {
          await API.patch('/admin/menu/' + it.id, { available: !it.available }, state.token);
          refreshMenu();
        })
      );
      actions.appendChild(
        mkBtn('Delete', 'ghost', async () => {
          await API.del('/admin/menu/' + it.id, state.token);
          refreshMenu();
        })
      );
      body.appendChild(tr);
    });
  }

  $('closeMenu').addEventListener('click', () => $('menuEditor').classList.add('hidden'));

  $('addItemBtn').addEventListener('click', async () => {
    $('menuError').textContent = '';
    try {
      await API.post(
        '/admin/restaurants/' + state.editingCode + '/menu',
        {
          name: $('mName').value.trim(),
          price: parseFloat($('mPrice').value),
          category: $('mCategory').value.trim() || 'General',
          imageUrl: $('mImage').value.trim(),
          isVeg: $('mVeg').value !== 'nonveg',
          spicy: $('mSpicy').checked,
          tags: $('mTags').value,
        },
        state.token
      );
      $('mName').value = '';
      $('mPrice').value = '';
      $('mCategory').value = '';
      $('mImage').value = '';
      $('mVeg').value = 'veg';
      $('mSpicy').checked = false;
      $('mTags').value = '';
      refreshMenu();
    } catch (e) {
      $('menuError').textContent = e.message;
    }
  });

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])
    );
  }
})();
