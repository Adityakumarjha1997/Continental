#!/usr/bin/env python3 

r""" 
apply-update.py -- writes the listed files straight into the deployed project. 

Run on the deployment machine, pointing at the project root (the Continental folder): 

    python apply-update.py "C:\Users\Aditya kumar jha\OneDrive\Documents\Continental" 

(or just `python apply-update.py` if TARGET_DIR below is already correct). 
Then push so Render redeploys: 

    git add -A 
    git commit -m "fix character encoding" 
    git push 

A "<file>.bak" backup is written before each overwrite. File contents are 
stored ASCII-safe (\uXXXX escapes / HTML entities) so no transfer or editor can 
corrupt special characters like the rupee sign again. 
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
    ['keypadScreen', 'menuScreen', 'checkoutScreen', 'successScreen'].forEach((s) => 
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
    <div class="topbar"> 
      <div class="brand"> 
        <span class="brand-name">Avenza</span> 
        <span class="brand-sub">by Astravia</span> 
      </div> 
      <small id="restaurantNameTop"></small> 
    </div> 

    <!-- STEP 1: keypad --> 
    <section id="keypadScreen" class="screen keypad-wrap"> 
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