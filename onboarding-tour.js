// ================================================================
// ONBOARDING TOUR — ARVEXA School
// Version : v3.0 — Réduit à 7 étapes, mise en avant des outils
// ================================================================

(function () {
  'use strict';

  if (window.__arvexaTourInit) return;
  window.__arvexaTourInit = true;

  const TOUR_KEY = 'arvexa_tour_completed_v1';

  try {
    if (localStorage.getItem(TOUR_KEY) === '1') {
      console.log('[Tour] Déjà effectué');
      return;
    }
  } catch (e) {
    return;
  }

  console.log('[Tour] Préparation...');

  // ═══ Charger Driver.js depuis CDN ═══
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

  // ═══ Attendre qu'un sélecteur existe ═══
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

  // ═══ Étapes du tutoriel — 7 étapes essentielles ═══
  function buildSteps() {
    return [
      // 1. Bienvenue
      {
        element: 'body',
        popover: {
          title: '🎓 Bienvenue sur ARVEXA !',
          description: 'Faisons un tour rapide en 1 minute pour découvrir l\'essentiel.',
          side: 'bottom', align: 'center'
        }
      },

      // 2. Profil + Notifications (groupés visuellement)
      {
        element: '#profileBtn',
        popover: {
          title: '👤 Ton profil',
          description: 'Ton profil, ton abonnement et toutes tes préférences ici. La cloche 🔔 à côté, ce sont tes notifications.',
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

      // 5. Outils — MISE EN AVANT des essentiels
      {
        element: '.tools-grid',
        popover: {
          title: '🛠️ Tes outils essentiels',
          description: 'ARV-PROGRESS (suivi de tes cours), Mode Examen (examens IA corrigés), ARV-Assistant (tuteur IA), et tous les outils scientifiques (calculatrice, formulaires, tableau périodique).',
          side: 'bottom', align: 'center'
        }
      },

      // 6. ARV-PROGRESS + Mode Examen (les 2 plus importants)
      {
        element: '.tools-grid a[href*="arv-progress"]',
        popover: {
          title: '📊 ARV-PROGRESS & Mode Examen',
          description: 'ARV-PROGRESS analyse tes cours et te dit quoi réviser. Le Mode Examen génère des sujets complets avec correction détaillée. Les deux sont tes meilleurs alliés pour le BAC.',
          side: 'bottom', align: 'start'
        }
      },

      // 7. Fin
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

      console.log('[Tour] ' + validSteps.length + ' étapes, démarrage');

      const tour = driver({
        showProgress: true,
        progressText: '{{current}} / {{total}}',
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
        onDestroyStarted: () => {
          if (!tour.hasNextStep() || confirm('Quitter le tutoriel ?')) {
            tour.destroy();
          }
        },
        onDestroyed: () => {
          markTourDone();
          showPremiumPopup();
        },
        steps: validSteps
      });

      setTimeout(() => tour.drive(), 500);

    } catch (error) {
      console.error('[Tour] Erreur :', error);
      markTourDone();
    }
  }

  function markTourDone() {
    try {
      localStorage.setItem(TOUR_KEY, '1');
    } catch (e) {}
  }

  // ═══ Pop-up Premium ═══
  function showPremiumPopup() {
    const overlay = document.createElement('div');
    overlay.className = 'arvexa-premium-overlay';
    overlay.innerHTML =
      '<div class="arvexa-premium-modal">' +
        '<button class="arvexa-premium-close" aria-label="Fermer">' +
          '<i class="fas fa-times"></i>' +
        '</button>' +
        '<div class="arvexa-premium-icon">👑</div>' +
        '<h2 class="arvexa-premium-title">Débloque <em>tout</em> ARVEXA</h2>' +
        '<p class="arvexa-premium-sub">Tu as vu l\'essentiel. Passe à Premium pour aller plus loin.</p>' +
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
