// ================================================================
// ONBOARDING TOUR — ARVEXA School
// Tutoriel interactif avec flèches sur les éléments réels
// Driver.js chargé depuis CDN avec fallback
// ================================================================

(function () {
  'use strict';

  if (window.__arvexaTourInit) return;
  window.__arvexaTourInit = true;

  const TOUR_KEY = 'arvexa_tour_completed_v1';

  // ═══ Vérifier si le tour a déjà été fait ═══
  try {
    if (localStorage.getItem(TOUR_KEY) === '1') {
      console.log('[Tour] Déjà effectué, on ne fait rien');
      return;
    }
  } catch (e) {
    console.warn('[Tour] localStorage inaccessible:', e.message);
    return;
  }

  console.log('[Tour] Script exécuté, préparation...');

  // ═══ Charger Driver.js depuis CDN ═══
  function loadDriver() {
    return new Promise((resolve, reject) => {
      if (window.driver && window.driver.js) {
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
      script.onload = () => {
        console.log('[Tour] Driver.js CDN chargé');
        resolve(window.driver);
      };
      script.onerror = () => {
        console.error('[Tour] Impossible de charger Driver.js CDN');
        reject(new Error('Driver.js CDN inaccessible'));
      };
      document.head.appendChild(script);
    });
  }

  // ═══ Attendre qu'un sélecteur existe dans le DOM ═══
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

  // ═══ Construire les étapes ═══
  function buildSteps() {
    return [
      {
        element: '#profileBtn',
        popover: {
          title: '👤 Ton profil',
          description: 'Clique ici pour accéder à ton profil, ton abonnement et tes préférences.',
          side: 'bottom', align: 'end'
        }
      },
      {
        element: '#notifBtn',
        popover: {
          title: '🔔 Tes notifications',
          description: 'Tu recevras ici les annonces, les nouveaux cours et les rappels importants.',
          side: 'bottom', align: 'end'
        }
      },
      {
        element: '#refreshBtn',
        popover: {
          title: '🔄 Actualiser',
          description: 'Ce bouton recharge tes données en cas de doute ou après une pause.',
          side: 'bottom', align: 'end'
        }
      },
      {
        element: '#countdownTitle',
        popover: {
          title: '📅 Compte à rebours BAC',
          description: 'Le temps restant avant l\'examen officiel. Chaque jour compte, garde-le en vue !',
          side: 'bottom', align: 'start'
        }
      },
      {
        element: '.subjects-grid',
        popover: {
          title: '📚 Toutes tes matières',
          description: 'Maths, Physique, Chimie et SVT. Chaque matière contient des chapitres complets, des exercices corrigés et des corrections détaillées.',
          side: 'bottom', align: 'center'
        }
      },
      {
        element: '.subjects-grid a[href*="mathematiques"]',
        popover: {
          title: '📐 Mathématiques',
          description: 'Clique sur cette matière pour accéder à ses chapitres, cours, exercices et corrections.',
          side: 'bottom', align: 'start'
        }
      },
      {
        element: '.tools-grid',
        popover: {
          title: '🛠️ Tes outils',
          description: 'Calculatrice scientifique, formulaires, tableau périodique. Tous accessibles hors ligne après une première visite.',
          side: 'bottom', align: 'center'
        }
      },
      {
        element: '.tools-grid a[href*="calculatrice"]',
        popover: {
          title: '🧮 Calculatrice',
          description: 'Trigonométrie, logarithmes, puissances, constantes, conversions. Fonctionne hors ligne.',
          side: 'bottom', align: 'start'
        }
      },
      {
        element: '.tools-grid a[href*="exam.html"]',
        popover: {
          title: '📝 Mode Examen',
          description: 'Génère un examen complet avec correction détaillée question par question. Le meilleur moyen de te préparer au BAC.',
          side: 'bottom', align: 'start'
        }
      },
      {
        element: 'body',
        popover: {
          title: '🎓 Bienvenue sur ARVEXA !',
          description: 'Tu as fait le tour de l\'essentiel. Commence par explorer tes matières et lance ton premier examen. Bonne réussite pour ton BAC !',
          side: 'bottom', align: 'center'
        }
      }
    ];
  }

   // ═══ Lancer le tour ═══
  async function launchTour() {
    try {
      console.log('[Tour] Lancement...');

      const driverModule = await loadDriver();
      
      // ✅ CORRECTION : le constructeur est dans driverModule.js.driver
      const driver = driverModule.js.driver;
      
      if (typeof driver !== 'function') {
        console.error('[Tour] driverModule.js.driver n\'est pas une fonction:', driverModule);
        markTourDone();
        return;
      }

      const allSteps = buildSteps();
      const validSteps = [];

      // ... reste du code inchangé

      for (const step of allSteps) {
        if (step.element === 'body') {
          validSteps.push(step);
          continue;
        }
        const el = await waitForSelector(step.element, 1500);
        if (el) {
          validSteps.push(step);
        } else {
          console.warn('[Tour] Élément introuvable, étape ignorée :', step.element);
        }
      }

      if (validSteps.length === 0) {
        console.warn('[Tour] Aucune étape valide, abandon');
        markTourDone();
        return;
      }

      console.log('[Tour] ' + validSteps.length + ' étapes valides, démarrage');

      const tour = driver({
        showProgress: true,
        progressText: '{{current}} sur {{total}}',
        nextBtnText: 'Suivant →',
        prevBtnText: '← Précédent',
        doneBtnText: 'Terminer',
        allowClose: true,
        overlayColor: 'rgba(0, 0, 0, 0.85)',
        stagePadding: 8,
        stageRadius: 12,
        popoverClass: 'arvexa-tour-popover',
        onDestroyed: () => {
          console.log('[Tour] Terminé');
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
      console.log('[Tour] Marquage "terminé"');
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

  // ═══ Lancement au chargement ═══
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(launchTour, 1500);
    });
  } else {
    setTimeout(launchTour, 1500);
  }

})();
