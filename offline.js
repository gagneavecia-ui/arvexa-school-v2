// ================================================================
// OFFLINE.JS — ARVEXA School
// Version : 3.0.0 — Bannière + indicateur + download complet
// ================================================================

(function () {
  'use strict';

  if (window.__arvexaOfflineInit) return;
  window.__arvexaOfflineInit = true;

  const STORAGE_KEY = 'arvexa_pending_sync';
  const DOWNLOAD_STATE_KEY = 'arvexa_download_state';

  let isOnline = navigator.onLine;
  let pendingSync = [];
  let bannerEl = null;
  let indicatorEl = null;
  let swRegistration = null;

  // ================================================================
  // DONNÉES EN ATTENTE
  // ================================================================
  function loadPendingData() {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      pendingSync = data ? JSON.parse(data) : [];
    } catch (e) {
      pendingSync = [];
    }
  }

  function savePendingData() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(pendingSync));
    } catch (e) {}
  }

  // ================================================================
  // SERVICE WORKER REGISTRATION
  // ================================================================
  function waitForSW() {
    return new Promise((resolve) => {
      if (!('serviceWorker' in navigator)) {
        resolve(null);
        return;
      }
      navigator.serviceWorker.ready.then((reg) => {
        swRegistration = reg;
        resolve(reg);
      }).catch(() => resolve(null));
    });
  }

  // ================================================================
  // BANNIÈRE
  // ================================================================
  function createBanner() {
    if (bannerEl) return bannerEl;

    bannerEl = document.createElement('div');
    bannerEl.id = 'arvexaOfflineBanner';
    bannerEl.className = 'arvexa-offline-banner';
    bannerEl.innerHTML = `
      <span class="arvexa-offline-dot"></span>
      <span class="arvexa-offline-text">
        Mode hors ligne — contenu en cache uniquement
      </span>
      <button class="arvexa-offline-retry" type="button" aria-label="Réessayer">
        <i class="fas fa-rotate-right"></i>
      </button>
    `;

    const header = document.querySelector('.header, .site-header');
    if (header && header.parentNode) {
      header.parentNode.insertBefore(bannerEl, header.nextSibling);
    } else {
      document.body.insertBefore(bannerEl, document.body.firstChild);
    }

    bannerEl.querySelector('.arvexa-offline-retry')
      .addEventListener('click', () => window.location.reload());

    return bannerEl;
  }

  // ================================================================
  // INDICATEUR
  // ================================================================
  function createIndicator() {
    if (indicatorEl) return indicatorEl;

    const actions = document.querySelector('.header-actions')
      || document.querySelector('.header-right')
      || document.querySelector('.site-header');

    if (!actions) return null;

    indicatorEl = document.createElement('button');
    indicatorEl.id = 'arvexaOfflineIndicator';
    indicatorEl.className = 'arvexa-offline-indicator';
    indicatorEl.type = 'button';
    indicatorEl.setAttribute('aria-label', 'Statut de connexion');
    indicatorEl.title = 'Statut de connexion';
    indicatorEl.innerHTML = '<i class="fas fa-wifi"></i>';

    indicatorEl.addEventListener('click', () => {
      if (!navigator.onLine) {
        showToast('📶 Hors ligne — contenu en cache', 'error');
      } else {
        showToast('✅ Connecté', 'success');
      }
    });

    actions.insertBefore(indicatorEl, actions.firstChild);
    return indicatorEl;
  }

  // ================================================================
  // MISE À JOUR UI
  // ================================================================
  function updateUI() {
    if (bannerEl) {
      bannerEl.classList.toggle('show', !isOnline);
    }

    if (indicatorEl) {
      indicatorEl.classList.toggle('online', isOnline);
      indicatorEl.classList.toggle('offline', !isOnline);
      indicatorEl.innerHTML = isOnline
        ? '<i class="fas fa-wifi"></i>'
        : '<i class="fas fa-wifi-slash"></i>';
    }

    document.documentElement.setAttribute(
      'data-online',
      isOnline ? 'true' : 'false'
    );
  }

  // ================================================================
  // TOAST
  // ================================================================
  function showToast(message, type = 'info') {
  if (typeof window.arvexaShowToast === 'function') {
    window.arvexaShowToast(message, type);
    return;
  }

  // ⚡ Chaque toast est un élément indépendant (empilement possible)
  const toast = document.createElement('div');
  toast.className = `arvexa-offline-toast ${type} show`;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.classList.remove('show');
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-10px)';
    setTimeout(() => toast.remove(), 300);
  }, 2500);
  }

  // ================================================================
  // ÉVÉNEMENTS RÉSEAU
  // ================================================================
  function bindNetworkEvents() {
    window.addEventListener('online', () => {
      isOnline = true;
      updateUI();
      showToast('✅ Connexion rétablie', 'success');
      setTimeout(syncPendingData, 500);
    });

    window.addEventListener('offline', () => {
      isOnline = false;
      updateUI();
      showToast('📶 Mode hors ligne activé', 'info');
    });
  }

  // ================================================================
  // SYNCHRONISATION
  // ================================================================
  async function syncPendingData() {
    loadPendingData();
    if (pendingSync.length === 0) return;

    const items = [...pendingSync];
    const failed = [];

    for (const item of items) {
      try {
        const success = await trySyncItem(item);
        if (!success) failed.push(item);
      } catch (e) {
        failed.push(item);
      }
    }

    pendingSync = failed;
    savePendingData();

    const successCount = items.length - failed.length;
    if (successCount > 0) {
      showToast(
        `✅ ${successCount} élément${successCount > 1 ? 's' : ''} synchronisé${successCount > 1 ? 's' : ''}`,
        'success'
      );
    }
  }

  async function trySyncItem(item) {
    if (!window.__arvexaSync) return false;
    try {
      return await window.__arvexaSync(item);
    } catch (e) {
      return false;
    }
  }

  // ================================================================
  // TÉLÉCHARGEMENT COMPLET POUR HORS LIGNE
  // ================================================================
  async function downloadAllForOffline() {
    if (!isOnline) {
      showToast('📶 Connecte-toi pour télécharger', 'error');
      return;
    }

    if (!navigator.serviceWorker || !navigator.serviceWorker.controller) {
      showToast('⚠️ Service Worker non prêt, recharge la page', 'error');
      return;
    }

    showToast('⬇️ Récupération de la liste...', 'info');

   try {
  // ⚡ Étape 1 : charger les 4 fichiers JSON des matières
  const subjectFiles = [
    'cours/mathematiques.json',
    'cours/physique.json',
    'cours/chimie.json',
    'cours/svt.json'
  ];

  // ⚡ Étape 2 : pour chaque matière, extraire tous les HTML référencés
  const htmlFiles = new Set();

  for (const jsonFile of subjectFiles) {
    try {
      const res = await fetch(jsonFile);
      if (!res.ok) continue;
      const data = await res.json();

      (data.chapters || []).forEach((ch) => {
        ['cours', 'exercices', 'corrections'].forEach((section) => {
          (ch[section] || []).forEach((part) => {
            if (part.file) htmlFiles.add(part.file);
          });
        });
      });
    } catch (e) {
      // Ignorer les matières absentes
    }
  }

  // ⚡ Étape 3 : compiler la liste finale (JSON + HTML)
  const files = [...subjectFiles, ...Array.from(htmlFiles)];

  if (files.length === 0) {
    showToast('ℹ️ Aucun fichier à télécharger', 'info');
    return;
  }

      // Créer la modale de progression
      openDownloadModal(files.length);

      // Envoyer au Service Worker
      const channel = new MessageChannel();
      channel.port1.onmessage = (event) => {
        const data = event.data;
        if (data.type === 'DOWNLOAD_PROGRESS') {
          updateDownloadProgress(data);
        } else if (data.type === 'DOWNLOAD_COMPLETE') {
          completeDownload(data);
        }
      };

      navigator.serviceWorker.controller.postMessage(
        { type: 'DOWNLOAD_ALL', files },
        [channel.port2]
      );

    } catch (error) {
      console.error(error);
      showToast('❌ Erreur: ' + error.message, 'error');
      closeDownloadModal();
    }
  }

  // ================================================================
  // MODALE DE PROGRESSION
  // ================================================================
  let modalEl = null;

  function openDownloadModal(total) {
    if (modalEl) return;

    modalEl = document.createElement('div');
    modalEl.className = 'arvexa-download-overlay';
    modalEl.innerHTML = `
      <div class="arvexa-download-modal">
        <div class="arvexa-download-icon">
          <i class="fas fa-cloud-arrow-down"></i>
        </div>
        <h3 class="arvexa-download-title">Téléchargement hors ligne</h3>
        <p class="arvexa-download-sub">
          Téléchargement du contenu pour accès hors ligne...
        </p>

        <div class="arvexa-download-progress">
          <div class="arvexa-download-bar">
            <div class="arvexa-download-fill" id="arvexaDlFill"></div>
          </div>
          <div class="arvexa-download-stats">
            <span id="arvexaDlDone">0</span> / <span id="arvexaDlTotal">${total}</span>
            <span id="arvexaDlPercent">0%</span>
          </div>
        </div>

        <div class="arvexa-download-info" id="arvexaDlInfo">
          Préparation...
        </div>

        <button class="arvexa-download-close" id="arvexaDlClose" style="display:none">
          Fermer
        </button>
      </div>
    `;

    document.body.appendChild(modalEl);

    // Bouton fermer
    document.getElementById('arvexaDlClose').addEventListener('click', closeDownloadModal);
  }

  function updateDownloadProgress(data) {
    const fill = document.getElementById('arvexaDlFill');
    const done = document.getElementById('arvexaDlDone');
    const total = document.getElementById('arvexaDlTotal');
    const percent = document.getElementById('arvexaDlPercent');
    const info = document.getElementById('arvexaDlInfo');

    if (fill) fill.style.width = data.percent + '%';
    if (done) done.textContent = data.done + data.failed;
    if (total) total.textContent = data.total;
    if (percent) percent.textContent = data.percent + '%';
    if (info) {
      info.textContent = `${data.done} fichiers téléchargés${data.failed > 0 ? `, ${data.failed} échecs` : ''}`;
    }
  }

  function completeDownload(data) {
    const info = document.getElementById('arvexaDlInfo');
    const close = document.getElementById('arvexaDlClose');

    if (info) {
      info.innerHTML = `✅ <strong>${data.done}</strong> fichiers prêts hors ligne${data.failed > 0 ? ` · ${data.failed} échecs` : ''}`;
    }

    if (close) close.style.display = 'block';

    showToast(`✅ ${data.done} fichiers prêts pour hors ligne`, 'success');

    // Auto-fermeture après 2 secondes si tout est bon
    if (data.failed === 0) {
      setTimeout(() => closeDownloadModal(), 2000);
    }
  }

  function closeDownloadModal() {
    if (modalEl) {
      modalEl.style.opacity = '0';
      setTimeout(() => {
        if (modalEl) {
          modalEl.remove();
          modalEl = null;
        }
      }, 300);
    }
  }

  // ================================================================
  // STYLES
  // ================================================================
  function injectStyles() {
    if (document.getElementById('arvexaOfflineStyles')) return;

    const style = document.createElement('style');
    style.id = 'arvexaOfflineStyles';
    style.textContent = `
      /* === BANNIÈRE === */
      .arvexa-offline-banner {
        display: none;
        position: sticky;
        top: 0;
        z-index: 999;
        align-items: center;
        gap: 10px;
        padding: 8px 14px;
        background: linear-gradient(90deg, rgba(184,92,58,.18), rgba(184,92,58,.10));
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border-bottom: 1px solid rgba(184,92,58,.2);
        color: #FFB8A0;
        font-family: 'Inter', sans-serif;
        font-size: 12.5px;
        font-weight: 600;
        animation: arvexaBannerIn 0.3s cubic-bezier(0.25,1,0.5,1);
      }
      .arvexa-offline-banner.show { display: flex; }
      .arvexa-offline-banner .arvexa-offline-dot {
        width: 8px; height: 8px; border-radius: 50%;
        background: #E74C3C; box-shadow: 0 0 8px #E74C3C;
        flex-shrink: 0;
        animation: arvexaPulseDot 1.5s ease-in-out infinite;
      }
      .arvexa-offline-banner .arvexa-offline-text {
        flex: 1; min-width: 0;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .arvexa-offline-banner .arvexa-offline-retry {
        width: 28px; height: 28px; border-radius: 50%;
        border: 1px solid rgba(255,184,160,.25);
        background: rgba(255,255,255,.04);
        color: #FFB8A0; cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        font-size: 12px; transition: all 0.2s ease; flex-shrink: 0;
      }
      .arvexa-offline-banner .arvexa-offline-retry:hover {
        background: rgba(255,184,160,.15);
        border-color: rgba(255,184,160,.5);
      }

      /* === INDICATEUR === */
      .arvexa-offline-indicator {
        width: 36px; height: 36px; border-radius: 50%;
        border: none; background: rgba(255,255,255,.04);
        color: #8A8A7A; cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        font-size: 14px; transition: all 0.25s ease;
        flex-shrink: 0; position: relative;
      }
      .arvexa-offline-indicator.online { color: #3AB67E; }
      .arvexa-offline-indicator.offline {
        color: #E74C3C;
        animation: arvexaPulseIndicator 2s ease-in-out infinite;
      }
      .arvexa-offline-indicator:hover { background: rgba(255,255,255,.08); }
      .arvexa-offline-indicator::after {
        content: ''; position: absolute; top: 6px; right: 6px;
        width: 6px; height: 6px; border-radius: 50%;
        background: transparent; transition: background 0.3s ease;
      }
      .arvexa-offline-indicator.online::after {
        background: #3AB67E; box-shadow: 0 0 6px #3AB67E;
      }
      .arvexa-offline-indicator.offline::after {
        background: #E74C3C; box-shadow: 0 0 6px #E74C3C;
      }

      /* === TOAST === */
      .arvexa-offline-toast {
        position: fixed; top: 20px; left: 50%;
        transform: translateX(-50%) translateY(-80px);
        padding: 12px 20px; border-radius: 12px;
        background: rgba(20,22,20,.96);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        border: 1px solid rgba(224,184,74,.3);
        color: #F5F0E8;
        font-family: 'Inter', sans-serif;
        font-size: 13px; font-weight: 500;
        z-index: 10000; opacity: 0; pointer-events: none;
        transition: all 0.4s cubic-bezier(0.25,1,0.5,1);
        max-width: 90%;
        box-shadow: 0 12px 40px rgba(0,0,0,.5);
        text-align: center;
      }
      .arvexa-offline-toast.show {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }
      .arvexa-offline-toast.success { border-color: rgba(58,182,126,.5); }
      .arvexa-offline-toast.error { border-color: rgba(231,76,60,.5); }

      /* === MODALE DOWNLOAD === */
      .arvexa-download-overlay {
        position: fixed; inset: 0;
        background: rgba(0,0,0,.85);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        z-index: 10001;
        display: flex; align-items: center; justify-content: center;
        padding: 20px;
        animation: arvexaFadeIn 0.3s ease;
        transition: opacity 0.3s ease;
      }
      .arvexa-download-modal {
        background: linear-gradient(145deg, #141414, #0A0A0A);
        border: 1px solid rgba(184,134,11,.25);
        border-radius: 20px;
        padding: 28px 24px 22px;
        max-width: 440px; width: 100%;
        text-align: center;
        box-shadow: 0 20px 60px rgba(0,0,0,.6);
        animation: arvexaSlideUp 0.4s cubic-bezier(0.34,1.56,0.64,1);
      }
      .arvexa-download-icon {
        font-size: 42px; margin-bottom: 12px;
        color: #E0B84A;
        animation: arvexaBounce 2s ease-in-out infinite;
      }
      .arvexa-download-title {
        font-family: 'Playfair Display', serif;
        font-size: 20px; font-weight: 700;
        color: #F5F0E8; margin-bottom: 6px;
      }
      .arvexa-download-sub {
        font-size: 13px; color: #8A8A7A;
        margin-bottom: 20px; line-height: 1.5;
      }
      .arvexa-download-progress { margin-bottom: 16px; }
      .arvexa-download-bar {
        height: 8px; border-radius: 8px;
        background: rgba(255,255,255,.06);
        overflow: hidden; margin-bottom: 10px;
      }
      .arvexa-download-fill {
        height: 100%; width: 0%;
        background: linear-gradient(90deg, #B8860B, #E0B84A);
        border-radius: 8px;
        transition: width 0.3s ease;
        box-shadow: 0 0 12px rgba(224,184,74,.5);
      }
      .arvexa-download-stats {
        display: flex; justify-content: space-between;
        font-size: 12px; color: #8A8A7A;
        font-weight: 600;
      }
      .arvexa-download-info {
        font-size: 13px; color: #8A8A7A;
        margin-bottom: 16px;
        min-height: 20px;
      }
      .arvexa-download-close {
        padding: 11px 28px; border-radius: 30px;
        border: none;
        background: linear-gradient(135deg, #E0B84A, #B8860B);
        color: #0A0A0A;
        font-family: 'Inter', sans-serif;
        font-size: 13px; font-weight: 700;
        cursor: pointer;
        transition: all 0.25s ease;
      }
      .arvexa-download-close:hover {
        transform: translateY(-2px);
        box-shadow: 0 6px 20px rgba(184,134,11,.3);
      }

      /* === ANIMATIONS === */
      @keyframes arvexaBannerIn {
        from { opacity: 0; transform: translateY(-100%); }
        to { opacity: 1; transform: translateY(0); }
      }
      @keyframes arvexaPulseDot {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.5; transform: scale(1.3); }
      }
      @keyframes arvexaPulseIndicator {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.6; }
      }
      @keyframes arvexaFadeIn {
        from { opacity: 0; } to { opacity: 1; }
      }
      @keyframes arvexaSlideUp {
        from { opacity: 0; transform: translateY(30px) scale(0.95); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      @keyframes arvexaBounce {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-6px); }
      }

      @media (prefers-reduced-motion: reduce) {
        .arvexa-offline-banner,
        .arvexa-offline-dot,
        .arvexa-offline-indicator,
        .arvexa-offline-toast,
        .arvexa-download-modal,
        .arvexa-download-icon {
          animation: none !important;
          transition: none !important;
        }
      }

      @media (max-width: 480px) {
        .arvexa-offline-banner { font-size: 11.5px; padding: 7px 10px; }
        .arvexa-offline-indicator { width: 32px; height: 32px; font-size: 13px; }
        .arvexa-download-modal { padding: 22px 18px 18px; }
        .arvexa-download-title { font-size: 18px; }
      }
    `;
    document.head.appendChild(style);
  }

  // ================================================================
  // INIT
  // ================================================================
  function init() {
    injectStyles();
    loadPendingData();

    const boot = async () => {
      createBanner();
      createIndicator();
      bindNetworkEvents();
      updateUI();
      await waitForSW();

      if (isOnline && pendingSync.length > 0) {
        setTimeout(syncPendingData, 1500);
      }
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot);
    } else {
      boot();
    }
  }

  // ================================================================
  // API PUBLIQUE
  // ================================================================
  window.arvexaOffline = {
    isOnline: () => isOnline,

    queue: function (data) {
      pendingSync.push({
        data: data,
        url: window.location.href,
        timestamp: new Date().toISOString()
      });
      savePendingData();
    },

    canPerform: function (action) {
      if (isOnline) return true;
      const allowed = ['read', 'navigate', 'notes', 'calculator', 'formula', 'cours'];
      return allowed.includes(action);
    },

    sync: function () {
      if (isOnline) syncPendingData();
      else showToast('📶 Impossible de synchroniser hors ligne', 'error');
    },

    pending: function () {
      loadPendingData();
      return [...pendingSync];
    },

    setSyncHandler: function (fn) {
      window.__arvexaSync = fn;
    },

    // ⭐ NOUVEAU : télécharger tout le contenu pour hors ligne
    downloadAll: downloadAllForOffline,

    // Cacher une URL unique
    cacheUrl: function (url) {
      if (!navigator.serviceWorker || !navigator.serviceWorker.controller) return;
      navigator.serviceWorker.controller.postMessage({
        type: 'CACHE_URL',
        url
      });
    },

    // Récupérer les stats
    getStats: function () {
      return new Promise((resolve) => {
        if (!navigator.serviceWorker || !navigator.serviceWorker.controller) {
          resolve({ shell: 0, cours: 0, manifests: 0, images: 0 });
          return;
        }
        const channel = new MessageChannel();
        channel.port1.onmessage = (e) => {
          if (e.data.type === 'STATS_RESULT') resolve(e.data.stats);
        };
        navigator.serviceWorker.controller.postMessage(
          { type: 'STATS' },
          [channel.port2]
        );
        setTimeout(() => resolve({ shell: 0, cours: 0, manifests: 0, images: 0 }), 2000);
      });
    },

    toast: showToast
  };

  init();

  console.log('✅ ARVEXA — Mode hors ligne v3 prêt');
})();
