// ================================================================
// API PROGRESS v8.4 — ARVEXA School
// Cahier intelligent + Fan-out IA + Tracking temps d'étude
// + Normalisation LaTeX renforcée (formules 100% propres)
// ================================================================

module.exports.config = { maxDuration: 120 };

const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 60;
const requestLog = new Map();

// ────────────────────────────────────────────────────────────────
// CONFIG
// ────────────────────────────────────────────────────────────────
var ALLOWED_SUBJECTS = new Set([
  'mathematiques', 'physique', 'chimie', 'svt',
  'philosophie', 'histoire', 'geographie'
]);

var ALLOWED_SUBJECTS_ARRAY = Array.from(ALLOWED_SUBJECTS);

var SUBJECT_INFO = {
  mathematiques: { label: 'Mathématiques',  profile: 'scientific' },
  physique:      { label: 'Physique',       profile: 'scientific' },
  chimie:        { label: 'Chimie',         profile: 'scientific' },
  svt:           { label: 'SVT',            profile: 'svt' },
  philosophie:   { label: 'Philosophie',    profile: 'philosophy' },
  histoire:      { label: 'Histoire',       profile: 'history' },
  geographie:    { label: 'Géographie',     profile: 'history' }
};
const MIN_CONTENT_LENGTH = 40;
const MAX_CONTENT_LENGTH = 15000;

const FREE_SECTION_LIMIT = 5;
const GLOBAL_AI_TIME_BUDGET_MS = 45000;

let adminServices = null;

// ════════════════════════════════════════════════════════════════
// NORMALISATION LATEX — v8.4 renforcée
// ════════════════════════════════════════════════════════════════

// ─── 1. Table Unicode → LaTeX (exhaustive) ─────────────────────
const UNICODE_MATH_MAP = {
  // Grec minuscules
  'α': '\\alpha ', 'β': '\\beta ', 'γ': '\\gamma ', 'δ': '\\delta ',
  'ε': '\\epsilon ', 'ζ': '\\zeta ', 'η': '\\eta ', 'θ': '\\theta ',
  'ι': '\\iota ', 'κ': '\\kappa ', 'λ': '\\lambda ', 'μ': '\\mu ',
  'ν': '\\nu ', 'ξ': '\\xi ', 'π': '\\pi ', 'ρ': '\\rho ',
  'σ': '\\sigma ', 'ς': '\\varsigma ', 'τ': '\\tau ', 'υ': '\\upsilon ',
  'φ': '\\phi ', 'χ': '\\chi ', 'ψ': '\\psi ', 'ω': '\\omega ',
  // Grec majuscules
  'Γ': '\\Gamma ', 'Δ': '\\Delta ', 'Θ': '\\Theta ',
  'Λ': '\\Lambda ', 'Ξ': '\\Xi ', 'Π': '\\Pi ',
  'Σ': '\\Sigma ', 'Υ': '\\Upsilon ', 'Φ': '\\Phi ',
  'Ψ': '\\Psi ', 'Ω': '\\Omega ',
  // Opérateurs
  '×': '\\times ', '÷': '\\div ', '±': '\\pm ', '∓': '\\mp ',
  '·': '\\cdot ', '⋅': '\\cdot ', '∘': '\\circ ', '∗': '\\ast ',
  '⋆': '\\star ', '∙': '\\bullet ', '⊕': '\\oplus ', '⊗': '\\otimes ',
  '⊙': '\\odot ',
  // Relations
  '≤': '\\leq ', '≥': '\\geq ', '≠': '\\neq ', '≈': '\\approx ',
  '≡': '\\equiv ', '≅': '\\cong ', '∼': '\\sim ', '≃': '\\simeq ',
  '∝': '\\propto ', '≪': '\\ll ', '≫': '\\gg ',
  // Ensembles et logique
  '∈': '\\in ', '∉': '\\notin ', '∋': '\\ni ', '⊂': '\\subset ',
  '⊃': '\\supset ', '⊆': '\\subseteq ', '⊇': '\\supseteq ',
  '⊄': '\\not\\subset ', '∪': '\\cup ', '∩': '\\cap ', '∅': '\\emptyset ',
  '∀': '\\forall ', '∃': '\\exists ', '∄': '\\nexists ', '¬': '\\neg ',
  '∧': '\\wedge ', '∨': '\\vee ',
  // Grands opérateurs
  '∑': '\\sum ', '∏': '\\prod ', '∫': '\\int ', '∮': '\\oint ',
  '∂': '\\partial ', '∇': '\\nabla ', '√': '\\sqrt ',
  // Flèches
  '→': '\\to ', '←': '\\leftarrow ', '↔': '\\leftrightarrow ',
  '↑': '\\uparrow ', '↓': '\\downarrow ', '↕': '\\updownarrow ',
  '⇒': '\\Rightarrow ', '⇐': '\\Leftarrow ', '⇔': '\\Leftrightarrow ',
  '⟹': '\\Longrightarrow ', '⟸': '\\Longleftarrow ', '⟺': '\\Longleftrightarrow ',
  '↦': '\\mapsto ', '↪': '\\hookrightarrow ', '↩': '\\hookleftarrow ',
  '↗': '\\nearrow ', '↘': '\\searrow ', '↙': '\\swarrow ', '↖': '\\nwarrow ',
  // Chimie
  '⇌': '\\rightleftharpoons ', '⇋': '\\leftrightharpoons ',
  '⟶': '\\longrightarrow ', '⟵': '\\longleftarrow ',
  // Divers
  '∞': '\\infty ', 'ℵ': '\\aleph ', 'ℓ': '\\ell ', 'ℏ': '\\hbar ',
  'ℜ': '\\Re ', 'ℑ': '\\Im ', '°': '^{\\circ} ', '′': "'", '″': "''",
  '‰': '\\text{‰} ', '§': '\\text{§} ',
};

// ─── 2. Exposants Unicode ─────────────────────────────────────
const SUPERSCRIPT_MAP = {
  '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4',
  '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9',
  '⁺': '+', '⁻': '-', '⁼': '=', '⁽': '(', '⁾': ')',
  'ⁿ': 'n', 'ⁱ': 'i'
};

// ─── 3. Indices Unicode ──────────────────────────────────────
const SUBSCRIPT_MAP = {
  '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4',
  '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9',
  '₊': '+', '₋': '-', '₌': '=', '₍': '(', '₎': ')'
};

// ─── 4. Commandes LaTeX sans arguments ────────────────────────
// TRÈS IMPORTANT : triées par longueur décroissante
// pour que \cdotp soit testé avant \cdot, \varepsilon avant \epsilon
const NO_ARG_LATEX_COMMANDS = [
  'rightleftharpoons', 'leftrightharpoons', 'longrightarrow', 'longleftarrow',
  'Longleftrightarrow', 'Longleftarrow', 'Longrightarrow',
  'Leftrightarrow', 'leftrightarrow', 'rightarrow', 'leftarrow',
  'updownarrow', 'hookrightarrow', 'hookleftarrow',
  'Rightarrow', 'Leftarrow',
  'varepsilon', 'vartheta', 'varsigma', 'varrho', 'varphi', 'varpi',
  'cdotp', 'cdot', 'times', 'div', 'pm', 'mp', 'ast', 'star', 'bullet',
  'circ', 'leq', 'geq', 'neq', 'approx', 'equiv', 'sim', 'simeq', 'propto',
  'cong', 'll', 'gg', 'subset', 'supset', 'subseteq', 'supseteq',
  'cup', 'cap', 'emptyset', 'forall', 'exists', 'nexists', 'neg', 'wedge',
  'vee', 'oplus', 'otimes', 'odot', 'sum', 'prod', 'int', 'oint',
  'partial', 'nabla', 'infty', 'aleph', 'ell', 'hbar',
  'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta',
  'iota', 'kappa', 'lambda', 'mu', 'nu', 'xi', 'pi', 'rho', 'sigma',
  'tau', 'upsilon', 'phi', 'chi', 'psi', 'omega',
  'Gamma', 'Delta', 'Theta', 'Lambda', 'Xi', 'Pi', 'Sigma', 'Upsilon',
  'Phi', 'Psi', 'Omega',
  'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'log', 'ln', 'exp',
  'lim', 'max', 'min', 'det', 'mod', 'gcd', 'lcm',
  'quad', 'qquad'
];

// Regex pour insérer un espace après une commande sans argument
// suivie immédiatement d'une lettre ou d'un chiffre.
// Trie par longueur décroissante (déjà fait dans le tableau ci-dessus)
const CMD_SPACE_REGEX = new RegExp(
  `(\\\\(?:${NO_ARG_LATEX_COMMANDS.join('|')}))(?=[a-zA-Z0-9])`,
  'g'
);

// ─── 5. Détection de caractères Unicode mathématiques ─────────
const HAS_UNICODE_MATH_REGEX = /[α-ωΑ-Ω×÷±∓·⋅∘∗⋆∙⊕⊗⊙≤≥≠≈≡≅∼≃∝≪≫∈∉∋⊂⊃⊆⊇⊄∪∩∅∀∃∄¬∧∨∑∏∫∮∂∇√→←↔↑↓↕⇒⇐⇔⟹⟸⟺↦↪↩↗↘↙↖⇌⇋⟶⟵∞ℵℓℏℜℑ⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿⁱ₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎]/;

function hasUnicodeMath(text) {
  if (!text || typeof text !== 'string') return false;
  return HAS_UNICODE_MATH_REGEX.test(text);
}

// ════════════════════════════════════════════════════════════════
// FONCTIONS DE NETTOYAGE LATEX
// ════════════════════════════════════════════════════════════════

// ─── Passe 1 : Convertir les exposants/indices Unicode ───────
function replaceUnicodeScripts(text) {
  if (!text || typeof text !== 'string') return text;
  let r = text;

  // Exposants : x² → x^{2}, x²y³ → x^{2}y^{3}, mol⁻¹ → mol^{-1}
  r = r.replace(/([a-zA-Z0-9}\)\]_])([⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿⁱ]+)/g, (m, base, sups) => {
    const conv = sups.split('').map((c) => SUPERSCRIPT_MAP[c] || c).join('');
    return `${base}^{${conv}}`;
  });

  // Indices : x₀ → x_{0}, H₂O → H_{2}O
  r = r.replace(/([a-zA-Z0-9}\)\]])([₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎]+)/g, (m, base, subs) => {
    const conv = subs.split('').map((c) => SUBSCRIPT_MAP[c] || c).join('');
    return `${base}_{${conv}}`;
  });

  return r;
}

// ─── Passe 2 : Convertir Unicode → LaTeX (hors formules) ─────
function replaceUnicodeMath(text) {
  if (!text || typeof text !== 'string') return text;

  // Découper pour ne pas toucher aux formules déjà entre $...$
  const parts = text.split(/(\$\$[\s\S]*?\$\$|\$[^$\n]+\$)/g);

  return parts.map((part, i) => {
    // Partie impaire = formule déjà délimitée : ne pas toucher
    if (i % 2 === 1) return part;

    let r = part;
    // Appliquer chaque substitution Unicode → LaTeX
    for (const [uni, latex] of Object.entries(UNICODE_MATH_MAP)) {
      if (r.indexOf(uni) !== -1) {
        r = r.split(uni).join(latex);
      }
    }
    return r;
  }).join('');
}

// ─── Passe 3 : Corriger les commandes collées au texte ────────
// Exemple : \cdotpmol → \cdotp mol, \alphax → \alpha x
function fixCommandSpacing(text) {
  if (!text || typeof text !== 'string') return text;
  return text.replace(CMD_SPACE_REGEX, '$1 ');
}

// ─── Passe 4 : Normaliser les délimiteurs ────────────────────
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

// ─── Passe 5 : Nettoyer les délimiteurs cassés ───────────────
function cleanBrokenDelimiters(text) {
  if (!text || typeof text !== 'string') return text;
  let r = text;

  // $$$$$$ → $$ (display)
  r = r.replace(/\${6,}/g, '$$$$');
  // $$$$ reste $$$$ (display), $$$ → $$$
  r = r.replace(/\${5}/g, '$$$$');
  // $$$ → $$ (probablement display mal écrit)
  r = r.replace(/\${3}/g, '$$');
  // $ $ → espace
  r = r.replace(/\$\s*\$/g, ' ');
  // $$ $$ → espace
  r = r.replace(/\$\$\s*\$\$/g, ' ');

  return r;
}

// ─── Passe 6 : Encadrer le LaTeX orphelin ────────────────────
// Transforme "\frac{a}{b}" → "$\frac{a}{b}$"
// et "La formule \sqrt{x} est belle" → "La formule $\sqrt{x}$ est belle"
function wrapOrphanLatex(text) {
  if (!text || typeof text !== 'string') return text;

  // Rien à faire si pas de LaTeX orphelin
  if (!/\\[a-zA-Z]/.test(text)) return text;

  // Découper pour ne pas toucher aux formules déjà délimitées
  const parts = text.split(/(\$\$[\s\S]*?\$\$|\$[^$\n]+\$)/g);

  return parts.map((part, i) => {
    // Partie impaire = formule déjà délimitée : ne pas toucher
    if (i % 2 === 1) return part;

    return wrapSegmentLatex(part);
  }).join('');
}

// ✅ FIX 2.1 — Environnements préservés + filtrage aux commandes connues
function wrapSegmentLatex(segment) {
  if (!segment) return segment;
  if (!/\\[a-zA-Z]/.test(segment)) return segment;

  let r = segment;

  // ÉTAPE 0 : préserver les environnements complets AVANT tout le reste
  r = r.replace(
    /\\begin\{([a-zA-Z*]+)\}([\s\S]*?)\\end\{\1\}/g,
    (match) => ` $$${match}$$ `
  );

  // ÉTAPE A : commandes avec arguments (filtrées sur commandes connues)
  const KNOWN_CMDS = new Set([
    ...NO_ARG_LATEX_COMMANDS,
    'frac', 'sqrt', 'dfrac', 'tfrac', 'cfrac',
    'text', 'mathrm', 'mathbf', 'mathit', 'mathbb', 'mathcal', 'mathfrak',
    'left', 'right', 'big', 'Big', 'bigg', 'Bigg',
    'overline', 'underline', 'vec', 'hat', 'bar', 'dot', 'ddot', 'tilde',
    'binom', 'choose', 'pmod', 'bmod', 'operatorname',
    'sinh', 'cosh', 'tanh', 'arcsin', 'arccos', 'arctan',
    'lg', 'log', 'ln', 'exp',
    'quad', 'qquad', 'hspace', 'vspace'
  ]);

  r = r.replace(
    /(\\[a-zA-Z]+)((?:\s*\{[^}]*\})*)((?:\s*[_^]\s*(?:\{[^}]*\}|[a-zA-Z0-9]))*)/g,
    (match, cmd, args, scripts) => {
      if (!KNOWN_CMDS.has(cmd.slice(1))) return match;
      return ` $${cmd}${args || ''}${scripts || ''}$ `;
    }
  );

  // ÉTAPE B : variables avec exposants/indices isolés
  r = r.replace(
    /(?:^|\s)([a-zA-Z]\s*[_^]\s*(?:\{[^}]*\}|[a-zA-Z0-9]))(?=\s|$|[.,;:!?])/g,
    (match, expr) => match.replace(expr, `$${expr.trim()}$`)
  );

  // ÉTAPE C : fusionner les $...$ adjacents
  for (let iteration = 0; iteration < 5; iteration++) {
    const before = r;
    r = r.replace(
      /\$\s*([^$]*?)\s*\$\s*([+\-*/=<>()\[\]{}.,\s]*?)\s*\$\s*([^$]*?)\s*\$/g,
      (m, a, ops, b) => ` $${a.trim()} ${ops.trim()} ${b.trim()}$ `
    );
    if (before === r) break;
  }

  // ÉTAPE D : nettoyer les $ inutiles
  r = r.replace(/\$\s*\$/g, ' ');
  r = r.replace(/\$\s+/g, '$');
  r = r.replace(/\s+\$/g, '$');

  // ÉTAPE E : espaces multiples
  r = r.replace(/\s+/g, ' ');
  r = r.replace(/\s+([.,;:!?])/g, '$1');

  return r;
}

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

  // Nettoyer les espaces multiples dans le contenu
  inner = inner.replace(/\s+/g, ' ').trim();

  // Fixer les commandes collées
  inner = fixCommandSpacing(inner);

// ✅ FIX 2.2 — Ne supprimer que les $ orphelins en bord
inner = inner.replace(/^\$+/, '').replace(/\$+$/, '');
  
  return open + inner + close;
}

// ─── Fonction principale de nettoyage LaTeX ──────────────────
function cleanLatexText(text) {
  if (!text || typeof text !== 'string') return text;
  if (!text.trim()) return text;

  // Skip si aucun caractère spécial
  const hasBackslash = text.indexOf('\\') !== -1;
  const hasDollar = text.indexOf('$') !== -1;
  const hasUnicode = hasUnicodeMath(text);

  if (!hasBackslash && !hasDollar && !hasUnicode) return text;

  let r = text;

  // 1. Normaliser les délimiteurs alternatifs
  r = normalizeDelimiters(r);

  // 2. Nettoyer les délimiteurs cassés
  r = cleanBrokenDelimiters(r);

  // 3. Convertir exposants/indices Unicode (avant Unicode général)
  r = replaceUnicodeScripts(r);

  // 4. Convertir Unicode → LaTeX (hors formules)
  r = replaceUnicodeMath(r);

  // 5. Fixer les commandes collées
  r = fixCommandSpacing(r);

  // 6. Encadrer le LaTeX orphelin
  r = wrapOrphanLatex(r);

  // 7. Découper final pour nettoyer chaque formule délimitée
  const parts = r.split(/(\$\$[\s\S]*?\$\$|\$[^$\n]+\$)/g);
  r = parts.map((part, i) => {
    if (i % 2 === 1) return cleanFormulaContent(part);
    return part;
  }).join('');

  // 8. Espaces multiples
  r = r.replace(/[ \t]+/g, ' ');
  r = r.replace(/\s+([.,;:!?])/g, '$1');

  return r;
}

// ─── Deep clean : traverse l'objet IA et nettoie les chaînes ─
function deepClean(obj, depth = 0) {
  if (depth > 20) return obj; // Protection anti-récursion

  if (typeof obj === 'string') {
    // Skip les chaînes courtes sans caractères spéciaux (ids, types, etc.)
    if (obj.length < 6 && !/[\\$]/.test(obj) && !hasUnicodeMath(obj)) return obj;
    return cleanLatexText(obj);
  }

  if (Array.isArray(obj)) return obj.map((item) => deepClean(item, depth + 1));

  if (obj && typeof obj === 'object') {
    const cleaned = {};
    for (const k in obj) {
      // Skip les clés techniques
      if (k === 'id' || k === 'type' || k === 'level' || k === 'importance' ||
          k === 'correct' || k === 'notionId' || k === 'number') {
        cleaned[k] = obj[k];
        continue;
      }
      cleaned[k] = deepClean(obj[k], depth + 1);
    }
    return cleaned;
  }

  return obj;
}

// ════════════════════════════════════════════════════════════════
// FIREBASE ADMIN
// ════════════════════════════════════════════════════════════════
function getAdminServices() {
  if (adminServices) return adminServices;

  const credentials = process.env.FIREBASE_ADMIN_CREDENTIALS;
  if (!credentials || !credentials.trim()) throw new Error('firebase_admin_not_configured');

  let serviceAccount;
  try { serviceAccount = JSON.parse(credentials); }
  catch (e) { throw new Error('firebase_admin_invalid_json'); }

  if (!serviceAccount.project_id || !serviceAccount.private_key) {
    throw new Error('firebase_admin_invalid_credentials');
  }

  const admin = require('firebase-admin');
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  }

  adminServices = {
    auth: admin.auth(),
    db: admin.firestore(),
    FieldValue: admin.firestore.FieldValue,
    Timestamp: admin.firestore.Timestamp
  };
  return adminServices;
}

// ────────────────────────────────────────────────────────────────
// HELPERS
// ────────────────────────────────────────────────────────────────
function clientIp(request) {
  return String(request.headers['x-forwarded-for'] || request.socket?.remoteAddress || 'unknown')
    .split(',')[0].trim();
}

function rateLimited(ip) {
  const now = Date.now();
  const recent = (requestLog.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  requestLog.set(ip, recent);
  return recent.length > MAX_REQUESTS_PER_WINDOW;
}

function jsonError(response, status, error, code) {
  return response.status(status).json({
    success: false,
    error,
    ...(code ? { code } : {})
  });
}

function applyCors(request, response) {
  const ALLOWED_ORIGINS = [
    'https://arvexaschool.vercel.app',
    'https://admin-89.vercel.app',
    'http://localhost:3000',
    'http://localhost:5000'
  ];
  const origin = request.headers.origin || '';
  if (ALLOWED_ORIGINS.includes(origin)) {
    response.setHeader('Access-Control-Allow-Origin', origin);
  }
  response.setHeader('Vary', 'Origin');
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  response.setHeader('Access-Control-Max-Age', '86400');
}

async function verifyFirebaseToken(request) {
  const authorization = request.headers.authorization || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  try {
    const { auth } = getAdminServices();
    return await auth.verifyIdToken(match[1]);
  } catch (error) {
    console.error('[PROGRESS AUTH] failed:', error.message);
    return null;
  }
}

function isPremiumUser(data) {
  if (!data) return false;
  const status = data.subscriptionStatus || 'none';
  if (status === 'pending') return false;

  const hasPremium = data.premium === true ||
                     data.isUnlocked === true ||
                     data.hasDeposited === true;

  const end = data.subscriptionEndDate?.toDate?.() ||
    (data.subscriptionEndDate?.seconds ? new Date(data.subscriptionEndDate.seconds * 1000) : null);

  if (hasPremium && end) return end.getTime() > Date.now();
  if (status === 'expired') return false;
  if (hasPremium && !end) return true;
  return false;
}

function toISO(v) {
  if (!v) return null;
  if (typeof v.toDate === 'function') return v.toDate().toISOString();
  if (v._seconds !== undefined) return new Date(v._seconds * 1000).toISOString();
  if (v.seconds !== undefined) return new Date(v.seconds * 1000).toISOString();
  if (typeof v === 'string') return v;
  if (v instanceof Date) return v.toISOString();
  return null;
}

function todayKey() { return new Date().toISOString().slice(0, 10); }
function monthKey()  { return new Date().toISOString().slice(0, 7); }

function formatRelativeDate(value) {
  const iso = toISO(value);
  if (!iso) return '';
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return 'à l\'instant';
  if (min < 60) return `il y a ${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h}h`;
  const day = Math.floor(h / 24);
  if (day < 7) return `il y a ${day}j`;
  if (day < 30) return `il y a ${Math.floor(day / 7)} sem.`;
  return d.toLocaleDateString('fr-FR');
}

function isMeaningfulContent(text) {
  if (!text || typeof text !== 'string') return false;
  const words = text.match(/[a-zA-ZÀ-ÿ]{2,}/g) || [];
  return words.length >= 5;
}

function formatMinutes(totalMin) {
  if (!totalMin || totalMin < 1) return '0 min';
  if (totalMin < 60) return `${totalMin} min`;
  const hours = Math.floor(totalMin / 60);
  const minutes = totalMin % 60;
  if (minutes === 0) return `${hours} h`;
  return `${hours} h ${String(minutes).padStart(2, '0')}`;
}

// ────────────────────────────────────────────────────────────────
// NORMALISATION DES ENTRÉES CLAVIER
// ────────────────────────────────────────────────────────────────
function normalizeMathInput(text) {
  if (!text || typeof text !== 'string') return '';
  let r = text;
  r = r.replace(/([a-zA-Z0-9\)])\s*²/g, '$1^2');
  r = r.replace(/([a-zA-Z0-9\)])\s*³/g, '$1^3');
  r = r.replace(/([a-zA-Z0-9\)])\s*⁴/g, '$1^4');
  r = r.replace(/([a-zA-Z0-9\)])\s*⁵/g, '$1^5');
  r = r.replace(/√\s*\(([^)]+)\)/g, 'racine($1)');
  r = r.replace(/√\s*([a-zA-Z0-9]+)/g, 'racine($1)');
  r = r.replace(/≤/g, ' <= ');
  r = r.replace(/≥/g, ' >= ');
  r = r.replace(/≠/g, ' != ');
  r = r.replace(/∞/g, ' infini ');
  r = r.replace(/π/g, ' pi ');
  r = r.replace(/θ/g, ' theta ');
  r = r.replace(/α/g, ' alpha ');
  r = r.replace(/β/g, ' beta ');
  r = r.replace(/Δ/g, ' Delta ');
  r = r.replace(/∑/g, ' somme ');
  r = r.replace(/∫/g, ' integrale ');
  r = r.replace(/→/g, ' tend vers ');
  r = r.replace(/×/g, ' fois ');
  r = r.replace(/÷/g, ' divise par ');
  r = r.replace(/±/g, ' plus ou moins ');
  return r;
}

// ────────────────────────────────────────────────────────────────
// IA — FOURNISSEURS
// ────────────────────────────────────────────────────────────────
function getProviders() {
  return [
    {
      name: 'Groq',
      key: process.env.GROQ_API_KEY,
      endpoint: 'https://api.groq.com/openai/v1/chat/completions',
      model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
      jsonMode: true
    },
    {
      name: 'OpenRouter',
      key: process.env.OPENROUTER_API_KEY,
      endpoint: 'https://openrouter.ai/api/v1/chat/completions',
      model: process.env.OPENROUTER_MODEL || 'openai/gpt-oss-120b',
      jsonMode: true,
      headers: {
        'HTTP-Referer': process.env.APP_ORIGIN || '',
        'X-Title': 'ARVEXA Notebook'
      }
    },
    {
      name: 'Mistral',
      key: process.env.MISTRAL_API_KEY,
      endpoint: 'https://api.mistral.ai/v1/chat/completions',
      model: process.env.MISTRAL_MODEL || 'mistral-large-latest',
      jsonMode: false
    }
  ].filter((p) => Boolean(p.key));
}

function repairJson(str) {
  if (!str || typeof str !== 'string') return null;

  let s = String(str).trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  try { return JSON.parse(s); } catch (_) {}

  const firstBrace = s.indexOf('{');
  const lastBrace = s.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return null;

  let candidate = s.slice(firstBrace, lastBrace + 1);
  try { return JSON.parse(candidate); } catch (_) {}

  let open = 0, openBrackets = 0;
  let inString = false, escape = false;
  for (const ch of candidate) {
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') open++;
    else if (ch === '}') open--;
    else if (ch === '[') openBrackets++;
    else if (ch === ']') openBrackets--;
  }
  while (openBrackets > 0) { candidate += ']'; openBrackets--; }
  while (open > 0) { candidate += '}'; open--; }

  try { return JSON.parse(candidate); } catch (_) {}
  return null;
}

async function callProvider(provider, { systemPrompt, userPrompt, maxTokens = 4000, deadline }) {
  const controller = new AbortController();
  const timeouts = { 'Groq': 15000, 'OpenRouter': 20000, 'Mistral': 8000 };
  const baseTimeout = timeouts[provider.name] || 15000;
  const remaining = deadline ? Math.max(5000, deadline - Date.now()) : baseTimeout;
  const timeoutMs = Math.min(baseTimeout, remaining);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const body = {
      model: provider.model,
      temperature: 0.3,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    };

    if (provider.jsonMode) body.response_format = { type: 'json_object' };

    const result = await fetch(provider.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${provider.key}`,
        ...(provider.headers || {})
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    const data = await result.json().catch(() => null);
    if (!result.ok) {
      const msg = data?.error?.message || `HTTP ${result.status}`;
      throw new Error(`${provider.name}: ${msg}`);
    }

    const rawContent = data?.choices?.[0]?.message?.content;
    if (!rawContent) throw new Error(`${provider.name}: réponse vide`);

    const cleaned = String(rawContent).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

    try { return JSON.parse(cleaned); }
    catch (_) {
      const repaired = repairJson(cleaned);
      if (repaired) {
        console.warn(`[AI] ${provider.name} — JSON réparé avec succès`);
        return repaired;
      }
      console.warn(`[AI] ${provider.name} — JSON invalide non réparable. Début: ${cleaned.slice(0, 200)}`);
      throw new Error(`${provider.name}: JSON invalide`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

function distributeTasks(tasks, providers) {
  if (providers.length === 0) return [];
  return tasks.map((task, i) => ({ ...task, provider: providers[i % providers.length] }));
}

async function runParallelTasks(tasks, providers, deadline) {
  const assignments = distributeTasks(tasks, providers);

  const results = await Promise.allSettled(
    assignments.map(({ provider, systemPrompt, userPrompt, maxTokens }) =>
      callProvider(provider, { systemPrompt, userPrompt, maxTokens, deadline })
    )
  );

  return await Promise.all(
    results.map(async (r, i) => {
      if (r.status === 'fulfilled') {
        return { status: 'fulfilled', value: r.value, task: tasks[i], provider: assignments[i].provider.name };
      }

      const errMsg = String(r.reason?.message || '');
      const isStructural = errMsg.includes('JSON') || errMsg.includes('structure');
      if (isStructural) {
        console.warn(`[FAN-OUT] Tâche "${tasks[i].name}" : erreur structurelle, pas de fallback`);
        return { status: 'rejected', error: r.reason, task: tasks[i], provider: 'none' };
      }

      if (deadline && Date.now() > deadline - 10000) {
        console.warn(`[FAN-OUT] Tâche "${tasks[i].name}" : deadline proche, pas de fallback`);
        return { status: 'rejected', error: r.reason, task: tasks[i], provider: 'none' };
      }

      console.warn(`[FAN-OUT] Tâche "${tasks[i].name}" échouée sur ${assignments[i].provider.name}, fallback...`);

      for (const provider of providers) {
        if (provider.name === assignments[i].provider.name) continue;
        try {
          const value = await callProvider(provider, {
            systemPrompt: tasks[i].systemPrompt,
            userPrompt: tasks[i].userPrompt,
            maxTokens: tasks[i].maxTokens,
            deadline
          });
          return { status: 'fulfilled', value, task: tasks[i], provider: provider.name };
        } catch (e) {
          console.warn(`[FAN-OUT] Fallback ${provider.name} échoué : ${e.message}`);
        }
      }
      return { status: 'rejected', error: r.reason, task: tasks[i], provider: 'none' };
    })
  );
}

// ────────────────────────────────────────────────────────────────
// FUSION FINALE
// ────────────────────────────────────────────────────────────────
function mergeAnalysis(results, profile) {
  const merged = {
    profile,
    sectionTitle: null,
    explanation: null,
    structure: null,
    questions: [],
    qcm: [],
    extracted: null
  };

  for (const r of results) {
    if (r.status !== 'fulfilled' || !r.value) continue;
    const data = r.value;
    const taskName = r.task.name;

    switch (taskName) {
      case 'extraction':
        merged.sectionTitle = data.sectionTitle || merged.sectionTitle;
        merged.extracted = data;
        break;
      case 'explanation':
        merged.explanation = data;
        merged.sectionTitle = data.sectionTitle || merged.sectionTitle;
        break;
      case 'structure':
        merged.structure = data;
        break;
      case 'questions':
        merged.questions = data.questions || [];
        break;
      case 'qcm':
        merged.qcm = data.qcm || [];
        break;
    }
  }

  return merged;
}

// ────────────────────────────────────────────────────────────────
// RÈGLES COMMUNES
// ────────────────────────────────────────────────────────────────
const LATEX_RULES = `
═══════════════════════════════════════════════════════════════
RÈGLE LATEX — OBLIGATOIRE
═══════════════════════════════════════════════════════════════
1. Toute formule mathématique DOIT être entre $...$ (inline) ou $$...$$ (display).
2. INTERDIT : LaTeX brut sans $ (ex : "v = \\\\sqrt{x}" doit devenir "$v = \\\\sqrt{x}$").
3. INTERDIT : symboles Unicode mathématiques bruts.
   → Utilise \\\\pi, \\\\sqrt{}, ^2, \\\\leq, \\\\geq, \\\\infty, \\\\to, \\\\times, \\\\cdot, \\\\neq, \\\\in, \\\\sum, \\\\int, \\\\Delta, \\\\alpha, \\\\beta, \\\\theta, \\\\lambda, \\\\mu.
4. Ajoute un espace après une commande LaTeX sans argument (ex : "\\\\cdot mol", PAS "\\\\cdotmol").

═══════════════════════════════════════════════════════════════
RÈGLE UNITÉS — TRÈS IMPORTANTE
═══════════════════════════════════════════════════════════════
5. N'écris JAMAIS une unité avec exposant à l'intérieur de \\\\text{...}.
   ❌ \\\\text{g\\\\,mol^{-1}}
   ❌ \\\\text{mol,L^{-1}}
   ✅ \\\\text{g}\\\\,\\\\text{mol}^{-1}
   ✅ \\\\text{mol}\\\\,\\\\text{L}^{-1}
   ✅ \\\\text{g} \\\\cdot \\\\text{mol}^{-1}

6. Les exposants (-1, 2, 3) doivent toujours être HORS de \\\\text{...}.
   ❌ \\\\text{L^{-1}}    ✅ \\\\text{L}^{-1}

7. Ne mélange pas plusieurs unités dans un seul \\\\text{...}.
   ❌ \\\\text{kg\\\\,m/s^2}
   ✅ \\\\text{kg}\\\\,\\\\text{m}/\\\\text{s}^2

═══════════════════════════════════════════════════════════════
RÈGLE ACCENTS FRANÇAIS
═══════════════════════════════════════════════════════════════
8. N'utilise JAMAIS les accents LaTeX (\\\\'e, \\\\\`a, \\\\^o, \\\\c{c}).
   Écris directement : é, è, à, â, ê, î, ô, û, ç, ù, ï, ë.
   ❌ "D\\\\'eterminer la masse"    ✅ "Déterminer la masse"

═══════════════════════════════════════════════════════════════
EXEMPLES DE FORMULES CORRECTES
═══════════════════════════════════════════════════════════════
- M(\\\\text{H}_2\\\\text{SO}_4) = 98\\\\ \\\\text{g}\\\\,\\\\text{mol}^{-1}
- C = \\\\frac{n}{V} \\\\quad \\\\text{en } \\\\text{mol} \\\\cdot \\\\text{L}^{-1}
- c = 3{,}00 \\\\times 10^{8}\\\\ \\\\text{m}\\\\,\\\\text{s}^{-1}
`.trim();

const PERIMETER_RULES = `
═══════════════════════════════════════════════════════════════
RÈGLE DE PÉRIMÈTRE ET DE FIABILITÉ — ABSOLUE
═══════════════════════════════════════════════════════════════
1. Tu travailles UNIQUEMENT sur la section fournie par l'élève.
2. Le texte de l'élève est la SOURCE PRINCIPALE. Tu ne remplaces pas
   son cours par une autre version.
3. INTERDICTION d'inventer une notion, une date, une expérience,
   un chiffre, un résultat ou une conclusion absent du cours.
4. Si une information nécessaire manque dans le cours, tu restes
   PRUDENT : tu ne la fabriques pas. Tu peux signaler son absence.
5. Tu ne présentes JAMAIS une hypothèse comme un fait établi.
6. Tu ne reproduis PAS aveuglément une erreur scientifique présente
   dans le cours. Si tu détectes une erreur :
   - tu la signales clairement dans un champ "warning" (si le schéma
     le permet) ;
   - tu fournis la correction UNIQUEMENT si elle est certaine ;
   - tu ne réécris pas tout le cours pour une seule erreur.
7. Tu distingues toujours :
   - ce qui est OBSERVÉ (fait) ;
   - ce qui est INTERPRÉTÉ (explication) ;
   - ce qui est CONCLU (résultat).
8. Tu utilises un français clair, sans jargon non expliqué.
9. Tu évites les répétitions inutiles d'une même idée.
10. Tu respectes scrupuleusement le schéma JSON demandé.
`.trim();

const JSON_STRICT_RULES = `
═══════════════════════════════════════════════════════════════
RÈGLE JSON STRICTE
═══════════════════════════════════════════════════════════════
1. Réponds UNIQUEMENT avec un objet JSON valide.
2. Pas de texte avant ou après le JSON.
3. Pas de markdown (\`\`\`).
4. Échappe correctement les guillemets doubles dans les chaînes.
5. Utilise des apostrophes droites (') et non typographiques (’).
6. Si un champ n'est pas documenté dans le cours, tu le renvoies
   comme une chaîne vide "" ou un tableau vide [] selon le type.
   JAMAIS de valeur inventée pour combler un champ vide.
7. Respecte STRICTEMENT les types attendus (chaîne, tableau, objet).
8. Ne renomme AUCUNE clé du schéma.
`.trim();

// ────────────────────────────────────────────────────────────────
// PROMPTS PAR PROFIL
// ────────────────────────────────────────────────────────────────

// ═══ SCIENTIFIQUE ═══
function buildScientificPrompts({ subjectLabel, rawInput }) {
  const baseContext = `Matière : ${subjectLabel}
═══════════════════════════════════════════════════════════════
CONTENU DE LA SECTION FOURNIE PAR L'ÉLÈVE
═══════════════════════════════════════════════════════════════
${rawInput}
═══════════════════════════════════════════════════════════════`.trim();

  return [
    {
      name: 'extraction',
      maxTokens: 1500,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Analyse cette section de cours scientifique.

${baseContext}

${PERIMETER_RULES}

Extrait UNIQUEMENT les concepts présents dans cette section.

Format JSON :
{
  "sectionTitle": "Titre court (max 60 caractères)",
  "mainConcepts": ["concept 1"],
  "formulas": ["formule 1"],
  "variables": [{"symbol": "x", "meaning": "signification", "unit": "unité"}],
  "definitions": [{"term": "terme", "definition": "définition"}]
}

${JSON_STRICT_RULES}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'explanation',
      maxTokens: 5000,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide, sans commentaire.',
      userPrompt: `Tu es professeur expert du BAC. Explique cette section comme à un élève qui découvre.

${baseContext}

${PERIMETER_RULES}
${LATEX_RULES}

RÈGLE : Chaque idée doit être EXPLIQUÉE en français simple.
Pas de jargon non expliqué. Phrases complètes, pas de listes télégraphiques.
Nombre de parties adapté au contenu.

Format JSON :
{
  "sectionTitle": "...",
  "understanding": "Ce que tu dois comprendre en 2-3 phrases.",
  "parts": [
    {
      "partTitle": "Partie 1",
      "mainIdea": "Idée principale",
      "simpleExplanation": "Explication en français simple (3-6 phrases).",
      "keyTerms": [{"term": "...", "meaning": "..."}],
      "relations": ["relation 1"],
      "example": "Exemple chiffré si présent",
      "toRemember": "Ce qu'il faut retenir"
    }
  ]
}

${JSON_STRICT_RULES}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'structure',
      maxTokens: 3500,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Extrait la structure scientifique de cette section.

${baseContext}

${PERIMETER_RULES}
${LATEX_RULES}

Ne mets QUE ce qui est présent dans la section. Si pas de formule → tableau vide.

Format JSON :
{
  "formulas": [{"latex": "$z = a + bi$", "description": "...", "variables": [{"symbol": "a", "meaning": "..."}], "condition": "..."}],
  "method": {"title": "Méthode", "steps": ["Étape 1"]},
  "examples": [{"enonce": "...", "steps": ["..."], "result": "$...$"}],
  "traps": [{"trap": "...", "solution": "..."}]
}

${JSON_STRICT_RULES}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'questions',
      maxTokens: 4000,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Génère une banque de questions basée UNIQUEMENT sur cette section.

${baseContext}

${PERIMETER_RULES}
${LATEX_RULES}

RÈGLE : 2 à 3 questions par notion importante.

Format JSON :
{
  "questions": [{"id": "q1", "level": 1, "type": "definition", "question": "...", "answer": "...", "mustHave": ["..."], "importance": 1}]
}

${JSON_STRICT_RULES}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'qcm',
      maxTokens: 3000,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Génère des QCM UNIQUEMENT sur cette section.

${baseContext}

${PERIMETER_RULES}
${LATEX_RULES}

Format JSON :
{
  "qcm": [{"question": "...", "options": [{"id":"A","text":"..."},{"id":"B","text":"..."},{"id":"C","text":"..."},{"id":"D","text":"..."}], "correct": "A", "explanation": "..."}]
}

${JSON_STRICT_RULES}

Réponds UNIQUEMENT avec le JSON.`
    }
  ];
}

// ═══ SVT ═══
function buildSvtPrompts({ subjectLabel, rawInput }) {
  const baseContext = `Matière : ${subjectLabel}
═══════════════════════════════════════════════════════════════
CONTENU DE LA SECTION FOURNIE PAR L'ÉLÈVE
═══════════════════════════════════════════════════════════════
${rawInput}
═══════════════════════════════════════════════════════════════`.trim();

  return [
    {
      name: 'extraction',
      maxTokens: 2000,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Analyse cette section de SVT.

${baseContext}

${PERIMETER_RULES}

RÈGLE SVT SPÉCIFIQUE :
- Priorise les MÉCANISMES, les RELATIONS, les ÉTAPES et les DÉFINITIONS.
- Identifie séparément les EXPÉRIENCES décrites : protocole, observations,
  interprétation, conclusion (uniquement si présentes dans le texte).
- PAS de formules mathématiques inventées.

Extrait UNIQUEMENT ce qui est présent dans la section.

Format JSON :
{
  "sectionTitle": "Titre court (max 60 caractères)",
  "mainConcepts": ["concept 1", "concept 2"],
  "terms": [{"term": "...", "definition": "..."}],
  "mechanisms": ["mécanisme 1", "mécanisme 2"],
  "experiments": [
    {
      "name": "Nom ou titre court",
      "protocol": "Protocole observé (si présent)",
      "observations": "Ce qui a été observé (si présent)",
      "interpretation": "Ce que ça signifie (si présent)",
      "conclusion": "Conclusion tirée (si présente)"
    }
  ],
  "warnings": ["Signale ici toute erreur ou contradiction scientifique détectée dans le cours. Sinon []"]
}

${JSON_STRICT_RULES}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'explanation',
      maxTokens: 5000,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Tu es professeur de SVT au BAC au Niger. Explique cette section à un élève qui découvre.

${baseContext}

${PERIMETER_RULES}

RÈGLES PÉDAGOGIQUES SVT :
- Chaque notion est EXPLIQUÉE en français simple, avec des phrases complètes.
- Pour chaque MÉCANISME : décris-le étape par étape.
- Pour chaque RELATION : identifie les éléments liés (A → B, cause → conséquence).
- Pour chaque EXPÉRIENCE présente dans le cours, tu présentes dans cet ordre :
  1) le protocole (que fait-on ?) ;
  2) les observations (que voit-on ?) ;
  3) l'interprétation (que signifie-ce ?) ;
  4) la conclusion (que retient-on ?).
  Si une de ces parties est absente du cours, tu ne l'inventes PAS.
  Tu peux écrire "non précisé dans le cours".
- Utilise les termes biologiques précis MAIS explique-les entre parenthèses.
- Ne résume pas à outrance : chaque idée importante doit être comprise.
- Ne recopie pas le texte brut : reformule pour expliquer.

Format JSON :
{
  "sectionTitle": "...",
  "understanding": "Ce que l'élève doit comprendre, en 3-4 phrases.",
  "parts": [
    {
      "partTitle": "Partie 1",
      "mainIdea": "Idée principale de cette partie.",
      "simpleExplanation": "Explication pédagogique (3-6 phrases).",
      "terms": [{"term": "...", "meaning": "..."}],
      "mechanism": {"description": "...", "steps": ["Étape 1", "Étape 2"]},
      "relations": ["A → B", "Cause → Conséquence"],
      "experiments": [
        {
          "name": "...",
          "protocol": "...",
          "observations": "...",
          "interpretation": "...",
          "conclusion": "..."
        }
      ],
      "toRemember": "Ce qu'il faut retenir en une phrase."
    }
  ]
}

${JSON_STRICT_RULES}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'structure',
      maxTokens: 3500,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Structure de façon CONCISE cette section de SVT.

${baseContext}

${PERIMETER_RULES}

RÈGLES STRUCTURE SVT :
- Ne recopie PAS l'explication : synthétise.
- Ne invente AUCUN mécanisme, AUCUNE conséquence, AUCUNE classification.
- Distingue clairement : étapes (ordre d'exécution) / relations (liens entre
  éléments) / conséquences (résultats produits).
- PAS de formules mathématiques.

Format JSON :
{
  "mechanisms": [
    {
      "name": "Nom du mécanisme",
      "steps": ["Étape 1", "Étape 2"],
      "relations": ["A → B"],
      "consequences": ["Résultat 1"]
    }
  ],
  "definitions": [{"term": "...", "definition": "..."}],
  "classifications": [{"category": "...", "items": ["..."]}]
}

${JSON_STRICT_RULES}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'questions',
      maxTokens: 4500,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Génère une banque de questions de SVT sur cette section UNIQUEMENT.

${baseContext}

${PERIMETER_RULES}

RÈGLES DES QUESTIONS :
- Varie les NIVEAUX COGNITIFS :
  · Niveau 1 → mémorisation (définitions, termes)
  · Niveau 2 → compréhension (explication d'un mécanisme, d'une relation)
  · Niveau 3 → interprétation (analyse d'une expérience, déduction)
- 2 à 3 questions par notion importante. Pas de quota forcé.
- Évite de reformuler 3 fois la même question.
- Chaque réponse doit être UNE PHRASE COMPLÈTE, précise et scientifiquement exacte.
- Le champ "mustHave" liste les éléments INDISPENSABLES dans la réponse.

Format JSON :
{
  "questions": [
    {
      "id": "q1",
      "level": 1,
      "type": "definition",
      "question": "...",
      "answer": "Une phrase complète.",
      "mustHave": ["terme précis 1", "terme précis 2"],
      "importance": 1
    }
  ]
}

${JSON_STRICT_RULES}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'qcm',
      maxTokens: 3500,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Génère des QCM de SVT sur cette section UNIQUEMENT.

${baseContext}

${PERIMETER_RULES}

RÈGLES QCM :
- 4 options A/B/C/D distinctes et plausibles.
- UNE SEULE option correcte. Les 3 autres sont fausses sans ambiguïté.
- Évite les indices involontaires (jamais "toutes les réponses" ni
  "aucune de ces réponses").
- Évite les distracteurs absurdes : chaque distracteur doit être une
  erreur plausible qu'un élève pourrait faire.
- L'explication justifie clairement POURQUOI la bonne réponse est correcte
  et pourquoi les autres sont fausses.
- Si tu n'es pas CERTAIN de la réponse correcte, NE GÉNÈRE PAS la question.

Format JSON :
{
  "qcm": [
    {
      "question": "...",
      "options": [
        {"id": "A", "text": "..."},
        {"id": "B", "text": "..."},
        {"id": "C", "text": "..."},
        {"id": "D", "text": "..."}
      ],
      "correct": "A",
      "explanation": "Pourquoi A est correcte et pourquoi B/C/D sont fausses."
    }
  ]
}

${JSON_STRICT_RULES}

Réponds UNIQUEMENT avec le JSON.`
    }
  ];
}

// ═══ PHILOSOPHIE ═══
function buildPhilosophyPrompts({ subjectLabel, rawInput }) {
  const baseContext = `Matière : ${subjectLabel}
═══════════════════════════════════════════════════════════════
CONTENU DE LA SECTION FOURNIE PAR L'ÉLÈVE
═══════════════════════════════════════════════════════════════
${rawInput}
═══════════════════════════════════════════════════════════════`.trim();

  return [
    {
      name: 'extraction',
      maxTokens: 1500,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Analyse cette section de philosophie.

${baseContext}

${PERIMETER_RULES}

Format JSON :
{
  "sectionTitle": "...",
  "mainConcepts": ["..."],
  "theses": [{"author": "nom", "thesis": "..."}],
  "arguments": ["..."],
  "keyTerms": [{"term": "...", "definition": "..."}]
}

${JSON_STRICT_RULES}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'explanation',
      maxTokens: 5000,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide, sans commentaire.',
      userPrompt: `Tu es professeur de philosophie. Explique cette section COMME SI L'ÉLÈVE N'Y CONNAISSAIT RIEN.

${baseContext}

${PERIMETER_RULES}

RÈGLES PHILO :
- VULGARISE chaque concept philosophique.
- Décompose chaque argument.
- Donne des exemples du quotidien.

Format JSON :
{
  "sectionTitle": "...",
  "understanding": "...",
  "parts": [
    {
      "partTitle": "...",
      "mainIdea": "...",
      "simpleExplanation": "Explication longue (5-10 phrases).",
      "keyTerms": [{"term": "...", "meaning": "..."}],
      "arguments": ["Argument 1"],
      "everydayExamples": ["Exemple 1"],
      "toRemember": "..."
    }
  ]
}

${JSON_STRICT_RULES}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'structure',
      maxTokens: 3000,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Structure cette section de philosophie.

${baseContext}

${PERIMETER_RULES}

Format JSON :
{
  "theses": [{"thesis": "...", "arguments": ["..."]}],
  "vocabulary": [{"term": "...", "meaning": "..."}],
  "plans": [{"title": "Plan", "parties": ["I. ...", "II. ..."]}]
}

${JSON_STRICT_RULES}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'questions',
      maxTokens: 4000,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Génère des questions de philosophie sur cette section UNIQUEMENT.

${baseContext}

${PERIMETER_RULES}

Chaque réponse doit être UNE PHRASE complète.

Format JSON :
{
  "questions": [{"id": "q1", "level": 1, "type": "definition", "question": "...", "answer": "Une phrase complète.", "mustHave": ["..."], "importance": 1}]
}

${JSON_STRICT_RULES}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'qcm',
      maxTokens: 2500,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `QCM de philosophie sur cette section.

${baseContext}

${PERIMETER_RULES}

Format JSON :
{
  "qcm": [{"question": "...", "options": [{"id":"A","text":"..."},{"id":"B","text":"..."},{"id":"C","text":"..."},{"id":"D","text":"..."}], "correct": "A", "explanation": "..."}]
}

${JSON_STRICT_RULES}

Réponds UNIQUEMENT avec le JSON.`
    }
  ];
}

// ═══ HISTOIRE-GÉO ═══
function buildHistoryPrompts({ subjectLabel, rawInput }) {
  const baseContext = `Matière : ${subjectLabel}
═══════════════════════════════════════════════════════════════
CONTENU DE LA SECTION FOURNIE PAR L'ÉLÈVE
═══════════════════════════════════════════════════════════════
${rawInput}
═══════════════════════════════════════════════════════════════`.trim();

  return [
    {
      name: 'extraction',
      maxTokens: 1800,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Analyse cette section d'histoire-géographie.

${baseContext}

${PERIMETER_RULES}

Format JSON :
{
  "sectionTitle": "...",
  "dates": [{"date": "...", "event": "..."}],
  "persons": [{"name": "...", "role": "..."}],
  "places": [{"place": "...", "stake": "..."}],
  "events": [{"event": "...", "date": "..."}],
  "causes": ["..."],
  "consequences": ["..."]
}

${JSON_STRICT_RULES}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'explanation',
      maxTokens: 2500,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Présente cette section d'histoire-géo de manière CLAIRE et CONCISE.

${baseContext}

${PERIMETER_RULES}

RÈGLE : résumé bref (5-10 phrases max) + accent sur les faits.

Format JSON :
{
  "sectionTitle": "...",
  "understanding": "Résumé en 5-8 phrases.",
  "context": "...",
  "keyFacts": ["fait 1"]
}

${JSON_STRICT_RULES}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'structure',
      maxTokens: 2500,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Structure cette section d'histoire-géo.

${baseContext}

${PERIMETER_RULES}

Format JSON :
{
  "timeline": [{"date": "...", "event": "..."}],
  "causesConsequences": [{"cause": "...", "consequence": "..."}],
  "keyFigures": [{"name": "...", "role": "..."}],
  "vocabulary": [{"term": "...", "meaning": "..."}]
}

${JSON_STRICT_RULES}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'questions',
      maxTokens: 4500,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Génère une BANQUE MASSIVE de questions d'histoire-géo sur cette section.

${baseContext}

${PERIMETER_RULES}

RÈGLE HIST-GÉO : MAX de questions sur les faits.

Format JSON :
{
  "questions": [{"id": "q1", "level": 1, "type": "date", "question": "...", "answer": "...", "mustHave": ["..."], "importance": 1}]
}

${JSON_STRICT_RULES}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'qcm',
      maxTokens: 3500,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `QCM d'histoire-géo sur cette section.

${baseContext}

${PERIMETER_RULES}

Format JSON :
{
  "qcm": [{"question": "...", "options": [{"id":"A","text":"..."},{"id":"B","text":"..."},{"id":"C","text":"..."},{"id":"D","text":"..."}], "correct": "A", "explanation": "..."}]
}

${JSON_STRICT_RULES}

Réponds UNIQUEMENT avec le JSON.`
    }
  ];
}

// ═══ FRANÇAIS ═══
function buildFrenchPrompts({ subjectLabel, rawInput }) {
  const baseContext = `Matière : ${subjectLabel}
═══════════════════════════════════════════════════════════════
CONTENU DE LA SECTION FOURNIE PAR L'ÉLÈVE
═══════════════════════════════════════════════════════════════
${rawInput}
═══════════════════════════════════════════════════════════════`.trim();

  return [
    {
      name: 'extraction',
      maxTokens: 1500,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Analyse cette section de français.

${baseContext}

${PERIMETER_RULES}

Format JSON :
{
  "sectionTitle": "...",
  "mainConcepts": ["..."],
  "texts": [{"title": "...", "author": "..."}],
  "literaryDevices": ["..."],
  "keyTerms": [{"term": "...", "definition": "..."}]
}

${JSON_STRICT_RULES}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'explanation',
      maxTokens: 4000,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Tu es professeur de français. Explique cette section clairement.

${baseContext}

${PERIMETER_RULES}

Format JSON :
{
  "sectionTitle": "...",
  "understanding": "...",
  "parts": [
    {
      "partTitle": "...",
      "mainIdea": "...",
      "simpleExplanation": "...",
      "keyTerms": [{"term": "...", "meaning": "..."}],
      "toRemember": "..."
    }
  ]
}

${JSON_STRICT_RULES}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'structure',
      maxTokens: 2500,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Structure cette section de français.

${baseContext}

${PERIMETER_RULES}

Format JSON :
{
  "literaryDevices": [{"name": "...", "definition": "...", "example": "..."}],
  "vocabulary": [{"term": "...", "meaning": "..."}],
  "texts": [{"title": "...", "author": "...", "analysis": "..."}]
}

${JSON_STRICT_RULES}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'questions',
      maxTokens: 3500,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Génère des questions de français sur cette section.

${baseContext}

${PERIMETER_RULES}

Format JSON :
{
  "questions": [{"id": "q1", "level": 1, "type": "definition", "question": "...", "answer": "Une phrase complète.", "mustHave": ["..."], "importance": 1}]
}

${JSON_STRICT_RULES}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'qcm',
      maxTokens: 2500,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `QCM de français sur cette section.

${baseContext}

${PERIMETER_RULES}

Format JSON :
{
  "qcm": [{"question": "...", "options": [{"id":"A","text":"..."},{"id":"B","text":"..."},{"id":"C","text":"..."},{"id":"D","text":"..."}], "correct": "A", "explanation": "..."}]
}

${JSON_STRICT_RULES}

Réponds UNIQUEMENT avec le JSON.`
    }
  ];
}

// ═══ LANGUE (Anglais) ═══
function buildLanguagePrompts({ subjectLabel, rawInput }) {
  const baseContext = `Matière : ${subjectLabel}
═══════════════════════════════════════════════════════════════
CONTENU DE LA SECTION FOURNIE PAR L'ÉLÈVE
═══════════════════════════════════════════════════════════════
${rawInput}
═══════════════════════════════════════════════════════════════`.trim();

  return [
    {
      name: 'extraction',
      maxTokens: 1500,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Analyse cette section d'anglais.

${baseContext}

${PERIMETER_RULES}

Format JSON :
{
  "sectionTitle": "...",
  "vocabulary": [{"english": "word", "french": "traduction"}],
  "grammarRules": [{"rule": "...", "explanation": "..."}],
  "structures": ["structure 1"],
  "keyTerms": [{"term": "...", "definition": "..."}]
}

${JSON_STRICT_RULES}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'explanation',
      maxTokens: 4500,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Tu es professeur d'anglais pour des FRANCOPHONES DÉBUTANTS.

${baseContext}

${PERIMETER_RULES}

RÈGLES LANGUE :
- EXPLICATIONS TOUJOURS EN FRANÇAIS.
- EXEMPLES EN ANGLAIS avec TRADUCTION SYSTÉMATIQUE.

Format JSON :
{
  "sectionTitle": "...",
  "understanding": "...",
  "parts": [
    {
      "partTitle": "...",
      "mainIdea": "...",
      "simpleExplanation": "Explication EN FRANÇAIS (5-10 phrases).",
      "keyTerms": [{"english": "word", "french": "traduction", "example": "example"}],
      "examples": [{"english": "English sentence.", "french": "Traduction."}],
      "commonMistakes": [{"mistake": "...", "correction": "..."}],
      "toRemember": "..."
    }
  ]
}

${JSON_STRICT_RULES}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'structure',
      maxTokens: 3000,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Structure cette section d'anglais.

${baseContext}

${PERIMETER_RULES}

Format JSON :
{
  "vocabulary": [{"english": "...", "french": "...", "phonetic": "..."}],
  "grammar": [{"rule": "...", "explanation_fr": "...", "examples": [{"english": "...", "french": "..."}]}],
  "phrases": [{"english": "...", "french": "..."}]
}

${JSON_STRICT_RULES}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'questions',
      maxTokens: 3500,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Génère des questions d'anglais.

${baseContext}

${PERIMETER_RULES}

Format JSON :
{
  "questions": [{"id": "q1", "level": 1, "type": "vocabulary", "question": "...", "answer": "...", "mustHave": ["..."], "importance": 1}]
}

${JSON_STRICT_RULES}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'qcm',
      maxTokens: 2500,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `QCM d'anglais sur cette section.

${baseContext}

${PERIMETER_RULES}

Format JSON :
{
  "qcm": [{"question": "...", "options": [{"id":"A","text":"..."},{"id":"B","text":"..."},{"id":"C","text":"..."},{"id":"D","text":"..."}], "correct": "A", "explanation": "..."}]
}

${JSON_STRICT_RULES}

Réponds UNIQUEMENT avec le JSON.`
    }
  ];
}

// ────────────────────────────────────────────────────────────────
// SÉLECTION DU PROFIL
// ────────────────────────────────────────────────────────────────
function getPromptsForProfile(profile, context) {
  switch (profile) {
    case 'scientific': return buildScientificPrompts(context);
    case 'svt':        return buildSvtPrompts(context);
    case 'philosophy': return buildPhilosophyPrompts(context);
    case 'history':    return buildHistoryPrompts(context);
    case 'french':     return buildFrenchPrompts(context);
    case 'language':   return buildLanguagePrompts(context);
    default:           return buildScientificPrompts(context);
  }
}

// ────────────────────────────────────────────────────────────────
// FALLBACK LOCAL
// ────────────────────────────────────────────────────────────────
function buildFallbackAnalysis({ rawInput, profile }) {
  return {
    profile,
    sectionTitle: 'Section',
    explanation: {
      sectionTitle: 'Section',
      understanding: 'Analyse automatique indisponible. Contenu brut disponible ci-dessous.',
      parts: [{
        partTitle: 'Contenu',
        mainIdea: 'Contenu fourni',
        simpleExplanation: rawInput.slice(0, 500),
        keyTerms: [],
        toRemember: 'Réessayer plus tard.'
      }]
    },
    structure: null,
    questions: [],
    qcm: [],
    fallback: true
  };
}

// ────────────────────────────────────────────────────────────────
// QUOTAS
// ────────────────────────────────────────────────────────────────
async function reserveSectionQuota(uid) {
  const { db, FieldValue } = getAdminServices();
  const userRef = db.collection('users').doc(uid);
  const period = monthKey();
  const quotaRef = userRef.collection('notebookQuota').doc(`sections-${period}`);

  return db.runTransaction(async (transaction) => {
    const userSnap = await transaction.get(userRef);
    if (!userSnap.exists) throw new Error('profile_missing');
    if (isPremiumUser(userSnap.data())) {
      return { allowed: true, premium: true, used: 0, limit: Infinity, reserved: false };
    }

    const quotaSnap = await transaction.get(quotaRef);
    const used = Number(quotaSnap.data()?.count || 0);
    if (used >= FREE_SECTION_LIMIT) {
      return { allowed: false, used, limit: FREE_SECTION_LIMIT, premium: false, reserved: false };
    }

    transaction.set(quotaRef, {
      count: used + 1,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });

    return { allowed: true, used: used + 1, limit: FREE_SECTION_LIMIT, premium: false, reserved: true };
  });
}

async function releaseSectionQuota(uid) {
  const { db, FieldValue } = getAdminServices();
  const period = monthKey();
  const quotaRef = db.collection('users').doc(uid).collection('notebookQuota').doc(`sections-${period}`);
  try {
    await db.runTransaction(async (transaction) => {
      const snap = await transaction.get(quotaRef);
      const used = Math.max(0, Number(snap.data()?.count || 0) - 1);
      transaction.set(quotaRef, {
        count: used,
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
    });
  } catch (_) {}
}

async function markDailyActivity(uid, inc = {}) {
  const { db, FieldValue } = getAdminServices();
  const dateKey = todayKey();
  const ref = db.collection('users').doc(uid).collection('dailyActivity').doc(dateKey);
  await ref.set({
    date: dateKey,
    sectionsCreated: FieldValue.increment(inc.sectionsCreated || 0),
    lastAt: FieldValue.serverTimestamp()
  }, { merge: true });
}

// ────────────────────────────────────────────────────────────────
// TRACKING TEMPS D'ÉTUDE
// ────────────────────────────────────────────────────────────────
async function trackStudyTime(uid, body) {
  const minutes = Math.min(120, Math.max(1, Math.round(Number(body.minutes) || 0)));
  if (minutes <= 0) return { success: true, skipped: true };

  const { db, FieldValue } = getAdminServices();
  const today = todayKey();
  const ref = db.collection('users').doc(uid).collection('dailyActivity').doc(today);

  await ref.set({
    date: today,
    studyMinutes: FieldValue.increment(minutes),
    lastAt: FieldValue.serverTimestamp()
  }, { merge: true });

  return { success: true, addedMinutes: minutes };
}

async function computeStudyTime(uid) {
  const { db } = getAdminServices();
  let snap;
  try {
    snap = await db.collection('users').doc(uid).collection('dailyActivity')
      .orderBy('date', 'desc').limit(365).get();
  } catch (e) {
    console.warn('[PROGRESS] computeStudyTime failed:', e.message);
    return {
      totalMinutes: 0,
      totalHours: 0,
      todayMinutes: 0,
      weekMinutes: 0,
      formatted: { total: '0 min', week: '0 min', today: '0 min' }
    };
  }

  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const weekAgoKey = weekAgo.toISOString().slice(0, 10);

  let totalMinutes = 0;
  let todayMinutes = 0;
  let weekMinutes = 0;

  snap.docs.forEach((d) => {
    const data = d.data();
    const minutes = Number(data.studyMinutes || 0);
    totalMinutes += minutes;
    if (data.date === today) todayMinutes += minutes;
    if (data.date >= weekAgoKey) weekMinutes += minutes;
  });

  return {
    totalMinutes,
    totalHours: Math.round((totalMinutes / 60) * 10) / 10,
    todayMinutes,
    weekMinutes,
    formatted: {
      total: formatMinutes(totalMinutes),
      week: formatMinutes(weekMinutes),
      today: formatMinutes(todayMinutes)
    }
  };
}

// ═══════════════════════════════════════════════════════════════
// ACTIONS
// ═══════════════════════════════════════════════════════════════
async function getDashboard(uid) {
  const { db } = getAdminServices();

  const chaptersPromises = ALLOWED_SUBJECTS_ARRAY.map((subjectKey) =>
    db
      .collection('users').doc(uid)
      .collection('notebooks').doc(subjectKey)
      .collection('chapters')
      .orderBy('updatedAt', 'desc')
      .limit(50)
      .get()
      .catch(() => ({ docs: [] }))
  );

  const streakPromise = computeStreak(uid);
  const studyTimePromise = computeStudyTime(uid);

  const [chaptersResults, streak, studyTime] = await Promise.all([
    Promise.all(chaptersPromises),
    streakPromise,
    studyTimePromise
  ]);

  const subjects = [];
  let totalChapters = 0;
  let totalSections = 0;

  ALLOWED_SUBJECTS_ARRAY.forEach((subjectKey, index) => {
    const chaptersSnap = chaptersResults[index];
    const info = SUBJECT_INFO[subjectKey];

    if (!chaptersSnap.docs || chaptersSnap.docs.length === 0) return;

    const chapters = chaptersSnap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        title: data.title || 'Chapitre',
        sectionsCount: data.sectionsCount || 0,
        last: formatRelativeDate(data.updatedAt || data.createdAt)
      };
    });

    const totalSubjectSections = chapters.reduce((s, c) => s + c.sectionsCount, 0);
    totalChapters += chapters.length;
    totalSections += totalSubjectSections;

    subjects.push({
      key: subjectKey,
      label: info.label,
      chaptersCount: chapters.length,
      sectionsCount: totalSubjectSections,
      last: chapters[0]?.last || ''
    });
  });

  subjects.sort((a, b) => b.sectionsCount - a.sectionsCount);

  let recentActivity = [];
  if (subjects.length > 0) {
    const topSubject = subjects[0];
    try {
      const lastChaptersSnap = await db
        .collection('users').doc(uid)
        .collection('notebooks').doc(topSubject.key)
        .collection('chapters')
        .orderBy('updatedAt', 'desc')
        .limit(3)
        .get();

      recentActivity = lastChaptersSnap.docs.map((d) => {
        const data = d.data();
        return {
          subject: topSubject.key,
          subjectLabel: topSubject.label,
          chapterId: d.id,
          chapterTitle: data.title || 'Chapitre',
          sectionsCount: data.sectionsCount || 0,
          time: formatRelativeDate(data.updatedAt || data.createdAt)
        };
      });
    } catch (e) {
      recentActivity = [];
    }
  }

  return {
    success: true,
    summary: { subjectsCount: subjects.length, totalChapters, totalSections },
    streak,
    studyTime,
    subjects,
    recentActivity
  };
}

async function computeStreak(uid) {
  const { db } = getAdminServices();
  let snap;
  try {
    snap = await db.collection('users').doc(uid).collection('dailyActivity')
      .orderBy('date', 'desc').limit(90).get();
  } catch (e) {
    console.warn('[PROGRESS] computeStreak failed:', e.message);
    return { current: 0, best: 0 };
  }

  if (snap.docs.length === 0) return { current: 0, best: 0 };

  const activeDates = new Set(snap.docs.map((d) => d.data().date).filter(Boolean));
  let current = 0;
  const today = new Date();
  for (let i = 0; i < 90; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    if (activeDates.has(key)) current++;
    else break;
  }

  const sorted = Array.from(activeDates).sort();
  let best = 0, run = 0, prev = null;
  sorted.forEach((dateStr) => {
    if (prev) {
      const diff = Math.round((new Date(dateStr) - new Date(prev)) / 86400000);
      run = diff === 1 ? run + 1 : 1;
    } else run = 1;
    best = Math.max(best, run);
    prev = dateStr;
  });

  return { current, best };
}

async function listChapters(uid, body) {
  const { subject } = body;
  if (!ALLOWED_SUBJECTS.has(subject)) throw { status: 400, message: 'Matière invalide.' };

  const { db } = getAdminServices();
  const snap = await db
    .collection('users').doc(uid)
    .collection('notebooks').doc(subject)
    .collection('chapters')
    .orderBy('updatedAt', 'desc')
    .limit(100)
    .get();

  const chapters = snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      title: data.title || 'Chapitre',
      sectionsCount: data.sectionsCount || 0,
      createdAt: toISO(data.createdAt),
      updatedAt: toISO(data.updatedAt),
      last: formatRelativeDate(data.updatedAt || data.createdAt)
    };
  });

  return { success: true, chapters };
}

async function createChapter(uid, body) {
  const { subject, title } = body;
  if (!ALLOWED_SUBJECTS.has(subject)) throw { status: 400, message: 'Matière invalide.' };
  if (!title || typeof title !== 'string' || title.trim().length < 2) {
    throw { status: 400, message: 'Titre trop court.' };
  }

  const { db, FieldValue } = getAdminServices();
  const cleanTitle = title.trim().slice(0, 100);

  const ref = db
    .collection('users').doc(uid)
    .collection('notebooks').doc(subject)
    .collection('chapters').doc();

  await ref.set({
    title: cleanTitle,
    sectionsCount: 0,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  });

  return { success: true, chapter: { id: ref.id, title: cleanTitle, sectionsCount: 0, last: 'à l\'instant' } };
}

async function getChapter(uid, body) {
  const { subject, chapterId } = body;
  if (!ALLOWED_SUBJECTS.has(subject)) throw { status: 400, message: 'Matière invalide.' };
  if (!chapterId) throw { status: 400, message: 'chapterId requis.' };

  const { db } = getAdminServices();
  const chapterRef = db
    .collection('users').doc(uid)
    .collection('notebooks').doc(subject)
    .collection('chapters').doc(chapterId);

  const chapterSnap = await chapterRef.get();
  if (!chapterSnap.exists) throw { status: 404, message: 'Chapitre introuvable.' };

  const data = chapterSnap.data();
  const sectionsSnap = await chapterRef.collection('sections').orderBy('createdAt', 'asc').get();

  const sections = sectionsSnap.docs.map((d) => {
    const s = d.data();
    const analysis = s.analysis || {};
    const questionsCount = Array.isArray(analysis.questions) ? analysis.questions.length : 0;
    const qcmCount = Array.isArray(analysis.qcm) ? analysis.qcm.length : 0;

    return {
      id: d.id,
      title: s.title || 'Section',
      questionsCount,
      qcmCount,
      time: formatRelativeDate(s.createdAt),
      status: 'done'
    };
  });

  return {
    success: true,
    chapter: {
      id: chapterId,
      title: data.title || 'Chapitre',
      subject,
      sectionsCount: sections.length,
      createdAt: toISO(data.createdAt),
      updatedAt: toISO(data.updatedAt)
    },
    sections
  };
}

async function createSection(uid, body) {
  const { subject, chapterId, rawInput } = body;

  if (!ALLOWED_SUBJECTS.has(subject)) throw { status: 400, message: 'Matière invalide.' };
  if (!chapterId) throw { status: 400, message: 'chapterId requis.' };
  if (!rawInput || typeof rawInput !== 'string') throw { status: 400, message: 'Contenu manquant.' };

  const trimmed = rawInput.trim();
  if (trimmed.length < MIN_CONTENT_LENGTH) {
    throw { status: 400, message: `Contenu trop court (min ${MIN_CONTENT_LENGTH} caractères).` };
  }
  if (trimmed.length > MAX_CONTENT_LENGTH) {
    throw { status: 400, message: `Contenu trop long (max ${MAX_CONTENT_LENGTH}).` };
  }
  if (!isMeaningfulContent(trimmed)) {
    throw { status: 400, message: 'Contenu trop court ou sans texte exploitable.' };
  }

  const quota = await reserveSectionQuota(uid);
  if (!quota.allowed) {
    throw {
      status: 429,
      message: `Limite gratuite atteinte (${quota.limit} sections/mois). Passe à Premium.`,
      code: 'FREE_SECTION_LIMIT'
    };
  }

  const { db, FieldValue } = getAdminServices();

  const chapterRef = db
    .collection('users').doc(uid)
    .collection('notebooks').doc(subject)
    .collection('chapters').doc(chapterId);

  const chapterSnap = await chapterRef.get();
  if (!chapterSnap.exists) {
    if (quota.reserved) await releaseSectionQuota(uid);
    throw { status: 404, message: 'Chapitre introuvable.' };
  }

  const info = SUBJECT_INFO[subject];
  const subjectLabel = info.label;
  const profile = info.profile;

  const normalizedInput = normalizeMathInput(trimmed);

  const context = { subjectLabel, rawInput: normalizedInput };
  const tasks = getPromptsForProfile(profile, context);
  const providers = getProviders();

  if (!providers.length) {
    if (quota.reserved) await releaseSectionQuota(uid);
    throw { status: 503, message: 'Aucun fournisseur IA disponible.' };
  }

  console.log(`[FAN-OUT] ${tasks.length} tâches, ${providers.length} fournisseurs pour profil "${profile}"`);

  let analysis;
  try {
    const deadline = Date.now() + GLOBAL_AI_TIME_BUDGET_MS;
    const results = await runParallelTasks(tasks, providers, deadline);

    results.forEach((r) => {
      if (r.status === 'fulfilled') {
        console.log(`[FAN-OUT] OK ${r.task.name} (via ${r.provider})`);
      } else {
        console.error(`[FAN-OUT] FAIL ${r.task.name} - raison: ${r.error?.message || 'unknown'}`);
      }
    });

    analysis = mergeAnalysis(results, profile);

    // ⚡ Nettoyage LaTeX RENFORCÉ v8.4
    analysis = deepClean(analysis);

    if (!analysis.explanation || typeof analysis.explanation !== 'object') {
      console.warn('[FAN-OUT] explanation manquant -> fallback minimal');
      analysis.explanation = {
        sectionTitle: analysis.sectionTitle || 'Section',
        understanding: 'L\'explication pédagogique n\'a pas pu être générée pour cette section. Les questions et QCM restent disponibles ci-dessous.',
        parts: []
      };
    }

    const hasContent = analysis.explanation || analysis.questions.length > 0;
    if (!hasContent) {
      console.warn('[FAN-OUT] Tout a échoué -> fallback complet');
      analysis = buildFallbackAnalysis({ rawInput: normalizedInput, profile });
    }
  } catch (err) {
    if (quota.reserved) await releaseSectionQuota(uid);
    throw err;
  }

  const sectionRef = chapterRef.collection('sections').doc();
  const sectionId = sectionRef.id;

  await sectionRef.set({
    title: analysis.sectionTitle || analysis.explanation?.sectionTitle || 'Section',
    rawInput: trimmed,
    profile,
    analysis,
    userNotes: '',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  });

  await chapterRef.set({
    sectionsCount: FieldValue.increment(1),
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });

  await markDailyActivity(uid, { sectionsCreated: 1 });

  return {
    success: true,
    sectionId,
    section: {
      id: sectionId,
      title: analysis.sectionTitle || 'Section',
      rawInput: trimmed,
      profile,
      analysis,
      userNotes: ''
    }
  };
}

async function getSection(uid, body) {
  const { subject, chapterId, sectionId } = body;
  if (!ALLOWED_SUBJECTS.has(subject)) throw { status: 400, message: 'Matière invalide.' };
  if (!chapterId || !sectionId) throw { status: 400, message: 'IDs manquants.' };

  const { db } = getAdminServices();
  const ref = db
    .collection('users').doc(uid)
    .collection('notebooks').doc(subject)
    .collection('chapters').doc(chapterId)
    .collection('sections').doc(sectionId);

  const snap = await ref.get();
  if (!snap.exists) throw { status: 404, message: 'Section introuvable.' };

  const s = snap.data();
  return {
    success: true,
    section: {
      id: sectionId,
      title: s.title || 'Section',
      subject,
      chapterId,
      rawInput: s.rawInput || '',
      profile: s.profile || 'scientific',
      analysis: s.analysis || {},
      userNotes: s.userNotes || '',
      createdAt: toISO(s.createdAt),
      time: formatRelativeDate(s.createdAt)
    }
  };
}

async function updateNotes(uid, body) {
  const { subject, chapterId, sectionId, userNotes } = body;
  if (!ALLOWED_SUBJECTS.has(subject)) throw { status: 400, message: 'Matière invalide.' };
  if (!chapterId || !sectionId) throw { status: 400, message: 'IDs manquants.' };
  if (typeof userNotes !== 'string') throw { status: 400, message: 'userNotes invalide.' };

  const { db, FieldValue } = getAdminServices();
  const ref = db
    .collection('users').doc(uid)
    .collection('notebooks').doc(subject)
    .collection('chapters').doc(chapterId)
    .collection('sections').doc(sectionId);

  await ref.set({
    userNotes: userNotes.slice(0, 8000),
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });

  return { success: true };
}

async function deleteSection(uid, body) {
  const { subject, chapterId, sectionId } = body;
  if (!ALLOWED_SUBJECTS.has(subject)) throw { status: 400, message: 'Matière invalide.' };
  if (!chapterId || !sectionId) throw { status: 400, message: 'IDs manquants.' };

  const { db, FieldValue } = getAdminServices();
  const chapterRef = db
    .collection('users').doc(uid)
    .collection('notebooks').doc(subject)
    .collection('chapters').doc(chapterId);

  const sectionRef = chapterRef.collection('sections').doc(sectionId);
  const snap = await sectionRef.get();
  if (!snap.exists) throw { status: 404, message: 'Section introuvable.' };

  await sectionRef.delete();
  await chapterRef.set({
    sectionsCount: FieldValue.increment(-1),
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });

  return { success: true };
}

async function deleteChapter(uid, body) {
  const { subject, chapterId } = body;
  if (!ALLOWED_SUBJECTS.has(subject)) throw { status: 400, message: 'Matière invalide.' };
  if (!chapterId) throw { status: 400, message: 'chapterId requis.' };

  const { db } = getAdminServices();
  const chapterRef = db
    .collection('users').doc(uid)
    .collection('notebooks').doc(subject)
    .collection('chapters').doc(chapterId);

  const snap = await chapterRef.get();
  if (!snap.exists) throw { status: 404, message: 'Chapitre introuvable.' };

  const sectionsSnap = await chapterRef.collection('sections').get();
  const batch = db.batch();
  sectionsSnap.docs.forEach((d) => batch.delete(d.ref));
  batch.delete(chapterRef);
  await batch.commit();

  return { success: true };
}

async function getFullLesson(uid, body) {
  const { subject, chapterId } = body;
  if (!ALLOWED_SUBJECTS.has(subject)) throw { status: 400, message: 'Matière invalide.' };
  if (!chapterId) throw { status: 400, message: 'chapterId requis.' };

  const { db } = getAdminServices();
  const chapterRef = db
    .collection('users').doc(uid)
    .collection('notebooks').doc(subject)
    .collection('chapters').doc(chapterId);

  const chapterSnap = await chapterRef.get();
  if (!chapterSnap.exists) throw { status: 404, message: 'Chapitre introuvable.' };

  const sectionsSnap = await chapterRef.collection('sections').orderBy('createdAt', 'asc').get();

  const sections = sectionsSnap.docs.map((d) => {
    const s = d.data();
    return {
      id: d.id,
      title: s.title || 'Section',
      profile: s.profile || 'scientific',
      analysis: s.analysis || {},
      userNotes: s.userNotes || ''
    };
  });

  return {
    success: true,
    chapter: { id: chapterId, title: chapterSnap.data().title || 'Chapitre', subject },
    sections
  };
}

// ═══════════════════════════════════════════════════════════════
// HANDLER
// ═══════════════════════════════════════════════════════════════
module.exports = async function handler(request, response) {
  applyCors(request, response);

  if (request.method === 'OPTIONS') return response.status(204).end();

  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return jsonError(response, 405, 'Méthode non autorisée.');
  }

  if (rateLimited(clientIp(request))) {
    return jsonError(response, 429, 'Trop de demandes. Réessaie.');
  }

  let user;
  try { user = await verifyFirebaseToken(request); }
  catch (e) {
    console.error('Auth error:', e.message);
    return jsonError(response, 503, 'Service temporairement indisponible.');
  }

  if (!user) return jsonError(response, 401, 'Connexion requise.', 'AUTH_REQUIRED');

  const body = request.body && typeof request.body === 'object' ? request.body : {};
  const action = body.action;
  const uid = user.uid;

  console.log(`[PROGRESS v8.4] ${action} | uid=${uid.slice(0, 8)}`);

  try {
    switch (action) {
      case 'getDashboard':     return response.status(200).json(await getDashboard(uid));
      case 'listChapters':     return response.status(200).json(await listChapters(uid, body));
      case 'createChapter':    return response.status(200).json(await createChapter(uid, body));
      case 'getChapter':       return response.status(200).json(await getChapter(uid, body));
      case 'createSection':    return response.status(200).json(await createSection(uid, body));
      case 'getSection':       return response.status(200).json(await getSection(uid, body));
      case 'updateNotes':      return response.status(200).json(await updateNotes(uid, body));
      case 'deleteSection':    return response.status(200).json(await deleteSection(uid, body));
      case 'deleteChapter':    return response.status(200).json(await deleteChapter(uid, body));
      case 'getFullLesson':    return response.status(200).json(await getFullLesson(uid, body));
      case 'trackStudyTime':   return response.status(200).json(await trackStudyTime(uid, body));
      default:
        return jsonError(response, 400, `Action inconnue : "${action}"`);
    }
  } catch (error) {
    console.error(`[PROGRESS v8.4] "${action}" failed:`, error.message);
    if (error.status) return jsonError(response, error.status, error.message, error.code);
    return jsonError(response, 500, error.message || 'Erreur serveur.');
  }
};
