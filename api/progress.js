// ================================================================
// API PROGRESS v9.2 — ARVEXA School
// v9.2 : questions exhaustives (pas de limite), explication profonde,
//        QCM fixés à 5, JSON_ARRAY_LIMITS séparé
// ================================================================

module.exports.config = { maxDuration: 120 };

const WINDOW_MS = 60 * 1000;

const RATE_LIMITS = {
  getDashboard: 60, listChapters: 60, createChapter: 30, getChapter: 60,
  createSection: 10, getSection: 60, updateNotes: 60, deleteSection: 30,
  deleteChapter: 30, getFullLesson: 30, trackStudyTime: 120,
  saveExamResult: 30, listExamResults: 60, getProgressionSummary: 60,
  markSectionStudied: 120, createGoal: 30, listGoals: 60, updateGoal: 30,
  deleteGoal: 30, createClassGrade: 30, listClassGrades: 60,
  updateClassGrade: 30, deleteClassGrade: 30, generatePlan: 10,
  listSessions: 60, createSession: 30, updateSession: 60, deleteSession: 30,
  getRecommendations: 60, getQuotaStatus: 60
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

const VALID_GRADE_TYPES = new Set([
  'interrogation', 'devoir', 'composition', 'oral', 'autre'
]);

let adminServices = null;

// ════════════════════════════════════════════════════════════════
// NORMALISATION LATEX
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
  '⁰':'0','¹':'1','²':'2','³':'3','⁴':'4','⁵':'5','⁶':'6','⁷':'7','⁸':'8','⁹':'9',
  '⁺':'+','⁻':'-','⁼':'=','⁽':'(','⁾':')','ⁿ':'n','ⁱ':'i'
};
const SUBSCRIPT_MAP = {
  '₀':'0','₁':'1','₂':'2','₃':'3','₄':'4','₅':'5','₆':'6','₇':'7','₈':'8','₉':'9',
  '₊':'+','₋':'-','₌':'=','₍':'(','₎':')'
};

const NO_ARG_LATEX_COMMANDS = [
  'rightleftharpoons','leftrightharpoons','longrightarrow','longleftarrow',
  'Longleftrightarrow','Longleftarrow','Longrightarrow','Leftrightarrow',
  'leftrightarrow','rightarrow','leftarrow','updownarrow','hookrightarrow',
  'hookleftarrow','Rightarrow','Leftarrow','varepsilon','vartheta','varsigma',
  'varrho','varphi','varpi','cdotp','cdot','times','div','pm','mp','ast',
  'star','bullet','circ','leq','geq','neq','approx','equiv','sim','simeq',
  'propto','cong','ll','gg','subset','supset','subseteq','supseteq','cup',
  'cap','emptyset','forall','exists','nexists','neg','wedge','vee','oplus',
  'otimes','odot','sum','prod','int','oint','partial','nabla','infty','aleph',
  'ell','hbar','alpha','beta','gamma','delta','epsilon','zeta','eta','theta',
  'iota','kappa','lambda','mu','nu','xi','pi','rho','sigma','tau','upsilon',
  'phi','chi','psi','omega','Gamma','Delta','Theta','Lambda','Xi','Pi','Sigma',
  'Upsilon','Phi','Psi','Omega','sin','cos','tan','cot','sec','csc','log','ln',
  'exp','lim','max','min','det','mod','gcd','lcm','quad','qquad'
];

const CMD_SPACE_REGEX = new RegExp(
  `(\\\\(?:${NO_ARG_LATEX_COMMANDS.join('|')}))(?=[a-zA-Z0-9])`, 'g'
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
      if (r.indexOf(uni) !== -1) r = r.split(uni).join(latex);
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
  r = r.replace(/\\begin\{([a-zA-Z*]+)\}([\s\S]*?)\\end\{\1\}/g, (match) => ` $$${match}$$ `);
  const KNOWN_CMDS = new Set([
    ...NO_ARG_LATEX_COMMANDS,
    'frac','sqrt','dfrac','tfrac','cfrac','text','mathrm','mathbf','mathit',
    'mathbb','mathcal','mathfrak','left','right','big','Big','bigg','Bigg',
    'overline','underline','vec','hat','bar','dot','ddot','tilde','binom',
    'choose','pmod','bmod','operatorname','sinh','cosh','tanh','arcsin',
    'arccos','arctan','lg','log','ln','exp','quad','qquad','hspace','vspace'
  ]);
  r = r.replace(/(\\[a-zA-Z]+)((?:\s*\{[^}]*\})*)((?:\s*[_^]\s*(?:\{[^}]*\}|[a-zA-Z0-9]))*)/g,
    (match, cmd, args, scripts) => {
      if (!KNOWN_CMDS.has(cmd.slice(1))) return match;
      return ` $${cmd}${args || ''}${scripts || ''}$ `;
    });
  r = r.replace(/(?:^|\s)([a-zA-Z]\s*[_^]\s*(?:\{[^}]*\}|[a-zA-Z0-9]))(?=\s|$|[.,;:!?])/g,
    (match, expr) => match.replace(expr, `$${expr.trim()}$`));
  for (let iteration = 0; iteration < 5; iteration++) {
    const before = r;
    r = r.replace(/\$\s*([^$]*?)\s*\$\s*([+\-*/=<>()\[\]{}.,\s]*?)\s*\$\s*([^$]*?)\s*\$/g,
      (m, a, ops, b) => ` $${a.trim()} ${ops.trim()} ${b.trim()}$ `);
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
    open = '$$'; close = '$$'; inner = formula.slice(2, -2);
  } else if (formula.startsWith('$') && formula.endsWith('$')) {
    open = '$'; close = '$'; inner = formula.slice(1, -1);
  } else return formula;
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
  r = parts.map((part, i) => i % 2 === 1 ? cleanFormulaContent(part) : part).join('');
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
          k === 'correct' || k === 'notionId' || k === 'number' ||
          k === 'source' || k === 'masteryLevel' || k === 'gradeType') {
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
// HELPERS ROBUSTES
// ════════════════════════════════════════════════════════════════
function docExists(snap) {
  if (!snap) return false;
  if (typeof snap.exists === 'function') return snap.exists();
  return Boolean(snap.exists);
}

function docData(snap) {
  if (!snap || typeof snap.data !== 'function') return {};
  return snap.data() || {};
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
    success: false, error, ...(code ? { code } : {})
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
  const hasPremium = data.premium === true || data.isUnlocked === true || data.hasDeposited === true;
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
  const timeouts = { 'Groq': 25000, 'OpenRouter': 30000, 'Mistral': 15000 };
  const baseTimeout = timeouts[provider.name] || 25000;
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
      if (repaired) { console.warn(`[AI] ${provider.name} — JSON réparé`); return repaired; }
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
      if (isStructural) return { status: 'rejected', error: r.reason, task: tasks[i], provider: 'none' };
      if (deadline && Date.now() > deadline - 10000) return { status: 'rejected', error: r.reason, task: tasks[i], provider: 'none' };
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
        } catch (e) { console.warn(`[FAN-OUT] Fallback ${provider.name} échoué : ${e.message}`); }
      }
      return { status: 'rejected', error: r.reason, task: tasks[i], provider: 'none' };
    })
  );
}

function mergeAnalysis(results, profile) {
  const merged = {
    profile, sectionTitle: null, explanation: null, structure: null, questions: [], qcm: [], extracted: null
  };
  for (const r of results) {
    if (r.status !== 'fulfilled' || !r.value) continue;
    const data = r.value;
    const taskName = r.task.name;
    switch (taskName) {
      case 'extraction': merged.sectionTitle = data.sectionTitle || merged.sectionTitle; merged.extracted = data; break;
      case 'explanation': merged.explanation = data; merged.sectionTitle = data.sectionTitle || merged.sectionTitle; break;
      case 'structure': merged.structure = data; break;
      case 'questions': merged.questions = Array.isArray(data.questions) ? data.questions : []; break;
      case 'qcm': merged.qcm = Array.isArray(data.qcm) ? data.qcm : []; break;
    }
  }
  if (merged.explanation && !Array.isArray(merged.explanation.parts)) merged.explanation.parts = [];
  if (merged.structure) {
    const arrayFields = [
      'formulas','examples','traps','mechanisms','definitions',
      'classifications','theses','vocabulary','plans','timeline',
      'causesConsequences','keyFigures','literaryDevices','texts','grammar','phrases'
    ];
    arrayFields.forEach((f) => {
      if (merged.structure[f] && !Array.isArray(merged.structure[f])) merged.structure[f] = [];
    });
    if (merged.structure.method && !Array.isArray(merged.structure.method.steps)) merged.structure.method.steps = [];
  }
  return merged;
}

// ────────────────────────────────────────────────────────────────
// PROMPTS — v9.2
// ────────────────────────────────────────────────────────────────
const LATEX_RULES = `
RÈGLE LATEX — OBLIGATOIRE :
- Toute formule mathématique DOIT être entre $...$ (inline) ou $$...$$ (display).
- INTERDIT : LaTeX brut sans $ (ex : "v = \\sqrt{x}" doit devenir "$v = \\sqrt{x}$").
- INTERDIT : symboles Unicode mathématiques bruts (π, √, ², ≤, ≥, ∞, →, ×, ·, ≠, ∈, ∑, ∫, Δ).
- Ajoute TOUJOURS un espace après une commande LaTeX sans argument (ex : "\\cdotp mol", pas "\\cdotpmol").
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
- Échappe correctement les guillemets doubles (\\").
`.trim();

const JSON_ARRAY_LIMITS = `
RÈGLE TABLEAUX :
- Maximum 5 éléments dans les tableaux : parts, keyTerms, relations, examples, traps, definitions, mechanisms, formulas, classifications, theses, vocabulary, plans, timeline, causesConsequences, keyFigures, literaryDevices, texts, grammar, phrases.
- EXCEPTION IMPORTANTE : le tableau "questions" n'a AUCUNE limite. Génère autant de questions que nécessaire pour couvrir TOUTES les notions du cours.
- EXCEPTION : le tableau "qcm" doit contenir EXACTEMENT 5 QCM (pas plus, pas moins).
`.trim();

const QUESTION_GEN_RULES = `
RÈGLES DE GÉNÉRATION DES QUESTIONS :
- Génère 2 à 4 questions par notion importante du cours.
- Cours court (5-10 lignes) : 8 à 12 questions MINIMUM.
- Cours moyen (15-20 lignes) : 15 à 25 questions MINIMUM.
- Cours long (30+ lignes) : 25 à 40 questions MINIMUM.
- Couvre TOUTES les définitions, formules, propriétés, méthodes et exemples du cours.
- Ne te limite JAMAIS à 5 questions — le tableau "questions" n'a pas de limite.
- Chaque question doit avoir : level (1=facile, 2=moyen, 3=difficile), importance (1=utile, 2=important, 3=indispensable), mustHave (2 à 4 éléments clés attendus).
`.trim();

const QCM_GEN_RULES = `
RÈGLES DE GÉNÉRATION DES QCM :
- Génère EXACTEMENT 5 QCM (ni plus, ni moins).
- Chaque QCM a 4 options (A, B, C, D) avec une seule réponse correcte.
- Les options incorrectes doivent être plausibles (pas d'options absurdes).
- Chaque QCM doit avoir une explication pédagogique.
`.trim();

const EXPLANATION_DEPTH_RULES = `
RÈGLES DE PROFONDEUR D'EXPLICATION :
- Chaque simpleExplanation doit contenir 5 à 10 phrases complètes (PAS 3-6).
- Ne te contente pas de reformuler le cours : ajoute des analogies, des exemples concrets, des mises en garde.
- Décompose les raisonnements complexes étape par étape.
- Pour chaque formule : à quoi elle sert, quand l'utiliser, ses conditions de validité.
- toRemember : 2 à 3 phrases de synthèse.
- Maximum 8 parties (parts) — utilisez 6-8 si le cours est riche.
`.trim();

function buildScientificPrompts({ subjectLabel, rawInput }) {
  const baseContext = `Matière : ${subjectLabel}
═══════════════════════════════════════════════════════════════
CONTENU DE LA SECTION FOURNIE PAR L'ÉLÈVE
═══════════════════════════════════════════════════════════════
${rawInput}
═══════════════════════════════════════════════════════════════`.trim();

  return [
    {
      name: 'extraction', maxTokens: 1500,
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
      name: 'explanation', maxTokens: 8000,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide, sans commentaire.',
      userPrompt: `Tu es professeur expert du BAC. Explique cette section EN PROFONDEUR comme à un élève qui découvre le sujet pour la première fois.

${baseContext}

${PERIMETER_RULES}
${LATEX_RULES}
${EXPLANATION_DEPTH_RULES}

Format JSON :
{
  "sectionTitle": "...",
  "understanding": "Ce que tu dois comprendre en 3-4 phrases.",
  "parts": [
    {
      "partTitle": "Partie 1",
      "mainIdea": "Idée principale",
      "simpleExplanation": "Explication en français simple (5-10 phrases détaillées).",
      "keyTerms": [{"term": "...", "meaning": "..."}],
      "relations": ["relation 1"],
      "example": "Exemple chiffré si présent",
      "toRemember": "2-3 phrases de synthèse."
    }
  ]
}

${JSON_STRICT_RULES}
${JSON_ARRAY_LIMITS}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'structure', maxTokens: 3500,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Extrait la structure scientifique de cette section.

${baseContext}

${PERIMETER_RULES}
${LATEX_RULES}

Format JSON :
{
  "formulas": [{"latex": "$z = a + bi$", "description": "...", "variables": [{"symbol": "a", "meaning": "..."}], "condition": "..."}],
  "method": {"title": "Méthode", "steps": ["Étape 1"]},
  "examples": [{"enonce": "...", "steps": ["..."], "result": "$...$"}],
  "traps": [{"trap": "...", "solution": "..."}]
}

${JSON_STRICT_RULES}
${JSON_ARRAY_LIMITS}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'questions', maxTokens: 12000,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Génère une banque EXHAUSTIVE de questions basée UNIQUEMENT sur cette section.

${baseContext}

${PERIMETER_RULES}
${LATEX_RULES}
${QUESTION_GEN_RULES}

Format JSON :
{
  "questions": [{"id": "q1", "level": 1, "type": "definition", "question": "...", "answer": "...", "mustHave": ["..."], "importance": 1}]
}

${JSON_STRICT_RULES}
${JSON_ARRAY_LIMITS}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'qcm', maxTokens: 5000,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Génère EXACTEMENT 5 QCM basés UNIQUEMENT sur cette section.

${baseContext}

${PERIMETER_RULES}
${LATEX_RULES}
${QCM_GEN_RULES}

Format JSON :
{
  "qcm": [{"question": "...", "options": [{"id":"A","text":"..."},{"id":"B","text":"..."},{"id":"C","text":"..."},{"id":"D","text":"..."}], "correct": "A", "explanation": "..."}]
}

${JSON_STRICT_RULES}
${JSON_ARRAY_LIMITS}

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

  return [
    {
      name: 'extraction', maxTokens: 1500,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Analyse cette section de SVT.

${baseContext}

${PERIMETER_RULES}

RÈGLE SVT : PAS de formules. Priorise mécanismes, relations, étapes, définitions.

Format JSON :
{
  "sectionTitle": "...",
  "mainConcepts": ["..."],
  "terms": [{"term": "...", "definition": "..."}],
  "mechanisms": ["mécanisme 1"]
}

${JSON_STRICT_RULES}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'explanation', maxTokens: 8000,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide, sans commentaire.',
      userPrompt: `Tu es professeur de SVT. Explique cette section EN PROFONDEUR comme à un élève qui découvre.

${baseContext}

${PERIMETER_RULES}
${EXPLANATION_DEPTH_RULES}

Format JSON :
{
  "sectionTitle": "...",
  "understanding": "3-4 phrases.",
  "parts": [
    {
      "partTitle": "...",
      "mainIdea": "...",
      "simpleExplanation": "5-10 phrases détaillées.",
      "terms": [{"term": "...", "meaning": "..."}],
      "mechanism": {"description": "...", "steps": ["Étape 1"]},
      "relations": ["relation 1"],
      "toRemember": "2-3 phrases."
    }
  ]
}

${JSON_STRICT_RULES}
${JSON_ARRAY_LIMITS}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'structure', maxTokens: 3000,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Structure cette section de SVT.

${baseContext}

${PERIMETER_RULES}

Format JSON :
{
  "mechanisms": [{"name": "...", "steps": ["..."], "relations": ["..."], "consequences": ["..."]}],
  "definitions": [{"term": "...", "definition": "..."}],
  "classifications": [{"category": "...", "items": ["..."]}]
}

${JSON_STRICT_RULES}
${JSON_ARRAY_LIMITS}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'questions', maxTokens: 12000,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Génère une banque EXHAUSTIVE de questions de SVT sur cette section.

${baseContext}

${PERIMETER_RULES}
${QUESTION_GEN_RULES}

Format JSON :
{
  "questions": [{"id": "q1", "level": 1, "type": "definition", "question": "...", "answer": "...", "mustHave": ["..."], "importance": 1}]
}

${JSON_STRICT_RULES}
${JSON_ARRAY_LIMITS}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'qcm', maxTokens: 5000,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Génère EXACTEMENT 5 QCM de SVT sur cette section.

${baseContext}

${PERIMETER_RULES}
${QCM_GEN_RULES}

Format JSON :
{
  "qcm": [{"question": "...", "options": [{"id":"A","text":"..."},{"id":"B","text":"..."},{"id":"C","text":"..."},{"id":"D","text":"..."}], "correct": "A", "explanation": "..."}]
}

${JSON_STRICT_RULES}
${JSON_ARRAY_LIMITS}

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

  return [
    {
      name: 'extraction', maxTokens: 1500,
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
      name: 'explanation', maxTokens: 8000,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide, sans commentaire.',
      userPrompt: `Tu es professeur de philosophie. Explique cette section EN PROFONDEUR comme à un élève qui n'y connaît RIEN.

${baseContext}

${PERIMETER_RULES}
${EXPLANATION_DEPTH_RULES}

Format JSON :
{
  "sectionTitle": "...",
  "understanding": "3-4 phrases.",
  "parts": [
    {
      "partTitle": "...",
      "mainIdea": "...",
      "simpleExplanation": "5-10 phrases détaillées.",
      "keyTerms": [{"term": "...", "meaning": "..."}],
      "arguments": ["Argument 1"],
      "everydayExamples": ["Exemple 1"],
      "toRemember": "2-3 phrases."
    }
  ]
}

${JSON_STRICT_RULES}
${JSON_ARRAY_LIMITS}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'structure', maxTokens: 3000,
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
${JSON_ARRAY_LIMITS}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'questions', maxTokens: 12000,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Génère une banque EXHAUSTIVE de questions de philosophie sur cette section.

${baseContext}

${PERIMETER_RULES}
${QUESTION_GEN_RULES}

Format JSON :
{
  "questions": [{"id": "q1", "level": 1, "type": "definition", "question": "...", "answer": "Une phrase complète.", "mustHave": ["..."], "importance": 1}]
}

${JSON_STRICT_RULES}
${JSON_ARRAY_LIMITS}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'qcm', maxTokens: 5000,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Génère EXACTEMENT 5 QCM de philosophie sur cette section.

${baseContext}

${PERIMETER_RULES}
${QCM_GEN_RULES}

Format JSON :
{
  "qcm": [{"question": "...", "options": [{"id":"A","text":"..."},{"id":"B","text":"..."},{"id":"C","text":"..."},{"id":"D","text":"..."}], "correct": "A", "explanation": "..."}]
}

${JSON_STRICT_RULES}
${JSON_ARRAY_LIMITS}

Réponds UNIQUEMENT avec le JSON.`
    }
  ];
}

function buildHistoryPrompts({ subjectLabel, rawInput }) {
  const baseContext = `Matière : ${subjectLabel}
═══════════════════════════════════════════════════════════════
CONTENU DE LA SECTION FOURNIE PAR L'ÉLÈVE
═══════════════════════════════════════════════════════════════
${rawInput}
═══════════════════════════════════════════════════════════════`.trim();

  return [
    {
      name: 'extraction', maxTokens: 1800,
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
      name: 'explanation', maxTokens: 5000,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Présente cette section d'histoire-géo de manière CLAIRE, CONCISE mais COMPLÈTE.

${baseContext}

${PERIMETER_RULES}

Format JSON :
{
  "sectionTitle": "...",
  "understanding": "Résumé en 6-10 phrases.",
  "context": "...",
  "keyFacts": ["fait 1"]
}

${JSON_STRICT_RULES}
${JSON_ARRAY_LIMITS}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'structure', maxTokens: 2500,
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
${JSON_ARRAY_LIMITS}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'questions', maxTokens: 12000,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Génère une BANQUE MASSIVE de questions d'histoire-géo sur cette section.

${baseContext}

${PERIMETER_RULES}
${QUESTION_GEN_RULES}

Format JSON :
{
  "questions": [{"id": "q1", "level": 1, "type": "date", "question": "...", "answer": "...", "mustHave": ["..."], "importance": 1}]
}

${JSON_STRICT_RULES}
${JSON_ARRAY_LIMITS}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'qcm', maxTokens: 5000,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Génère EXACTEMENT 5 QCM d'histoire-géo sur cette section.

${baseContext}

${PERIMETER_RULES}
${QCM_GEN_RULES}

Format JSON :
{
  "qcm": [{"question": "...", "options": [{"id":"A","text":"..."},{"id":"B","text":"..."},{"id":"C","text":"..."},{"id":"D","text":"..."}], "correct": "A", "explanation": "..."}]
}

${JSON_STRICT_RULES}
${JSON_ARRAY_LIMITS}

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
      name: 'extraction', maxTokens: 1500,
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
      name: 'explanation', maxTokens: 6000,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Tu es professeur de français. Explique cette section EN PROFONDEUR.

${baseContext}

${PERIMETER_RULES}
${EXPLANATION_DEPTH_RULES}

Format JSON :
{
  "sectionTitle": "...",
  "understanding": "3-4 phrases.",
  "parts": [
    {
      "partTitle": "...",
      "mainIdea": "...",
      "simpleExplanation": "5-10 phrases détaillées.",
      "keyTerms": [{"term": "...", "meaning": "..."}],
      "toRemember": "2-3 phrases."
    }
  ]
}

${JSON_STRICT_RULES}
${JSON_ARRAY_LIMITS}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'structure', maxTokens: 2500,
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
${JSON_ARRAY_LIMITS}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'questions', maxTokens: 12000,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Génère une banque EXHAUSTIVE de questions de français sur cette section.

${baseContext}

${PERIMETER_RULES}
${QUESTION_GEN_RULES}

Format JSON :
{
  "questions": [{"id": "q1", "level": 1, "type": "definition", "question": "...", "answer": "Une phrase complète.", "mustHave": ["..."], "importance": 1}]
}

${JSON_STRICT_RULES}
${JSON_ARRAY_LIMITS}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'qcm', maxTokens: 5000,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Génère EXACTEMENT 5 QCM de français sur cette section.

${baseContext}

${PERIMETER_RULES}
${QCM_GEN_RULES}

Format JSON :
{
  "qcm": [{"question": "...", "options": [{"id":"A","text":"..."},{"id":"B","text":"..."},{"id":"C","text":"..."},{"id":"D","text":"..."}], "correct": "A", "explanation": "..."}]
}

${JSON_STRICT_RULES}
${JSON_ARRAY_LIMITS}

Réponds UNIQUEMENT avec le JSON.`
    }
  ];
}

function buildLanguagePrompts({ subjectLabel, rawInput }) {
  const baseContext = `Matière : ${subjectLabel}
═══════════════════════════════════════════════════════════════
CONTENU DE LA SECTION FOURNIE PAR L'ÉLÈVE
═══════════════════════════════════════════════════════════════
${rawInput}
═══════════════════════════════════════════════════════════════`.trim();

  return [
    {
      name: 'extraction', maxTokens: 1500,
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
      name: 'explanation', maxTokens: 7000,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Tu es professeur d'anglais pour des FRANCOPHONES DÉBUTANTS. Explique EN PROFONDEUR.

${baseContext}

${PERIMETER_RULES}
${EXPLANATION_DEPTH_RULES}

Format JSON :
{
  "sectionTitle": "...",
  "understanding": "3-4 phrases.",
  "parts": [
    {
      "partTitle": "...",
      "mainIdea": "...",
      "simpleExplanation": "5-10 phrases en français.",
      "keyTerms": [{"english": "word", "french": "traduction", "example": "example"}],
      "examples": [{"english": "English sentence.", "french": "Traduction."}],
      "commonMistakes": [{"mistake": "...", "correction": "..."}],
      "toRemember": "2-3 phrases."
    }
  ]
}

${JSON_STRICT_RULES}
${JSON_ARRAY_LIMITS}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'structure', maxTokens: 3000,
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
${JSON_ARRAY_LIMITS}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'questions', maxTokens: 12000,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Génère une banque EXHAUSTIVE de questions d'anglais.

${baseContext}

${PERIMETER_RULES}
${QUESTION_GEN_RULES}

Format JSON :
{
  "questions": [{"id": "q1", "level": 1, "type": "vocabulary", "question": "...", "answer": "...", "mustHave": ["..."], "importance": 1}]
}

${JSON_STRICT_RULES}
${JSON_ARRAY_LIMITS}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'qcm', maxTokens: 5000,
      systemPrompt: 'Tu produis EXCLUSIVEMENT du JSON valide.',
      userPrompt: `Génère EXACTEMENT 5 QCM d'anglais sur cette section.

${baseContext}

${PERIMETER_RULES}
${QCM_GEN_RULES}

Format JSON :
{
  "qcm": [{"question": "...", "options": [{"id":"A","text":"..."},{"id":"B","text":"..."},{"id":"C","text":"..."},{"id":"D","text":"..."}], "correct": "A", "explanation": "..."}]
}

${JSON_STRICT_RULES}
${JSON_ARRAY_LIMITS}

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
    if (!docExists(userSnap)) throw new Error('profile_missing');
    if (isPremiumUser(docData(userSnap))) {
      return { allowed: true, premium: true, used: 0, limit: Infinity, reserved: false };
    }
    const quotaSnap = await transaction.get(quotaRef);
    const used = Number(docData(quotaSnap)?.count || 0);
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
      const used = Math.max(0, Number(docData(snap)?.count || 0) - 1);
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

// ────────────────────────────────────────────────────────────────
// ACTIONS
// ────────────────────────────────────────────────────────────────
async function getDashboard(uid) {
  const { db } = getAdminServices();
  const chaptersPromises = ALLOWED_SUBJECTS_ARRAY.map((subjectKey) =>
    db.collection('users').doc(uid).collection('notebooks').doc(subjectKey)
      .collection('chapters').orderBy('updatedAt', 'desc').limit(50).get()
      .catch(() => ({ docs: [] }))
  );
  const streakPromise = computeStreak(uid);
  const studyTimePromise = computeStudyTime(uid);
  const quotaPromise = getQuotaStatus(uid).catch(() => null);

  const [chaptersResults, streak, studyTime, quota] = await Promise.all([
    Promise.all(chaptersPromises), streakPromise, studyTimePromise, quotaPromise
  ]);

  const subjects = [];
  let totalChapters = 0, totalSections = 0, totalStudied = 0;

  ALLOWED_SUBJECTS_ARRAY.forEach((subjectKey, index) => {
    const chaptersSnap = chaptersResults[index];
    const info = SUBJECT_INFO[subjectKey];
    const docs = (chaptersSnap && Array.isArray(chaptersSnap.docs)) ? chaptersSnap.docs : [];
    if (docs.length === 0) return;
    const chapters = docs.map((d) => {
      const data = docData(d);
      return {
        id: d.id,
        title: data.title || 'Chapitre',
        sectionsCount: data.sectionsCount || 0,
        sectionsStudied: data.sectionsStudied || 0,
        last: formatRelativeDate(data.updatedAt || data.createdAt)
      };
    });
    const subjectSections = chapters.reduce((s, c) => s + c.sectionsCount, 0);
    const subjectStudied = chapters.reduce((s, c) => s + c.sectionsStudied, 0);
    totalChapters += chapters.length;
    totalSections += subjectSections;
    totalStudied += subjectStudied;
    subjects.push({
      key: subjectKey, label: info.label,
      chaptersCount: chapters.length,
      sectionsCount: subjectSections, sectionsStudied: subjectStudied,
      last: chapters[0]?.last || ''
    });
  });

  subjects.sort((a, b) => b.sectionsCount - a.sectionsCount);

  let recentActivity = [];
  if (subjects.length > 0) {
    const topSubject = subjects[0];
    try {
      const lastChaptersSnap = await db.collection('users').doc(uid)
        .collection('notebooks').doc(topSubject.key).collection('chapters')
        .orderBy('updatedAt', 'desc').limit(3).get();
      const docs = (lastChaptersSnap && Array.isArray(lastChaptersSnap.docs)) ? lastChaptersSnap.docs : [];
      recentActivity = docs.map((d) => {
        const data = docData(d);
        return {
          subject: topSubject.key, subjectLabel: topSubject.label,
          chapterId: d.id, chapterTitle: data.title || 'Chapitre',
          sectionsCount: data.sectionsCount || 0,
          time: formatRelativeDate(data.updatedAt || data.createdAt)
        };
      });
    } catch (e) {}
  }

  return {
    success: true,
    summary: { subjectsCount: subjects.length, totalChapters, totalSections, totalStudied },
    streak, studyTime, quota, subjects, recentActivity
  };
}

async function computeStreak(uid) {
  const { db } = getAdminServices();
  let snap;
  try {
    snap = await db.collection('users').doc(uid).collection('dailyActivity')
      .orderBy('date', 'desc').limit(90).get();
  } catch (e) { return { current: 0, best: 0 }; }
  const docs = (snap && Array.isArray(snap.docs)) ? snap.docs : [];
  if (docs.length === 0) return { current: 0, best: 0 };
  const activeDates = new Set(docs.map((d) => docData(d).date).filter(Boolean));
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
  const snap = await db.collection('users').doc(uid)
    .collection('notebooks').doc(subject).collection('chapters')
    .orderBy('updatedAt', 'desc').limit(100).get();
  const docs = (snap && Array.isArray(snap.docs)) ? snap.docs : [];
  const chapters = docs.map((d) => {
    const data = docData(d);
    return {
      id: d.id, title: data.title || 'Chapitre',
      sectionsCount: data.sectionsCount || 0,
      sectionsStudied: data.sectionsStudied || 0,
      createdAt: toISO(data.createdAt), updatedAt: toISO(data.updatedAt),
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
  const ref = db.collection('users').doc(uid)
    .collection('notebooks').doc(subject).collection('chapters').doc();
  await ref.set({
    title: cleanTitle, sectionsCount: 0, sectionsStudied: 0,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  });
  return { success: true, chapter: { id: ref.id, title: cleanTitle, sectionsCount: 0, sectionsStudied: 0, last: 'à l\'instant' } };
}

async function getChapter(uid, body) {
  const { subject, chapterId } = body;
  if (!ALLOWED_SUBJECTS.has(subject)) throw { status: 400, message: 'Matière invalide.' };
  if (!chapterId) throw { status: 400, message: 'chapterId requis.' };

  const { db } = getAdminServices();
  const chapterRef = db.collection('users').doc(uid)
    .collection('notebooks').doc(subject).collection('chapters').doc(chapterId);

  const chapterSnap = await chapterRef.get();
  if (!docExists(chapterSnap)) throw { status: 404, message: 'Chapitre introuvable.' };

  const data = docData(chapterSnap);
  const sectionsSnap = await chapterRef.collection('sections').orderBy('createdAt', 'asc').get();
  const sectionDocs = (sectionsSnap && Array.isArray(sectionsSnap.docs)) ? sectionsSnap.docs : [];

  const sections = sectionDocs.map((d) => {
    const s = docData(d);
    const analysis = s.analysis || {};
    const questionsCount = Array.isArray(analysis.questions) ? analysis.questions.length : 0;
    const qcmCount = Array.isArray(analysis.qcm) ? analysis.qcm.length : 0;
    return {
      id: d.id, title: s.title || 'Section',
      questionsCount, qcmCount,
      studied: Boolean(s.studiedAt), studiedAt: toISO(s.studiedAt),
      time: formatRelativeDate(s.createdAt),
      status: s.studiedAt ? 'studied' : 'created'
    };
  });

  let latestResult = null;
  try {
    const examSnap = await db.collection('users').doc(uid).collection('examResults')
      .where('subject', '==', subject).limit(50).get();
    const examDocs = (examSnap && Array.isArray(examSnap.docs)) ? examSnap.docs : [];
    const filtered = examDocs
      .map((d) => ({ id: d.id, data: docData(d) }))
      .filter((entry) => entry.data.chapterId === chapterId)
      .sort((a, b) => {
        const aTime = a.data.date?.toMillis?.() || 0;
        const bTime = b.data.date?.toMillis?.() || 0;
        return bTime - aTime;
      });
    if (filtered.length > 0) {
      const entry = filtered[0];
      latestResult = {
        id: entry.id, percentage: entry.data.percentage,
        masteryLevel: entry.data.masteryLevel, date: toISO(entry.data.date)
      };
    }
  } catch (e) {
    console.warn('[getChapter] examResults lookup failed:', e.message);
  }

  return {
    success: true,
    chapter: {
      id: chapterId, title: data.title || 'Chapitre', subject,
      sectionsCount: sections.length,
      sectionsStudied: sections.filter((s) => s.studied).length,
      createdAt: toISO(data.createdAt), updatedAt: toISO(data.updatedAt)
    },
    sections, latestResult
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
  const chapterRef = db.collection('users').doc(uid)
    .collection('notebooks').doc(subject).collection('chapters').doc(chapterId);

  const chapterSnap = await chapterRef.get();
  if (!docExists(chapterSnap)) {
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

  console.log(`[FAN-OUT] ${tasks.length} tâches, ${providers.length} fournisseurs pour "${profile}"`);

  let analysis;
  try {
    const deadline = Date.now() + GLOBAL_AI_TIME_BUDGET_MS;
    const results = await runParallelTasks(tasks, providers, deadline);

    results.forEach((r) => {
      if (r.status === 'fulfilled') console.log(`[FAN-OUT] OK ${r.task.name} (via ${r.provider})`);
      else console.error(`[FAN-OUT] FAIL ${r.task.name} - ${r.error?.message || 'unknown'}`);
    });

    analysis = mergeAnalysis(results, profile);
    analysis = deepClean(analysis);

    if (!analysis.explanation || typeof analysis.explanation !== 'object') {
      analysis.explanation = {
        sectionTitle: analysis.sectionTitle || 'Section',
        understanding: 'L\'explication pédagogique n\'a pas pu être générée pour cette section. Les questions et QCM restent disponibles ci-dessous.',
        parts: []
      };
    }

    const hasContent = analysis.explanation || analysis.questions.length > 0;
    if (!hasContent) {
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
      id: sectionId, title: analysis.sectionTitle || 'Section',
      rawInput: trimmed, profile, analysis, userNotes: ''
    }
  };
}

async function getSection(uid, body) {
  const { subject, chapterId, sectionId } = body;
  if (!ALLOWED_SUBJECTS.has(subject)) throw { status: 400, message: 'Matière invalide.' };
  if (!chapterId || !sectionId) throw { status: 400, message: 'IDs manquants.' };

  const { db } = getAdminServices();
  const ref = db.collection('users').doc(uid)
    .collection('notebooks').doc(subject).collection('chapters').doc(chapterId)
    .collection('sections').doc(sectionId);

  const snap = await ref.get();
  if (!docExists(snap)) throw { status: 404, message: 'Section introuvable.' };

  const s = docData(snap);
  return {
    success: true,
    section: {
      id: sectionId, title: s.title || 'Section', subject, chapterId,
      rawInput: s.rawInput || '', profile: s.profile || 'scientific',
      analysis: s.analysis || {}, userNotes: s.userNotes || '',
      createdAt: toISO(s.createdAt), time: formatRelativeDate(s.createdAt)
    }
  };
}

async function updateNotes(uid, body) {
  const { subject, chapterId, sectionId, userNotes } = body;
  if (!ALLOWED_SUBJECTS.has(subject)) throw { status: 400, message: 'Matière invalide.' };
  if (!chapterId || !sectionId) throw { status: 400, message: 'IDs manquants.' };
  if (typeof userNotes !== 'string') throw { status: 400, message: 'userNotes invalide.' };
  const { db, FieldValue } = getAdminServices();
  const ref = db.collection('users').doc(uid)
    .collection('notebooks').doc(subject).collection('chapters').doc(chapterId)
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
  const chapterRef = db.collection('users').doc(uid)
    .collection('notebooks').doc(subject).collection('chapters').doc(chapterId);
  const sectionRef = chapterRef.collection('sections').doc(sectionId);
  const snap = await sectionRef.get();
  if (!docExists(snap)) throw { status: 404, message: 'Section introuvable.' };
  const wasStudied = Boolean(docData(snap).studiedAt);
  await sectionRef.delete();
  const updates = {
    sectionsCount: FieldValue.increment(-1),
    updatedAt: FieldValue.serverTimestamp()
  };
  if (wasStudied) updates.sectionsStudied = FieldValue.increment(-1);
  await chapterRef.set(updates, { merge: true });
  return { success: true };
}

async function deleteChapter(uid, body) {
  const { subject, chapterId } = body;
  if (!ALLOWED_SUBJECTS.has(subject)) throw { status: 400, message: 'Matière invalide.' };
  if (!chapterId) throw { status: 400, message: 'chapterId requis.' };
  const { db } = getAdminServices();
  const chapterRef = db.collection('users').doc(uid)
    .collection('notebooks').doc(subject).collection('chapters').doc(chapterId);
  const snap = await chapterRef.get();
  if (!docExists(snap)) throw { status: 404, message: 'Chapitre introuvable.' };
  const sectionsSnap = await chapterRef.collection('sections').get();
  const sectionDocs = (sectionsSnap && Array.isArray(sectionsSnap.docs)) ? sectionsSnap.docs : [];
  const batch = db.batch();
  sectionDocs.forEach((d) => batch.delete(d.ref));
  batch.delete(chapterRef);
  await batch.commit();
  return { success: true };
}

async function getFullLesson(uid, body) {
  const { subject, chapterId } = body;
  if (!ALLOWED_SUBJECTS.has(subject)) throw { status: 400, message: 'Matière invalide.' };
  if (!chapterId) throw { status: 400, message: 'chapterId requis.' };
  const { db } = getAdminServices();
  const chapterRef = db.collection('users').doc(uid)
    .collection('notebooks').doc(subject).collection('chapters').doc(chapterId);
  const chapterSnap = await chapterRef.get();
  if (!docExists(chapterSnap)) throw { status: 404, message: 'Chapitre introuvable.' };
  const sectionsSnap = await chapterRef.collection('sections').orderBy('createdAt', 'asc').get();
  const sectionDocs = (sectionsSnap && Array.isArray(sectionsSnap.docs)) ? sectionsSnap.docs : [];
  const sections = sectionDocs.map((d) => {
    const s = docData(d);
    return {
      id: d.id, title: s.title || 'Section',
      profile: s.profile || 'scientific',
      analysis: s.analysis || {}, userNotes: s.userNotes || ''
    };
  });
  return {
    success: true,
    chapter: { id: chapterId, title: docData(chapterSnap).title || 'Chapitre', subject },
    sections
  };
}

async function saveExamResult(uid, body) {
  const { subject, chapterId, chapterTitle, score, maxScore, answers, examType } = body;
  if (!ALLOWED_SUBJECTS.has(subject)) throw { status: 400, message: 'Matière invalide.' };
  if (typeof score !== 'number' || score < 0) throw { status: 400, message: 'Score invalide.' };
  if (typeof maxScore !== 'number' || maxScore <= 0) throw { status: 400, message: 'maxScore invalide.' };
  const { db, FieldValue } = getAdminServices();
  const ref = db.collection('users').doc(uid).collection('examResults').doc();
  const pct = Math.min(100, Math.max(0, Math.round((score / maxScore) * 100)));
  const masteryLevel = pct >= 80 ? 'mastered' : 'to_review';
  await ref.set({
    subject, chapterId: chapterId || null, chapterTitle: chapterTitle || null,
    score, maxScore, percentage: pct, masteryLevel,
    answers: answers || {}, examType: examType || 'arvexa', type: 'arvexa',
    date: FieldValue.serverTimestamp(), createdAt: FieldValue.serverTimestamp()
  });
  return {
    success: true,
    result: { id: ref.id, subject, chapterId: chapterId || null, percentage: pct, masteryLevel }
  };
}

async function listExamResults(uid, body) {
  const { subject, chapterId, limit = 50 } = body;
  const { db } = getAdminServices();
  let q = db.collection('users').doc(uid).collection('examResults');
  if (subject) q = q.where('subject', '==', subject);
  q = q.orderBy('date', 'desc').limit(Math.min(200, limit));
  const snap = await q.get();
  const docs = (snap && Array.isArray(snap.docs)) ? snap.docs : [];
  let results = docs.map((d) => {
    const data = docData(d);
    return {
      id: d.id, subject: data.subject, chapterId: data.chapterId, chapterTitle: data.chapterTitle,
      score: data.score, maxScore: data.maxScore, percentage: data.percentage,
      masteryLevel: data.masteryLevel, examType: data.examType, date: toISO(data.date)
    };
  });
  if (chapterId) results = results.filter((r) => r.chapterId === chapterId);
  return { success: true, results };
}

async function getProgressionSummary(uid) {
  const { db } = getAdminServices();
  let totalSections = 0, totalStudied = 0;
  const chaptersPromises = ALLOWED_SUBJECTS_ARRAY.map((subjectKey) =>
    db.collection('users').doc(uid).collection('notebooks').doc(subjectKey)
      .collection('chapters').get().catch(() => ({ docs: [] }))
  );
  const chaptersResults = await Promise.all(chaptersPromises);
  const allChapters = [];
  chaptersResults.forEach((snap, idx) => {
    const subjectKey = ALLOWED_SUBJECTS_ARRAY[idx];
    const docs = (snap && Array.isArray(snap.docs)) ? snap.docs : [];
    docs.forEach((d) => {
      const data = docData(d);
      totalSections += Number(data.sectionsCount || 0);
      totalStudied += Number(data.sectionsStudied || 0);
      allChapters.push({
        subject: subjectKey, chapterId: d.id, title: data.title,
        sectionsCount: Number(data.sectionsCount || 0),
        sectionsStudied: Number(data.sectionsStudied || 0)
      });
    });
  });

  const advancementPercent = totalSections > 0 ? Math.round((totalStudied / totalSections) * 100) : 0;
  const examSnap = await db.collection('users').doc(uid).collection('examResults')
    .orderBy('date', 'desc').limit(500).get().catch(() => ({ docs: [] }));
  const examDocs = (examSnap && Array.isArray(examSnap.docs)) ? examSnap.docs : [];
  const latestByChapter = new Map();
  examDocs.forEach((d) => {
    const data = docData(d);
    if (!data.chapterId) return;
    const key = `${data.subject}_${data.chapterId}`;
    if (!latestByChapter.has(key)) {
      latestByChapter.set(key, {
        subject: data.subject, chapterId: data.chapterId,
        percentage: Number(data.percentage || 0), masteryLevel: data.masteryLevel
      });
    }
  });

  let totalEvaluated = 0, totalMastered = 0;
  const bySubject = {};
  ALLOWED_SUBJECTS_ARRAY.forEach((subj) => {
    bySubject[subj] = { evaluated: 0, mastered: 0, advancement: 0, sectionsStudied: 0, sectionsTotal: 0 };
  });
  latestByChapter.forEach((v) => {
    totalEvaluated++;
    if (v.masteryLevel === 'mastered' || v.percentage >= 80) {
      totalMastered++;
      if (bySubject[v.subject]) bySubject[v.subject].mastered++;
    }
    if (bySubject[v.subject]) bySubject[v.subject].evaluated++;
  });
  const masteryPercent = totalEvaluated > 0 ? Math.round((totalMastered / totalEvaluated) * 100) : 0;
  allChapters.forEach((c) => {
    if (bySubject[c.subject]) {
      bySubject[c.subject].sectionsStudied += c.sectionsStudied;
      bySubject[c.subject].sectionsTotal += c.sectionsCount;
    }
  });
  Object.keys(bySubject).forEach((s) => {
    const b = bySubject[s];
    b.advancement = b.sectionsTotal > 0 ? Math.round((b.sectionsStudied / b.sectionsTotal) * 100) : 0;
  });
  return {
    success: true,
    advancement: { totalSections, totalStudied, percent: advancementPercent },
    mastery: { totalEvaluated, totalMastered, percent: masteryPercent, threshold: 80 },
    bySubject
  };
}

async function markSectionStudied(uid, body) {
  const { subject, chapterId, sectionId } = body;
  if (!ALLOWED_SUBJECTS.has(subject)) throw { status: 400, message: 'Matière invalide.' };
  if (!chapterId || !sectionId) throw { status: 400, message: 'IDs manquants.' };
  const { db, FieldValue } = getAdminServices();
  const sectionRef = db.collection('users').doc(uid)
    .collection('notebooks').doc(subject).collection('chapters').doc(chapterId)
    .collection('sections').doc(sectionId);
  const snap = await sectionRef.get();
  if (!docExists(snap)) throw { status: 404, message: 'Section introuvable.' };
  if (docData(snap).studiedAt) return { success: true, alreadyStudied: true };
  await sectionRef.set({ studiedAt: FieldValue.serverTimestamp() }, { merge: true });
  const chapterRef = sectionRef.parent.parent;
  await chapterRef.set({
    sectionsStudied: FieldValue.increment(1),
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });
  return { success: true, alreadyStudied: false };
}

async function createGoal(uid, body) {
  const { type, subject, chapterId, title, target, deadline } = body;
  if (!['weekly', 'subject'].includes(type)) throw { status: 400, message: 'Type d\'objectif invalide.' };
  if (type === 'subject' && !ALLOWED_SUBJECTS.has(subject)) throw { status: 400, message: 'Matière invalide.' };
  if (!title || title.trim().length < 2) throw { status: 400, message: 'Titre trop court.' };
  if (typeof target !== 'number' || target <= 0) throw { status: 400, message: 'Cible invalide.' };
  const { db, FieldValue } = getAdminServices();
  const ref = db.collection('users').doc(uid).collection('goals').doc();
  await ref.set({
    type, subject: type === 'subject' ? subject : null,
    chapterId: chapterId || null, title: title.trim().slice(0, 200),
    target: Number(target), current: 0,
    deadline: deadline ? new Date(deadline) : null,
    status: 'pending',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  });
  return { success: true, goalId: ref.id };
}

async function listGoals(uid) {
  const { db } = getAdminServices();
  const snap = await db.collection('users').doc(uid).collection('goals')
    .orderBy('createdAt', 'desc').limit(100).get();
  const docs = (snap && Array.isArray(snap.docs)) ? snap.docs : [];
  const goals = docs.map((d) => {
    const data = docData(d);
    return {
      id: d.id, type: data.type, subject: data.subject, chapterId: data.chapterId,
      title: data.title, target: data.target, current: data.current,
      deadline: toISO(data.deadline), status: data.status,
      progress: data.target > 0 ? Math.min(100, Math.round((data.current / data.target) * 100)) : 0
    };
  });
  return { success: true, goals };
}

async function updateGoal(uid, body) {
  const { goalId, current, status } = body;
  if (!goalId) throw { status: 400, message: 'goalId requis.' };
  const { db, FieldValue } = getAdminServices();
  const ref = db.collection('users').doc(uid).collection('goals').doc(goalId);
  const snap = await ref.get();
  if (!docExists(snap)) throw { status: 404, message: 'Objectif introuvable.' };
  const updates = { updatedAt: FieldValue.serverTimestamp() };
  if (typeof current === 'number') {
    updates.current = Math.max(0, current);
    const data = docData(snap);
    if (updates.current >= data.target) updates.status = 'achieved';
    else if (updates.current > 0) updates.status = 'in_progress';
  }
  if (status && ['pending', 'in_progress', 'achieved', 'overdue'].includes(status)) {
    updates.status = status;
  }
  await ref.set(updates, { merge: true });
  return { success: true };
}

async function deleteGoal(uid, body) {
  const { goalId } = body;
  if (!goalId) throw { status: 400, message: 'goalId requis.' };
  const { db } = getAdminServices();
  await db.collection('users').doc(uid).collection('goals').doc(goalId).delete();
  return { success: true };
}

async function createClassGrade(uid, body) {
  const { subject, chapterId, gradeType, score, maxScore, date, comment } = body;
  if (!ALLOWED_SUBJECTS.has(subject)) throw { status: 400, message: 'Matière invalide.' };
  if (!VALID_GRADE_TYPES.has(gradeType)) throw { status: 400, message: 'Type de note invalide.' };
  if (typeof score !== 'number' || score < 0) throw { status: 400, message: 'Note invalide.' };
  if (typeof maxScore !== 'number' || maxScore <= 0) throw { status: 400, message: 'Barème invalide.' };
  if (score > maxScore) throw { status: 400, message: 'Note supérieure au barème.' };
  const { db, FieldValue } = getAdminServices();
  const ref = db.collection('users').doc(uid).collection('classGrades').doc();
  await ref.set({
    subject, chapterId: chapterId || null, gradeType,
    score: Number(score), maxScore: Number(maxScore),
    date: date ? new Date(date) : new Date(),
    comment: comment ? String(comment).slice(0, 500) : '',
    type: 'manual',
    createdAt: FieldValue.serverTimestamp()
  });
  return { success: true, gradeId: ref.id };
}

async function listClassGrades(uid, body) {
  const { subject, limit = 100 } = body;
  const { db } = getAdminServices();
  let q = db.collection('users').doc(uid).collection('classGrades');
  if (subject) q = q.where('subject', '==', subject);
  q = q.orderBy('date', 'desc').limit(Math.min(200, limit));
  const snap = await q.get();
  const docs = (snap && Array.isArray(snap.docs)) ? snap.docs : [];
  const grades = docs.map((d) => {
    const data = docData(d);
    return {
      id: d.id, subject: data.subject, chapterId: data.chapterId,
      gradeType: data.gradeType, score: data.score, maxScore: data.maxScore,
      date: toISO(data.date), comment: data.comment, type: data.type
    };
  });
  return { success: true, grades };
}

async function updateClassGrade(uid, body) {
  const { gradeId, score, maxScore, comment } = body;
  if (!gradeId) throw { status: 400, message: 'gradeId requis.' };
  const { db } = getAdminServices();
  const ref = db.collection('users').doc(uid).collection('classGrades').doc(gradeId);
  const snap = await ref.get();
  if (!docExists(snap)) throw { status: 404, message: 'Note introuvable.' };
  const updates = {};
  if (typeof score === 'number') updates.score = score;
  if (typeof maxScore === 'number') updates.maxScore = maxScore;
  if (typeof comment === 'string') updates.comment = comment.slice(0, 500);
  const existing = docData(snap);
  const finalScore = updates.score !== undefined ? updates.score : existing.score;
  const finalMax = updates.maxScore !== undefined ? updates.maxScore : existing.maxScore;
  if (finalScore > finalMax) throw { status: 400, message: 'Note supérieure au barème.' };
  await ref.set(updates, { merge: true });
  return { success: true };
}

async function deleteClassGrade(uid, body) {
  const { gradeId } = body;
  if (!gradeId) throw { status: 400, message: 'gradeId requis.' };
  const { db } = getAdminServices();
  await db.collection('users').doc(uid).collection('classGrades').doc(gradeId).delete();
  return { success: true };
}

async function generatePlan(uid, body) {
  const { weekStart, sessionsPerWeek = 3, duration = 45 } = body;
  const { db, FieldValue } = getAdminServices();
  const examSnap = await db.collection('users').doc(uid).collection('examResults')
    .orderBy('date', 'desc').limit(100).get().catch(() => ({ docs: [] }));
  const examDocs = (examSnap && Array.isArray(examSnap.docs)) ? examSnap.docs : [];
  const latestByChapter = new Map();
  examDocs.forEach((d) => {
    const data = docData(d);
    if (!data.chapterId) return;
    const key = `${data.subject}_${data.chapterId}`;
    if (!latestByChapter.has(key)) {
      latestByChapter.set(key, {
        subject: data.subject, chapterId: data.chapterId,
        chapterTitle: data.chapterTitle, percentage: Number(data.percentage || 0)
      });
    }
  });
  const toReview = Array.from(latestByChapter.values())
    .filter((c) => c.percentage < 80)
    .sort((a, b) => a.percentage - b.percentage)
    .slice(0, sessionsPerWeek);
  const startDate = weekStart ? new Date(weekStart) : new Date();
  const generatedSessions = [];
  for (let i = 0; i < toReview.length; i++) {
    const c = toReview[i];
    const sessionDate = new Date(startDate);
    sessionDate.setDate(sessionDate.getDate() + i * 2);
    const ref = db.collection('users').doc(uid).collection('sessions').doc();
    await ref.set({
      date: sessionDate, duration: Number(duration),
      subject: c.subject, chapterId: c.chapterId, chapterTitle: c.chapterTitle,
      reason: `Maîtrise ${c.percentage}% < 80%`,
      status: 'planned',
      createdAt: FieldValue.serverTimestamp()
    });
    generatedSessions.push({
      id: ref.id, date: sessionDate.toISOString(),
      subject: c.subject, chapterTitle: c.chapterTitle,
      reason: `Maîtrise ${c.percentage}% < 80%`
    });
  }
  return { success: true, sessions: generatedSessions, generated: generatedSessions.length };
}

async function listSessions(uid, body) {
  const { from, to, limit = 100 } = body;
  const { db } = getAdminServices();
  let q = db.collection('users').doc(uid).collection('sessions');
  if (from) q = q.where('date', '>=', new Date(from));
  if (to) q = q.where('date', '<=', new Date(to));
  q = q.orderBy('date', 'asc').limit(Math.min(200, limit));
  const snap = await q.get();
  const docs = (snap && Array.isArray(snap.docs)) ? snap.docs : [];
  const sessions = docs.map((d) => {
    const data = docData(d);
    return {
      id: d.id, date: toISO(data.date), duration: data.duration,
      subject: data.subject, chapterId: data.chapterId,
      chapterTitle: data.chapterTitle, reason: data.reason, status: data.status
    };
  });
  return { success: true, sessions };
}

async function createSession(uid, body) {
  const { date, duration, subject, chapterId, chapterTitle } = body;
  if (!date) throw { status: 400, message: 'date requise.' };
  if (!subject || !ALLOWED_SUBJECTS.has(subject)) throw { status: 400, message: 'Matière invalide.' };
  const { db, FieldValue } = getAdminServices();
  const ref = db.collection('users').doc(uid).collection('sessions').doc();
  await ref.set({
    date: new Date(date), duration: Number(duration) || 45,
    subject, chapterId: chapterId || null, chapterTitle: chapterTitle || null,
    reason: 'session_manuelle', status: 'planned',
    createdAt: FieldValue.serverTimestamp()
  });
  return { success: true, sessionId: ref.id };
}

async function updateSession(uid, body) {
  const { sessionId, date, duration, status } = body;
  if (!sessionId) throw { status: 400, message: 'sessionId requis.' };
  const { db } = getAdminServices();
  const ref = db.collection('users').doc(uid).collection('sessions').doc(sessionId);
  const snap = await ref.get();
  if (!docExists(snap)) throw { status: 404, message: 'Séance introuvable.' };
  const updates = {};
  if (date) updates.date = new Date(date);
  if (typeof duration === 'number') updates.duration = duration;
  if (status && ['planned', 'done', 'postponed'].includes(status)) updates.status = status;
  await ref.set(updates, { merge: true });
  return { success: true };
}

async function deleteSession(uid, body) {
  const { sessionId } = body;
  if (!sessionId) throw { status: 400, message: 'sessionId requis.' };
  const { db } = getAdminServices();
  await db.collection('users').doc(uid).collection('sessions').doc(sessionId).delete();
  return { success: true };
}

async function getRecommendations(uid) {
  const { db } = getAdminServices();
  const recos = [];
  const examSnap = await db.collection('users').doc(uid).collection('examResults')
    .orderBy('date', 'desc').limit(50).get().catch(() => ({ docs: [] }));
  const examDocs = (examSnap && Array.isArray(examSnap.docs)) ? examSnap.docs : [];
  const latest = new Map();
  examDocs.forEach((d) => {
    const data = docData(d);
    if (!data.chapterId) return;
    const key = `${data.subject}_${data.chapterId}`;
    if (!latest.has(key)) latest.set(key, data);
  });
  latest.forEach((data) => {
    if (data.percentage < 80) {
      recos.push({
        priority: 1, type: 'review',
        subject: data.subject, chapterId: data.chapterId,
        title: `Revoir ${data.chapterTitle || 'un chapitre'}`,
        reason: `Dernière évaluation : ${data.percentage}% (< 80%)`
      });
    }
  });
  const goalsSnap = await db.collection('users').doc(uid).collection('goals')
    .where('status', 'in', ['pending', 'in_progress']).limit(20).get().catch(() => ({ docs: [] }));
  const goalDocs = (goalsSnap && Array.isArray(goalsSnap.docs)) ? goalsSnap.docs : [];
  goalDocs.forEach((d) => {
    const data = docData(d);
    const deadline = toISO(data.deadline);
    if (deadline && new Date(deadline) < new Date()) {
      recos.push({
        priority: 2, type: 'goal',
        title: `Objectif en retard : ${data.title}`,
        reason: `Échéance dépassée`
      });
    }
  });
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  const sessionsSnap = await db.collection('users').doc(uid).collection('sessions')
    .where('date', '>=', today).where('date', '<', tomorrow)
    .where('status', '==', 'planned').get().catch(() => ({ docs: [] }));
  const sessionDocs = (sessionsSnap && Array.isArray(sessionsSnap.docs)) ? sessionsSnap.docs : [];
  sessionDocs.forEach((d) => {
    const data = docData(d);
    recos.push({
      priority: 0, type: 'session',
      title: `Séance aujourd'hui : ${data.chapterTitle || data.subject}`,
      reason: `${data.duration} min prévues`
    });
  });
  return {
    success: true,
    recommendations: recos.sort((a, b) => a.priority - b.priority).slice(0, 5)
  };
}

async function getQuotaStatus(uid) {
  const { db } = getAdminServices();
  const period = monthKey();
  const quotaRef = db.collection('users').doc(uid).collection('notebookQuota').doc(`sections-${period}`);
  const [userSnap, quotaSnap] = await Promise.all([
    db.collection('users').doc(uid).get(), quotaRef.get()
  ]);
  if (!docExists(userSnap)) throw { status: 404, message: 'Profil introuvable.' };
  if (isPremiumUser(docData(userSnap))) {
    return { success: true, premium: true, used: 0, limit: null, remaining: null };
  }
  const used = Number(docData(quotaSnap)?.count || 0);
  return {
    success: true, premium: false, used,
    limit: FREE_SECTION_LIMIT,
    remaining: Math.max(0, FREE_SECTION_LIMIT - used)
  };
}

async function trackStudyTime(uid, body) {
  const minutes = Math.min(120, Math.max(1, Math.round(Number(body.minutes) || 0)));
  if (minutes <= 0) return { success: true, skipped: true };
  const subject = body.subject && ALLOWED_SUBJECTS.has(body.subject) ? body.subject : null;
  const { db, FieldValue } = getAdminServices();
  const today = todayKey();
  const ref = db.collection('users').doc(uid).collection('dailyActivity').doc(today);
  const updates = {
    date: today, studyMinutes: FieldValue.increment(minutes),
    lastAt: FieldValue.serverTimestamp()
  };
  if (subject) {
    updates.subjectMinutes = {};
    updates.subjectMinutes[subject] = FieldValue.increment(minutes);
  }
  await ref.set(updates, { merge: true });
  return { success: true, addedMinutes: minutes, subject };
}

async function computeStudyTime(uid) {
  const { db } = getAdminServices();
  let snap;
  try {
    snap = await db.collection('users').doc(uid).collection('dailyActivity')
      .orderBy('date', 'desc').limit(365).get();
  } catch (e) {
    return {
      totalMinutes: 0, totalHours: 0, todayMinutes: 0, weekMinutes: 0,
      bySubject: {}, formatted: { total: '0 min', week: '0 min', today: '0 min' }
    };
  }
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const weekAgoKey = weekAgo.toISOString().slice(0, 10);
  let totalMinutes = 0, todayMinutes = 0, weekMinutes = 0;
  const bySubject = {};
  const docs = (snap && Array.isArray(snap.docs)) ? snap.docs : [];
  docs.forEach((d) => {
    const data = docData(d);
    const minutes = Number(data.studyMinutes || 0);
    totalMinutes += minutes;
    if (data.date === today) todayMinutes += minutes;
    if (data.date >= weekAgoKey) weekMinutes += minutes;
    if (data.subjectMinutes && typeof data.subjectMinutes === 'object') {
      Object.keys(data.subjectMinutes).forEach((subj) => {
        if (!bySubject[subj]) bySubject[subj] = 0;
        bySubject[subj] += Number(data.subjectMinutes[subj] || 0);
      });
    }
  });
  return {
    totalMinutes, totalHours: Math.round((totalMinutes / 60) * 10) / 10,
    todayMinutes, weekMinutes, bySubject,
    formatted: {
      total: formatMinutes(totalMinutes),
      week: formatMinutes(weekMinutes),
      today: formatMinutes(todayMinutes)
    }
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

  let user;
  try { user = await verifyFirebaseToken(request); }
  catch (e) { return jsonError(response, 503, 'Service temporairement indisponible.'); }

  if (!user) return jsonError(response, 401, 'Connexion requise.', 'AUTH_REQUIRED');
  if (rateLimitedByUid(user.uid, action)) {
    return jsonError(response, 429, 'Trop de requêtes. Patiente et réessaie.', 'RATE_LIMITED');
  }

  const uid = user.uid;
  console.log(`[PROGRESS v9.2] ${action} | uid=${uid.slice(0, 8)}`);

  try {
    switch (action) {
      case 'getDashboard':         return response.status(200).json(await getDashboard(uid));
      case 'listChapters':         return response.status(200).json(await listChapters(uid, body));
      case 'createChapter':        return response.status(200).json(await createChapter(uid, body));
      case 'getChapter':           return response.status(200).json(await getChapter(uid, body));
      case 'createSection':        return response.status(200).json(await createSection(uid, body));
      case 'getSection':           return response.status(200).json(await getSection(uid, body));
      case 'updateNotes':          return response.status(200).json(await updateNotes(uid, body));
      case 'deleteSection':        return response.status(200).json(await deleteSection(uid, body));
      case 'deleteChapter':        return response.status(200).json(await deleteChapter(uid, body));
      case 'getFullLesson':        return response.status(200).json(await getFullLesson(uid, body));
      case 'trackStudyTime':       return response.status(200).json(await trackStudyTime(uid, body));
      case 'saveExamResult':       return response.status(200).json(await saveExamResult(uid, body));
      case 'listExamResults':      return response.status(200).json(await listExamResults(uid, body));
      case 'getProgressionSummary':return response.status(200).json(await getProgressionSummary(uid));
      case 'markSectionStudied':   return response.status(200).json(await markSectionStudied(uid, body));
      case 'createGoal':           return response.status(200).json(await createGoal(uid, body));
      case 'listGoals':            return response.status(200).json(await listGoals(uid));
      case 'updateGoal':           return response.status(200).json(await updateGoal(uid, body));
      case 'deleteGoal':           return response.status(200).json(await deleteGoal(uid, body));
      case 'createClassGrade':     return response.status(200).json(await createClassGrade(uid, body));
      case 'listClassGrades':      return response.status(200).json(await listClassGrades(uid, body));
      case 'updateClassGrade':     return response.status(200).json(await updateClassGrade(uid, body));
      case 'deleteClassGrade':     return response.status(200).json(await deleteClassGrade(uid, body));
      case 'generatePlan':         return response.status(200).json(await generatePlan(uid, body));
      case 'listSessions':         return response.status(200).json(await listSessions(uid, body));
      case 'createSession':        return response.status(200).json(await createSession(uid, body));
      case 'updateSession':        return response.status(200).json(await updateSession(uid, body));
      case 'deleteSession':        return response.status(200).json(await deleteSession(uid, body));
      case 'getRecommendations':   return response.status(200).json(await getRecommendations(uid));
      case 'getQuotaStatus':       return response.status(200).json(await getQuotaStatus(uid));
      default:
        return jsonError(response, 400, `Action inconnue : "${action}"`);
    }
  } catch (error) {
    console.error(`[PROGRESS v9.2] "${action}" failed:`, error.message);
    if (error.status) return jsonError(response, error.status, error.message, error.code);
    return jsonError(response, 500, error.message || 'Erreur serveur.');
  }
};
