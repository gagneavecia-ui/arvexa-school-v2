// ================================================================
// KATEX UTILS v2.1 — ARVEXA School
// Rendu mathématique robuste, global, auto-injecté
// Utilisé par TOUTES les pages d'ARVEXA
// ================================================================

(function () {
  'use strict';

  if (window.__arvexaKatexInit) return;
  window.__arvexaKatexInit = true;

  // ═══════════════════════════════════════════════════════════════
  // MACROS UNIVERSELLES
  // ═══════════════════════════════════════════════════════════════
  const MACROS = {
    "\\R": "\\mathbb{R}",
    "\\N": "\\mathbb{N}",
    "\\Z": "\\mathbb{Z}",
    "\\Q": "\\mathbb{Q}",
    "\\C": "\\mathbb{C}",
    "\\Re": "\\operatorname{Re}",
    "\\Im": "\\operatorname{Im}",
    "\\arg": "\\operatorname{arg}",
    "\\card": "\\operatorname{card}",
    "\\Vect": "\\overrightarrow",
    "\\norm": "\\left\\|#1\\right\\|",
    "\\abs": "\\left|#1\\right|",
    "\\deriv": "\\frac{d#1}{d#2}",
    "\\derivn": "\\frac{d^{#1}#2}{d#3^{#1}}",
    "\\integral": "\\int_{#1}^{#2}",
    "\\limite": "\\lim_{#1 \\to #2}",
    "\\paren": "\\left(#1\\right)",
    "\\bracket": "\\left[#1\\right]",
    "\\set": "\\left\\{#1\\right\\}"
  };

  // ═══════════════════════════════════════════════════════════════
  // DÉLIMITEURS ÉTENDUS
  // ═══════════════════════════════════════════════════════════════
  const DELIMITERS = [
    { left: '$$', right: '$$', display: true },
    { left: '\\[', right: '\\]', display: true },
    { left: '$', right: '$', display: false },
    { left: '\\(', right: '\\)', display: false },
    { left: '\\begin{equation}', right: '\\end{equation}', display: true },
    { left: '\\begin{equation*}', right: '\\end{equation*}', display: true },
    { left: '\\begin{align}', right: '\\end{align}', display: true },
    { left: '\\begin{align*}', right: '\\end{align*}', display: true },
    { left: '\\begin{cases}', right: '\\end{cases}', display: true },
    { left: '\\begin{matrix}', right: '\\end{matrix}', display: true },
    { left: '\\begin{pmatrix}', right: '\\end{pmatrix}', display: true },
    { left: '\\begin{bmatrix}', right: '\\end{bmatrix}', display: true }
  ];

  // ═══════════════════════════════════════════════════════════════
  // NORMALISATION LATEX
  // ═══════════════════════════════════════════════════════════════
  function normalizeLatex(input) {
    if (!input || typeof input !== 'string') return '';
    let text = String(input);

    // Symboles Unicode → LaTeX
    const unicodeMap = {
      '×': '\\times', '÷': '\\div',
      '−': '-', '–': '-', '—': '-',
      '≠': '\\neq', '≤': '\\leq', '≥': '\\geq',
      '≈': '\\approx', '∞': '\\infty',
      '√': '\\sqrt', 'π': '\\pi',
      'θ': '\\theta', 'α': '\\alpha', 'β': '\\beta', 'γ': '\\gamma',
      'δ': '\\delta', 'Δ': '\\Delta',
      'λ': '\\lambda', 'μ': '\\mu', 'σ': '\\sigma', 'Σ': '\\Sigma',
      'φ': '\\phi', 'ω': '\\omega', 'Ω': '\\Omega',
      '∫': '\\int', '∑': '\\sum', '∂': '\\partial',
      '∈': '\\in', '∉': '\\notin', '⊂': '\\subset', '⊃': '\\supset',
      '∪': '\\cup', '∩': '\\cap',
      '∀': '\\forall', '∃': '\\exists',
      '⇒': '\\Rightarrow', '⇔': '\\Leftrightarrow',
      '→': '\\to', '↦': '\\mapsto',
      '⟹': '\\Longrightarrow', '⟺': '\\Longleftrightarrow',
      '±': '\\pm', '∓': '\\mp',
      '⋅': '\\cdot', '…': '\\ldots', '⋯': '\\cdots'
    };

    Object.keys(unicodeMap).forEach((symbol) => {
      text = text.split(symbol).join(unicodeMap[symbol]);
    });

    // ⚡ SUPPRESSION de la regex \d+/\d+ → \frac
    // Cette transformation cassait les textes français ("3/4 des élèves")

    // Exposants textuels
    text = text.replace(/([a-zA-Z0-9])\^(\d+)/g, '$1^{$2}');
    text = text.replace(/([a-zA-Z0-9])_(\d+)/g, '$1_{$2}');

    // Racines
    text = text.replace(/sqrt\(([^)]+)\)/g, '\\sqrt{$1}');

    // Fonctions trigonométriques
    const funcs = ['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh'];
    funcs.forEach((fn) => {
      const regex = new RegExp(`(?<![\\\\a-zA-Z])${fn}\\s*\\(`, 'g');
      text = text.replace(regex, `\\${fn}(`);
    });

    // ln, log, exp
    text = text.replace(/(?<![\\a-zA-Z])ln\s*\(/g, '\\ln(');
    text = text.replace(/(?<![\\a-zA-Z])log\s*\(/g, '\\log(');
    text = text.replace(/(?<![\\a-zA-Z])exp\s*\(/g, '\\exp(');

    // Limites
    text = text.replace(/lim\s+([a-zA-Z])\s*(?:→|\\to|->)\s*([^\s,;)]+)/g, '\\lim_{$1 \\to $2}');

    return text;
  }

  // ═══════════════════════════════════════════════════════════════
  // FIX DÉLIMITEURS
  // ═══════════════════════════════════════════════════════════════
  function fixDelimiters(text) {
    if (!text || typeof text !== 'string') return '';
    let result = text;

    // \( ... \) → $ ... $
    result = result.replace(/\\\((.+?)\\\)/gs, '$$$1$$');
    // \[ ... \] → $$ ... $$
    result = result.replace(/\\\[(.+?)\\\]/gs, '$$$$$1$$$$');
    // Corriger doubles délimiteurs
    result = result.replace(/\$\$\$+/g, '$$');

    return result;
  }

  // ═══════════════════════════════════════════════════════════════
  // CLEAN AI RESPONSE
  // ═══════════════════════════════════════════════════════════════
  function cleanAIResponse(text) {
    if (!text || typeof text !== 'string') return '';
    let cleaned = text;

    // Retirer blocs code markdown
    cleaned = cleaned.replace(/```(?:json|latex|math)?\s*/gi, '');
    cleaned = cleaned.replace(/```/g, '');

    // Retirer HTML dangereux
    cleaned = cleaned.replace(/<script[\s\S]*?<\/script>/gi, '');
    cleaned = cleaned.replace(/<style[\s\S]*?<\/style>/gi, '');

    // Normaliser LaTeX
    cleaned = normalizeLatex(cleaned);
    cleaned = fixDelimiters(cleaned);

    return cleaned;
  }

  // ═══════════════════════════════════════════════════════════════
  // FILTRE : nœud à ignorer ?
  // ═══════════════════════════════════════════════════════════════
  function shouldIgnoreNode(node) {
    if (!node || node.nodeType !== 1) return true;

    const tag = (node.tagName || '').toLowerCase();
    if (['script', 'style', 'noscript', 'textarea', 'pre', 'code', 'kbd', 'samp'].includes(tag)) {
      return true;
    }

    const cls = node.className || '';
    if (typeof cls === 'string') {
      if (cls.includes('katex') || cls.includes('no-katex') || cls.includes('katex-ignore')) {
        return true;
      }
    }

    // Vérifier parents
    let parent = node.parentElement;
    let depth = 0;
    while (parent && depth < 5) {
      if (parent.classList &&
          (parent.classList.contains('katex') ||
           parent.classList.contains('no-katex') ||
           parent.classList.contains('katex-ignore'))) {
        return true;
      }
      parent = parent.parentElement;
      depth++;
    }

    return false;
  }

  // ═══════════════════════════════════════════════════════════════
  // RENDU KATEX (config robuste)
  // ═══════════════════════════════════════════════════════════════
  function renderKaTeX(root, options = {}) {
    if (typeof renderMathInElement !== 'function') {
      setTimeout(() => renderKaTeX(root, options), 200);
      return;
    }

    const element = root || document.body;
    if (!element || !document.body.contains(element)) return;

    try {
      renderMathInElement(element, {
        delimiters: DELIMITERS,
        throwOnError: false,
        errorColor: '#ff9a84',
        strict: false,
        trust: false,          // ⚡ Sécurité : désactivé (pas de \href, \url, \includegraphics)
        maxSize: 50,
        maxExpand: 1000,
        macros: { ...MACROS, ...(options.macros || {}) },
        ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code', 'kbd', 'samp', 'option'],
        ignoredClasses: ['no-katex', 'katex-ignore', 'katex'],
        ...options
      });
    } catch (error) {
      console.warn('[KaTeX] render error:', error.message);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // RENDU SAFE (avec double-check)
  // ═══════════════════════════════════════════════════════════════
  function renderMathSafe(root) {
    if (!root) return;
    requestAnimationFrame(() => {
      renderKaTeX(root);
      // Double check pour injections tardives
      setTimeout(() => renderKaTeX(root), 250);
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // RENDU + NORMALISATION
  // ═══════════════════════════════════════════════════════════════
  function renderMath(root) {
    const element = root || document.body;

    // Normaliser les nœuds texte
    try {
      const walker = document.createTreeWalker(
        element,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode: (node) => {
            if (shouldIgnoreNode(node.parentElement)) return NodeFilter.FILTER_REJECT;
            const text = node.textContent;
            if (!text || !text.trim()) return NodeFilter.FILTER_REJECT;
            if (/\$|\\\(|\\\[/.test(text)) return NodeFilter.FILTER_ACCEPT;
            return NodeFilter.FILTER_REJECT;
          }
        }
      );
      const nodes = [];
      let node;
      while ((node = walker.nextNode())) nodes.push(node);
      nodes.forEach((n) => {
        const fixed = fixDelimiters(n.textContent);
        if (fixed !== n.textContent) n.textContent = fixed;
      });
    } catch (e) { /* silent */ }

    renderKaTeX(element);
  }

  // ═══════════════════════════════════════════════════════════════
  // AUTO-RENDER — MutationObserver
  // ═══════════════════════════════════════════════════════════════
  let observerTimer = null;

  function hasLatexContent(node) {
    if (!node || node.nodeType !== 1) return false;
    const text = node.textContent || '';
    return text.includes('$') || text.includes('\\(') || text.includes('\\[');
  }

  function initAutoRender() {
    if (!window.MutationObserver) return;
    if (window.__arvexaKatexObserver) return;
    if (window.__arvexaKatexDisabled) {
      console.log('📐 KaTeX auto-render désactivé');
      return;
    }

    const observer = new MutationObserver((mutations) => {
      const targets = new Set();

      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType !== 1) return;
          if (shouldIgnoreNode(node)) return;
          if (hasLatexContent(node)) {
            targets.add(node);
          }
        });
      });

      if (targets.size === 0) return;

      // Debounce
      if (observerTimer) clearTimeout(observerTimer);
      observerTimer = setTimeout(() => {
        targets.forEach((target) => {
          if (document.body.contains(target)) {
            renderKaTeX(target);
          }
        });
      }, 100);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    window.__arvexaKatexObserver = observer;
    console.log('📐 KaTeX auto-render activé');
  }

  // ═══════════════════════════════════════════════════════════════
  // EXPORT GLOBAL
  // ═══════════════════════════════════════════════════════════════
  window.KaTeXUtils = {
    normalizeLatex,
    fixDelimiters,
    cleanAIResponse,
    renderMath,
    renderMathSafe,
    renderKaTeX,
    initAutoRender,
    MACROS,
    DELIMITERS,

    // Raccourci pour désactiver l'auto-render
    disableAutoRender: () => {
      window.__arvexaKatexDisabled = true;
      if (window.__arvexaKatexObserver) {
        window.__arvexaKatexObserver.disconnect();
        window.__arvexaKatexObserver = null;
      }
    }
  };

  // ═══════════════════════════════════════════════════════════════
  // AUTO-INIT
  // ═══════════════════════════════════════════════════════════════
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initAutoRender();
    });
  } else {
    initAutoRender();
  }

  console.log('📐 KaTeXUtils v2.1 chargé');
})();
