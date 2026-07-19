#!/usr/bin/env python3 

r""" 
apply-update.py -- writes the listed files straight into the deployed project. 

Run on the deployment machine, pointing at the project root (the Continental 
folder): 

    python apply-update.py "C:\Users\Aditya kumar jha\OneDrive\Documents\Continental" 

(or just `python apply-update.py` if TARGET_DIR below is already correct). 
Then push so Render redeploys: 

    git add -A 
    git commit -m "add login page, hotel-name layout, encoding fixes" 
    git push 

This update: 
  - Adds a dummy login page (Google button OR any username/password) before the 
    keypad on the customer app. 
  - Moves the hotel name to the LEFT (nicely formatted) and the Avenza brand to 
    the RIGHT once a table code is entered. 
  - Keeps all special characters ASCII-safe so transfers cannot corrupt them. 

A "<file>.bak" backup is written before each overwrite (git-ignored via *.bak). 
""" 
import os 
import sys 
import shutil 

TARGET_DIR = r"C:\Users\Aditya kumar jha\OneDrive\Documents\Continental" 
MAKE_BACKUP = True 

FILES = [ 
    ("public/js/customer.js", r''' 
/* Customer flow: keypad -> menu -> (geofence) -> checkout -> pay -> success */ 
(function () { 
  const state = { 
    code: '', 
    restaurant: null, 
    menu: [], 
    cart: {}, // itemId -> qty 
    location: null, 
    withinRange: false, 
  }; 

  const $ = (id) => document.getElementById(id); 
  const money = (n) => '\u20B9' + Number(n).toFixed(0); 

  /* ---------------------------- Login ----------------------------- */ 
  // Dummy sign-in: Google just advances; any username + password works. 
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
    codeDisplay.textContent = state.code.replace(/./g, (c) => c); 
    if (state.code.length === 3) loadRestaurant(); 
  } 

  async function loadRestaurant() { 
    try { 
      const data = await API.get('/public/restaurants/' + state.code + '/menu'); 
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
  function renderMenu() { 
    const list = $('menuList'); 
    const groups = {}; 
    state.menu.forEach((m) => { 
      (groups[m.category] = groups[m.category] || []).push(m); 
    }); 

    list.innerHTML = ''; 
    Object.keys(groups).forEach((cat) => { 
      const title = document.createElement('div'); 
      title.className = 'category-title'; 
      title.textContent = cat; 
      list.appendChild(title); 

      groups[cat].forEach((item) => { 
        const row = document.createElement('div'); 
        row.className = 'menu-item' + (item.available ? '' : ' unavailable'); 
        const qty = state.cart[item.id] || 0; 
        row.innerHTML = 
          '<div><div class="name">' + esc(item.name) + '</div>' + 
          '<div class="price">' + money(item.price) + 
          (item.available ? '' : ' \u00B7 sold out') + '</div></div>'; 

        const controls = document.createElement('div'); 
        if (item.available) { 
          controls.className = 'qty'; 
          controls.innerHTML = 
            '<button class="round-btn" data-dec="' + item.id + '">\u2212</button>' + 
            '<span>' + qty + '</span>' + 
            '<button class="round-btn brand" data-inc="' + item.id + '">+</button>'; 
        } 
        row.appendChild(controls); 
        list.appendChild(row); 
      }); 
    }); 

    list.querySelectorAll('[data-inc]').forEach((b) => 
      b.addEventListener('click', () => changeQty(b.dataset.inc, 1)) 
    ); 
    list.querySelectorAll('[data-dec]').forEach((b) => 
      b.addEventListener('click', () => changeQty(b.dataset.dec, -1)) 
    ); 
    renderCartBar(); 
  } 

  function changeQty(id, delta) { 
    const next = (state.cart[id] || 0) + delta; 
    if (next <= 0) delete state.cart[id]; 
    else state.cart[id] = next; 
    renderMenu(); 
  } 

  function cartLines() { 
    return Object.keys(state.cart).map((id) => { 
      const m = state.menu.find((x) => x.id === id); 
      return { itemId: id, name: m.name, price: m.price, qty: state.cart[id] }; 
    }); 
  } 

  function cartTotal() { 
    return cartLines().reduce((s, l) => s + l.price * l.qty, 0); 
  } 

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
  async function checkLocation() { 
    const banner = $('geoBanner'); 
    try { 
      state.location = await getPosition(); 
      const res = await API.post('/public/restaurants/' + state.code + '/geocheck', state.location); 
      state.withinRange = res.withinRange; 
      if (res.withinRange) { 
        banner.className = 'banner ok'; 
        banner.textContent = 'You are near ' + state.restaurant.name + ' \u2014 you can order.'; 
      } else { 
        banner.className = 'banner danger'; 
        banner.textContent = 
          'You are ~' + res.distanceMeters + 'm away. You must be within ' + 
          res.radiusMeters + 'm to order (browsing only).'; 
      } 
    } catch (e) { 
      state.withinRange = false; 
      banner.className = 'banner danger'; 
      banner.textContent = 'Location unavailable \u2014 ordering is blocked. Enable location and reload.'; 
    } 
    renderCartBar(); 
  } 

  /* --------------------------- Checkout --------------------------- */ 
  function goCheckout() { 
    if (!state.withinRange) { 
      alert('You must be within range of the restaurant to order.'); 
      return; 
    } 
    if (cartLines().length === 0) return; 
    const box = $('checkoutItems'); 
    box.innerHTML = 
      cartLines() 
        .map((l) => '<div class="menu-item"><span>' + esc(l.name) + ' \u00D7 ' + l.qty + 
          '</span><strong>' + money(l.price * l.qty) + '</strong></div>') 
        .join('') + 
      '<div class="menu-item"><strong>Total</strong><strong>' + money(cartTotal()) + '</strong></div>'; 
    show('checkoutScreen'); 
  } 

  $('backToMenu').addEventListener('click', () => show('menuScreen')); 

  $('payBtn').addEventListener('click', async () => { 
    $('checkoutError').textContent = ''; 
    const name = $('custName').value.trim(); 
    const phone = $('custPhone').value.trim(); 
    if (!name) return ($('checkoutError').textContent = 'Please enter your name'); 

    $('payBtn').disabled = true; 
    try { 
      const data = await API.post('/public/orders', { 
        restaurantCode: state.code, 
        items: cartLines().map((l) => ({ itemId: l.itemId, qty: l.qty })), 
        customer: { name, phone }, 
        location: state.location, 
      }); 
      await pay(data, { name, phone }); 
    } catch (e) { 
      $('checkoutError').textContent = e.message; 
      $('payBtn').disabled = false; 
    } 
  }); 

  function pay(data, customer) { 
    return new Promise((resolve) => { 
      if (data.provider === 'razorpay' && data.keyId) { 
        const rzp = new Razorpay({ 
          key: data.keyId, 
          order_id: data.paymentOrder.id, 
          amount: data.paymentOrder.amount, 
          currency: data.paymentOrder.currency, 
          name: state.restaurant.name, 
          description: 'Food order', 
          prefill: { name: customer.name, contact: customer.phone }, 
          theme: { color: '#6366f1' }, 
          handler: async (resp) => { 
            try { 
              await API.post('/public/orders/' + data.order.id + '/confirm', resp); 
              showSuccess(data.order); 
            } catch (e) { 
              $('checkoutError').textContent = e.message; 
              $('payBtn').disabled = false; 
            } 
            resolve(); 
          }, 
          modal: { 
            ondismiss: () => { 
              $('checkoutError').textContent = 'Payment cancelled.'; 
              $('payBtn').disabled = false; 
              resolve(); 
            }, 
          }, 
        }); 
        rzp.open(); 
      } else { 
        // Free mock mode -- confirm immediately (no real payment window) 
        API.post('/public/orders/' + data.order.id + '/confirm', {}) 
          .then(() => showSuccess(data.order)) 
          .catch((e) => { 
            $('checkoutError').textContent = e.message; 
            $('payBtn').disabled = false; 
          }) 
          .finally(resolve); 
      } 
    }); 
  } 

  function showSuccess(order) { 
    $('successDetail').innerHTML = 
      '<div class="muted">Order ID</div><div>' + order.id.slice(0, 8) + '</div>' + 
      '<div class="muted" style="margin-top:8px">Total</div><div>' + money(order.total) + '</div>'; 
    show('successScreen'); 
  } 

  /* --------------------------- Helpers ---------------------------- */ 
  function show(id) { 
    ['loginScreen', 'keypadScreen', 'menuScreen', 'checkoutScreen', 'successScreen'].forEach((s) => 
      $(s).classList.toggle('hidden', s !== id) 
    ); 
  } 
  function esc(s) { 
    return String(s).replace(/[&<>"]/g, (c) => 
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]) 
    ); 
  } 
})(); 
'''), 

    ("public/index.html", r''' 
<!DOCTYPE html> 
<html lang="en"> 
<head> 
  <meta charset="UTF-8" /> 
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" /> 
  <title>Avenza by Astravia</title> 
  <link rel="stylesheet" href="/css/styles.css" /> 
</head> 
<body> 
  <div class="app"> 
    <div class="topbar" id="appTopbar"> 
      <div class="brand"> 
        <span class="brand-name">Avenza</span> 
        <span class="brand-sub">by Astravia</span> 
      </div> 
      <div class="hotel hidden" id="hotelBox"> 
        <span class="hotel-label">Dining at</span> 
        <span class="hotel-name" id="restaurantNameTop"></span> 
      </div> 
    </div> 

    <!-- STEP 0: login --> 
    <section id="loginScreen" class="screen login-wrap"> 
      <div class="login-card"> 
        <div class="login-hero"> 
          <div class="login-logo"> 
            <svg width="30" height="30" viewBox="0 0 64 64" fill="none"> 
              <path d="M20 48 L32 18 L44 48" stroke="white" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/> 
              <path d="M24.5 37 L39.5 37" stroke="white" stroke-width="3.5" stroke-linecap="round"/> 
              <circle cx="32" cy="11" r="3" fill="white"/> 
            </svg> 
          </div> 
          <h2>Welcome</h2> 
          <p class="muted">Sign in to start your order</p> 
        </div> 
        <button class="btn-google" id="googleBtn"> 
          <svg width="18" height="18" viewBox="0 0 24 24"> 
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/> 
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/> 
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/> 
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/> 
          </svg> 
          <span>Continue with Google</span> 
        </button> 
        <div class="divider"><span>or</span></div> 
        <label>Username</label> 
        <input id="loginUser" placeholder="Any username" /> 
        <label>Password</label> 
        <input id="loginPass" type="password" placeholder="Any password" /> 
        <div class="error" id="loginError"></div> 
        <button class="primary" id="loginBtn">Sign in</button> 
      </div> 
    </section> 

    <!-- STEP 1: keypad --> 
    <section id="keypadScreen" class="screen keypad-wrap hidden"> 
      <div class="code-display" id="codeDisplay"></div> 
      <div class="code-hint">Enter your 3-digit restaurant code</div> 
      <div class="keypad"> 
        <div class="key" data-k="1">1</div> 
        <div class="key" data-k="2">2</div> 
        <div class="key" data-k="3">3</div> 
        <div class="key" data-k="4">4</div> 
        <div class="key" data-k="5">5</div> 
        <div class="key" data-k="6">6</div> 
        <div class="key" data-k="7">7</div> 
        <div class="key" data-k="8">8</div> 
        <div class="key" data-k="9">9</div> 
        <div class="key" data-k="del">&larr;</div> 
        <div class="key" data-k="0">0</div> 
        <div class="key action" data-k="ok">Go</div> 
      </div> 
      <div class="error center" id="keypadError"></div> 
    </section> 

    <!-- STEP 2: menu --> 
    <section id="menuScreen" class="screen hidden"> 
      <div id="geoBanner" class="banner warn">Checking your location&hellip;</div> 
      <div id="menuList"></div> 
      <div class="spacer"></div> 
      <div id="cartBar" class="cart-bar hidden"> 
        <span id="cartSummary">0 items</span> 
        <strong id="cartTotal">&#8377;0</strong> 
      </div> 
    </section> 

    <!-- STEP 3: checkout --> 
    <section id="checkoutScreen" class="screen hidden"> 
      <button class="ghost" id="backToMenu">&larr; Back to menu</button> 
      <h3>Your order</h3> 
      <div id="checkoutItems" class="card"></div> 
      <label>Your name</label> 
      <input id="custName" placeholder="Name" /> 
      <label>Phone number</label> 
      <input id="custPhone" placeholder="Phone" inputmode="numeric" /> 
      <div class="error" id="checkoutError"></div> 
      <button class="primary" id="payBtn">Pay & Place Order</button> 
    </section> 

    <!-- STEP 4: success --> 
    <section id="successScreen" class="screen hidden center"> 
      <h2 style="color: var(--ok)">&#10003; Order placed!</h2> 
      <p class="muted">The restaurant has received your order.</p> 
      <div id="successDetail" class="card"></div> 
      <button class="primary" onclick="location.reload()">Place another order</button> 
    </section> 
  </div> 

  <script src="https://checkout.razorpay.com/v1/checkout.js"></script> 
  <script src="/js/api.js"></script> 
  <script src="/js/customer.js"></script> 
</body> 
</html> 
'''), 

    ("public/css/styles.css", r''' 
/* ===================================================================== 
   Avenza-inspired design system 
   Indigo -> violet -> pink gradients, glassmorphism, soft rounded surfaces. 
   Class/ID names are kept identical to the original so all JS keeps working. 
   ===================================================================== */ 
:root { 
  /* Brand gradient stops */ 
  --brand-1: #6366f1; 
  --brand-2: #8b5cf6; 
  --brand-3: #ec4899; 
  --brand: #6366f1;           /* legacy single-colour alias */ 
  --brand-dark: #4f46e5; 

  --grad: linear-gradient(135deg, #6366f1, #8b5cf6, #ec4899); 
  --grad-2: linear-gradient(135deg, #6366f1, #8b5cf6); 
  --grad-soft: linear-gradient(135deg, #ede9fe, #fce7f3); 

  --bg: #f8f9fc; 
  --card: rgba(255, 255, 255, 0.88); 
  --card-solid: #ffffff; 
  --ink: #1e1b4b;             /* deep indigo -- headings */ 
  --text: #111827; 
  --muted: #9ca3af; 
  --border: #eef0f6; 
  --border-strong: #e5e7eb; 

  --ok: #16a34a; 
  --warn: #d97706; 
  --danger: #dc2626; 

  --shadow: 0 8px 32px rgba(99, 102, 241, 0.10); 
  --shadow-sm: 0 1px 4px rgba(0, 0, 0, 0.05); 
  --shadow-brand: 0 6px 20px rgba(99, 102, 241, 0.35); 

  --r-sm: 12px; 
  --r-md: 16px; 
  --r-lg: 20px; 
  --r-xl: 24px; 
} 

* { box-sizing: border-box; } 

body { 
  margin: 0; 
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; 
  color: var(--text); 
  -webkit-tap-highlight-color: transparent; 
  background: linear-gradient(145deg, #eef2ff 0%, #f5f3ff 50%, #fdf2f8 100%); 
  min-height: 100vh; 
  position: relative; 
  overflow-x: hidden; 
} 

/* Ambient blob decorations -- purely CSS, no HTML changes needed */ 
body::before, 
body::after { 
  content: ""; 
  position: fixed; 
  border-radius: 50%; 
  filter: blur(80px); 
  pointer-events: none; 
  z-index: 0; 
} 
body::before { 
  top: -80px; left: -80px; 
  width: 320px; height: 320px; 
  background: radial-gradient(circle, #818cf8, transparent 70%); 
  opacity: 0.35; 
} 
body::after { 
  bottom: -60px; right: -60px; 
  width: 340px; height: 340px; 
  background: radial-gradient(circle, #f472b6, transparent 70%); 
  opacity: 0.28; 
} 

.app { 
  max-width: 480px; 
  margin: 0 auto; 
  min-height: 100vh; 
  background: transparent; 
  position: relative; 
  z-index: 1; 
} 
.app.wide { max-width: 1040px; } 

/* ------------------------------- Topbar ------------------------------- */ 
.topbar { 
  background: var(--grad); 
  color: #fff; 
  padding: 18px 22px; 
  display: flex; 
  align-items: center; 
  justify-content: space-between; 
  position: sticky; 
  top: 0; 
  z-index: 30; 
  border-bottom-left-radius: var(--r-xl); 
  border-bottom-right-radius: var(--r-xl); 
  box-shadow: 0 8px 28px rgba(99, 102, 241, 0.28); 
} 
.topbar h1 { 
  font-size: 19px; 
  margin: 0; 
  font-weight: 800; 
  letter-spacing: -0.02em; 
} 
.topbar small { 
  opacity: 0.9; 
  font-weight: 500; 
  letter-spacing: 0.04em; 
} 

/* Brand wordmark: "Avenza" large, "by Astravia" small underneath */ 
.brand { 
  display: flex; 
  flex-direction: column; 
  line-height: 1.02; 
} 
.brand-name { 
  font-size: 23px; 
  font-weight: 900; 
  letter-spacing: -0.03em; 
} 
.brand-sub { 
  font-size: 10px; 
  font-weight: 500; 
  letter-spacing: 0.16em; 
  text-transform: uppercase; 
  opacity: 0.85; 
  margin-top: 3px; 
} 

.screen { padding: 22px; } 
.hidden { display: none !important; } 

/* ------------------------------- Keypad ------------------------------- */ 
.keypad-wrap { text-align: center; padding-top: 40px; } 
.code-display { 
  font-size: 46px; 
  letter-spacing: 20px; 
  font-weight: 900; 
  min-height: 60px; 
  margin: 14px 0 8px; 
  padding-left: 20px; 
  background: var(--grad); 
  -webkit-background-clip: text; 
  background-clip: text; 
  -webkit-text-fill-color: transparent; 
} 
.code-hint { 
  color: var(--muted); 
  margin-bottom: 28px; 
  font-size: 14px; 
  font-weight: 500; 
} 
.keypad { 
  display: grid; 
  grid-template-columns: repeat(3, 1fr); 
  gap: 14px; 
  max-width: 320px; 
  margin: 0 auto; 
  padding: 20px; 
  border-radius: var(--r-xl); 
  background: rgba(255, 255, 255, 0.8); 
  backdrop-filter: blur(20px); 
  -webkit-backdrop-filter: blur(20px); 
  border: 1.5px solid rgba(255, 255, 255, 0.95); 
  box-shadow: var(--shadow); 
} 
.key { 
  background: rgba(255, 255, 255, 0.9); 
  border: 1.5px solid #f3f4f6; 
  border-radius: var(--r-md); 
  font-size: 24px; 
  font-weight: 700; 
  color: var(--ink); 
  padding: 18px 0; 
  cursor: pointer; 
  box-shadow: var(--shadow-sm); 
  user-select: none; 
  transition: transform 0.12s ease, box-shadow 0.12s ease; 
} 
.key:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(99, 102, 241, 0.15); } 
.key:active { transform: scale(0.94); } 
.key.wide { grid-column: span 1; } 
.key.action { 
  background: var(--grad-2); 
  color: #fff; 
  border-color: transparent; 
  box-shadow: var(--shadow-brand); 
} 

/* ---------------------------- Banners --------------------------------- */ 
.banner { 
  padding: 13px 16px; 
  border-radius: var(--r-sm); 
  margin-bottom: 14px; 
  font-size: 14px; 
  font-weight: 500; 
  border: 1px solid transparent; 
} 
.banner.ok { background: #e7f6ec; color: var(--ok); border-color: #bbf7d0; } 
.banner.warn { background: #fff7ed; color: var(--warn); border-color: #fed7aa; } 
.banner.danger { background: #fdecec; color: var(--danger); border-color: #fecaca; } 

/* ---------------------------- Menu ------------------------------------ */ 
.category-title { 
  font-size: 12px; 
  text-transform: uppercase; 
  letter-spacing: 1.2px; 
  font-weight: 800; 
  color: var(--brand-2); 
  margin: 22px 0 10px; 
} 
.menu-item { 
  background: var(--card-solid); 
  border: 1.5px solid #f3f4f6; 
  border-radius: var(--r-md); 
  padding: 14px 16px; 
  margin-bottom: 10px; 
  display: flex; 
  justify-content: space-between; 
  align-items: center; 
  gap: 12px; 
  box-shadow: var(--shadow-sm); 
  transition: box-shadow 0.15s ease, transform 0.15s ease; 
} 
.menu-item:hover { box-shadow: 0 4px 16px rgba(99, 102, 241, 0.1); transform: translateY(-1px); } 
.menu-item .name { font-weight: 700; color: var(--text); } 
.menu-item .price { color: var(--brand-1); font-size: 14px; font-weight: 800; margin-top: 2px; } 
.menu-item.unavailable { opacity: 0.5; } 

.qty { display: flex; align-items: center; gap: 12px; } 
.round-btn { 
  width: 34px; height: 34px; border-radius: 50%; 
  border: 1.5px solid #e0e7ff; 
  background: var(--grad-soft); 
  color: var(--brand-1); 
  font-size: 18px; font-weight: 800; cursor: pointer; line-height: 1; 
  transition: transform 0.12s ease; 
} 
.round-btn:active { transform: scale(0.9); } 
.round-btn.brand { 
  background: var(--grad-2); color: #fff; border-color: transparent; 
  box-shadow: 0 2px 8px rgba(99, 102, 241, 0.3); 
} 

/* ---------------------------- Cart bar -------------------------------- */ 
.cart-bar { 
  position: fixed; 
  bottom: 16px; left: 50%; transform: translateX(-50%); 
  width: calc(100% - 32px); max-width: 448px; 
  background: var(--grad); 
  color: #fff; 
  padding: 16px 22px; 
  border-radius: var(--r-lg); 
  display: flex; justify-content: space-between; align-items: center; 
  cursor: pointer; 
  font-weight: 700; 
  box-shadow: var(--shadow-brand); 
  z-index: 20; 
} 

/* ------------------------- Buttons + forms ---------------------------- */ 
button.primary { 
  background: var(--grad); 
  color: #fff; border: none; 
  padding: 14px 18px; border-radius: var(--r-md); font-size: 15px; font-weight: 800; 
  letter-spacing: 0.01em; 
  cursor: pointer; width: 100%; 
  box-shadow: var(--shadow-brand); 
  transition: box-shadow 0.18s ease, transform 0.12s ease; 
} 
button.primary:hover { box-shadow: 0 10px 28px rgba(99, 102, 241, 0.5); } 
button.primary:active { transform: translateY(1px); } 
button.primary:disabled { background: #cbd0d6; box-shadow: none; cursor: not-allowed; } 
button.ghost { 
  background: #fff; border: 1.5px solid var(--border-strong); 
  padding: 9px 14px; border-radius: var(--r-sm); cursor: pointer; font-size: 13px; 
  font-weight: 600; color: #4b5563; 
  transition: box-shadow 0.15s ease; 
} 
button.ghost:hover { box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08); } 

input, select, textarea { 
  width: 100%; padding: 12px 14px; border: 1.5px solid var(--border-strong); 
  border-radius: var(--r-sm); font-size: 14px; margin-bottom: 12px; background: #fff; 
  transition: border-color 0.15s ease, box-shadow 0.15s ease; 
} 
input:focus, select:focus, textarea:focus { 
  outline: none; 
  border-color: var(--brand-2); 
  box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.15); 
} 
label { font-size: 13px; color: var(--muted); display: block; margin-bottom: 5px; font-weight: 500; } 
.error { color: var(--danger); font-size: 14px; margin: 8px 0; min-height: 18px; font-weight: 500; } 

.card { 
  background: var(--card); 
  backdrop-filter: blur(20px); 
  -webkit-backdrop-filter: blur(20px); 
  border: 1.5px solid rgba(255, 255, 255, 0.95); 
  border-radius: var(--r-xl); padding: 20px; margin-bottom: 16px; box-shadow: var(--shadow); 
} 
.card h3, .card h4 { color: var(--ink); margin-top: 0; } 

/* ------------------------- Owner dashboard ---------------------------- */ 
.orders-grid { 
  display: grid; 
  grid-template-columns: repeat(auto-fill, minmax(270px, 1fr)); 
  gap: 16px; 
} 
.order-card { 
  background: var(--card-solid); border: 1.5px solid #f3f4f6; 
  border-radius: var(--r-lg); padding: 16px; box-shadow: var(--shadow); 
  border-left: 5px solid var(--brand-2); 
} 
.order-card.flash { animation: flash 1.2s ease; } 
@keyframes flash { 
  0% { background: #f5f3ff; box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.35); } 
  100% { background: #fff; box-shadow: var(--shadow); } 
} 
.order-card h4 { margin: 0 0 6px; display: flex; justify-content: space-between; color: var(--ink); } 
.pill { 
  display: inline-block; font-size: 11px; padding: 4px 10px; 
  border-radius: 20px; background: #eef1f4; color: var(--muted); 
  text-transform: capitalize; font-weight: 700; 
} 
.pill.paid { background: #e7f6ec; color: var(--ok); } 
.pill.pending { background: #fff7ed; color: var(--warn); } 
.order-items { font-size: 14px; margin: 8px 0; } 
.order-items li { margin-bottom: 3px; } 
.status-row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; } 
.status-row button { font-size: 12px; padding: 6px 10px; } 

/* ------------------------------- Utils -------------------------------- */ 
.muted { color: var(--muted); } 
.center { text-align: center; } 
.spacer { height: 90px; } 
.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; } 
table { width: 100%; border-collapse: collapse; font-size: 14px; } 
th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid var(--border); } 
th { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; } 

/* ------------------------- Login screen ------------------------------- */ 
.login-wrap { padding-top: 26px; } 
.login-card { 
  max-width: 380px; 
  margin: 6px auto 0; 
  background: var(--card); 
  backdrop-filter: blur(20px); 
  -webkit-backdrop-filter: blur(20px); 
  border: 1.5px solid rgba(255, 255, 255, 0.95); 
  border-radius: var(--r-xl); 
  padding: 26px 24px; 
  box-shadow: var(--shadow); 
  display: flex; 
  flex-direction: column; 
  gap: 12px; 
} 
.login-hero { text-align: center; margin-bottom: 4px; } 
.login-logo { 
  width: 62px; height: 62px; border-radius: 18px; margin: 0 auto 12px; 
  display: flex; align-items: center; justify-content: center; 
  background: var(--grad); box-shadow: var(--shadow-brand); 
} 
.login-hero h2 { margin: 0; color: var(--ink); font-size: 22px; font-weight: 800; letter-spacing: -0.02em; } 
.login-hero p { margin: 4px 0 0; font-size: 14px; } 
.btn-google { 
  display: flex; align-items: center; justify-content: center; gap: 10px; 
  width: 100%; padding: 12px; border-radius: var(--r-md); 
  background: #fff; border: 1.5px solid var(--border-strong); color: #374151; 
  font-size: 14px; font-weight: 600; cursor: pointer; 
  transition: box-shadow 0.15s ease; 
} 
.btn-google:hover { box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12); } 
.divider { display: flex; align-items: center; gap: 12px; color: #d1d5db; font-size: 12px; } 
.divider::before, .divider::after { content: ""; flex: 1; height: 1px; background: var(--border); } 

/* ---------- Hotel name in topbar (shown after code entry) ------------- */ 
.hotel { display: flex; flex-direction: column; line-height: 1.05; min-width: 0; } 
.hotel-label { 
  font-size: 10px; font-weight: 600; letter-spacing: 0.14em; 
  text-transform: uppercase; opacity: 0.82; 
} 
.hotel-name { 
  font-size: 20px; font-weight: 800; letter-spacing: -0.01em; 
  max-width: 210px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; 
} 
/* After a table code is entered: hotel name moves left, brand moves right */ 
.topbar.menu-mode .hotel { order: 1; align-items: flex-start; } 
.topbar.menu-mode .brand { order: 2; align-items: flex-end; } 
'''), 

    (".gitignore", r''' 
node_modules/ 
.env 
data/db.json 
credentials.json 
npm-debug.log* 
.DS_Store 
*.bak 
'''), 

] 

def apply(target_dir): 
    if not FILES: 
        print("Nothing to apply: FILES is empty.") 
        return 
    if not os.path.isdir(target_dir): 
        sys.exit("Target folder does not exist:\n  " + target_dir) 
    written = 0 
    for rel_path, content in FILES: 
        abs_path = os.path.join(target_dir, *rel_path.split("/")) 
        os.makedirs(os.path.dirname(abs_path) or ".", exist_ok=True) 
        existed = os.path.exists(abs_path) 
        if existed and MAKE_BACKUP: 
            shutil.copy2(abs_path, abs_path + ".bak") 
        text = content[1:] if content.startswith("\n") else content 
        with open(abs_path, "w", encoding="utf-8", newline="\n") as fh: 
            fh.write(text) 
        written += 1 
        print(("Overwrote: " if existed else "Created:   ") + rel_path) 
    print("\nDone. %d file(s) written to:\n  %s" % (written, target_dir)) 
    if MAKE_BACKUP: 
        print('Backups saved as "<file>.bak" next to each changed file.') 

def main(): 
    target = sys.argv[1] if len(sys.argv) > 1 else TARGET_DIR 
    apply(target) 

if __name__ == "__main__": 
    main()