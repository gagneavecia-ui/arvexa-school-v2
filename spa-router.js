// spa-router.js — Routeur SPA robuste pour ARVEXA
// Remplace uniquement la zone de contenu, garde header + head intacts
(function() {
  'use strict';

  const SKIP_PAGES = ['login', 'register', 'onboarding', '404', 'offline'];
  if (SKIP_PAGES.some(p => location.pathname.includes(p))) return;

  // ⚡ Sélecteurs de la zone de contenu pour chaque type de page
  // Ordre : du plus spécifique au plus générique
  const CONTENT_SELECTORS = [
    '#cardsView',           // chapitre.html
    '#chapterList',         // matiere.html
    '#contentWrapper',      // lecture.html
    'main.container',       // défaut (matiere, chapitre, etc.)
    'main'                  // fallback
  ];

  // Trouve l'élément de contenu dans un document
  function trouverContenu(doc) {
    for (const sel of CONTENT_SELECTORS) {
      const el = doc.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  // Trouve l'élément de contenu dans la page ACTUELLE
  function trouverContenuActuel() {
    for (const sel of CONTENT_SELECTORS) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  // ⚡ Intercepter les liens <a href>
  document.addEventListener('click', function(e) {
    const link = e.target.closest('a[href]');
    if (!link) return;

    const href = link.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('http') || 
        href.startsWith('mailto:') || link.hasAttribute('data-no-spa')) return;

    const url = new URL(href, location.href);
    if (url.origin !== location.origin) return;

    e.preventDefault();
    naviguer(url.href);
  });

  // ⚡ Intercepter les cartes onclick="navigateToChapter(...)"
  document.addEventListener('click', function(e) {
    const card = e.target.closest('[onclick*="navigateToChapter"]');
    if (!card) return;
    
    const match = card.getAttribute('onclick').match(/navigateToChapter\((\d+)\)/);
    if (!match) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    const params = new URLSearchParams(location.search);
    const subject = params.get('subject') || 'mathematiques';
    const url = `chapitre.html?subject=${subject}&chapter=${match[1]}`;
    naviguer(new URL(url, location.href).href);
  }, true);

  // ⚡ Bouton retour du navigateur
  window.addEventListener('popstate', function() {
    naviguer(location.href, true);
  });

  // ⚡ Navigation — remplace UNIQUEMENT le contenu
  async function naviguer(url, isPopState) {
    try {
      // 1. Récupérer le HTML de la page cible
      const response = await fetch(url);
      const html = await response.text();

      // 2. Parser
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      // 3. Trouver les zones de contenu
      const ancienContenu = trouverContenuActuel();
      const nouveauContenu = trouverContenu(doc);

      if (!ancienContenu || !nouveauContenu) {
        // Fallback : navigation classique si on ne trouve pas
        console.warn('[SPA] Zone de contenu introuvable, navigation classique');
        window.location.href = url;
        return;
      }

      // 4. Sauvegarder la position de scroll
      const scrollY = window.scrollY;

      // 5. Remplacer le contenu
      ancienContenu.innerHTML = nouveauContenu.innerHTML;
      
      // 6. Copier les classes et attributs du nouveau contenu
      // (au cas où le sélecteur a matché un élément différent)
      ancienContenu.className = nouveauContenu.className;
      
      // 7. Mettre à jour le titre
      document.title = doc.title;
      
      // ⚡ Recharger les données de la page si elle expose une fonction
      if (typeof window.arvexaRechargerMatiere === 'function') {
        window.arvexaRechargerMatiere();
      }
      
      // 8. Mettre à jour l'URL
      if (!isPopState) {
        history.pushState({}, '', url);
      }

      // 9. Ré-exécuter UNIQUEMENT les scripts inline (pas les modules)
      await reexecuterScriptsInline(nouveauContenu);

      // 10. Scroll en haut
      window.scrollTo(0, 0);

    } catch (error) {
      console.warn('[SPA] Erreur navigation:', error);
      window.location.href = url;
    }
  }

  // ⚡ Ré-exécuter UNIQUEMENT les scripts inline classiques
  // (pas les type="module" qui sont déjà chargés globalement)
  async function reexecuterScriptsInline(container) {
    const scripts = container.querySelectorAll('script');
    
    for (const oldScript of scripts) {
      // ⚡ NE PAS ré-exécuter les modules (Firebase est déjà chargé)
      if (oldScript.type === 'module') continue;
      if (oldScript.src && oldScript.src.includes('register-sw')) continue;
      if (oldScript.src && oldScript.src.includes('spa-router')) continue;
      if (oldScript.hasAttribute('data-no-spa')) continue;
      
      // Ne ré-exécuter que les scripts inline classiques
      if (!oldScript.src) {
        const newScript = document.createElement('script');
        for (const attr of oldScript.attributes) {
          newScript.setAttribute(attr.name, attr.value);
        }
        newScript.textContent = oldScript.textContent;
        oldScript.parentNode.replaceChild(newScript, oldScript);
      }
    }
  }

    // ⚡ API publique pour que les pages puissent déclencher une navigation SPA
  window.arvexaNavigate = function(url) {
    if (!url) return;
    const absoluteUrl = new URL(url, location.href).href;
    naviguer(absoluteUrl);
  };
  
  console.log('[SPA] Routeur robuste activé');
})();
