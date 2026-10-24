// ================================================================
// REGISTER SERVICE WORKER — ARVEXA School
// Version : OFFLINE v1.2 — Sans reload brutal
// ================================================================

(function () {
  'use strict';

  // ═══ 1. ENREGISTREMENT SW ═══
  if ('serviceWorker' in navigator) {

    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('service-worker.js', {
          scope: './',
          updateViaCache: 'none'
        })
        .then((registration) => {
          console.log('[SW] Enregistré. Scope:', registration.scope);

          registration.addEventListener('updatefound', () => {
            const newWorker = registration.installing;
            if (!newWorker) return;
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                console.log('[SW] Nouvelle version détectée — activation silencieuse');
                // ⚡ On active la nouvelle version SANS reload
                newWorker.postMessage({ type: 'SKIP_WAITING' });
              }
            });
          });

          setInterval(() => {
            if (document.visibilityState === 'visible') {
              registration.update().catch(() => {});
            }
          }, 60 * 60 * 1000);

          document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
              registration.update().catch(() => {});
            }
          });
        })
        .catch((error) => {
          console.warn('[SW] Erreur:', error.message);
        });
    });
  }

  // ═══ 2. INJECTION offline.js ═══
  function injectOffline() {
    if (document.getElementById('arvexaOfflineScript')) return;

    const path = window.location.pathname.toLowerCase();
    const SKIP = ['login','register','forgot-password','auth-choice','onboarding','conditions','confidentialite','offline','404'];
    if (SKIP.some((p) => path.includes(p))) return;

    const script = document.createElement('script');
    script.id = 'arvexaOfflineScript';
    script.src = 'offline.js';
    script.defer = true;
    script.onerror = () => console.warn('[Offline] Impossible de charger offline.js');
    document.head.appendChild(script);
  }

  // ═══ 3. INJECTION analytics.js ═══
  function injectAnalytics() {
    if (document.getElementById('arvexaAnalyticsScript')) return;
    if (window.location.pathname.includes('admin')) return;

    const script = document.createElement('script');
    script.id = 'arvexaAnalyticsScript';
    script.src = 'analytics.js';
    script.async = true;
    script.type = 'module';
    script.onerror = () => console.warn('[Analytics] non chargé');
    document.head.appendChild(script);
  }

  // ═══ 4. LANCEMENT ═══
  function boot() {
    injectOffline();
    injectAnalytics();
    injectTour();
  }

  // ═══ INJECTION DU TUTORIEL ═══
  function injectTour() {
    if (document.getElementById('arvexaTourScript')) return;

    const path = window.location.pathname.toLowerCase();
    const SKIP = [
      'login', 'register', 'forgot-password', 'auth-choice',
      'onboarding.html', 'conditions', 'confidentialite',
      'offline', '404', 'onboarding-tour'
    ];

    if (SKIP.some((p) => path.includes(p))) return;

    try {
      if (localStorage.getItem('arvexa_tour_completed_v1') === '1') return;
    } catch (e) { return; }

    if (!document.querySelector('link[data-arvexa-tour-css]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'tour-styles.css';
      link.setAttribute('data-arvexa-tour-css', '1');
      document.head.appendChild(link);
    }

    const script = document.createElement('script');
    script.id = 'arvexaTourScript';
    script.src = 'onboarding-tour.js';
    script.defer = true;
    script.onerror = () => console.warn('[Tour] Impossible de charger onboarding-tour.js');
    document.head.appendChild(script);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // ═══ 5. LOGS ═══
  window.addEventListener('online', () => console.log('[SW] En ligne'));
  window.addEventListener('offline', () => console.log('[SW] Hors ligne'));

  // ═══ 6. NETTOYAGE MANUEL (console) ═══
  window.arvexaClearSW = async () => {
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const reg of regs) await reg.unregister();
      const names = await caches.keys();
      await Promise.all(names.map((n) => caches.delete(n)));
      console.log('[SW] Tout nettoyé. Recharge la page.');
    } catch (e) {
      console.error(e);
    }
  };
})();
