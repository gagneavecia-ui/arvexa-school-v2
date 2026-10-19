// ================================================================
// API PROGRESS v8.7 — ARVEXA School
// Cahier intelligent + Fan-out IA + Tracking temps d'étude
// ✅ Rate limit par UID (pas par IP) — pas de faux positifs
// ✅ Limites pédagogiques arbitraires supprimées (plus de plafond à 5)
// ✅ Règles pédagogiques explicites par matière
// ✅ Validation qualité : explication, questions, QCM, couverture
// ✅ Détection troncature via finish_reason
// ✅ Décision de fallback basée sur la qualité réelle
// ================================================================

module.exports.config = { maxDuration: 120 };

const WINDOW_MS = 60 * 1000;

// ✅ Limites techniques conservées
const RATE_LIMITS = {
  getDashboard: 60,
  listChapters: 60,
  createChapter: 30,
  getChapter: 60,
  createSection: 10,
  getSection: 60,
  updateNotes: 60,
  deleteSection: 30,
  deleteChapter: 30,
  getFullLesson: 30,
  trackStudyTime: 120
};

const DEFAULT_RATE_LIMIT = 60;
const requestLog = new Map();

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
// NORMALISATION LATEX (inchangé)
// ════════════════════════════════════════════════════════════════
const UNICODE_MATH_MAP = {
  'α': '\\alpha ', 'β': '\\beta ', 'γ': '\\gamma ', 'δ': '\\delta ',
  'ε': '\\epsilon ', 'ζ': '\\zeta ', 'η': '\\eta ', 'θ': '\\theta ',
  'ι': '\\iota ', 'κ': '\\kappa ', 'λ': '\\lambda ', 'μ': '\\mu ',
  'ν': '\\nu ', 'ξ': '\\xi ', 'π': '\\pi ', 'ρ': '\\rho ',
  'σ': '\\sigma ', 'ς': '\\varsigma ', 'τ': '\\tau ', 'υ': '\\upsilon ',
  'φ': '\\phi ', 'χ': '\\chi ', 'ψ': '\\psi ', 'ω': '\\omega ',
  'Γ': '\\Gamma ', 'Δ': '\\Delta ', 'Θ': '\\Theta ',
  'Λ': '\\Lambda ', 'Ξ': '\\Xi ', 'Π': '\\Pi ',
  'Σ': '\\Sigma ', 'Υ': '\\Upsilon ', 'Φ': '\\Phi ',
  'Ψ': '\\Psi ', 'Ω': '\\Omega ',
  '×': '\\times ', '÷': '\\div ', '±': '\\pm ', '∓': '\\mp ',
  '·': '\\cdot ', '⋅': '\\cdot ', '∘': '\\circ ', '∗': '\\ast ',
  '⋆': '\\star ', '∙': '\\bullet ', '⊕': '\\oplus ', '⊗': '\\otimes ',
  '⊙': '\\odot ',
  '≤': '\\leq ', '≥': '\\geq ', '≠': '\\neq ', '≈': '\\approx ',
  '≡': '\\equiv ', '≅': '\\cong ', '∼': '\\sim ', '≃': '\\simeq ',
  '∝': '\\propto ', '≪': '\\ll ', '≫': '\\gg ',
  '∈': '\\in ', '∉': '\\notin ', '∋': '\\ni ', '⊂': '\\subset ',
  '⊃': '\\supset ', '⊆': '\\subseteq ', '⊇': '\\supseteq ',
  '⊄': '\\not\\subset ', '∪': '\\cup ', '∩': '\\cap ', '∅': '\\emptyset ',
  '∀': '\\forall ', '∃': '\\exists ', '∄': '\\nexists ', '¬': '\\neg ',
  '∧': '\\wedge ', '∨': '\\vee ',
  '∑': '\\sum ', '∏': '\\prod ', '∫': '\\int ', '∮': '\\oint ',
  '∂': '\\partial ', '∇': '\\nabla ', '√': '\\sqrt ',
  '→': '\\to ', '←': '\\leftarrow ', '↔': '\\leftrightarrow ',
  '↑': '\\uparrow ', '↓': '\\downarrow ', '↕': '\\updownarrow ',
  '⇒': '\\Rightarrow ', '⇐': '\\Leftarrow ', '⇔': '\\Leftrightarrow ',
  '⟹': '\\Longrightarrow ', '⟸': '\\Longleftarrow ', '⟺': '\\Longleftrightarrow ',
  '↦': '\\mapsto ', '↪': '\\hookrightarrow ', '↩': '\\hookleftarrow ',
  '↗': '\\nearrow ', '↘': '\\searrow ', '↙': '\\swarrow ', '↖': '\\nwarrow ',
  '⇌': '\\rightleftharpoons ', '⇋': '\\leftrightharpoons ',
  '⟶': '\\longrightarrow ', '⟵': '\\longleftarrow ',
  '∞': '\\infty ', 'ℵ': '\\aleph ', 'ℓ': '\\ell ', 'ℏ': '\\hbar ',
  'ℜ': '\\Re ', 'ℑ': '\\Im ', '°': '^{\\circ} ', '′': "'", '″': "''",
  '‰': '\\text{‰} ', '§': '\\text{§} ',
};

const SUPERSCRIPT_MAP = {
  '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4',
  '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9',
  '⁺': '+', '⁻': '-', '⁼': '=', '⁽': '(', '⁾': ')',
  'ⁿ': 'n', 'ⁱ': 'i'
};

const SUBSCRIPT_MAP = {
  '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4',
  '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9',
  '₊': '+', '₋': '-', '₌': '=', '₍': '(', '₎': ')'
};

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

const CMD_SPACE_REGEX = new RegExp(
  `(\\\\(?:${NO_ARG_LATEX_COMMANDS.join('|')}))(?=[a-zA-Z0-9])`,
  'g'
);

const HAS_UNICODE_MATH_REGEX = /[α-ωΑ-Ω×÷±∓·⋅∘∗⋆∙⊕⊗⊙≤≥≠≈≡≅∼≃∝≪≫∈∉∋⊂⊃⊆⊇⊄∪∩∅∀∃∄¬∧∨∑∏∫∮∂∇√→←↔↑↓↕⇒⇐⇔⟹⟸⟺↦↪↩↗↘↙↖⇌⇋⟶⟵∞ℵℓℏℜℑ⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿⁱ₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎]/;

function hasUnicodeMath(text) {
  if (!text || typeof text !== 'string') return false;
  return HAS_UNICODE_MATH_REGEX.test(text);
}

function replaceUnicodeScripts(text) {
  if (!text || typeof text !== 'string') return text;
  let r = text;

  r = r.replace(/([a-zA-Z0-9}\)\]_])([⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿⁱ]+)/g, (m, base, sups) => {
    const conv = sups.split('').map((c) => SUPERSCRIPT_MAP[c] || c).join('');
    return `${base}^{${conv}}`;
  });

  r = r.replace(/([a-zA-Z0-9}\)\]])([₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎]+)/g, (m, base, subs) => {
    const conv = subs.split('').map((c) => SUBSCRIPT_MAP[c] || c).join('');
    return `${base}_{${conv}}`;
  });

  return r;
}

function replaceUnicodeMath(text) {
  if (!text || typeof text !== 'string') return text;

  const parts = text.split(/(\$\$[\s\S]*?\$\$|\$[^$\n]+\$)/g);

  return parts.map((part, i) => {
    if (i % 2 === 1) return part;

    let r = part;
    for (const [uni, latex] of Object.entries(UNICODE_MATH_MAP)) {
      if (r.indexOf(uni) !== -1) {
        r = r.split(uni).join(latex);
      }
    }
    return r;
  }).join('');
}

function fixCommandSpacing(text) {
  if (!text || typeof text !== 'string') return text;
  return text.replace(CMD_SPACE_REGEX, '$1 ');
}

function normalizeDelimiters(text) {
  if (!text || typeof text !== 'string') return text;
  let r = text;

  r = r.replace(/\\\(([\s\S]*?)\\\)/g, (m, inner) => `$${inner.trim()}$`);
  r = r.replace(/\\\[([\s\S]*?)\\\]/g, (m, inner) => `$$${inner.trim()}$$`);
  r = r.replace(/\\begin\{(?:equation|align|gather)\*?\}([\s\S]*?)\\end\{(?:equation|align|gather)\*?\}/g,
                (m, inner) => `$$${inner.trim()}$$`);

  return r;
}

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

function wrapOrphanLatex(text) {
  if (!text || typeof text !== 'string') return text;
  if (!/\\[a-zA-Z]/.test(text)) return text;

  const parts = text.split(/(\$\$[\s\S]*?\$\$|\$[^$\n]+\$)/g);

  return parts.map((part, i) => {
    if (i % 2 === 1) return part;
    return wrapSegmentLatex(part);
  }).join('');
}

function wrapSegmentLatex(segment) {
  if (!segment) return segment;
  if (!/\\[a-zA-Z]/.test(segment)) return segment;

  let r = segment;

  r = r.replace(
    /\\begin\{([a-zA-Z*]+)\}([\s\S]*?)\\end\{\1\}/g,
    (match) => ` $$${match}$$ `
  );

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

  r = r.replace(
    /(?:^|\s)([a-zA-Z]\s*[_^]\s*(?:\{[^}]*\}|[a-zA-Z0-9]))(?=\s|$|[.,;:!?])/g,
    (match, expr) => match.replace(expr, `$${expr.trim()}$`)
  );

  for (let iteration = 0; iteration < 5; iteration++) {
    const before = r;
    r = r.replace(
      /\$\s*([^$]*?)\s*\$\s*([+\-*/=<>()\[\]{}.,\s]*?)\s*\$\s*([^$]*?)\s*\$/g,
      (m, a, ops, b) => ` $${a.trim()} ${ops.trim()} ${b.trim()}$ `
    );
    if (before === r) break;
  }

  r = r.replace(/\$\s*\$/g, ' ');
  r = r.replace(/\$\s+/g, '$');
  r = r.replace(/\s+\$/g, '$');

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

  inner = inner.replace(/\s+/g, ' ').trim();
  inner = fixCommandSpacing(inner);
  inner = inner.replace(/^\$+/, '').replace(/\$+$/, '');

  return open + inner + close;
}

function cleanLatexText(text) {
  if (!text || typeof text !== 'string') return text;
  if (!text.trim()) return text;

  const hasBackslash = text.indexOf('\\') !== -1;
  const hasDollar = text.indexOf('$') !== -1;
  const hasUnicode = hasUnicodeMath(text);

  if (!hasBackslash && !hasDollar && !hasUnicode) return text;

  let r = text;

  r = normalizeDelimiters(r);
  r = cleanBrokenDelimiters(r);
  r = replaceUnicodeScripts(r);
  r = replaceUnicodeMath(r);
  r = fixCommandSpacing(r);
  r = wrapOrphanLatex(r);

  const parts = r.split(/(\$\$[\s\S]*?\$\$|\$[^$\n]+\$)/g);
  r = parts.map((part, i) => {
    if (i % 2 === 1) return cleanFormulaContent(part);
    return part;
  }).join('');

  r = r.replace(/[ \t]+/g, ' ');
  r = r.replace(/\s+([.,;:!?])/g, '$1');

  return r;
}

function deepClean(obj, depth = 0) {
  if (depth > 20) return obj;

  if (typeof obj === 'string') {
    if (obj.length < 6 && !/[\\$]/.test(obj) && !hasUnicodeMath(obj)) return obj;
    return cleanLatexText(obj);
  }

  if (Array.isArray(obj)) return obj.map((item) => deepClean(item, depth + 1));

  if (obj && typeof obj === 'object') {
    const cleaned = {};
    for (const k in obj) {
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

function rateLimitedByUid(uid, action) {
  if (!uid) return false;

  const limit = RATE_LIMITS[action] || DEFAULT_RATE_LIMIT;
  const now = Date.now();
  const key = `uid:${uid}:${action}`;
  const recent = (requestLog.get(key) || []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  requestLog.set(key, recent);
  return recent.length > limit;
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

// ════════════════════════════════════════════════════════════════
// VALIDATION D'ANALYSE — v8.7 (NOUVEAU)
// ════════════════════════════════════════════════════════════════
function countWords(text) {
  if (!text || typeof text !== 'string') return 0;
  return (text.match(/[a-zA-ZÀ-ÿ0-9]{2,}/g) || []).length;
}

function validateExplanation(explanation) {
  if (!explanation || typeof explanation !== 'object') {
    return { ok: false, reason: 'explanation_absente' };
  }

  const understanding = String(explanation.understanding || '').trim();
  const parts = Array.isArray(explanation.parts) ? explanation.parts : [];

  const partsWithContent = parts.filter((p) => {
    if (!p || typeof p !== 'object') return false;
    const idea = String(p.mainIdea || '').trim();
    const expl = String(p.simpleExplanation || '').trim();
    return (idea.length > 0) || (countWords(expl) >= 5);
  });

  const totalWords = countWords(understanding) +
    partsWithContent.reduce((s, p) => s + countWords(p.simpleExplanation), 0);

  const stats = {
    understandingWords: countWords(understanding),
    partsCount: parts.length,
    partsWithContent: partsWithContent.length,
    totalWords
  };

  if (partsWithContent.length === 0) {
    return { ok: false, reason: 'aucune_partie_avec_contenu', stats };
  }
  if (totalWords < 40) {
    return { ok: false, reason: 'explication_trop_courte', stats };
  }

  return { ok: true, stats };
}

function validateQuestions(questions) {
  if (!Array.isArray(questions)) {
    return { ok: false, valid: [], invalid: [], reason: 'questions_non_tableau' };
  }

  const valid = [];
  const invalid = [];

  for (const q of questions) {
    if (!q || typeof q !== 'object') { invalid.push({ q, reason: 'not_object' }); continue; }
    const question = String(q.question || '').trim();
    const answer = String(q.answer || '').trim();
    const mustHave = Array.isArray(q.mustHave)
      ? q.mustHave.filter((m) => String(m || '').trim().length > 0)
      : [];

    if (question.length < 5) { invalid.push({ q, reason: 'question_vide' }); continue; }
    if (answer.length < 5) { invalid.push({ q, reason: 'reponse_vide' }); continue; }
    if (countWords(answer) < 3) { invalid.push({ q, reason: 'reponse_trop_courte' }); continue; }

    valid.push({ ...q, mustHave });
  }

  return {
    ok: valid.length > 0,
    valid,
    invalid,
    reason: valid.length === 0 ? 'aucune_question_valide' : null
  };
}

function validateQcm(qcmList) {
  if (!Array.isArray(qcmList)) {
    return { ok: false, valid: [], invalid: [], reason: 'qcm_non_tableau' };
  }

  const valid = [];
  const invalid = [];

  for (const q of qcmList) {
    if (!q || typeof q !== 'object') { invalid.push({ q, reason: 'not_object' }); continue; }
    const question = String(q.question || '').trim();
    const options = Array.isArray(q.options) ? q.options : [];
    const correct = String(q.correct || '').trim();
    const optionIds = options.map((o) => String(o?.id || '')).filter(Boolean);

    if (question.length < 5) { invalid.push({ q, reason: 'question_vide' }); continue; }
    if (options.length < 2) { invalid.push({ q, reason: 'moins_de_2_options' }); continue; }
    if (!optionIds.includes(correct)) { invalid.push({ q, reason: 'correct_absent_des_options' }); continue; }

    valid.push(q);
  }

  return {
    ok: valid.length > 0,
    valid,
    invalid,
    reason: valid.length === 0 ? 'aucun_qcm_valide' : null
  };
}

function checkConceptCoverage(mainConcepts, explanation) {
  if (!Array.isArray(mainConcepts) || mainConcepts.length === 0) {
    return { covered: 0, total: 0, missing: [], ratio: 1 };
  }
  if (!explanation || !Array.isArray(explanation.parts)) {
    return { covered: 0, total: mainConcepts.length, missing: mainConcepts, ratio: 0 };
  }

  const haystack = [
    String(explanation.understanding || ''),
    ...explanation.parts.map((p) =>
      `${p.partTitle || ''} ${p.mainIdea || ''} ${p.simpleExplanation || ''} ${
        Array.isArray(p.keyTerms)
          ? p.keyTerms.map((t) => `${t.term || ''} ${t.meaning || ''}`).join(' ')
          : ''
      }`
    )
  ].join(' ').toLowerCase();

  const missing = [];
  let covered = 0;
  for (const concept of mainConcepts) {
    const c = String(concept || '').trim().toLowerCase();
    if (c.length < 3) continue;
    const wholeMatch = haystack.includes(c);
    const wordMatch = c.split(/[\s,;()]+/).some((w) => w.length >= 5 && haystack.includes(w));
    if (wholeMatch || wordMatch) covered++;
    else missing.push(concept);
  }

  const total = mainConcepts.length;
  return { covered, total, missing, ratio: total > 0 ? covered / total : 1 };
}

function cleanFormulas(structure) {
  if (!structure || !Array.isArray(structure.formulas)) return;
  structure.formulas = structure.formulas.filter((f) => {
    if (!f || typeof f !== 'object') return false;
    const latex = String(f.latex || '').trim();
    return latex.length >= 2;
  });
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
      jsonMode: false,
      maxTokensCap: 4000  // ✅ plafond Mistral vérifié
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

  // ✅ Plafond éventuel par provider
  const effectiveMax = provider.maxTokensCap
    ? Math.min(maxTokens, provider.maxTokensCap)
    : maxTokens;

  try {
    const body = {
      model: provider.model,
      temperature: 0.3,
      max_tokens: effectiveMax,
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

    const choice = data?.choices?.[0];
    const rawContent = choice?.message?.content;
    const finishReason = choice?.finish_reason;

    if (!rawContent) throw new Error(`${provider.name}: réponse vide`);

    const cleaned = String(rawContent)
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    let parsed = null;

    try {
      parsed = JSON.parse(cleaned);
    } catch (_) {
      const repaired = repairJson(cleaned);
      if (repaired) {
        console.warn(`[AI] ${provider.name} — JSON réparé (finish_reason=${finishReason})`);
        parsed = repaired;
      } else {
        console.warn(`[AI] ${provider.name} — JSON invalide non réparable. Début: ${cleaned.slice(0, 200)}`);
        throw new Error(`${provider.name}: JSON invalide`);
      }
    }

    // ✅ Signaler la troncature (finish_reason=length → contenu coupé)
    if (finishReason === 'length' || finishReason === 'max_tokens') {
      console.warn(`[AI] ${provider.name} — Réponse tronquée (finish_reason=${finishReason})`);
      if (parsed && typeof parsed === 'object') {
        parsed.__truncated = true;
        parsed.__provider = provider.name;
      }
    }

    return parsed;
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
        return {
          status: 'fulfilled',
          value: r.value,
          task: tasks[i],
          provider: assignments[i].provider.name
        };
      }

      const errMsg = String(r.reason?.message || '');
      const isStructural = errMsg.includes('JSON') || errMsg.includes('structure') || errMsg.includes('tronqu');
      const isTimeout = errMsg.includes('timeout') || errMsg.includes('aborted') || errMsg.includes('AbortError');
      const isDeadlineNear = deadline && Date.now() > deadline - 10000;

      if (isDeadlineNear) {
        console.warn(`[FAN-OUT] Tâche "${tasks[i].name}" : deadline proche, pas de fallback`);
        return { status: 'rejected', error: r.reason, task: tasks[i], provider: 'none' };
      }

      // ✅ Erreur structurelle : un seul fallback (pas en boucle)
      if (isStructural) {
        const remainingProviders = providers.filter((p) => p.name !== assignments[i].provider.name);
        if (remainingProviders.length > 0) {
          const fallbackProvider = remainingProviders[0];
          console.warn(`[FAN-OUT] Tâche "${tasks[i].name}" structurellement invalide sur ${assignments[i].provider.name}, tentative unique sur ${fallbackProvider.name}`);
          try {
            const value = await callProvider(fallbackProvider, {
              systemPrompt: tasks[i].systemPrompt,
              userPrompt: tasks[i].userPrompt,
              maxTokens: tasks[i].maxTokens,
              deadline
            });
            return { status: 'fulfilled', value, task: tasks[i], provider: fallbackProvider.name };
          } catch (e) {
            console.warn(`[FAN-OUT] Fallback ${fallbackProvider.name} échoué : ${e.message}`);
          }
        }
        return { status: 'rejected', error: r.reason, task: tasks[i], provider: 'none' };
      }

      // Timeout ou autre erreur : fallback classique sur tous les autres providers
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

function mergeAnalysis(results, profile) {
  const merged = {
    profile,
    sectionTitle: null,
    explanation: null,
    structure: null,
    questions: [],
    qcm: [],
    extracted: null,
    __quality: {
      explanation: null,
      questions: null,
      qcm: null,
      coverage: null,
      failedTasks: [],
      truncatedTasks: []
    }
  };

  for (const r of results) {
    if (r.status !== 'fulfilled' || !r.value) {
      if (r.task?.name) merged.__quality.failedTasks.push(r.task.name);
      continue;
    }
    const data = r.value;
    const taskName = r.task.name;

    if (data.__truncated) merged.__quality.truncatedTasks.push(taskName);

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
        merged.questions = Array.isArray(data.questions) ? data.questions : [];
        break;
      case 'qcm':
        merged.qcm = Array.isArray(data.qcm) ? data.qcm : [];
        break;
    }
  }

  // ─── Forçage tableaux (existant) ──────────────────────────
  if (merged.explanation) {
    if (!Array.isArray(merged.explanation.parts)) merged.explanation.parts = [];
  }
  if (merged.structure) {
    const arrayFields = [
      'formulas', 'examples', 'traps', 'mechanisms', 'definitions',
      'classifications', 'theses', 'vocabulary', 'plans', 'timeline',
      'causesConsequences', 'keyFigures', 'literaryDevices', 'texts',
      'grammar', 'phrases'
    ];
    arrayFields.forEach((field) => {
      if (merged.structure[field] && !Array.isArray(merged.structure[field])) {
        merged.structure[field] = [];
      }
    });
    if (merged.structure.method && !Array.isArray(merged.structure.method.steps)) {
      merged.structure.method.steps = [];
    }
    cleanFormulas(merged.structure);
  }

  // ─── Validation ciblée ────────────────────────────────────
  merged.__quality.explanation = validateExplanation(merged.explanation);

  const qCheck = validateQuestions(merged.questions);
  merged.__quality.questions = qCheck;
  merged.questions = qCheck.valid;

  const qcmCheck = validateQcm(merged.qcm);
  merged.__quality.qcm = qcmCheck;
  merged.qcm = qcmCheck.valid;

  const concepts = Array.isArray(merged.extracted?.mainConcepts) ? merged.extracted.mainConcepts : [];
  merged.__quality.coverage = checkConceptCoverage(concepts, merged.explanation);

  // Dédoublonnage questions par id
  const seen = new Set();
  merged.questions = merged.questions.filter((q) => {
    if (!q || !q.id) return true;
    if (seen.has(q.id)) return false;
    seen.add(q.id);
    return true;
  });

  return merged;
}

// ────────────────────────────────────────────────────────────────
// RÈGLES COMMUNES
// ────────────────────────────────────────────────────────────────
const LATEX_RULES = `
RÈGLE LATEX — OBLIGATOIRE :
- Toute formule mathématique DOIT être entre $...$ (inline) ou $$...$$ (display).
- INTERDIT : LaTeX brut sans $ (ex : "v = \\sqrt{x}" doit devenir "$v = \\sqrt{x}$").
- INTERDIT : symboles Unicode mathématiques bruts (π, √, ², ≤, ≥, ∞, →, ×, ·, ≠, ∈, ∑, ∫, Δ).
- Ajoute TOUJOURS un espace après une commande LaTeX sans argument (ex : "\\cdotp mol", pas "\\cdotpmol").
- Utilise \\cdot ou \\cdotp (avec espace) pour le point médian : "g \\cdot mol^{-1}".
`.trim();

const PERIMETER_RULES = `
RÈGLE DE PÉRIMÈTRE STRICT :
- Tu travailles UNIQUEMENT sur la section fournie par l'élève.
- INTERDICTION de mentionner ou d'utiliser une connaissance externe au texte fourni.
`.trim();

const JSON_STRICT_RULES = `
RÈGLE JSON STRICTE :
- Réponds UNIQUEMENT avec un objet JSON valide.
- Pas de texte avant ou après le JSON.
- Pas de markdown (\`\`\`).
- Échappe correctement les guillemets doubles dans les chaînes (\\").
- Utilise des apostrophes droites (') et non typographiques.
- Le nombre d'éléments dans les tableaux doit être proportionnel à la richesse
  du cours fourni. NE PLAFONNE PAS artificiellement : si le cours contient
  8 mécanismes distincts, liste les 8.
- À l'inverse, ne remplis pas artificiellement : si le cours ne contient que
  2 formules, n'en invente pas une 3e.
- Si une information est absente du cours, ne l'invente pas :
  omets le champ ou mets null.
- Si tu approches de la fin de ta réponse, PRIORISE la complétude des éléments
  déjà commencés plutôt que d'en ajouter de nouveaux tronqués.
`.trim();

const EXPLANATION_RULES = `
RÈGLES D'EXPLICATION (OBLIGATOIRES) :
1. Public cible : élève de Terminale D au Niger préparant le BAC.
   Utilise un français simple et direct, sans être infantilisant.
2. Conserve les termes scientifiques et scolaires indispensables.
   Si un terme technique est difficile, explique-le brièvement
   dans la phrase qui suit (entre parenthèses ou en apposition).
3. Présente les notions dans un ordre logique : du plus simple au plus complexe,
   du général au particulier, ou dans l'ordre chronologique si le cours s'y prête.
4. Si le cours décrit un mécanisme ou un processus, décris chaque étape
   dans l'ordre, sans en sauter.
5. Si le cours aborde des causes, des conséquences, des relations entre notions
   ou des différences, explique-les explicitement.
6. Donne un exemple concret UNIQUEMENT lorsqu'il aide réellement à comprendre.
   N'invente pas d'exemple si le cours n'en fournit pas et que le concept
   est abstrait — signale-le plutôt.
7. N'utilise PAS une simple définition à la place d'une explication.
   Définir n'est pas expliquer : l'explication doit répondre à "pourquoi" et "comment".
8. Il n'y a PAS de limite fixe de phrases. La longueur doit être proportionnelle
   à la complexité de la notion et à la richesse du cours fourni.
9. Évite les répétitions et les phrases de remplissage.
10. N'invente AUCUNE information absente du cours. Si une donnée semble manquer
    ou est ambiguë, signale-le explicitement dans le champ concerné.
`.trim();

const SUMMARY_RULES = `
RÈGLES DE RÉSUMÉ (OBLIGATOIRES) :
1. Le résumé doit conserver TOUTES les connaissances importantes du cours :
   définitions, propriétés, mécanismes et leurs étapes, causes, conséquences,
   formules et unités, dates et faits, concepts et arguments, distinctions
   essentielles, exemples indispensables à la compréhension.
2. Supprime les répétitions, raccourcis les formulations inutilement longues,
   simplifie les explications SANS DÉFORMER LEUR SENS.
3. NE SUPPRIME JAMAIS une notion importante uniquement pour raccourcir.
   La longueur du résumé dépend de la complexité et de la longueur du cours.
4. Conserve les nuances du cours : conditions, restrictions, exceptions.
5. Ne fusionne pas deux notions distinctes sous prétexte qu'elles sont proches.
6. Ne présente PAS une information absente du cours comme si elle y figurait.
`.trim();

const QUESTIONS_RULES = `
RÈGLES DE GÉNÉRATION DE QUESTIONS (OBLIGATOIRES) :
1. Couvre SYSTÉMATIQUEMENT toutes les notions importantes présentes dans le cours.
   Pas une notion importante sans au moins une question.
2. Choisis les TYPES de questions adaptés à la nature de chaque notion.
   Types disponibles selon la matière :
   - définition, restitution, explication, description,
   - comparaison, justification,
   - causes / conséquences / relations,
   - application (calcul, résolution),
   - synthèse,
   - lecture de schéma (si le cours en contient).
   Ne force PAS tous les types pour chaque notion.
3. Chaque réponse doit être COMPLÈTE, CORRECTE, COMPRÉHENSIBLE.
   - Une réponse de définition doit contenir le terme, son genre, son domaine
     et ses caractères distinctifs.
   - Une réponse d'explication doit contenir "pourquoi" et "comment".
   - Une réponse de comparaison doit énoncer les points communs ET les différences.
4. Utilise le vocabulaire attendu dans la matière (termes du cours).
5. Le champ "mustHave" doit lister les éléments INDISPENSABLES sans lesquels
   la réponse serait considérée incomplète par un correcteur de BAC.
   Chaque élément doit être court (mots-clés, pas une phrase).
6. N'invente AUCUNE information absente du cours.
`.trim();

// ────────────────────────────────────────────────────────────────
// PROMPTS PAR PROFIL
// ────────────────────────────────────────────────────────────────
function buildScientificPrompts({ subjectLabel, rawInput, subject }) {
  const baseContext = `Matière : ${subjectLabel}
═══════════════════════════════════════════════════════════════
CONTENU DE LA SECTION FOURNIE PAR L'ÉLÈVE
═══════════════════════════════════════════════════════════════
${rawInput}
═══════════════════════════════════════════════════════════════`.trim();

  const focusBySubject = {
    mathematiques: `Focus MATHÉMATIQUES :
- Privilégie définitions, propriétés, théorèmes, formules,
  conditions d'application, méthodes de résolution, interprétations.
- Pour chaque formule, précise les conditions de validité et le domaine.
- Pour chaque méthode, donne les étapes dans l'ordre.`,
    physique: `Focus PHYSIQUE :
- Privilégie phénomènes, grandeurs physiques, unités (SI), relations
  entre grandeurs, conditions d'application, méthodes de résolution.
- Toute formule doit être accompagnée de l'unité de chaque grandeur
  et des conditions de validité.
- Décris les phénomènes étape par étape quand ils évoluent.`,
    chimie: `Focus CHIMIE :
- Privilégie notions, réactions, équations-bilans, propriétés,
  conditions expérimentales (température, pression, catalyseur),
  méthodes de calcul (concentrations, quantités de matière, rendements).
- Toute équation doit être équilibrée.
- Pour chaque réaction, précise les conditions expérimentales et
  les produits observables.`
  };

  const subjectFocus = focusBySubject[subject] || focusBySubject.mathematiques;

  return [
    {
      name: 'extraction',
      maxTokens: 2200,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Analyse cette section de cours scientifique.

${baseContext}

${PERIMETER_RULES}
${SUMMARY_RULES}

Extrait UNIQUEMENT les concepts présents dans cette section.

${subjectFocus}

Format JSON :
{
  "sectionTitle": "Titre court (max 60 caractères)",
  "resume": "Résumé structuré du cours en 3 à 8 phrases, fidèle au document.",
  "mainConcepts": ["concept 1", "concept 2"],
  "formulas": ["formule 1"],
  "variables": [{"symbol": "x", "meaning": "signification", "unit": "unité"}],
  "definitions": [{"term": "terme", "definition": "définition"}]
}

${JSON_STRICT_RULES}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'explanation',
      maxTokens: 7000,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide, sans commentaire.',
      userPrompt: `Tu es professeur expert du BAC (Terminale D, Niger). Explique cette section
comme à un élève qui découvre la notion.

${baseContext}

${PERIMETER_RULES}
${EXPLANATION_RULES}
${LATEX_RULES}

${subjectFocus}

Adapte le nombre de parties à la richesse du cours (généralement 3 à 8).
Chaque partie doit contenir une explication réellement pédagogique,
pas une simple reformulation de définition.

Format JSON :
{
  "sectionTitle": "...",
  "understanding": "Ce que tu dois comprendre en 2-4 phrases.",
  "parts": [
    {
      "partTitle": "Partie 1",
      "mainIdea": "Idée principale",
      "simpleExplanation": "Explication pédagogique complète. Longueur adaptée à la notion.",
      "keyTerms": [{"term": "...", "meaning": "..."}],
      "relations": ["relation 1"],
      "example": "Exemple chiffré si présent dans le cours",
      "toRemember": "Ce qu'il faut retenir"
    }
  ]
}

${JSON_STRICT_RULES}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'structure',
      maxTokens: 5000,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Extrait la structure scientifique de cette section.

${baseContext}

${PERIMETER_RULES}
${SUMMARY_RULES}
${LATEX_RULES}

${subjectFocus}

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
      maxTokens: 6500,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Génère une banque de questions basée UNIQUEMENT sur cette section.

${baseContext}

${PERIMETER_RULES}
${QUESTIONS_RULES}
${LATEX_RULES}

${subjectFocus}

Format JSON :
{
  "questions": [{"id": "q1", "level": 1, "type": "definition", "question": "...", "answer": "...", "mustHave": ["..."], "importance": 1}]
}

${JSON_STRICT_RULES}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'qcm',
      maxTokens: 4500,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Génère des QCM UNIQUEMENT sur cette section.

${baseContext}

${PERIMETER_RULES}
${QUESTIONS_RULES}
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

function buildSvtPrompts({ subjectLabel, rawInput }) {
  const baseContext = `Matière : ${subjectLabel}
═══════════════════════════════════════════════════════════════
CONTENU DE LA SECTION FOURNIE PAR L'ÉLÈVE
═══════════════════════════════════════════════════════════════
${rawInput}
═══════════════════════════════════════════════════════════════`.trim();

  const svtFocus = `Focus SVT :
- Privilégie définitions, structures (cellule, tissu, organe, système),
  fonctions, mécanismes biologiques et leurs étapes, causes et conséquences,
  relations entre niveaux d'organisation.
- Décris les mécanismes étape par étape.
- Explique les relations entre organes / niveaux d'organisation quand le cours les aborde.`;

  return [
    {
      name: 'extraction',
      maxTokens: 2200,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Analyse cette section de SVT.

${baseContext}

${PERIMETER_RULES}
${SUMMARY_RULES}
${svtFocus}

RÈGLE SVT : PAS de formules. Priorise mécanismes, relations, étapes, définitions.

Format JSON :
{
  "sectionTitle": "...",
  "resume": "Résumé fidèle et complet du cours (3 à 8 phrases).",
  "mainConcepts": ["..."],
  "terms": [{"term": "...", "definition": "..."}],
  "mechanisms": ["mécanisme 1"]
}

${JSON_STRICT_RULES}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'explanation',
      maxTokens: 7000,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide, sans commentaire.',
      userPrompt: `Tu es professeur de SVT (Terminale D, Niger). Explique cette section
comme à un élève qui découvre la notion.

${baseContext}

${PERIMETER_RULES}
${EXPLANATION_RULES}
${svtFocus}

Adapte le nombre de parties à la richesse du cours (généralement 3 à 8).

Format JSON :
{
  "sectionTitle": "...",
  "understanding": "...",
  "parts": [
    {
      "partTitle": "...",
      "mainIdea": "...",
      "simpleExplanation": "...",
      "terms": [{"term": "...", "meaning": "..."}],
      "mechanism": {"description": "...", "steps": ["Étape 1"]},
      "relations": ["relation 1"],
      "toRemember": "..."
    }
  ]
}

${JSON_STRICT_RULES}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'structure',
      maxTokens: 5000,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Structure cette section de SVT.

${baseContext}

${PERIMETER_RULES}
${SUMMARY_RULES}
${svtFocus}

PAS de formules.

Format JSON :
{
  "mechanisms": [{"name": "...", "steps": ["..."], "relations": ["..."], "consequences": ["..."]}],
  "definitions": [{"term": "...", "definition": "..."}],
  "classifications": [{"category": "...", "items": ["..."]}]
}

${JSON_STRICT_RULES}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'questions',
      maxTokens: 6500,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Génère une banque de questions de SVT sur cette section UNIQUEMENT.

${baseContext}

${PERIMETER_RULES}
${QUESTIONS_RULES}
${svtFocus}

Format JSON :
{
  "questions": [{"id": "q1", "level": 1, "type": "definition", "question": "...", "answer": "...", "mustHave": ["..."], "importance": 1}]
}

${JSON_STRICT_RULES}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'qcm',
      maxTokens: 4500,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `QCM de SVT sur cette section UNIQUEMENT.

${baseContext}

${PERIMETER_RULES}
${QUESTIONS_RULES}

Format JSON :
{
  "qcm": [{"question": "...", "options": [{"id":"A","text":"..."},{"id":"B","text":"..."},{"id":"C","text":"..."},{"id":"D","text":"..."}], "correct": "A", "explanation": "..."}]
}

${JSON_STRICT_RULES}

Réponds UNIQUEMENT avec le JSON.`
    }
  ];
}

function buildPhilosophyPrompts({ subjectLabel, rawInput }) {
  const baseContext = `Matière : ${subjectLabel}
═══════════════════════════════════════════════════════════════
CONTENU DE LA SECTION FOURNIE PAR L'ÉLÈVE
═══════════════════════════════════════════════════════════════
${rawInput}
═══════════════════════════════════════════════════════════════`.trim();

  const philoFocus = `Focus PHILOSOPHIE :
- Privilégie concepts, problématiques, thèses, arguments, distinctions conceptuelles,
  exemples pertinents.
- Distingue clairement thèse / antithèse / synthèse quand le cours les aborde.
- Explique le sens des concepts philosophiques AVANT de les utiliser.`;

  return [
    {
      name: 'extraction',
      maxTokens: 2200,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Analyse cette section de philosophie.

${baseContext}

${PERIMETER_RULES}
${SUMMARY_RULES}
${philoFocus}

Format JSON :
{
  "sectionTitle": "...",
  "resume": "Résumé fidèle (3 à 8 phrases).",
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
      maxTokens: 7000,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide, sans commentaire.',
      userPrompt: `Tu es professeur de philosophie (Terminale, Niger). Explique cette section
COMME SI L'ÉLÈVE N'Y CONNAISSAIT RIEN.

${baseContext}

${PERIMETER_RULES}
${EXPLANATION_RULES}
${philoFocus}

Adapte le nombre de parties à la richesse du cours.

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
      maxTokens: 5000,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Structure cette section de philosophie.

${baseContext}

${PERIMETER_RULES}
${SUMMARY_RULES}
${philoFocus}

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
      maxTokens: 6500,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Génère des questions de philosophie sur cette section UNIQUEMENT.

${baseContext}

${PERIMETER_RULES}
${QUESTIONS_RULES}
${philoFocus}

Chaque réponse doit être une phrase complète, argumentée.

Format JSON :
{
  "questions": [{"id": "q1", "level": 1, "type": "definition", "question": "...", "answer": "...", "mustHave": ["..."], "importance": 1}]
}

${JSON_STRICT_RULES}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'qcm',
      maxTokens: 4500,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `QCM de philosophie sur cette section.

${baseContext}

${PERIMETER_RULES}
${QUESTIONS_RULES}

Format JSON :
{
  "qcm": [{"question": "...", "options": [{"id":"A","text":"..."},{"id":"B","text":"..."},{"id":"C","text":"..."},{"id":"D","text":"..."}], "correct": "A", "explanation": "..."}]
}

${JSON_STRICT_RULES}

Réponds UNIQUEMENT avec le JSON.`
    }
  ];
}

function buildHistoryPrompts({ subjectLabel, rawInput, subject }) {
  const baseContext = `Matière : ${subjectLabel}
═══════════════════════════════════════════════════════════════
CONTENU DE LA SECTION FOURNIE PAR L'ÉLÈVE
═══════════════════════════════════════════════════════════════
${rawInput}
═══════════════════════════════════════════════════════════════`.trim();

  const isGeo = subject === 'geographie';

  const focus = isGeo
    ? `Focus GÉOGRAPHIE :
- Privilégie localisations, espaces, acteurs, enjeux spatiaux,
  causes et conséquences des dynamiques territoriales.
- Situe les phénomènes dans l'espace (pays, régions, villes).`
    : `Focus HISTOIRE :
- Privilégie faits, dates, acteurs, contextes, causes, conséquences, enjeux.
- Respecte la chronologie des événements.`;

  return [
    {
      name: 'extraction',
      maxTokens: 2400,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Analyse cette section ${isGeo ? 'de géographie' : "d'histoire"}.

${baseContext}

${PERIMETER_RULES}
${SUMMARY_RULES}
${focus}

Format JSON :
{
  "sectionTitle": "...",
  "resume": "Résumé fidèle (3 à 8 phrases).",
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
      maxTokens: 5500,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Présente cette section ${isGeo ? 'de géographie' : "d'histoire"} de manière CLAIRE et FIDÈLE.

${baseContext}

${PERIMETER_RULES}
${EXPLANATION_RULES}
${focus}

Adapte la longueur à la richesse du cours.

Format JSON :
{
  "sectionTitle": "...",
  "understanding": "...",
  "context": "...",
  "parts": [
    {
      "partTitle": "...",
      "mainIdea": "...",
      "simpleExplanation": "...",
      "keyTerms": [{"term": "...", "meaning": "..."}],
      "toRemember": "..."
    }
  ],
  "keyFacts": ["fait 1"]
}

${JSON_STRICT_RULES}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'structure',
      maxTokens: 5000,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Structure cette section ${isGeo ? 'de géographie' : "d'histoire"}.

${baseContext}

${PERIMETER_RULES}
${SUMMARY_RULES}
${focus}

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
      maxTokens: 6500,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Génère une banque de questions ${isGeo ? 'de géographie' : "d'histoire"} sur cette section.

${baseContext}

${PERIMETER_RULES}
${QUESTIONS_RULES}
${focus}

Couvre TOUS les faits importants (dates, acteurs, événements,
causes, conséquences, enjeux). Nombre proportionnel au contenu.

Format JSON :
{
  "questions": [{"id": "q1", "level": 1, "type": "date", "question": "...", "answer": "...", "mustHave": ["..."], "importance": 1}]
}

${JSON_STRICT_RULES}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'qcm',
      maxTokens: 4500,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `QCM ${isGeo ? 'de géographie' : "d'histoire"} sur cette section.

${baseContext}

${PERIMETER_RULES}
${QUESTIONS_RULES}

Format JSON :
{
  "qcm": [{"question": "...", "options": [{"id":"A","text":"..."},{"id":"B","text":"..."},{"id":"C","text":"..."},{"id":"D","text":"..."}], "correct": "A", "explanation": "..."}]
}

${JSON_STRICT_RULES}

Réponds UNIQUEMENT avec le JSON.`
    }
  ];
}

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
      maxTokens: 2200,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Analyse cette section de français.

${baseContext}

${PERIMETER_RULES}
${SUMMARY_RULES}

Format JSON :
{
  "sectionTitle": "...",
  "resume": "Résumé fidèle (3 à 8 phrases).",
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
      maxTokens: 6500,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Tu es professeur de français. Explique cette section clairement.

${baseContext}

${PERIMETER_RULES}
${EXPLANATION_RULES}

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
      maxTokens: 4500,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Structure cette section de français.

${baseContext}

${PERIMETER_RULES}
${SUMMARY_RULES}

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
      maxTokens: 6000,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Génère des questions de français sur cette section.

${baseContext}

${PERIMETER_RULES}
${QUESTIONS_RULES}

Format JSON :
{
  "questions": [{"id": "q1", "level": 1, "type": "definition", "question": "...", "answer": "Une phrase complète.", "mustHave": ["..."], "importance": 1}]
}

${JSON_STRICT_RULES}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'qcm',
      maxTokens: 4000,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `QCM de français sur cette section.

${baseContext}

${PERIMETER_RULES}
${QUESTIONS_RULES}

Format JSON :
{
  "qcm": [{"question": "...", "options": [{"id":"A","text":"..."},{"id":"B","text":"..."},{"id":"C","text":"..."},{"id":"D","text":"..."}], "correct": "A", "explanation": "..."}]
}

${JSON_STRICT_RULES}

Réponds UNIQUEMENT avec le JSON.`
    }
  ];
}

// Note : buildLanguagePrompts est conservé (code mort inoffensif)
// pour une activation future quand ALLOWED_SUBJECTS inclura 'anglais'.
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
      maxTokens: 2200,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Analyse cette section d'anglais.

${baseContext}

${PERIMETER_RULES}
${SUMMARY_RULES}

Format JSON :
{
  "sectionTitle": "...",
  "resume": "Résumé fidèle (3 à 8 phrases).",
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
      maxTokens: 6000,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Tu es professeur d'anglais pour des FRANCOPHONES DÉBUTANTS.

${baseContext}

${PERIMETER_RULES}
${EXPLANATION_RULES}

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
      "simpleExplanation": "Explication EN FRANÇAIS.",
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
      maxTokens: 4500,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Structure cette section d'anglais.

${baseContext}

${PERIMETER_RULES}
${SUMMARY_RULES}

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
      maxTokens: 5500,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Génère des questions d'anglais.

${baseContext}

${PERIMETER_RULES}
${QUESTIONS_RULES}

Format JSON :
{
  "questions": [{"id": "q1", "level": 1, "type": "vocabulary", "question": "...", "answer": "...", "mustHave": ["..."], "importance": 1}]
}

${JSON_STRICT_RULES}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'qcm',
      maxTokens: 4000,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `QCM d'anglais sur cette section.

${baseContext}

${PERIMETER_RULES}
${QUESTIONS_RULES}

Format JSON :
{
  "qcm": [{"question": "...", "options": [{"id":"A","text":"..."},{"id":"B","text":"..."},{"id":"C","text":"..."},{"id":"D","text":"..."}], "correct": "A", "explanation": "..."}]
}

${JSON_STRICT_RULES}

Réponds UNIQUEMENT avec le JSON.`
    }
  ];
}

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
  try {
    const { db, FieldValue } = getAdminServices();
    const period = monthKey();
    const quotaRef = db.collection('users').doc(uid).collection('notebookQuota').doc(`sections-${period}`);

    await db.runTransaction(async (transaction) => {
      const snap = await transaction.get(quotaRef);
      const used = Math.max(0, Number(snap.data()?.count || 0) - 1);
      transaction.set(quotaRef, {
        count: used,
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
    });
  } catch (err) {
    console.warn('[PROGRESS] releaseSectionQuota failed:', err.message);
  }
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
    console.error('[PROGRESS] computeStudyTime failed:', e.message);
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
    console.error('[PROGRESS] computeStreak failed:', e.message);
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

  const context = { subjectLabel, rawInput: normalizedInput, subject };
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
    analysis = deepClean(analysis);

    // ✅ Décision basée sur __quality
    const q = analysis.__quality || {};
    const explCheck = q.explanation || { ok: false, reason: 'non_evaluee' };
    const qCheck = q.questions || { ok: false, valid: [] };
    const qcmCheck = q.qcm || { ok: false, valid: [] };
    const coverage = q.coverage || { covered: 0, total: 0, missing: [], ratio: 1 };

    const totalQ = (qCheck.valid?.length || 0) + (qCheck.invalid?.length || 0);
    const totalQcm = (qcmCheck.valid?.length || 0) + (qcmCheck.invalid?.length || 0);

    console.log(
      `[PROGRESS] Qualité — expl=${explCheck.ok ? 'OK' : 'KO(' + explCheck.reason + ')'} ` +
      `questions=${qCheck.valid.length}/${totalQ} ` +
      `qcm=${qcmCheck.valid.length}/${totalQcm} ` +
      `couverture=${coverage.covered}/${coverage.total} ` +
      `échecs=${(q.failedTasks || []).join(',') || 'aucun'} ` +
      `tronquées=${(q.truncatedTasks || []).join(',') || 'aucune'}`
    );

    // Cas 1 : explication KO + 0 question valide → fallback complet
    if (!explCheck.ok && qCheck.valid.length === 0) {
      console.warn('[PROGRESS] Analyse inutilisable (expl KO + 0 question) → fallback complet');
      analysis = buildFallbackAnalysis({ rawInput: normalizedInput, profile });
    }
    // Cas 2 : explication KO mais questions valides → fallback minimal
    else if (!explCheck.ok) {
      console.warn(`[PROGRESS] Explication KO (${explCheck.reason}) → fallback minimal sur explication, questions conservées`);
      analysis.explanation = {
        sectionTitle: analysis.sectionTitle || 'Section',
        understanding: "L'explication pédagogique n'a pas pu être générée correctement pour cette section. Les questions et QCM ci-dessous restent disponibles.",
        parts: []
      };
    }
    // Cas 3 : couverture faible → log informatif
    else if (coverage.total > 0 && coverage.ratio < 0.5) {
      console.warn(`[PROGRESS] Couverture faible (${coverage.covered}/${coverage.total}). Notions manquantes : ${coverage.missing.join(', ')}`);
    }

    // Cas 4 : aucun QCM valide
    if (qcmCheck.valid.length === 0 && (qcmCheck.invalid?.length || 0) > 0) {
      console.warn(`[PROGRESS] Tous les QCM invalides (${qcmCheck.invalid.map((i) => i.reason).join(',')}) → qcm vidé`);
    }

  } catch (err) {
    if (quota.reserved) await releaseSectionQuota(uid);
    throw err;
  }

  // ✅ Nettoyage des marqueurs internes AVANT sauvegarde
  if (analysis && typeof analysis === 'object') {
    delete analysis.__quality;
    delete analysis.__partial;
  }
  if (analysis.explanation && typeof analysis.explanation === 'object') {
    delete analysis.explanation.__truncated;
    delete analysis.explanation.__provider;
  }
  if (analysis.structure && typeof analysis.structure === 'object') {
    delete analysis.structure.__truncated;
    delete analysis.structure.__provider;
  }
  if (analysis.extracted && typeof analysis.extracted === 'object') {
    delete analysis.extracted.__truncated;
    delete analysis.extracted.__provider;
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

  const body = request.body && typeof request.body === 'object' ? request.body : {};
  const action = body.action || '';

  // ✅ AUTH d'abord
  let user;
  try { user = await verifyFirebaseToken(request); }
  catch (e) {
    console.error('Auth error:', e.message);
    return jsonError(response, 503, 'Service temporairement indisponible.');
  }

  if (!user) return jsonError(response, 401, 'Connexion requise.', 'AUTH_REQUIRED');

  // ✅ Rate limit APRÈS l'auth (par UID)
  if (rateLimitedByUid(user.uid, action)) {
    return jsonError(response, 429, 'Trop de requêtes. Patiente quelques secondes et réessaie.', 'RATE_LIMITED');
  }

  const uid = user.uid;

  console.log(`[PROGRESS v8.7] ${action} | uid=${uid.slice(0, 8)}`);

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
    console.error(`[PROGRESS v8.7] "${action}" failed:`, error.message);
    if (error.status) return jsonError(response, error.status, error.message, error.code);
    return jsonError(response, 500, error.message || 'Erreur serveur.');
  }
};
