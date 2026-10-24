// spa-router.js — Routeur SPA automatique pour ARVEXA
(function() {
  'use strict';

  const SKIP_PAGES = ['login', 'register', 'onboarding', '404', 'offline'];
  if (SKIP_PAGES.some(p => location.pathname.includes(p))) return;

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

  // ⚡ Intercepter les cartes avec onclick="navigateToChapter(...)"
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

  // ⚡ Navigation
  async function naviguer(url, isPopState) {
    try {
      document.body.style.opacity = '0.7';

      const response = await fetch(url);
      const html = await response.text();

      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      document.body.innerHTML = doc.body.innerHTML;
      document.title = doc.title;

      if (!isPopState) {
        history.pushState({}, '', url);
      }

      await reexecuterScripts(doc.body);

      document.body.style.opacity = '1';
      window.scrollTo(0, 0);

    } catch (error) {
      console.warn('[SPA] Erreur navigation:', error);
      window.location.href = url;
    }
  }

  // ⚡ Ré-exécuter les scripts de la nouvelle page (sauf Firebase)
  async function reexecuterScripts(container) {
    const scripts = container.querySelectorAll('script');
    
    for (const oldScript of scripts) {
      if (oldScript.src && oldScript.src.includes('register-sw')) continue;
      if (oldScript.src && oldScript.src.includes('spa-router')) continue;
      if (oldScript.hasAttribute('data-no-spa')) continue;
      
      const newScript = document.createElement('script');
      
      for (const attr of oldScript.attributes) {
        newScript.setAttribute(attr.name, attr.value);
      }

      if (!oldScript.src) {
        newScript.textContent = oldScript.textContent;
      }

      oldScript.parentNode.replaceChild(newScript, oldScript);
    }
  }

  console.log('[SPA] Routeur automatique activé');
})();
