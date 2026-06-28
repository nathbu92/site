const CACHE = 'nath-v2';
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbw6aZ1_cwiijbbDE6WZR-Yq29LkAlQtNZ5mysjzPdVApxFVcYEASodSzLtQ4v4ltCnU/exec';

const PAGES = [
  '/site/index.html',
  '/site/programmes.html',
  '/site/contact.html',
  '/site/discord.html',
  '/site/projets-embed.html',
];

self.addEventListener('install', function(e){
  e.waitUntil(
    caches.open(CACHE).then(function(c){
      return Promise.allSettled(PAGES.map(function(url){
        return c.add(url).catch(function(err){ console.warn('[SW] skip:', url); });
      }));
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(
        keys.filter(function(k){ return k !== CACHE; })
            .map(function(k){ return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function(e){
  var url = e.request.url;

  // CDN / fonts => cache first
  if(url.includes('googleapis') || url.includes('cloudflare') || url.includes('gstatic')){
    e.respondWith(cacheFirst(e.request));
    return;
  }

  // Pages GitHub => stale-while-revalidate
  if(url.includes('nathbu92.github.io') && !url.includes('script.google')){
    e.respondWith(staleWhileRevalidate(e.request));
    return;
  }
  // Apps Script => pas intercepté (problèmes CORS/redirect)
});

function cacheFirst(req){
  return caches.open(CACHE).then(function(cache){
    return cache.match(req).then(function(cached){
      if(cached) return cached;
      // Cloner avant tout usage
      return fetch(req.clone()).then(function(res){
        if(res && res.ok){
          cache.put(req, res.clone());
        }
        return res;
      }).catch(function(){ return cached; });
    });
  });
}

function staleWhileRevalidate(req){
  return caches.open(CACHE).then(function(cache){
    return cache.match(req).then(function(cached){
      // Revalider en arrière-plan
      var fetchPromise = fetch(req.clone()).then(function(res){
        if(res && res.ok){
          cache.put(req, res.clone());
        }
        return res;
      }).catch(function(){ return null; });

      // Retourner le cache immédiatement, sinon attendre le réseau
      return cached || fetchPromise;
    });
  });
}

// Messages depuis les pages
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

  // Vérifier si les données ont changé
  if(e.data.type === 'CHECK_UPDATE'){
    var client = e.source;
    var oldVersion = e.data.version;
    fetch(SCRIPT_URL + '?action=get&t=' + Date.now())
      .then(function(r){ return r.json(); })
      .then(function(data){
        var s=JSON.stringify(data), h=0;
        for(var i=0;i<s.length;i++){ h=((h<<5)-h)+s.charCodeAt(i); h|=0; }
        var newVersion = String(h);
        if(oldVersion && newVersion !== oldVersion){
          client.postMessage({type:'DATA_UPDATED', data:data, version:newVersion});
        } else {
          client.postMessage({type:'DATA_VERSION', version:newVersion});
        }
      })
      .catch(function(err){ console.warn('[SW] check update failed:', err); });
  }
});
