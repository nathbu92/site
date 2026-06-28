const CACHE = 'nath-v1';
const DATA_CACHE = 'nath-data-v1';
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbw6aZ1_cwiijbbDE6WZR-Yq29LkAlQtNZ5mysjzPdVApxFVcYEASodSzLtQ4v4ltCnU/exec';

const PAGES = [
  '/site/index.html',
  '/site/programmes.html',
  '/site/contact.html',
  '/site/discord.html',
  '/site/projets-embed.html',
];

// INSTALL
self.addEventListener('install', function(e){
  e.waitUntil(
    caches.open(CACHE).then(function(c){
      return Promise.allSettled(PAGES.map(function(url){
        return c.add(url).catch(function(err){ console.warn('[SW] skip:', url, err); });
      }));
    })
  );
  self.skipWaiting();
});

// ACTIVATE
self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.filter(function(k){ return k!==CACHE && k!==DATA_CACHE; }).map(function(k){ return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

// FETCH
self.addEventListener('fetch', function(e){
  var url = e.request.url;

  // CDN / fonts => cache first
  if(url.includes('googleapis') || url.includes('cloudflare') || url.includes('gstatic')){
    e.respondWith(cacheFirst(e.request)); return;
  }

  // Pages GitHub => stale-while-revalidate
  if(url.includes('nathbu92.github.io')){
    e.respondWith(staleWhileRevalidate(e.request)); return;
  }

  // Tout le reste => réseau
  // (Apps Script non intercepté pour éviter les problèmes CORS/redirect)
});

function cacheFirst(req){
  return caches.match(req).then(function(cached){
    if(cached) return cached;
    return fetch(req).then(function(res){
      if(res.ok){ var c=caches.open(CACHE).then(function(cache){ cache.put(req,res.clone()); }); }
      return res;
    });
  });
}

function staleWhileRevalidate(req){
  var cache = caches.open(CACHE);
  var fetchP = cache.then(function(c){
    return fetch(req).then(function(res){
      if(res && res.ok) c.put(req, res.clone());
      return res;
    }).catch(function(){ return null; });
  });
  return cache.then(function(c){
    return c.match(req).then(function(cached){
      return cached || fetchP;
    });
  });
}

// MESSAGE check update + broadcast
self.addEventListener('message', function(e){
  if(!e.data) return;

  // Diffuser les données à tous les autres clients
  if(e.data.type === 'BROADCAST_DATA'){
    self.clients.matchAll({includeUncontrolled:true, type:'window'}).then(function(clients){
      clients.forEach(function(client){
        if(client.id !== e.source.id){
          client.postMessage({type:'DATA_UPDATED', data:e.data.data, version:e.data.version});
        }
      });
    });
    return;
  }

  if(e.data.type !== 'CHECK_UPDATE') return;
  if(!e.data || e.data.type !== 'CHECK_UPDATE') return;
  var client = e.source;
  var oldVersion = e.data.version;

  fetch(SCRIPT_URL + '?action=get&t=' + Date.now())
    .then(function(r){ return r.json(); })
    .then(function(data){
      var s = JSON.stringify(data), h = 0;
      for(var i=0;i<s.length;i++){ h=((h<<5)-h)+s.charCodeAt(i); h|=0; }
      var newVersion = String(h);
      if(oldVersion && newVersion !== oldVersion){
        client.postMessage({ type:'DATA_UPDATED', data:data, version:newVersion });
      } else {
        client.postMessage({ type:'DATA_VERSION', version:newVersion });
      }
    })
    .catch(function(err){ console.warn('[SW] check update failed:', err); });
});
