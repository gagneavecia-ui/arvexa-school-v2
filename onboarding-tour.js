// ================================================================
// ONBOARDING TOUR — ARVEXA School
// Version : v4.0 — Révolutionnaire, 8 étapes, sauvegarde d'état
// ================================================================

(function () {
  'use strict';

  if (window.__arvexaTourInit) return;
  window.__arvexaTourInit = true;

  const TOUR_KEY = 'arvexa_tour_completed_v1';
  const STEP_KEY = 'arvexa_tour_step_v1';

  // ═══ Vérifier si le tour est terminé ═══
  try {
    if (localStorage.getItem(TOUR_KEY) === '1') {
      console.log('[Tour] Déjà effectué');
      return;
    }
  } catch (e) {
    return;
  }

  console.log('[Tour] Préparation...');

  // ═══ Charger Driver.js ═══
  function loadDriver() {
    return new Promise((resolve, reject) => {
      if (window.driver && window.driver.js && window.driver.js.driver) {
        resolve(window.driver);
        return;
      }
      if (!document.querySelector('link[data-driver-css]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://cdn.jsdelivr.net/npm/driver.js@1.3.1/dist/driver.css';
        link.setAttribute('data-driver-css', '1');
        document.head.appendChild(link);
      }
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/driver.js@1.3.1/dist/driver.js.iife.js';
      script.onload = () => resolve(window.driver);
      script.onerror = () => reject(new Error('CDN inaccessible'));
      document.head.appendChild(script);
    });
  }

  function waitForSelector(selector, timeout) {
    timeout = timeout || 3000;
    return new Promise((resolve) => {
      const start = Date.now();
      const check = () => {
        const el = document.querySelector(selector);
        if (el) { resolve(el); return; }
        if (Date.now() - start > timeout) { resolve(null); return; }
        setTimeout(check, 100);
      };
      check();
    });
  }

  // ═══ Récupérer la position sauvegardée ═══
  function getSavedStep() {
    try {
      const v = localStorage.getItem(STEP_KEY);
      if (v === null) return 0;
      const n = parseInt(v, 10);
      return isNaN(n) ? 0 : Math.max(0, n);
    } catch (e) {
      return 0;
    }
  }

  function saveStep(index) {
    try {
      localStorage.setItem(STEP_KEY, String(index));
    } catch (e) {}
  }

  function clearStep() {
    try {
      localStorage.removeItem(STEP_KEY);
    } catch (e) {}
  }

  // ═══ Étapes — 8 étapes choisies ═══
  function buildSteps() {
    return [
      // 1. Bienvenue
      {
        element: 'body',
        popover: {
          title: '🎓 Bienvenue sur ARVEXA !',
          description: 'Faisons un tour en 1 minute. Tu vas découvrir comment réviser efficacement et décrocher ton BAC.',
          side: 'bottom', align: 'center'
        }
      },

      // 2. Profil + Notifications
      {
        element: '#profileBtn',
        popover: {
          title: '👤 Ton profil',
          description: 'Ton profil, ton abonnement, tes préférences. La cloche 🔔 à côté, ce sont tes notifications.',
          side: 'bottom', align: 'end'
        }
      },

      // 3. Compte à rebours
      {
        element: '#countdownTitle',
        popover: {
          title: '📅 Compte à rebours BAC',
          description: 'Le temps restant avant l\'examen officiel. Chaque jour compte, garde-le en vue !',
          side: 'bottom', align: 'start'
        }
      },

      // 4. Matières
      {
        element: '.subjects-grid',
        popover: {
          title: '📚 Tes matières',
          description: 'Maths, Physique, Chimie, SVT. Clique sur une matière pour accéder à ses chapitres, cours, exercices et corrections.',
          side: 'bottom', align: 'center'
        }
      },

      // 5. ARV-PROGRESS — le cœur du suivi
      {
        element: '.tools-grid a[href*="arv-progress"]',
        popover: {
          title: '📊 ARV-PROGRESS',
          description: 'Ton carnet intelligent. Ajoute tes cours, l\'IA les analyse et te dit exactement quoi réviser. Ton meilleur allié pour progresser.',
          side: 'bottom', align: 'start'
        }
      },

      // 6. ARV-Assistant — l'IA tuteur
      {
        element: '.tools-grid a[href*="arv.html"]',
        popover: {
          title: '🤖 ARV-Assistant',
          description: 'Ton tuteur personnel IA. Pose-lui n\'importe quelle question sur ton programme. Il connaît tes examens et tes faiblesses.',
          side: 'top', align: 'start'
        }
      },

      // 7. Hors ligne — la différenciation ARVEXA
      {
        element: '#profileBtn',
        popover: {
          title: '📶 Réviser sans Internet',
          description: 'Dans ton profil, clique « Télécharger tout hors ligne ». Tous tes cours restent accessibles au village ou en déplacement, même sans réseau.',
          side: 'bottom', align: 'end'
        }
      },

      // 8. Fin
      {
        element: 'body',
        popover: {
          title: '✨ Tu es prêt !',
          description: 'Tu connais maintenant l\'essentiel. Explore tes matières, lance ton premier examen et bonne réussite pour ton BAC !',
          side: 'bottom', align: 'center'
        }
      }
    ];
  }

  // ═══ Calcul des stats réelles pour le pop-up Premium ═══
  function computePremiumStats() {
    const stats = {
      totalChapters: 0,
      freeChapters: 0,
      arvRemaining: 0,
      hasData: false
    };

    try {
      // Compter les chapitres vus depuis localStorage
      const readParts = JSON.parse(localStorage.getItem('arvexa_read_parts') || '[]');
      const chaptersRead = new Set();
      readParts.forEach((key) => {
        const parts = key.split('_');
        if (parts.length >= 2) chaptersRead.add(parts[0] + '_' + parts[1]);
      });
      stats.totalChapters = chaptersRead.size;
      stats.freeChapters = 1; // Premier chapitre gratuit
      stats.hasData = stats.totalChapters > 0;

      // Quota ARV-Assistant (approximatif côté client)
      const today = new Date().toISOString().slice(0, 10);
      const arvUsed = localStorage.getItem('arvexa_arv_used_' + today);
      stats.arvRemaining = 10 - (parseInt(arvUsed, 10) || 0);
      if (stats.arvRemaining < 0) stats.arvRemaining = 0;
    } catch (e) {}

    return stats;
  }

  // ═══ Lancer le tour ═══
  async function launchTour() {
    try {
      const driverModule = await loadDriver();
      const driver = driverModule.js.driver;

      if (typeof driver !== 'function') {
        console.error('[Tour] driverModule.js.driver n\'est pas une fonction');
        markTourDone();
        return;
      }

      const allSteps = buildSteps();
      const validSteps = [];

      for (const step of allSteps) {
        if (step.element === 'body') {
          validSteps.push(step);
          continue;
        }
        const el = await waitForSelector(step.element, 1500);
        if (el) validSteps.push(step);
        else console.warn('[Tour] Élément introuvable :', step.element);
      }

      if (validSteps.length === 0) {
        markTourDone();
        return;
      }

      const startIndex = Math.min(getSavedStep(), validSteps.length - 1);
      console.log('[Tour] ' + validSteps.length + ' étapes, départ à l\'étape ' + (startIndex + 1));

      // ═══ Barre de progression personnalisée ═══
      const tour = driver({
        showProgress: false, // on gère nous-mêmes la barre
        nextBtnText: 'Suivant →',
        prevBtnText: '← Précédent',
        doneBtnText: '✨ Terminer',
        allowClose: true,
        overlayClickNext: false,
        overlayColor: 'rgba(0, 0, 0, 0.88)',
        stagePadding: 10,
        stageRadius: 14,
        popoverClass: 'arvexa-tour-popover',
        smoothScroll: true,
        onHighlightStarted: (element, step, options) => {
          const idx = options.state?.activeIndex ?? 0;
          saveStep(idx);
          injectProgressBar(idx, validSteps.length, options);
        },
        onDestroyStarted: () => {
          const hasNext = tour.hasNextStep();
          if (!hasNext || confirm('Quitter le tutoriel ?')) {
            tour.destroy();
          }
        },
        onDestroyed: () => {
          clearStep();
          markTourDone();
          showPremiumPopup();
        },
        steps: validSteps
      });

      setTimeout(() => {
        tour.drive(startIndex);
      }, 500);

    } catch (error) {
      console.error('[Tour] Erreur :', error);
      markTourDone();
    }
  }

  // ═══ Injection de la barre de progression + bouton Passer ═══
  function injectProgressBar(currentIndex, total, options) {
    // Retirer l'ancienne barre
    const oldBar = document.querySelector('.arvexa-tour-progressbar');
    if (oldBar) oldBar.remove();

    const oldSkip = document.querySelector('.arvexa-tour-skip');
    if (oldSkip) oldSkip.remove();

    // Trouver le footer du popover actuel
    setTimeout(() => {
      const popovers = document.querySelectorAll('.driver-popover');
      const activePopover = popovers[popovers.length - 1];
      if (!activePopover) return;

      const footer = activePopover.querySelector('.driver-popover-footer');
      if (!footer) return;

      // Créer la barre de progression
      const bar = document.createElement('div');
      bar.className = 'arvexa-tour-progressbar';
      bar.innerHTML =
        '<div class="arvexa-tour-progressbar-track">' +
          '<div class="arvexa-tour-progressbar-fill" style="width: ' +
            Math.round(((currentIndex + 1) / total) * 100) + '%"></div>' +
        '</div>' +
        '<div class="arvexa-tour-progressbar-text">Étape ' + (currentIndex + 1) + ' sur ' + total + '</div>';

      // Créer le bouton Passer
      const skipBtn = document.createElement('button');
      skipBtn.className = 'arvexa-tour-skip';
      skipBtn.textContent = 'Passer le tutoriel';
      skipBtn.addEventListener('click', () => {
        clearStep();
        markTourDone();
        // Fermer le tour proprement
        const closeBtn = activePopover.querySelector('.driver-popover-close-btn');
        if (closeBtn) closeBtn.click();
      });

      // Insérer la barre avant le footer, le skip après
      activePopover.insertBefore(bar, footer);
      activePopover.appendChild(skipBtn);

    }, 50);
  }

  function markTourDone() {
    try {
      localStorage.setItem(TOUR_KEY, '1');
    } catch (e) {}
  }

  // ═══ Pop-up Premium avec stats réelles ═══
  function showPremiumPopup() {
    const stats = computePremiumStats();
    const overlay = document.createElement('div');
    overlay.className = 'arvexa-premium-overlay';

    const statsHtml = stats.hasData
      ? '<div class="arvexa-premium-stats">' +
          '<div class="arvexa-premium-stat">' +
            '<div class="arvexa-premium-stat-value">' + stats.totalChapters + '</div>' +
            '<div class="arvexa-premium-stat-label">chapitres explorés</div>' +
          '</div>' +
          '<div class="arvexa-premium-stat">' +
            '<div class="arvexa-premium-stat-value">' + stats.arvRemaining + '</div>' +
            '<div class="arvexa-premium-stat-label">questions ARV restantes</div>' +
          '</div>' +
        '</div>'
      : '';

    overlay.innerHTML =
      '<div class="arvexa-premium-modal">' +
        '<button class="arvexa-premium-close" aria-label="Fermer">' +
          '<i class="fas fa-times"></i>' +
        '</button>' +
        '<div class="arvexa-premium-icon">👑</div>' +
        '<h2 class="arvexa-premium-title">Débloque <em>tout</em> ARVEXA</h2>' +
        '<p class="arvexa-premium-sub">Tu as vu l\'essentiel. Passe à Premium pour aller plus loin.</p>' +
        statsHtml +
        '<div class="arvexa-premium-benefits">' +
          '<div class="arvexa-premium-benefit"><i class="fas fa-book-open"></i><span>Tous les chapitres de toutes les matières</span></div>' +
          '<div class="arvexa-premium-benefit"><i class="fas fa-robot"></i><span>ARV-Assistant illimité (60 questions/jour)</span></div>' +
          '<div class="arvexa-premium-benefit"><i class="fas fa-file-circle-check"></i><span>Examens IA illimités + historique complet</span></div>' +
          '<div class="arvexa-premium-benefit"><i class="fas fa-chalkboard-user"></i><span>Réviseur et génération de fiches illimités</span></div>' +
          '<div class="arvexa-premium-benefit"><i class="fas fa-calendar-week"></i><span>Planificateur IA personnalisé</span></div>' +
          '<div class="arvexa-premium-benefit"><i class="fas fa-cloud-arrow-down"></i><span>Contenu hors ligne complet</span></div>' +
        '</div>' +
        '<div class="arvexa-premium-actions">' +
          '<a href="abonnement.html" class="arvexa-premium-btn primary">' +
            '<i class="fas fa-crown"></i> Découvrir Premium — 2 000 FCFA/mois' +
          '</a>' +
          '<button class="arvexa-premium-btn secondary" data-close>Plus tard</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('show'));

    const close = () => {
      overlay.classList.remove('show');
      setTimeout(() => overlay.remove(), 300);
    };

    overlay.querySelector('.arvexa-premium-close').addEventListener('click', close);
    overlay.querySelector('[data-close]').addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
    }, { once: true });
  }

  // ═══ Lancement ═══
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(launchTour, 1500));
  } else {
    setTimeout(launchTour, 1500);
  }

})();
