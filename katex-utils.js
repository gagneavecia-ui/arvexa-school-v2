// ================================================================
// KATEX UTILS v2.2 — ARVEXA School
// Rendu mathématique robuste, global, auto-injecté
// + Détection LaTeX orphelin (commandes connues)
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
  // ✅ FIX 1.1 — Commandes LaTeX connues (détection orphelin)
  // ═══════════════════════════════════════════════════════════════
  const KNOWN_LATEX_COMMANDS = new Set([
    // Grec
    'alpha','beta','gamma','delta','epsilon','varepsilon','zeta','eta','theta','vartheta',
    'iota','kappa','lambda','mu','nu','xi','pi','rho','sigma','varsigma','tau','upsilon',
    'phi','varphi','chi','psi','omega','Gamma','Delta','Theta','Lambda','Xi','Pi','Sigma',
    'Upsilon','Phi','Psi','Omega',
    // Opérateurs
    'times','div','pm','mp','cdot','cdotp','ast','star','bullet','circ','oplus','otimes','odot',
    // Relations
    'leq','geq','neq','approx','equiv','cong','sim','simeq','propto','ll','gg',
    // Ensembles
    'in','notin','ni','subset','supset','subseteq','supseteq','cup','cap','emptyset',
    'forall','exists','nexists','neg','wedge','vee',
    // Grands opérateurs
    'sum','prod','int','oint','partial','nabla','infty','aleph','ell','hbar',
    // Fonctions
    'sin','cos','tan','cot','sec','csc','arcsin','arccos','arctan','sinh','cosh','tanh',
    'log','ln','exp','lim','max','min','det','mod','gcd','lcm',
    // Structures
    'frac','dfrac','tfrac','cfrac','sqrt','binom','choose','pmod','bmod','operatorname',
    // Délimiteurs
    'left','right','big','Big','bigg','Bigg','langle','rangle','lceil','rceil','lfloor','rfloor',
    'Vert','vert','parallel','nparallel','perp',
    // Décorations
    'overline','underline','vec','hat','bar','dot','ddot','tilde','widehat','widetilde',
    // Environnements
    'begin','end',
    // Espacement
    'quad','qquad','hspace','vspace',
    // Typographie
    'text','mathrm','mathbf','mathit','mathbb','mathcal','mathfrak','displaystyle','textstyle',
    // Divers
    'ldots','cdots','vdots','ddots','prime','backprime','degree','celsius',
    // Flèches
    'to','leftarrow','rightarrow','leftrightarrow','uparrow','downarrow','updownarrow',
    'Rightarrow','Leftarrow','Leftrightarrow','Longrightarrow','Longleftarrow','Longleftrightarrow',
    'mapsto','hookrightarrow','hookleftarrow','nearrow','searrow','swarrow','nwarrow',
    'rightleftharpoons','leftrightharpoons','longrightarrow','longleftarrow',
    'implies','impliedby','iff','leqslant','geqslant','varnothing','setminus',
    'dagger','ddagger'
  ]);

  function containsKnownLatex(text) {
    if (!text) return false;
    const re = /\\([a-zA-Z]+)/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      if (KNOWN_LATEX_COMMANDS.has(m[1])) return true;
    }
    return false;
  }

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

    text = text.replace(/([a-zA-Z0-9])\^(\d+)/g, '$1^{$2}');
    text = text.replace(/([a-zA-Z0-9])_(\d+)/g, '$1_{$2}');

    text = text.replace(/sqrt\(([^)]+)\)/g, '\\sqrt{$1}');

    const funcs = ['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh'];
    funcs.forEach((fn) => {
      const regex = new RegExp(`(?<![\\\\a-zA-Z])${fn}\\s*\\(`, 'g');
      text = text.replace(regex, `\\${fn}(`);
    });

    text = text.replace(/(?<![\\a-zA-Z])ln\s*\(/g, '\\ln(');
    text = text.replace(/(?<![\\a-zA-Z])log\s*\(/g, '\\log(');
    text = text.replace(/(?<![\\a-zA-Z])exp\s*\(/g, '\\exp(');

    text = text.replace(/lim\s+([a-zA-Z])\s*(?:→|\\to|->)\s*([^\s,;)]+)/g, '\\lim_{$1 \\to $2}');

    return text;
  }

  // ═══════════════════════════════════════════════════════════════
  // FIX DÉLIMITEURS
  // ═══════════════════════════════════════════════════════════════
  function fixDelimiters(text) {
    if (!text || typeof text !== 'string') return '';
    let result = text;

    result = result.replace(/\\\((.+?)\\\)/gs, '$$$1$$');
    result = result.replace(/\\\[(.+?)\\\]/gs, '$$$$$1$$$$');
    result = result.replace(/\$\$\$+/g, '$$');

    return result;
  }

  // ═══════════════════════════════════════════════════════════════
  // CLEAN AI RESPONSE
  // ═══════════════════════════════════════════════════════════════
  function cleanAIResponse(text) {
    if (!text || typeof text !== 'string') return '';
    let cleaned = text;

    cleaned = cleaned.replace(/```(?:json|latex|math)?\s*/gi, '');
    cleaned = cleaned.replace(/```/g, '');
    cleaned = cleaned.replace(/<script[\s\S]*?<\/script>/gi, '');
    cleaned = cleaned.replace(/<style[\s\S]*?<\/style>/gi, '');

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
        trust: false,
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
      setTimeout(() => renderKaTeX(root), 250);
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // RENDU + NORMALISATION
  // ═══════════════════════════════════════════════════════════════
  function renderMath(root) {
    const element = root || document.body;

    try {
      const walker = document.createTreeWalker(
        element,
        NodeFilter.SHOW_TEXT,
        {
          // ✅ FIX 1.3 — Accepter les commandes LaTeX orphelines connues
          acceptNode: (node) => {
            if (shouldIgnoreNode(node.parentElement)) return NodeFilter.FILTER_REJECT;
            const text = node.textContent;
            if (!text || !text.trim()) return NodeFilter.FILTER_REJECT;
            if (/\$|\\\(|\\\[/.test(text) || containsKnownLatex(text)) {
              return NodeFilter.FILTER_ACCEPT;
            }
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

  // ✅ FIX 1.2 — Détection élargie aux commandes LaTeX connues
  function hasLatexContent(node) {
    if (!node || node.nodeType !== 1) return false;
    const text = node.textContent || '';
    return /\$|\\\(|\\\[/.test(text) || containsKnownLatex(text);
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
    containsKnownLatex,
    MACROS,
    DELIMITERS,
    KNOWN_LATEX_COMMANDS,

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

  console.log('📐 KaTeXUtils v2.2 chargé');
})();
