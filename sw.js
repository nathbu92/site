// ══════════════════════════════════════════════════
//  SERVICE WORKER — nathabu.fr
//  Cache statique + données Sheet en background
// ══════════════════════════════════════════════════

const CACHE_NAME    = 'nath-site-v1';
const DATA_CACHE    = 'nath-data-v1';
const SCRIPT_URL    = 'https://script.google.com/macros/s/AKfycbw6aZ1_cwiijbbDE6WZR-Yq29LkAlQtNZ5mysjzPdVApxFVcYEASodSzLtQ4v4ltCnU/exec';

// Fichiers statiques à mettre en cache immédiatement
const STATIC_FILES = [
  '/site/',
  '/site/index.html',
  '/site/programmes.html',
  '/site/contact.html',
  '/site/discord.html',
  '/site/admin.html',
  '/site/projets-embed.html',
  '/site/mentions-legales.html',
];

// ── INSTALL : cache les fichiers statiques ──
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(STATIC_FILES.filter(Boolean));
    }).catch(e => console.warn('[SW] Install partiel:', e))
  );
  self.skipWaiting();
});

// ── ACTIVATE : nettoie les vieux caches ──
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys
        .filter(k => k !== CACHE_NAME && k !== DATA_CACHE)
        .map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ── FETCH : stratégie selon la requête ──
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Requêtes Apps Script → Network first, cache fallback
  if (url.hostname === 'script.google.com') {
    event.respondWith(networkFirstData(event.request));
    return;
  }

  // Fonts / CDN externes → cache first
  if (url.hostname.includes('googleapis') || url.hostname.includes('cloudflare') || url.hostname.includes('gstatic')) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // Fichiers du site → stale-while-revalidate
  if (url.hostname === 'nathbu92.github.io') {
    event.respondWith(staleWhileRevalidate(event.request));
    return;
  }

  // Tout le reste → réseau direct
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});

// ── STRATÉGIES ──

// Cache first (fonts, CDN)
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE_NAME);
    cache.put(request, response.clone());
  }
  return response;
}

// Stale-while-revalidate (pages HTML/CSS/JS)
async function staleWhileRevalidate(request) {
  const cache  = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request).then(async response => {
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  }).catch(() => null);

  return cached || await fetchPromise;
}

// Network first avec cache fallback (données Sheet)
async function networkFirstData(request) {
  const cache = await caches.open(DATA_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok || response.status === 302) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw new Error('Pas de réseau et pas de cache');
  }
}

// ── MESSAGE : vérification de mise à jour des données ──
// Reçoit un message 'CHECK_UPDATE' depuis la page
// Compare les données actuelles avec le cache
// Envoie 'DATA_UPDATED' si les données ont changé
self.addEventListener('message', async event => {
  if (event.data?.type !== 'CHECK_UPDATE') return;

  const client = event.source;
  const cachedVersion = event.data.version || null;

  try {
    const response = await fetch(SCRIPT_URL + '?action=get&t=' + Date.now());
    const text = await response.text();

    // Extraire le JSON du callback JSONP si nécessaire
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      const match = text.match(/\w+\((.+)\)$/s);
      if (match) data = JSON.parse(match[1]);
    }

    if (!data) return;

    // Créer une version hash simple basée sur les données
    const newVersion = simpleHash(JSON.stringify(data));

    if (cachedVersion && newVersion !== cachedVersion) {
      // Mettre en cache les nouvelles données
      const cache = await caches.open(DATA_CACHE);
      cache.put(SCRIPT_URL + '?action=get', new Response(JSON.stringify(data), {
        headers: { 'Content-Type': 'application/json' }
      }));
      // Notifier la page
      client.postMessage({ type: 'DATA_UPDATED', data, version: newVersion });
    } else if (!cachedVersion) {
      // Premier chargement : envoyer la version
      client.postMessage({ type: 'DATA_VERSION', version: newVersion });
    }
  } catch(e) {
    console.warn('[SW] Check update failed:', e);
  }
});

// Hash simple pour comparaison
function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return String(hash);
}
