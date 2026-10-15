// ================================================================
// KATEX UTILS v3.0 — ARVEXA School
// Rendu mathématique robuste, global, auto-injecté
// + Détection LaTeX orphelin élargie
// + Conversion Unicode exhaustive
// + Réparation délimiteurs cassés
// + Extraction commandes LaTeX dans \text{...}
// + Nettoyage unités avec virgules
// + Fallback visuel si KaTeX échoue
// ================================================================

(function () {
  'use strict';

  if (window.__arvexaKatexInit) return;
  window.__arvexaKatexInit = true;

  // ═══════════════════════════════════════════════════════════════
  // 1. MACROS UNIVERSAL
  // ═══════════════════════════════════════════════════════════════
  const MACROS = {
    // Ensembles
    "\\R": "\\mathbb{R}",
    "\\N": "\\mathbb{N}",
    "\\Z": "\\mathbb{Z}",
    "\\Q": "\\mathbb{Q}",
    "\\C": "\\mathbb{C}",
    "\\K": "\\mathbb{K}",
    "\\P": "\\mathbb{P}",
    // Opérateurs classiques
    "\\Re": "\\operatorname{Re}",
    "\\Im": "\\operatorname{Im}",
    "\\arg": "\\operatorname{arg}",
    "\\card": "\\operatorname{card}",
    "\\Card": "\\operatorname{Card}",
    "\\Ker": "\\operatorname{Ker}",
    "\\Img": "\\operatorname{Im}",
    "\\Vect": "\\operatorname{Vect}",
    "\\rg": "\\operatorname{rg}",
    "\\tr": "\\operatorname{tr}",
    "\\grad": "\\operatorname{grad}",
    "\\divergence": "\\operatorname{div}",
    "\\rot": "\\operatorname{rot}",
    // Vecteurs et normes
    "\\norm": "\\left\\|#1\\right\\|",
    "\\norme": "\\left\\|#1\\right\\|",
    "\\abs": "\\left|#1\\right|",
    "\\valabs": "\\left|#1\\right|",
    // Dérivées et intégrales
    "\\deriv": "\\frac{d#1}{d#2}",
    "\\derivn": "\\frac{d^{#1}#2}{d#3^{#1}}",
    "\\derivp": "\\frac{\\partial #1}{\\partial #2}",
    "\\integral": "\\int_{#1}^{#2}",
    "\\limite": "\\lim_{#1 \\to #2}",
    // Délimiteurs
    "\\paren": "\\left(#1\\right)",
    "\\bracket": "\\left[#1\\right]",
    "\\brace": "\\left\\{#1\\right\\}",
    "\\set": "\\left\\{#1\\right\\}",
    "\\interval": "\\left[#1, #2\\right]",
    "\\intervalo": "\\left]#1, #2\\right[",
    // Physique
    "\\ii": "\\mathrm{i}",
    "\\jj": "\\mathrm{j}",
    "\\kk": "\\mathrm{k}",
    "\\unite": "\\,\\text{#1}",
    "\\unites": "\\,\\text{#1}",
    // Chimie
    "\\mol": "\\text{mol}",
    "\\pH": "\\text{pH}",
    // Divers
    "\\e": "\\mathrm{e}",
    "\\eps": "\\varepsilon",
    "\\phi": "\\varphi",
    "\\dt": "\\Delta t",
    "\\dx": "\\Delta x",
    "\\dv": "\\Delta v"
  };

  // ═══════════════════════════════════════════════════════════════
  // 2. COMMANDES LATEX CONNUES
  // ═══════════════════════════════════════════════════════════════
  const KNOWN_LATEX_COMMANDS = new Set([
    // Grec
    'alpha','beta','gamma','delta','epsilon','varepsilon','zeta','eta','theta','vartheta',
    'iota','kappa','lambda','mu','nu','xi','pi','varpi','rho','varrho','sigma','varsigma',
    'tau','upsilon','phi','varphi','chi','psi','omega',
    'Gamma','Delta','Theta','Lambda','Xi','Pi','Sigma','Upsilon','Phi','Psi','Omega',
    // Opérateurs
    'times','div','pm','mp','cdot','cdotp','ast','star','bullet','circ','oplus','otimes',
    'odot','ominus','oslash','bigcirc',
    // Relations
    'leq','geq','neq','ne','approx','equiv','cong','sim','simeq','propto','ll','gg',
    'leqslant','geqslant','lesssim','gtrsim','prec','succ','preceq','succeq',
    // Ensembles
    'in','notin','ni','owns','subset','supset','subseteq','supseteq','subsetneq',
    'supsetneq','cup','cap','emptyset','varnothing','setminus','sqcup','sqcap',
    // Logique
    'forall','exists','nexists','neg','lnot','wedge','land','vee','lor','top','bot',
    'vdash','dashv','models','vDash','nvdash',
    // Grands opérateurs
    'sum','prod','coprod','int','iint','iiint','oint','partial','nabla','infty',
    'aleph','beth','gimel','daleth','ell','hbar','imath','jmath','wp',
    // Fonctions
    'sin','cos','tan','cot','sec','csc','arcsin','arccos','arctan',
    'sinh','cosh','tanh','coth','log','ln','lg','exp','lim','limsup','liminf',
    'max','min','sup','inf','det','dim','ker','deg','gcd','hom','arg','mod','bmod','pmod',
    // Structures
    'frac','dfrac','tfrac','cfrac','sqrt','binom','dbinom','tbinom','choose','genfrac',
    'operatorname','overset','underset','stackrel',
    // Délimiteurs
    'left','right','big','Big','bigg','Bigg','bigl','bigr','Bigl','Bigr','biggl','biggr',
    'Biggl','Biggr','middle','langle','rangle','lceil','rceil','lfloor','rfloor',
    'lbrace','rbrace','lbrack','rbrack','vert','Vert','parallel','nparallel',
    'perp','backslash',
    // Décorations
    'overline','underline','underbrace','overbrace','vec','hat','bar','dot','ddot',
    'dddot','ddddot','tilde','widetilde','widehat','overrightarrow','overleftarrow',
    'overleftrightarrow','underrightarrow','underleftarrow','boxed','fbox','cancel',
    'bcancel','xcancel','sout','not',
    // Environnements
    'begin','end',
    // Espacement
    'quad','qquad','enspace','hspace','vspace','thinspace','medspace','thickspace',
    'negthinspace','negmedspace','negthickspace',
    // Typographie
    'text','textrm','textsf','texttt','textnormal','textup','textsl','textsc',
    'mathrm','mathbf','mathit','mathsf','mathtt','mathbb','mathcal','mathscr',
    'mathfrak','boldsymbol','bm','pmb','displaystyle','textstyle','scriptstyle',
    'scriptscriptstyle','limits','nolimits',
    // Divers
    'ldots','cdots','vdots','ddots','idotsint','prime','backprime','degree','celsius',
    'micro','perthousand','copyright','pounds','yen','euro',
    // Flèches
    'to','gets','leftarrow','rightarrow','leftrightarrow','Leftarrow','Rightarrow',
    'Leftrightarrow','uparrow','downarrow','updownarrow','Uparrow','Downarrow',
    'Updownarrow','mapsto','longmapsto','longleftarrow','longrightarrow',
    'longleftrightarrow','Longleftarrow','Longrightarrow','Longleftrightarrow',
    'hookrightarrow','hookleftarrow','twoheadrightarrow','twoheadleftarrow',
    'rightharpoonup','rightharpoondown','leftharpoonup','leftharpoondown',
    'rightleftharpoons','leftrightharpoons','nearrow','searrow','swarrow','nwarrow',
    'implies','impliedby','iff','leadsto',
    // Symboles divers
    'dagger','ddagger','checkmark','maltese','flat','natural','sharp',
    'clubsuit','diamondsuit','heartsuit','spadesuit',
    'triangle','triangledown','triangleleft','triangleright','square','blacksquare',
    'lozenge','blacklozenge','bigstar','circledast','circledcirc','circleddash',
    'angstrom'
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
  // 3. DÉLIMITEURS ÉTENDUS
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
    { left: '\\begin{aligned}', right: '\\end{aligned}', display: true },
    { left: '\\begin{cases}', right: '\\end{cases}', display: true },
    { left: '\\begin{matrix}', right: '\\end{matrix}', display: true },
    { left: '\\begin{pmatrix}', right: '\\end{pmatrix}', display: true },
    { left: '\\begin{bmatrix}', right: '\\end{bmatrix}', display: true },
    { left: '\\begin{vmatrix}', right: '\\end{vmatrix}', display: true },
    { left: '\\begin{Vmatrix}', right: '\\end{Vmatrix}', display: true },
    { left: '\\begin{array}', right: '\\end{array}', display: true },
    { left: '\\begin{gather}', right: '\\end{gather}', display: true },
    { left: '\\begin{gather*}', right: '\\end{gather*}', display: true },
    { left: '\\begin{smallmatrix}', right: '\\end{smallmatrix}', display: true },
    { left: '\\begin{multline}', right: '\\end{multline}', display: true },
    { left: '\\begin{split}', right: '\\end{split}', display: true }
  ];

  // ═══════════════════════════════════════════════════════════════
  // 4. TABLE UNICODE → LATEX (exhaustive)
  // ═══════════════════════════════════════════════════════════════
  const UNICODE_MAP = {
    // Grec minuscules
    'α': '\\alpha ', 'β': '\\beta ', 'γ': '\\gamma ', 'δ': '\\delta ',
    'ε': '\\epsilon ', 'ϵ': '\\epsilon ', 'ζ': '\\zeta ', 'η': '\\eta ',
    'θ': '\\theta ', 'ϑ': '\\vartheta ', 'ι': '\\iota ', 'κ': '\\kappa ',
    'λ': '\\lambda ', 'μ': '\\mu ', 'ν': '\\nu ', 'ξ': '\\xi ',
    'π': '\\pi ', 'ϖ': '\\varpi ', 'ρ': '\\rho ', 'ϱ': '\\varrho ',
    'σ': '\\sigma ', 'ς': '\\varsigma ', 'τ': '\\tau ', 'υ': '\\upsilon ',
    'φ': '\\phi ', 'ϕ': '\\varphi ', 'χ': '\\chi ', 'ψ': '\\psi ', 'ω': '\\omega ',
    // Grec majuscules
    'Γ': '\\Gamma ', 'Δ': '\\Delta ', 'Θ': '\\Theta ', 'Λ': '\\Lambda ',
    'Ξ': '\\Xi ', 'Π': '\\Pi ', 'Σ': '\\Sigma ', 'Υ': '\\Upsilon ',
    'Φ': '\\Phi ', 'Ψ': '\\Psi ', 'Ω': '\\Omega ',
    // Opérateurs
    '×': '\\times ', '÷': '\\div ', '±': '\\pm ', '∓': '\\mp ',
    '·': '\\cdot ', '⋅': '\\cdot ', '∘': '\\circ ', '∗': '\\ast ',
    '⋆': '\\star ', '∙': '\\bullet ', '⊕': '\\oplus ', '⊖': '\\ominus ',
    '⊗': '\\otimes ', '⊘': '\\oslash ', '⊙': '\\odot ', '⊚': '\\circledcirc ',
    '†': '\\dagger ', '‡': '\\ddagger ',
    // Relations
    '≤': '\\leq ', '≥': '\\geq ', '≠': '\\neq ', '≈': '\\approx ',
    '≡': '\\equiv ', '≅': '\\cong ', '∼': '\\sim ', '≃': '\\simeq ',
    '∝': '\\propto ', '≪': '\\ll ', '≫': '\\gg ', '≦': '\\leq ',
    '≧': '\\geq ', '≲': '\\lesssim ', '≳': '\\gtrsim ',
    '≺': '\\prec ', '≻': '\\succ ', '⪯': '\\preceq ', '⪰': '\\succeq ',
    // Ensembles
    '∈': '\\in ', '∉': '\\notin ', '∋': '\\ni ', '∌': '\\not\\ni ',
    '⊂': '\\subset ', '⊃': '\\supset ', '⊆': '\\subseteq ', '⊇': '\\supseteq ',
    '⊄': '\\not\\subset ', '⊅': '\\not\\supset ',
    '⊈': '\\nsubseteq ', '⊉': '\\nsupseteq ',
    '∪': '\\cup ', '∩': '\\cap ', '∅': '\\emptyset ', '∖': '\\setminus ',
    '⊔': '\\sqcup ', '⊓': '\\sqcap ',
    // Logique
    '∀': '\\forall ', '∃': '\\exists ', '∄': '\\nexists ',
    '¬': '\\neg ', '∧': '\\wedge ', '∨': '\\vee ',
    '⊢': '\\vdash ', '⊣': '\\dashv ', '⊨': '\\models ',
    '⊤': '\\top ', '⊥': '\\bot ',
    // Grands opérateurs
    '∑': '\\sum ', '∏': '\\prod ', '∐': '\\coprod ', '∫': '\\int ',
    '∬': '\\iint ', '∭': '\\iiint ', '∮': '\\oint ',
    '∂': '\\partial ', '∇': '\\nabla ', '√': '\\sqrt ',
    // Symboles spéciaux
    '∞': '\\infty ', 'ℵ': '\\aleph ', 'ℶ': '\\beth ', 'ℷ': '\\gimel ',
    'ℓ': '\\ell ', 'ℏ': '\\hbar ', 'ℜ': '\\Re ', 'ℑ': '\\Im ',
    '℘': '\\wp ', 'ı': '\\imath ', 'ȷ': '\\jmath ',
    '°': '^{\\circ} ', '′': "'", '″': "''", '‴': "'''",
    '‰': '\\text{‰} ', '§': '\\text{§} ', '¶': '\\text{¶} ',
    '€': '\\text{€} ', '£': '\\text{£} ', '¥': '\\text{¥} ',
    '©': '\\text{©} ', '®': '\\text{®} ', '™': '\\text{™} ',
    // Divers
    '◆': '\\blacklozenge ', '◇': '\\lozenge ', '■': '\\blacksquare ',
    '□': '\\square ', '▲': '\\blacktriangle ', '△': '\\triangle ',
    '▼': '\\blacktriangledown ', '▽': '\\triangledown ',
    '◀': '\\blacktriangleleft ', '▶': '\\blacktriangleright ',
    '★': '\\bigstar ', '☆': '\\star ', '✓': '\\checkmark ',
    '♣': '\\clubsuit ', '♦': '\\diamondsuit ',
    '♡': '\\heartsuit ', '♠': '\\spadesuit ',
    // Chimie et physique
    '⇌': '\\rightleftharpoons ', '⇋': '\\leftrightharpoons ',
    '⟶': '\\longrightarrow ', '⟵': '\\longleftarrow ',
    'Å': '\\text{Å} ', '℃': '\\text{°C} ',
    // Flèches
    '→': '\\to ', '←': '\\leftarrow ', '↔': '\\leftrightarrow ',
    '↑': '\\uparrow ', '↓': '\\downarrow ', '↕': '\\updownarrow ',
    '⇑': '\\Uparrow ', '⇓': '\\Downarrow ', '⇕': '\\Updownarrow ',
    '⇒': '\\Rightarrow ', '⇐': '\\Leftarrow ', '⇔': '\\Leftrightarrow ',
    '⟹': '\\Longrightarrow ', '⟸': '\\Longleftarrow ', '⟺': '\\Longleftrightarrow ',
    '↦': '\\mapsto ', '⟼': '\\longmapsto ',
    '↪': '\\hookrightarrow ', '↩': '\\hookleftarrow ',
    '↠': '\\twoheadrightarrow ', '↞': '\\twoheadleftarrow ',
    '⇀': '\\rightharpoonup ', '⇁': '\\rightharpoondown ',
    '↼': '\\leftharpoonup ', '↽': '\\leftharpoondown ',
    '↗': '\\nearrow ', '↘': '\\searrow ', '↙': '\\swarrow ', '↖': '\\nwarrow ',
    '⤳': '\\leadsto ', '⟾': '\\implies ',
    // Barre
    '¯': '\\bar{}', 'ˉ': '\\bar{}',
    // Musique
    '♭': '\\flat ', '♮': '\\natural ', '♯': '\\sharp '
  };

  // ═══════════════════════════════════════════════════════════════
  // 5. EXPOSANTS ET INDICES UNICODE
  // ═══════════════════════════════════════════════════════════════
  const SUPERSCRIPT_MAP = {
    '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4',
    '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9',
    '⁺': '+', '⁻': '-', '⁼': '=', '⁽': '(', '⁾': ')',
    'ⁿ': 'n', 'ⁱ': 'i'
  };

  const SUBSCRIPT_MAP = {
    '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4',
    '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9',
    '₊': '+', '₋': '-', '₌': '=', '₍': '(', '₎': ')',
    'ₐ': 'a', 'ₑ': 'e', 'ₒ': 'o', 'ₓ': 'x', 'ₕ': 'h',
    'ₖ': 'k', 'ₗ': 'l', 'ₘ': 'm', 'ₙ': 'n', 'ₚ': 'p',
    'ₛ': 's', 'ₜ': 't', 'ᵢ': 'i', 'ⱼ': 'j'
  };

  // ═══════════════════════════════════════════════════════════════
  // 6. DÉTECTION UNICODE MATHÉMATIQUE
  // ═══════════════════════════════════════════════════════════════
  const HAS_UNICODE_MATH_REGEX = /[α-ωΑ-Ω×÷±∓·⋅∘∗⋆∙⊕⊗⊖⊘⊙≤≥≠≈≡≅∼≃∝≪≫∈∉∋⊂⊃⊆⊇⊄⊅⊈⊉∪∩∅∖⊔⊓∀∃∄¬∧∨⊢⊣⊨⊤⊥∑∏∐∫∬∭∮∂∇√∞ℵℶℷℓℏℜℑ℘°′″‴‰§¶€£¥©®™◆◇■□▲△▼▽◀▶★☆✓♣♦♡♠⇌⇋⟶⟵Å℃→←↔↑↓↕⇑⇓⇕⇒⇐⇔⟹⟸⟺↦⟼↪↩↠↞⇀⇁↼↽↗↘↙↖⤳⟾⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿⁱ₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎]/;

  function hasUnicodeMath(text) {
    if (!text || typeof text !== 'string') return false;
    return HAS_UNICODE_MATH_REGEX.test(text);
  }

  // ═══════════════════════════════════════════════════════════════
  // 7. FONCTIONS DE NETTOYAGE
  // ═══════════════════════════════════════════════════════════════

  // ─── 7.1 : Exposants/indices Unicode → LaTeX ───
  function replaceUnicodeScripts(text) {
    if (!text || typeof text !== 'string') return text;
    let r = text;

    // Exposants : x² → x^{2}, x²y³ → x^{2}y^{3}
    r = r.replace(/([a-zA-Z0-9}\)\]_\}])([⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿⁱ]+)/g, (m, base, sups) => {
      const conv = sups.split('').map((c) => SUPERSCRIPT_MAP[c] || c).join('');
      return `${base}^{${conv}}`;
    });

    // Indices : x₀ → x_{0}, H₂O → H_{2}O
    r = r.replace(/([a-zA-Z0-9}\)\]\}])([₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₐₑₒₓₕₖₗₘₙₚₛₜᵢⱼ]+)/g, (m, base, subs) => {
      const conv = subs.split('').map((c) => SUBSCRIPT_MAP[c] || c).join('');
      return `${base}_{${conv}}`;
    });

    return r;
  }

  // ─── 7.2 : Unicode → LaTeX (hors formules) ───
  function replaceUnicodeMath(text) {
    if (!text || typeof text !== 'string') return text;

    const parts = text.split(/(\$\$[\s\S]*?\$\$|\$[^$\n]+\$)/g);

    return parts.map((part, i) => {
      if (i % 2 === 1) return part;

      let r = part;
      for (const [uni, latex] of Object.entries(UNICODE_MAP)) {
        if (r.indexOf(uni) !== -1) {
          r = r.split(uni).join(latex);
        }
      }
      return r;
    }).join('');
  }

  // ─── 7.3 : Corriger les commandes collées au texte ───
  function fixCommandSpacing(text) {
    if (!text || typeof text !== 'string') return text;

    const cmdList = Array.from(KNOWN_LATEX_COMMANDS)
      .filter(c => /^[a-zA-Z]+$/.test(c))
      .sort((a, b) => b.length - a.length);

    if (cmdList.length === 0) return text;

    const regex = new RegExp(`(\\\\${cmdList.join('|\\\\')})(?=[a-zA-Z0-9])`, 'g');

    return text.replace(regex, '$1 ');
  }

  // ─── 7.4 : EXTRAIRE les commandes LaTeX piégées dans \text{...} ───
  // Exemple : \text{g\,mol^{-1}} → \text{g}\,\text{mol}^{-1}
  function fixTextInternals(text) {
    if (!text || typeof text !== 'string') return text;

    let r = text;

    // Plusieurs passes pour traiter les imbrications simples
    for (let pass = 0; pass < 3; pass++) {
      const before = r;

      r = r.replace(/\\text\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g, (match, inner) => {
        // Si pas de commande LaTeX ni exposant/indice dedans, rien à faire
        if (!/\\[a-zA-Z]|[_^]/.test(inner)) return match;
        // Si l'intérieur contient déjà \text{...}, ne pas toucher (imbrication)
        if (/\\text\{/.test(inner)) return match;

        // Découper sur les frontières : \, \; \: \! \quad, et exposants/indices
        let parts = inner
          // Insérer un séparateur avant \, \; \: \! \quad \qquad
          .replace(/\\(,|;|:|!|quad|qquad|thinspace|enspace|medspace|thickspace|negthinspace|negmedspace|negthickspace)/g,
                   '\u0001\\$1\u0001')
          // Insérer un séparateur avant ^ ou _
          .replace(/([_^])/g, '\u0001$1')
          .split('\u0001')
          .map(s => s.trim())
          .filter(Boolean);

        if (parts.length <= 1) return match;

        // Reconstruire : \text{mot} pour les mots, \cmd pour les commandes
        let result = '';
        for (const part of parts) {
          if (/^\\[a-zA-Z]/.test(part) && !/^\\text\{/.test(part)) {
            // C'est une commande (\ , \quad, \, etc.) → hors \text
            result += part + ' ';
          } else if (/^[_^]/.test(part)) {
            // Exposant ou indice isolé → accrocher au token précédent
            result = result.replace(/\s*$/, '') + part + ' ';
          } else {
            // Mot normal → dans \text{...}
            result += `\\text{${part}}\\,`;
          }
        }

        // Nettoyer le \, final
        result = result.replace(/\\,\s*$/, '');
        // Nettoyer les espaces multiples
        result = result.replace(/\s+/g, ' ');
        return result;
      });

      if (before === r) break;
    }

    return r;
  }

  // ─── 7.5 : Corriger les unités avec virgule ───
  // Exemple : \text{g,L^{-1}} → \text{g}\cdot\text{L}^{-1}
  function fixUnitCommas(text) {
    if (!text || typeof text !== 'string') return text;

    let r = text;

    // \text{a,b} → \text{a}\cdot\text{b} (uniquement si a et b sont des unités courtes)
    r = r.replace(/\\text\{([a-zA-Z]{1,6}),\s*([a-zA-Z]{1,6})([_^]?)\}/g, (match, a, b, script) => {
      return `\\text{${a}}\\cdot\\text{${b}}${script}`;
    });

    // \text{a,b^{-1}} → \text{a}\cdot\text{b}^{-1}
    r = r.replace(/\\text\{([a-zA-Z]{1,6}),\s*([a-zA-Z]{1,6})([_^]\{[^{}]+\})\}/g, (match, a, b, script) => {
      return `\\text{${a}}\\cdot\\text{${b}}${script}`;
    });

    // \text{mol,L^{-1}} déjà capturé ci-dessus
    // Cas : \text{a , b} avec espaces
    r = r.replace(/\\text\{([a-zA-Z]{1,6})\s*,\s*([a-zA-Z]{1,6})([_^]?)\}/g, (match, a, b, script) => {
      return `\\text{${a}}\\cdot\\text{${b}}${script}`;
    });

    return r;
  }

  // ─── 7.6 : Supprimer les parenthèses orphelines en fin ───
  function fixOrphanParens(text) {
    if (!text || typeof text !== 'string') return text;
    let r = text;

    // Formule LaTeX terminée par ) orpheline
    r = r.replace(/(\\[a-zA-Z]+(?:\{[^{}]*\})*(?:[_^](?:\{[^{}]*\}|[a-zA-Z0-9]))*[^)()\n]*)\)\s*(?=[.,;:!?\n]|$)/g,
      (match) => match.slice(0, -1));

    return r;
  }

  // ─── 7.7 : Normaliser les délimiteurs ───
  function normalizeDelimiters(text) {
    if (!text || typeof text !== 'string') return text;
    let r = text;

    // \( ... \) → $ ... $
    r = r.replace(/\\\(([\s\S]*?)\\\)/g, (m, inner) => `$${inner.trim()}$`);

    // \[ ... \] → $$ ... $$
    r = r.replace(/\\\[([\s\S]*?)\\\]/g, (m, inner) => `$$${inner.trim()}$$`);

    // \begin{equation} ... \end{equation} → $$ ... $$
    r = r.replace(/\\begin\{(?:equation|align|gather)\*?\}([\s\S]*?)\\end\{(?:equation|align|gather)\*?\}/g,
                  (m, inner) => `$$${inner.trim()}$$`);

    return r;
  }

  // ─── 7.8 : Nettoyer les délimiteurs cassés ───
  function cleanBrokenDelimiters(text) {
    if (!text || typeof text !== 'string') return text;
    let r = text;

    r = r.replace(/\${6,}/g, '$$$$');
    r = r.replace(/\${5}/g, '$$$$');
    r = r.replace(/\${3}/g, '$$');
    r = r.replace(/\$\s*\$/g, ' ');
    r = r.replace(/\$\$\s*\$\$/g, ' ');

    return r;
  }

  // ─── 7.9 : Encadrer le LaTeX orphelin (EN BLOG, pas commande par commande) ───
  function wrapOrphanLatex(text) {
    if (!text || typeof text !== 'string') return text;
    if (!/\\[a-zA-Z]/.test(text)) return text;

    const parts = text.split(/(\$\$[\s\S]*?\$\$|\$[^$\n]+\$)/g);

    return parts.map((part, i) => {
      if (i % 2 === 1) return part;
      return wrapSegmentLatex(part);
    }).join('');
  }

  // ─── 7.10 : Encadrer un segment LaTeX orphelin ───
  function wrapSegmentLatex(segment) {
    if (!segment) return segment;
    if (!/\\[a-zA-Z]/.test(segment)) return segment;

    let r = segment;

    // ═══ ÉTAPE 0 : préserver les environnements complets ═══
    r = r.replace(
      /\\begin\{([a-zA-Z*]+)\}([\s\S]*?)\\end\{\1\}/g,
      (match) => ` $$${match}$$ `
    );

    // ═══ ÉTAPE 1 : détecter les formules multi-tokens ═══
    // Pattern : suite de commandes LaTeX, symboles math, opérateurs
    // On capture des blocs "expression" qui contiennent au moins une commande
    const exprPattern = /(\\[a-zA-Z]+(?:\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})?(?:[_^](?:\{[^{}]*\}|[a-zA-Z0-9]))?(?:\s*[=+\-*/<>()\[\]{}.,]+\s*\\?[a-zA-Z0-9]*\\?[a-zA-Z]*)*)/g;

    // On va encadrer les blocs multi-tokens
    r = r.replace(
      /((?:[a-zA-Z0-9()\[\]{}\s=+\-*/<>.,]|\\(?:[a-zA-Z]+\*?(?:\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})?|[,;:!]|\\|\s|quad|qquad|thinspace|enspace|medspace|thickspace|negthinspace|negmedspace|negthickspace))+)/g,
      (match) => {
        // Ne toucher qu'aux blocs contenant au moins une commande LaTeX
        if (!/\\[a-zA-Z]/.test(match)) return match;
        // Ne pas toucher les URLs
        if (/^https?:\/\//.test(match)) return match;
        // Ne pas toucher les mots simples avec juste un backslash isolé en fin
        if (match.length < 3) return match;
        return ` $$${match.trim()}$$ `;
      }
    );

    // ═══ ÉTAPE 2 : fusionner les $...$ adjacents ═══
    for (let iteration = 0; iteration < 8; iteration++) {
      const before = r;
      r = r.replace(
        /\$\s*([^$]*?)\s*\$\s*([+\-*/=<>()\[\]{}.,\s]*?)\s*\$\s*([^$]*?)\s*\$/g,
        (m, a, ops, b) => ` $${a.trim()} ${ops.trim()} ${b.trim()}$ `
      );
      if (before === r) break;
    }

    // ═══ ÉTAPE 3 : corriger les $ mal placés ═══
    r = r.replace(/\$\s*\$/g, ' ');
    r = r.replace(/\$\s+/g, '$');
    r = r.replace(/\s+\$/g, '$');

    // ═══ ÉTAPE 4 : nettoyer les espaces multiples ═══
    r = r.replace(/\s+/g, ' ');
    r = r.replace(/\s+([.,;:!?])/g, '$1');

    return r;
  }

  // ─── 7.11 : Nettoyer le contenu d'une formule ───
  function cleanFormulaContent(formula) {
    if (!formula || typeof formula !== 'string') return formula;

    let open, close, inner;
    if (formula.startsWith('$$') && formula.endsWith('$$')) {
      open = '$$'; close = '$$';
      inner = formula.slice(2, -2);
    } else if (formula.startsWith('$') && formula.endsWith('$')) {
      open = '$'; close = '$';
      inner = formula.slice(1, -1);
    } else {
      return formula;
    }

    inner = inner.replace(/\s+/g, ' ').trim();
    inner = fixCommandSpacing(inner);
    inner = fixTextInternals(inner);
    inner = fixUnitCommas(inner);
    inner = inner.replace(/^\$+/, '').replace(/\$+$/, '');

    return open + inner + close;
  }

  // ─── 7.12 : Fonction principale de nettoyage ───
  function cleanLatexText(text) {
    if (!text || typeof text !== 'string') return text;
    if (!text.trim()) return text;

    const hasBackslash = text.indexOf('\\') !== -1;
    const hasDollar = text.indexOf('$') !== -1;
    const hasUnicode = hasUnicodeMath(text);

    if (!hasBackslash && !hasDollar && !hasUnicode) return text;

    let r = text;

    // 1. Normaliser les délimiteurs alternatifs
    r = normalizeDelimiters(r);

    // 2. Nettoyer les délimiteurs cassés
    r = cleanBrokenDelimiters(r);

    // 3. Convertir exposants/indices Unicode
    r = replaceUnicodeScripts(r);

    // 4. Convertir Unicode → LaTeX (hors formules)
    r = replaceUnicodeMath(r);

    // 5. Corriger les commandes collées
    r = fixCommandSpacing(r);

    // 6. ★ NOUVEAU : Extraire les commandes piégées dans \text{...}
    r = fixTextInternals(r);

    // 7. ★ NOUVEAU : Corriger les unités avec virgule
    r = fixUnitCommas(r);

    // 8. Encadrer le LaTeX orphelin (par blocs)
    r = wrapOrphanLatex(r);

    // 9. Découper final pour nettoyer chaque formule délimitée
    const parts = r.split(/(\$\$[\s\S]*?\$\$|\$[^$\n]+\$)/g);
    r = parts.map((part, i) => {
      if (i % 2 === 1) return cleanFormulaContent(part);
      return part;
    }).join('');

    // 10. Nettoyer parenthèses orphelines
    r = fixOrphanParens(r);

    // 11. Espaces multiples
    r = r.replace(/[ \t]+/g, ' ');
    r = r.replace(/\s+([.,;:!?])/g, '$1');

    return r;
  }

  // ─── 7.13 : Fonction publique de normalisation ───
  function normalizeLatex(input) {
    if (!input || typeof input !== 'string') return '';
    return cleanLatexText(input);
  }

  // ─── 7.14 : Fixer les délimiteurs ───
  function fixDelimiters(text) {
    if (!text || typeof text !== 'string') return '';
    let result = text;

    result = result.replace(/\\\((.+?)\\\)/gs, '$$$1$$');
    result = result.replace(/\\\[(.+?)\\\]/gs, '$$$$$1$$$$');
    result = result.replace(/\$\$\$+/g, '$$');

    return result;
  }

  // ─── 7.15 : Nettoyer la réponse IA complète ───
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

  // ─── 7.16 : Filtre nœud à ignorer ───
  function shouldIgnoreNode(node) {
    if (!node || node.nodeType !== 1) return true;

    const tag = (node.tagName || '').toLowerCase();
    if (['script', 'style', 'noscript', 'textarea', 'pre', 'code', 'kbd', 'samp', 'option'].includes(tag)) {
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
  // STOCKAGE INTERNE POUR PARTIE 2
  // ═══════════════════════════════════════════════════════════════
  window.__arvexaKatexState = {
    MACROS,
    DELIMITERS,
    KNOWN_LATEX_COMMANDS,
    containsKnownLatex,
    hasUnicodeMath,
    replaceUnicodeScripts,
    replaceUnicodeMath,
    fixCommandSpacing,
    fixTextInternals,
    fixUnitCommas,
    fixOrphanParens,
    normalizeDelimiters,
    cleanBrokenDelimiters,
    wrapOrphanLatex,
    wrapSegmentLatex,
    cleanFormulaContent,
    cleanLatexText,
    normalizeLatex,
    fixDelimiters,
    cleanAIResponse,
    shouldIgnoreNode
  };

   // ═══════════════════════════════════════════════════════════════
  // 8. RENDU KATEX (fonction interne)
  // ═══════════════════════════════════════════════════════════════
  function renderKaTeXInternal(root, options) {
    if (!root) return;

    if (typeof renderMathInElement !== 'function') {
      setTimeout(() => renderKaTeXInternal(root, options), 200);
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
        macros: { ...MACROS, ...(options && options.macros ? options.macros : {}) },
        ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code', 'kbd', 'samp', 'option'],
        ignoredClasses: ['no-katex', 'katex-ignore', 'katex'],
        ...(options || {})
      });
    } catch (error) {
      console.warn('[KaTeX] render error:', error && error.message);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 9. FALLBACK VISUEL — afficher le LaTeX brut si échec
  // ═══════════════════════════════════════════════════════════════
  function applyFallbackStyle() {
    if (document.getElementById('arvexa-katex-fallback-style')) return;

    const style = document.createElement('style');
    style.id = 'arvexa-katex-fallback-style';
    style.textContent = `
      .katex-error {
        color: #ff9a84 !important;
        background: rgba(255, 154, 132, 0.10) !important;
        padding: 2px 6px !important;
        border-radius: 4px !important;
        font-family: 'SF Mono', 'Menlo', 'Consolas', monospace !important;
        font-size: 0.9em !important;
        word-break: break-word !important;
        line-height: 1.5 !important;
        display: inline-block !important;
        max-width: 100% !important;
      }
      .arvexa-latex-raw {
        color: #ffd29d !important;
        background: rgba(255, 210, 157, 0.08) !important;
        padding: 2px 6px !important;
        border-radius: 4px !important;
        font-family: 'SF Mono', 'Menlo', 'Consolas', monospace !important;
        font-size: 0.88em !important;
        word-break: break-word !important;
        line-height: 1.5 !important;
        display: inline !important;
      }
    `;
    document.head.appendChild(style);
  }

  // ═══════════════════════════════════════════════════════════════
  // 10. RENDU GLOBAL (fonction publique)
  //     - Détecte les nœuds texte contenant du LaTeX
  //     - Corrige les délimiteurs cassés
  //     - Encadre les orphelins
  //     - Appelle KaTeX
  // ═══════════════════════════════════════════════════════════════
  function renderMath(root) {
    const element = root || document.body;
    if (!element) return;

    // ═══ Passe 1 : pré-traitement des nœuds texte ═══
    try {
      const walker = document.createTreeWalker(
        element,
        NodeFilter.SHOW_TEXT,
        {
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
        const original = n.textContent;
        const fixed = fixDelimiters(original);
        if (fixed !== original) n.textContent = fixed;
      });
    } catch (e) {
      // Silencieux — le DOM peut être en cours de modification
    }

    // ═══ Passe 2 : rendu KaTeX ═══
    renderKaTeXInternal(element);
  }

  // ═══════════════════════════════════════════════════════════════
  // 11. RENDU SAFE (avec double-check)
  // ═══════════════════════════════════════════════════════════════
  function renderMathSafe(root) {
    if (!root) return;
    requestAnimationFrame(() => {
      renderMath(root);
      setTimeout(() => renderMath(root), 250);
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // 12. EXPORT PUBLIC DE RENDERKATEX (avec délégation au moteur)
  // ═══════════════════════════════════════════════════════════════
  function renderKaTeX(root, options) {
    if (!root) return;

    // Déléguer au moteur central
    if (typeof renderMathInElement === 'function') {
      renderKaTeXInternal(root, options);
    } else {
      setTimeout(() => renderKaTeX(root, options), 200);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 13. DÉTECTION DE CONTENU LATEX DANS UN NŒUD
  // ═══════════════════════════════════════════════════════════════
  function hasLatexContent(node) {
    if (!node || node.nodeType !== 1) return false;
    const text = node.textContent || '';
    return /\$|\\\(|\\\[/.test(text) || containsKnownLatex(text);
  }

  // ═══════════════════════════════════════════════════════════════
  // 14. MUTATION OBSERVER — Auto-render
  // ═══════════════════════════════════════════════════════════════
  let observerTimer = null;
  let pendingTargets = new Set();

  function flushPendingTargets() {
    observerTimer = null;
    const targets = Array.from(pendingTargets);
    pendingTargets.clear();

    targets.forEach((target) => {
      if (document.body.contains(target)) {
        try {
          renderMath(target);
        } catch (e) {
          // Silencieux
        }
      }
    });
  }

  function initAutoRender() {
    if (!window.MutationObserver) return;
    if (window.__arvexaKatexObserver) return;
    if (window.__arvexaKatexDisabled) {
      console.log('📐 KaTeX auto-render désactivé');
      return;
    }

    // Appliquer le fallback style au démarrage
    applyFallbackStyle();

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType !== 1) {
            // Peut être un nœud texte ajouté directement
            if (node.nodeType === 3 && node.textContent) {
              const parent = node.parentElement;
              if (parent && !shouldIgnoreNode(parent) && hasLatexContent(parent)) {
                pendingTargets.add(parent);
              }
            }
            return;
          }
          if (shouldIgnoreNode(node)) return;
          if (hasLatexContent(node)) {
            pendingTargets.add(node);
          }
        });

        // Gérer les modifications de texte dans les nœuds existants
        if (mutation.type === 'characterData') {
          const target = mutation.target;
          const parent = target && target.parentElement;
          if (parent && !shouldIgnoreNode(parent) && hasLatexContent(parent)) {
            pendingTargets.add(parent);
          }
        }
      });

      if (pendingTargets.size === 0) return;

      if (observerTimer) clearTimeout(observerTimer);
      observerTimer = setTimeout(flushPendingTargets, 80);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });

    window.__arvexaKatexObserver = observer;
    console.log('📐 KaTeX auto-render activé');
  }

  // ═══════════════════════════════════════════════════════════════
  // 15. EXPORT GLOBAL
  // ═══════════════════════════════════════════════════════════════
  window.KaTeXUtils = {
    // Normalisation et nettoyage
    normalizeLatex,
    fixDelimiters,
    cleanAIResponse,
    cleanLatexText,
    fixTextInternals,
    fixUnitCommas,

    // Rendu
    renderMath,
    renderMathSafe,
    renderKaTeX,

    // Auto-render
    initAutoRender,
    disableAutoRender: () => {
      window.__arvexaKatexDisabled = true;
      if (window.__arvexaKatexObserver) {
        window.__arvexaKatexObserver.disconnect();
        window.__arvexaKatexObserver = null;
      }
    },

    // Détection
    containsKnownLatex,
    hasUnicodeMath,

    // Constantes exposées
    MACROS,
    DELIMITERS,
    KNOWN_LATEX_COMMANDS
  };

  // ═══════════════════════════════════════════════════════════════
  // 16. AUTO-INIT
  // ═══════════════════════════════════════════════════════════════
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initAutoRender();
    });
  } else {
    initAutoRender();
  }

  console.log('📐 KaTeXUtils v3.0 chargé');

})();
