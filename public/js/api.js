/* Shared helpers used by all three pages: API fetch, geolocation, dark-mode
   theme, web notifications, and PWA service-worker registration. */
window.API = {
  async req(method, url, body, token, extraHeaders) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    if (extraHeaders) Object.assign(headers, extraHeaders);
    const res = await fetch('/api' + url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = {};
    try {
      data = await res.json();
    } catch (_) {}
    if (!res.ok) throw new Error(data.error || 'Request failed (' + res.status + ')');
    return data;
  },
  get(url, token) {
    return this.req('GET', url, null, token);
  },
  post(url, body, token) {
    return this.req('POST', url, body, token);
  },
  patch(url, body, token) {
    return this.req('PATCH', url, body, token);
  },
  del(url, token) {
    return this.req('DELETE', url, null, token);
  },
};

/* Promise wrapper around the browser geolocation API. */
window.getPosition = function () {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Geolocation not supported'));
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  });
};

/* ------------------------------- Dark mode ------------------------------- */
window.Theme = (function () {
  const KEY = 'avenza_theme';
  function preferred() {
    const saved = localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dark') return saved;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  }
  function apply(mode) {
    document.documentElement.setAttribute('data-theme', mode);
    const fab = document.getElementById('themeFab');
    if (fab) fab.textContent = mode === 'dark' ? '☀️' : '🌙';
  }
  function set(mode) {
    localStorage.setItem(KEY, mode);
    apply(mode);
  }
  function toggle() {
    set(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  }
  function init() {
    apply(preferred());
  }
  return { init, set, toggle, preferred };
})();

/* --------------------------- Web notifications --------------------------- */
window.notify = function (title, body) {
  try {
    if (!('Notification' in window)) return;
    const show = () => new Notification(title, { body, icon: '/icon.svg', badge: '/icon.svg' });
    if (Notification.permission === 'granted') show();
    else if (Notification.permission !== 'denied')
      Notification.requestPermission().then((p) => p === 'granted' && show());
  } catch (_) {}
};
window.requestNotifyPermission = function () {
  try {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  } catch (_) {}
};

/* Shared collapsible order-row (used by owner/waiter/kitchen boards). Renders a
   compact row with the status on the right; clicking it expands full details.
   opts: { id, title, sub(html), statusText, statusClass, items:[{qty,name}],
           extraDetailHtml, actions:[{label,cls,onClick}], flash } */
window.makeOrderRow = function (opts) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const el = document.createElement('div');
  el.className = 'order-row' + (opts.flash ? ' flash' : '');
  el.id = 'ord-' + opts.id;

  const head = document.createElement('div');
  head.className = 'or-head';
  head.innerHTML =
    '<div class="or-main"><strong>' + esc(opts.title) + '</strong>' +
    (opts.sub ? '<span class="or-sub">' + opts.sub + '</span>' : '') + '</div>' +
    '<span class="pill ' + (opts.statusClass || '') + '">' + esc(opts.statusText) + '</span>' +
    '<span class="or-chevron">▾</span>';

  const details = document.createElement('div');
  details.className = 'or-details hidden';
  const itemsHtml = (opts.items || []).map((i) => '<li>' + i.qty + ' × ' + esc(i.name) + '</li>').join('');
  details.innerHTML = '<ul class="order-items">' + itemsHtml + '</ul>' + (opts.extraDetailHtml || '');
  const actRow = document.createElement('div');
  actRow.className = 'status-row';
  (opts.actions || []).forEach((a) => {
    const b = document.createElement('button');
    b.className = a.cls || 'ghost';
    b.style.width = 'auto';
    b.textContent = a.label;
    b.onclick = (e) => { e.stopPropagation(); a.onClick(); };
    actRow.appendChild(b);
  });
  details.appendChild(actRow);

  head.addEventListener('click', () => {
    details.classList.toggle('hidden');
    el.classList.toggle('open');
  });
  el.appendChild(head);
  el.appendChild(details);
  return el;
};

/* Reusable line-icon set. Any element with class "ic" + data-icon="<name>" gets
   the matching glyph injected, so the same back/home/orders icons render
   identically across every page. Call applyIcons() again after dynamic renders. */
window.Icons = {
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  home: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11.4 12 4l9 7.4"/><path d="M5.5 10v9.5h13V10"/></svg>',
  orders: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6"/><path d="M9 12h6"/></svg>',
  cart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h2l2.2 10.5h9.1L20 8H7"/><circle cx="10" cy="19" r="1.3"/><circle cx="17" cy="19" r="1.3"/></svg>',
  theme: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.5A8.5 8.5 0 1 1 11.5 3a6.5 6.5 0 0 0 9.5 9.5z"/></svg>',
};
window.applyIcons = function (root) {
  (root || document).querySelectorAll('[data-icon]').forEach((el) => {
    if (el.dataset.iconDone) return;
    const svg = Icons[el.dataset.icon];
    if (svg) { el.insertAdjacentHTML('beforeend', svg); el.dataset.iconDone = '1'; }
  });
};

/* Read an image file and return a downscaled/compressed data URL, so photos can
   be attached (uploaded) and stored inline without any file-storage service.
   Default: max 600px on the long edge, JPEG quality 0.7 (~30-80 KB). */
window.readImageAsDataURL = function (file, maxDim, quality) {
  maxDim = maxDim || 600;
  quality = quality || 0.7;
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('No file selected'));
    if (!/^image\//.test(file.type)) return reject(new Error('Please choose an image file'));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the file'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That file is not a valid image'));
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > maxDim || h > maxDim) {
          if (w >= h) { h = Math.round((h * maxDim) / w); w = maxDim; }
          else { w = Math.round((w * maxDim) / h); h = maxDim; }
        }
        try {
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', quality));
        } catch (e) {
          resolve(reader.result); // fallback: original data URL
        }
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
};

/* Add a show/hide eye button to every password field on the page. */
window.enhancePasswordInputs = function () {
  document.querySelectorAll('input[type="password"]').forEach((inp) => {
    if (inp.dataset.pwEnhanced) return;
    inp.dataset.pwEnhanced = '1';
    const wrap = document.createElement('div');
    wrap.className = 'pw-wrap';
    inp.parentNode.insertBefore(wrap, inp);
    wrap.appendChild(inp);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pw-toggle';
    btn.setAttribute('aria-label', 'Show password');
    btn.textContent = '👁';
    btn.addEventListener('click', () => {
      const reveal = inp.type === 'password';
      inp.type = reveal ? 'text' : 'password';
      btn.classList.toggle('on', reveal);
      btn.setAttribute('aria-label', reveal ? 'Hide password' : 'Show password');
    });
    wrap.appendChild(btn);
  });
};

/* ---------------- Boot: theme, floating toggle, PWA worker --------------- */
(function boot() {
  Theme.init();
  enhancePasswordInputs();
  applyIcons();

  // If a page provides an in-nav theme button (#navTheme), wire that and skip the
  // floating toggle; otherwise inject the small floating dark-mode toggle.
  const navTheme = document.getElementById('navTheme');
  if (navTheme) {
    navTheme.addEventListener('click', () => Theme.toggle());
  } else {
    const fab = document.createElement('button');
    fab.id = 'themeFab';
    fab.className = 'theme-fab';
    fab.type = 'button';
    fab.setAttribute('aria-label', 'Toggle dark mode');
    fab.textContent = document.documentElement.getAttribute('data-theme') === 'dark' ? '☀️' : '🌙';
    fab.addEventListener('click', () => Theme.toggle());
    document.body.appendChild(fab);
  }

  // Register the service worker (installable + offline shell). Secure-context
  // only; silently skipped on unsupported/insecure origins.
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }
})();
