// ================================================================
// REGISTER SERVICE WORKER — ARVEXA School
// Version : 6.0.0 — Charge offline.js + modals.js + analytics.js
// ================================================================

(function () {
  'use strict';

  // ============================================================
  // 1. ENREGISTREMENT DU SERVICE WORKER
  // ============================================================
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('service-worker.js', {
          scope: './',
          updateViaCache: 'none'
        })
        .then((registration) => {
          console.log('[SW] Enregistré. Scope:', registration.scope);
        })
        .catch((error) => {
          console.warn('[SW] Erreur:', error.message);
        });
    });
  }

  // ============================================================
  // 2. INJECTION AUTOMATIQUE DE offline.js
  // ============================================================
  function injectOffline() {
  if (document.getElementById('arvexaOfflineScript')) return;

  // ⚡ Ne pas injecter sur les pages publiques / d'authentification
  const path = window.location.pathname.toLowerCase();
  const SKIP_PATTERNS = [
    'login',
    'register',
    'forgot-password',
    'auth-choice',
    'onboarding',
    'conditions',
    'confidentialite',
    'offline',
    '404'
  ];

  if (SKIP_PATTERNS.some((pattern) => path.includes(pattern))) {
    return;
  }

  const script = document.createElement('script');
  script.id = 'arvexaOfflineScript';
  script.src = 'offline.js';
  script.defer = true;
  script.onerror = () => console.warn('[Offline] Impossible de charger offline.js');
  document.head.appendChild(script);
  }


  // ============================================================
  // 4. INJECTION AUTOMATIQUE DE analytics.js (ultra-robuste)
  // ============================================================
  function injectAnalytics() {
    if (document.getElementById('arvexaAnalyticsScript')) return;

    // ⚡ Ne pas injecter sur les pages admin
    const path = window.location.pathname;
    if (path.includes('admin')) return;

    const script = document.createElement('script');
    script.id = 'arvexaAnalyticsScript';
    script.src = 'analytics.js';
    script.async = true;     // ⚡ async → jamais bloquant
    script.type = 'module';  // ⚡ module ES (pour les imports Firebase)
    script.onerror = () => {
      // Silencieux : si ça échoue, la page continue normalement
      console.warn('[Analytics] Script non chargé (non bloquant)');
    };
    document.head.appendChild(script);
  }

  // ============================================================
  // 5. LANCEMENT
  // ============================================================
  function boot() {
    injectOffline();
    injectAnalytics();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // ============================================================
  // 6. LOGS RÉSEAU
  // ============================================================
  window.addEventListener('online', () => console.log('[SW] En ligne'));
  window.addEventListener('offline', () => console.log('[SW] Hors ligne'));

})();
