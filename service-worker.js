// ================================================================
// SERVICE WORKER — ARVEXA School
// Version : OFFLINE v1.1 — Mode hors ligne complet
// ================================================================

const SW_VERSION = 'arvexa-offline-v2.1';
const CACHE_STATIC = `${SW_VERSION}-static`;
const CACHE_HTML = `${SW_VERSION}-html`;

// Fichiers critiques à précacher
const PRECACHE = [
  './',
  './index.html',
  './offline.html',
  './manifest.json',
  './perf.css',
  './register-sw.js',
  './icon.png'
];

// Ne JAMAIS intercepter
const NEVER_CACHE_HOSTS = [
  'firebaseio.com',
  'googleapis.com',
  'gstatic.com',
  'firebaseapp.com',
  'firebasestorage.app',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com'
];

const NEVER_CACHE_PREFIXES = ['/api/'];

// ═══ INSTALL ═══
self.addEventListener('install', (event) => {
  console.log(`[SW] Install ${SW_VERSION}`);
  event.waitUntil(
    caches.open(CACHE_STATIC).then((cache) =>
      Promise.all(
        PRECACHE.map((url) =>
          cache.add(url).catch(() => {
            console.warn('[SW] Précache ignoré :', url);
          })
        )
      )
    ).then(() => self.skipWaiting())
  );
});

// ═══ ACTIVATE ═══
self.addEventListener('activate', (event) => {
  console.log(`[SW] Activate ${SW_VERSION}`);
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((n) => !n.startsWith(SW_VERSION))
          .map((n) => caches.delete(n))
      )
    ).then(() => self.clients.claim())
  );
});

// ═══ FETCH ═══
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }

  if (NEVER_CACHE_PREFIXES.some((p) => url.pathname.startsWith(p))) return;
  if (NEVER_CACHE_HOSTS.some((h) => url.hostname.includes(h))) return;

  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(handleHTML(req));
    return;
  }

  if (
    req.destination === 'style' ||
    req.destination === 'script' ||
    req.destination === 'font' ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.json')
  ) {
    event.respondWith(handleStatic(req));
    return;
  }

  if (req.destination === 'image') {
    event.respondWith(handleImage(req));
    return;
  }

  event.respondWith(handleGeneric(req));
});

// ═══ STRATÉGIES ═══
async function handleHTML(req) {
  try {
    const networkResp = await fetch(req);
    if (networkResp && networkResp.ok) {
      const cache = await caches.open(CACHE_HTML);
      cache.put(req, networkResp.clone());
    }
    return networkResp;
  } catch (e) {
    const cache = await caches.open(CACHE_HTML);
    const cached = await cache.match(req);
    if (cached) return cached;

    const staticCache = await caches.open(CACHE_STATIC);
    const cachedStatic = await staticCache.match(req);
    if (cachedStatic) return cachedStatic;

    const offline = await caches.match('./offline.html');
    if (offline) return offline;

    return new Response(
      '<!DOCTYPE html><html lang="fr"><body><h1>Hors ligne</h1><p>Page non disponible.</p></body></html>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
}

async function handleStatic(req) {
  const cache = await caches.open(CACHE_STATIC);
  const cached = await cache.match(req);

  const fetchPromise = fetch(req)
    .then((response) => {
      if (response && response.ok) cache.put(req, response.clone());
      return response;
    })
    .catch(() => null);

  return cached || fetchPromise || new Response('', { status: 504 });
}

async function handleImage(req) {
  const cache = await caches.open(CACHE_STATIC);
  const cached = await cache.match(req);
  if (cached) return cached;

  try {
    const response = await fetch(req);
    if (response && response.ok) cache.put(req, response.clone());
    return response;
  } catch (e) {
    return new Response('', { status: 204 });
  }
}

async function handleGeneric(req) {
  const cache = await caches.open(CACHE_HTML);
  try {
    const response = await fetch(req);
    if (response && response.ok) cache.put(req, response.clone());
    return response;
  } catch (e) {
    const cached = await cache.match(req);
    return cached || new Response('', { status: 504 });
  }
}

// ═══ HANDLER — Bouton "Télécharger tout hors ligne" ═══
self.addEventListener('message', (event) => {
  const data = event.data || {};
  const port = event.ports && event.ports[0];

  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  if (data.type === 'DOWNLOAD_ALL' && Array.isArray(data.files) && port) {
    downloadAllFiles(data.files, port);
  }

  if (data.type === 'CACHE_URL' && data.url) {
    cacheUrl(data.url);
  }

  if (data.type === 'STATS' && port) {
    getStats(port);
  }
});

async function downloadAllFiles(files, port) {
  const total = files.length;
  let done = 0;
  let failed = 0;

  for (let i = 0; i < files.length; i++) {
    const url = files[i];
    try {
      const response = await fetch(url, { cache: 'reload' });
      if (response.ok) {
        const cache = await caches.open(CACHE_HTML);
        await cache.put(url, response);
        done++;
      } else {
        failed++;
      }
    } catch (e) {
      failed++;
    }

    const percent = Math.round(((done + failed) / total) * 100);
    port.postMessage({
      type: 'DOWNLOAD_PROGRESS',
      done, failed, total, percent
    });
  }

  port.postMessage({
    type: 'DOWNLOAD_COMPLETE',
    done, failed, total
  });
}

async function cacheUrl(url) {
  try {
    const response = await fetch(url, { cache: 'reload' });
    if (response.ok) {
      const cache = await caches.open(CACHE_HTML);
      await cache.put(url, response);
    }
  } catch (e) {}
}

async function getStats(port) {
  try {
    const names = await caches.keys();
    const stats = {};
    for (const name of names) {
      const cache = await caches.open(name);
      const keys = await cache.keys();
      stats[name.replace(`${SW_VERSION}-`, '')] = keys.length;
    }
    port.postMessage({ type: 'STATS_RESULT', stats });
  } catch (e) {
    port.postMessage({ type: 'STATS_RESULT', stats: {} });
  }
}

console.log(`[SW] ${SW_VERSION} prêt — mode hors ligne actif`);
