/* Admin panel: manage restaurants (codes, locations, owner passwords) + menus. */ 
(function () { 
  const $ = (id) => document.getElementById(id); 
  const state = { token: null, restaurants: [], editingCode: null }; 
 
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
        ' Â· radius ' + r.radiusMeters + 'm</div></div>' + 
        '<div></div></div>'; 
 
      const btns = el.querySelector('div > div:last-child'); 
      btns.appendChild(mkBtn('Menu', 'primary', () => openMenu(r.code, r.name))); 
      btns.appendChild(mkBtn(r.active ? 'Pause' : 'Activate', 'ghost', () => 
        patchRestaurant(r.code, { active: !r.active }) 
      )); 
      btns.appendChild(mkBtn('Delete', 'ghost', () => del(r.code))); 
      wrap.appendChild(el); 
    }); 
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
 
  /* --------------------------- Menu ------------------------------- */ 
  async function openMenu(code, name) { 
    state.editingCode = code; 
    $('menuTitle').textContent = 'Menu Â· ' + name + ' (code ' + code + ')'; 
    $('menuEditor').classList.remove('hidden'); 
    $('menuEditor').scrollIntoView({ behavior: 'smooth' }); 
    await refreshMenu(); 
  } 
 
  async function refreshMenu() { 
    const data = await API.get('/admin/restaurants/' + state.editingCode + '/menu', state.token); 
    const body = $('menuBody'); 
    body.innerHTML = ''; 
    if (data.menu.length === 0) { 
      body.innerHTML = '<tr><td colspan="5" class="muted">No items yet.</td></tr>'; 
    } 
    data.menu.forEach((it) => { 
      const tr = document.createElement('tr'); 
      tr.innerHTML = 
        '<td>' + esc(it.name) + '</td>' + 
        '<td>â‚¹' + it.price + '</td>' + 
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
        }, 
        state.token 
      ); 
      $('mName').value = ''; 
      $('mPrice').value = ''; 
      $('mCategory').value = ''; 
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
 

 
