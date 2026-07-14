/* Shared API helper used by all three pages. */ 
window.API = { 
  async req(method, url, body, token) { 
    const headers = { 'Content-Type': 'application/json' }; 
    if (token) headers.Authorization = 'Bearer ' + token; 
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
 

 
