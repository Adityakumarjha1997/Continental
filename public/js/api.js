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

/* ---------------- Boot: theme, floating toggle, PWA worker --------------- */
(function boot() {
  Theme.init();

  // Inject a small floating dark-mode toggle so no page markup has to change.
  const fab = document.createElement('button');
  fab.id = 'themeFab';
  fab.className = 'theme-fab';
  fab.type = 'button';
  fab.setAttribute('aria-label', 'Toggle dark mode');
  fab.textContent = document.documentElement.getAttribute('data-theme') === 'dark' ? '☀️' : '🌙';
  fab.addEventListener('click', () => Theme.toggle());
  document.body.appendChild(fab);

  // Register the service worker (installable + offline shell). Secure-context
  // only; silently skipped on unsupported/insecure origins.
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }
})();
