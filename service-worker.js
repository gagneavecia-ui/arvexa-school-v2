// ================================================================
// SERVICE WORKER — ARVEXA School
// Version : DEV — Ne cache RIEN. Se désinscrit. Vide tout.
// ⚠️ À utiliser UNIQUEMENT en développement.
// ================================================================

console.log('[SW] Mode DÉVELOPPEMENT — désactivation complète');

// ================================================================
// INSTALLATION : on s'installe puis on se désinscrit immédiatement
// ================================================================
self.addEventListener('install', (event) => {
  console.log('[SW] Install — auto-désinscription');
  self.skipWaiting();
  event.waitUntil(self.registration.unregister());
});

// ================================================================
// ACTIVATION : on vide TOUS les caches existants
// ================================================================
self.addEventListener('activate', (event) => {
  console.log('[SW] Activate — vidage de tous les caches');
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.map((name) => {
        console.log('[SW] Suppression cache:', name);
        return caches.delete(name);
      })))
      .then(() => {
        console.log('[SW] Tous les caches supprimés');
        return self.registration.unregister();
      })
      .then(() => self.clients.matchAll())
      .then((clients) => {
        clients.forEach((client) => {
          if (client.navigate) {
            client.navigate(client.url);
          }
        });
      })
  );
});

// ================================================================
// FETCH : on ne touche à RIEN (laisse le navigateur faire)
// ================================================================
self.addEventListener('fetch', (event) => {
  // Aucune interception = le navigateur gère nativement
  // Donc zéro cache parasite, zéro délai SW, zéro bug de version
  return;
});

// ================================================================
// MESSAGES (pour forcer la désinscription manuellement)
// ================================================================
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'UNREGISTER') {
    event.waitUntil(self.registration.unregister());
  }
});

console.log('[SW] Mode DEV prêt — aucun cache, aucune interception');
