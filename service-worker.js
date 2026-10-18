// ================================================================
// SERVICE WORKER — ARVEXA School
// Version : 7.0.0 — Network-first sur HTML + JS + CSS locaux
// Les correctifs prennent effet dès le prochain chargement.
// ================================================================

const CACHE_VERSION = 'arvexa-v12.0.0';
const CACHE_SHELL = 'arvexa-shell-v7';
const CACHE_COURS = 'arvexa-cours-v7';
const CACHE_IMAGES = 'arvexa-images-v7';

const ALL_CACHES = [CACHE_SHELL, CACHE_COURS, CACHE_IMAGES];

// ================================================================
// SHELL (pages de base précachées)
// ================================================================
const PRECACHE_SHELL = [
  './',
  './index.html',
  './offline.html',
  './auth-choice.html',
  './login.html',
  './register.html',
  './onboarding.html',
  './profil.html',
  './abonnement.html',
  './notifications.html',
  './matiere.html',
  './chapitre.html',
  './lecture.html',
  './calculatrice.html',
  './formulaires.html',
  './tableau-periodique.html',
  './outils.html',
  './planificateur.html',
  './reviseur.html',
  './exam.html',
  './groupe.html',
  './conditions.html',
  './confidentialite.html',
  './404.html',
  './manifest.json',
  './icon.png',
  './arv-progress.html',
  './katex-utils.js',
  './perf.css',
  './bac-date.js'
];

// ================================================================
// INSTALLATION
// ================================================================
self.addEventListener('install', (event) => {
  console.log('[SW] Installation v7.0.0...');
  self.skipWaiting();

  event.waitUntil(
    caches.open(CACHE_SHELL).then((cache) => {
      return Promise.all(
        PRECACHE_SHELL.map((url) =>
          cache.add(url).catch((e) => {
            console.warn('[SW] Échec précache:', url, e.message);
          })
        )
      );
    })
  );
});

// ================================================================
// ACTIVATION
// ================================================================
self.addEventListener('activate', (event) => {
  console.log('[SW] Activation v7.0.0...');
  event.waitUntil(
    caches.keys().then((names) => {
      return Promise.all(
        names.map((name) => {
          if (!ALL_CACHES.includes(name)) {
            console.log('[SW] Suppression ancien cache:', name);
            return caches.delete(name);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// ================================================================
// FETCH — Routage intelligent
// ================================================================
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Ignorer méthodes non-GET et protocoles non-HTTP
  if (request.method !== 'GET') return;
  if (!url.protocol.startsWith('http')) return;

  // ⚡ NE JAMAIS toucher aux requêtes Firebase / API externes
  if (url.hostname.includes('firebase') ||
      url.hostname.includes('gstatic') ||
      url.hostname.includes('googleapis') ||
      url.hostname.includes('googleusercontent') ||
      url.hostname.includes('cloudflare') ||
      url.pathname.startsWith('/api/')) {
    return;
  }

  // ─────────────────────────────────────────────────────────────
  // 1️⃣ COURS HTML + JSON → network-first
  // ─────────────────────────────────────────────────────────────
  if (url.pathname.includes('/cours/')) {
    event.respondWith(handleCoursRequest(request));
    return;
  }

  // ─────────────────────────────────────────────────────────────
  // 2️⃣ PAGES HTML principales → network-first avec fallback
  // ─────────────────────────────────────────────────────────────
  if (request.mode === 'navigate' ||
      request.destination === 'document' ||
      url.pathname.endsWith('.html')) {
    event.respondWith(handlePageRequest(request));
    return;
  }

  // ─────────────────────────────────────────────────────────────
  // 3️⃣ ASSETS CDN KaTeX + Tesseract → cache-first permanent
  // (externes, versionnés, jamais modifiés)
  // ─────────────────────────────────────────────────────────────
  if (url.hostname === 'cdn.jsdelivr.net' &&
      (url.pathname.includes('/katex') || url.pathname.includes('/tesseract'))) {
    event.respondWith(handleAssetRequest(request, CACHE_IMAGES));
    return;
  }

  // ─────────────────────────────────────────────────────────────
  // 4️⃣ IMAGES / FONTS / ICÔNES → cache-first
  // ─────────────────────────────────────────────────────────────
  if (request.destination === 'image' ||
      request.destination === 'font' ||
      /\.(png|jpg|jpeg|svg|webp|gif|ico|woff2?|ttf|otf)$/i.test(url.pathname)) {
    event.respondWith(handleAssetRequest(request, CACHE_IMAGES));
    return;
  }

  // ─────────────────────────────────────────────────────────────
  // 5️⃣ CSS / JS LOCAUX → network-first (correctifs pris en compte)
  // ⚡ Différence clé avec v6 : on ne cache-plus-first plus les JS locaux
  // ─────────────────────────────────────────────────────────────
  if (request.destination === 'style' || request.destination === 'script') {
    event.respondWith(handleLocalAssetRequest(request));
    return;
  }
});

// ================================================================
// HANDLERS
// ================================================================

// --- COURS (HTML + JSON) : NETWORK-FIRST
async function handleCoursRequest(request) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.ok) {
      const cache = await caches.open(CACHE_COURS);
      cache.put(request, networkResponse.clone()).catch(() => {});
    }
    return networkResponse;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;

    const offlinePage = await caches.match('./offline.html');
    if (offlinePage) return offlinePage;

    return new Response(
      '<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>Hors ligne</title></head><body style="background:#0A0A0A;color:#F5F0E8;font-family:sans-serif;display:grid;place-items:center;height:100vh;text-align:center;margin:0"><div><h1>Contenu indisponible</h1><p>Ce chapitre n\'a pas encore été téléchargé.</p><p><a href="./index.html" style="color:#E0B84A">Retour à l\'accueil</a></p></div></body></html>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
}

// --- PAGES HTML principales : network-first avec fallback
async function handlePageRequest(request) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.ok) {
      const cache = await caches.open(CACHE_SHELL);
      cache.put(request, networkResponse.clone()).catch(() => {});
    }
    return networkResponse;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;

    const offlinePage = await caches.match('./offline.html');
    if (offlinePage) return offlinePage;

    return new Response('Hors ligne', { status: 503 });
  }
}

// --- ASSETS (images, fonts, CSS/JS externes CDN) : cache-first avec revalidate
async function handleAssetRequest(request, cacheName) {
  const cached = await caches.match(request);

  const networkPromise = fetch(request).then((response) => {
    if (response && response.ok) {
      caches.open(cacheName).then((cache) => {
        cache.put(request, response.clone());
      });
    }
    return response;
  }).catch(() => null);

  if (cached) {
    networkPromise.catch(() => {});
    return cached;
  }

  const response = await networkPromise;
  if (response) return response;
  return new Response('', { status: 404 });
}

// --- ASSETS LOCAUX (CSS / JS applicatifs) : NETWORK-FIRST avec fallback cache
// ⚡ Correctifs JS pris en compte dès le prochain chargement
async function handleLocalAssetRequest(request) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.ok) {
      const cache = await caches.open(CACHE_SHELL);
      cache.put(request, networkResponse.clone()).catch(() => {});
    }
    return networkResponse;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response('', { status: 503 });
  }
}

// ================================================================
// MESSAGES depuis les pages
// ================================================================
self.addEventListener('message', (event) => {
  if (!event.data) return;

  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  if (event.data.type === 'CLEAR_CACHES') {
    event.waitUntil(
      caches.keys().then((names) =>
        Promise.all(names.map((n) => caches.delete(n)))
      )
    );
    return;
  }

  if (event.data.type === 'CACHE_URL') {
    event.waitUntil(cacheUrl(event.data.url));
    return;
  }

  if (event.data.type === 'STATS') {
    event.waitUntil(sendStats(event.source));
    return;
  }
});

// ================================================================
// CACHE URL UNIQUE
// ================================================================
async function cacheUrl(url) {
  try {
    const already = await caches.match(url);
    if (already) return;

    const response = await fetch(url);
    if (response && response.ok) {
      const cacheName = url.includes('/cours/') ? CACHE_COURS : CACHE_SHELL;
      const cache = await caches.open(cacheName);
      cache.put(url, response);
    }
  } catch (e) {}
}

// ================================================================
// STATS
// ================================================================
async function sendStats(client) {
  if (!client) return;

  const stats = { shell: 0, cours: 0, images: 0 };

  try {
    stats.shell = (await (await caches.open(CACHE_SHELL)).keys()).length;
    stats.cours = (await (await caches.open(CACHE_COURS)).keys()).length;
    stats.images = (await (await caches.open(CACHE_IMAGES)).keys()).length;
  } catch (e) {}

  client.postMessage({ type: 'STATS_RESULT', stats });
}

console.log('[SW] Service Worker v7.0.0 chargé (network-first sur HTML + JS + CSS locaux)');
