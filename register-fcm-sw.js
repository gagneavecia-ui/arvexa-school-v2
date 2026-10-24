// ================================================================
// REGISTER FCM SERVICE WORKER — ARVEXA School
// Version : v2.1
// Corrections appliquées :
//  - C1 : garde anti-double enregistrement
//  - C2 : résoudre avec null au lieu de rejeter (évite UnhandledPromiseRejection)
//  - C3 : vérifier document.readyState (ne pas dépendre uniquement de 'load')
//  - C4 : console.warn au lieu de console.log pour l'absence de support
// ================================================================

(function() {
  'use strict';

  // ✅ C1 — Garde anti-double enregistrement
  if (window.arvexaFcmRegistration) return;

  if (!('serviceWorker' in navigator)) {
    // ✅ C4 — warn (plus visible que log)
    console.warn('[FCM-SW] Service Worker non supporté');
    // ✅ C2 — résoudre avec null plutôt que de rester en attente
    window.arvexaFcmRegistration = Promise.resolve(null);
    return;
  }

  // ✅ C2 — Résoudre avec null en cas d'échec (pas de rejet)
  // Cela évite les UnhandledPromiseRejection si aucun consommateur ne catch.
  window.arvexaFcmRegistration = new Promise((resolve) => {
    const registerSW = () => {
      navigator.serviceWorker.register('firebase-messaging-sw.js', {
        scope: './firebase-cloud-messaging-push-scope'
      })
        .then((registration) => {
          console.log('[FCM-SW] ✅ Service Worker FCM enregistré. Scope:', registration.scope);
          resolve(registration);
        })
        .catch((error) => {
          console.warn('[FCM-SW] ⚠️ Échec d\'enregistrement (non bloquant) :', error && error.message ? error.message : error);
          // ✅ C2 — resolve(null), pas reject
          resolve(null);
        });
    };

    // ✅ C3 — Vérifier document.readyState pour ne pas dépendre de 'load'
    if (document.readyState === 'complete') {
      registerSW();
    } else {
      window.addEventListener('load', registerSW, { once: true });
    }
  });
})();
