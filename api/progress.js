// ================================================================
// API PROGRESS v9.0 — ARVEXA School
// Cahier intelligent + Maîtrise + Objectifs + Planificateur
// ================================================================

module.exports.config = { maxDuration: 120 };

const WINDOW_MS = 60 * 1000;

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
  trackStudyTime: 120,
  saveExamResult: 30,
  listExamResults: 60,
  getProgressionSummary: 60,
  markSectionStudied: 120,
  createGoal: 30,
  listGoals: 60,
  updateGoal: 30,
  deleteGoal: 30,
  createClassGrade: 30,
  listClassGrades: 60,
  updateClassGrade: 30,
  deleteClassGrade: 30,
  generatePlan: 10,
  listSessions: 60,
  createSession: 30,
  updateSession: 60,
  deleteSession: 30,
  getRecommendations: 60,
  getQuotaStatus: 60
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
const MASTERY_THRESHOLD = 0.80;
const GLOBAL_AI_TIME_BUDGET_MS = 45000;

const VALID_GRADE_TYPES = new Set([
  'interrogation', 'devoir', 'composition', 'oral', 'autre'
]);

let adminServices = null;

// ════════════════════════════════════════════════════════════════
// NORMALISATION LATEX (conservée de v8.6, tronquée ici pour clarté)
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
  '≤': '\\leq ', '≥': '\\geq ', '≠': '\\neq ', '≈': '\\approx ',
  '≡': '\\equiv ', '∈': '\\in ', '∉': '\\notin ', '∋': '\\ni ',
  '⊂': '\\subset ', '⊃': '\\supset ', '⊆': '\\subseteq ', '⊇': '\\supseteq ',
  '∪': '\\cup ', '∩': '\\cap ', '∅': '\\emptyset ',
  '∀': '\\forall ', '∃': '\\exists ', '¬': '\\neg ',
  '∧': '\\wedge ', '∨': '\\vee ',
  '∑': '\\sum ', '∏': '\\prod ', '∫': '\\int ', '∮': '\\oint ',
  '∂': '\\partial ', '∇': '\\nabla ', '√': '\\sqrt ',
  '→': '\\to ', '←': '\\leftarrow ', '↔': '\\leftrightarrow ',
  '⇒': '\\Rightarrow ', '⇐': '\\Leftarrow ', '⇔': '\\Leftrightarrow ',
  '∞': '\\infty ', '°': '^{\\circ} '
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

// ────────────────────────────────────────────────────────────────
// IA — FOURNISSEURS (conservés de v8.6)
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
      'formulas', 'examples', 'traps', 'mechanisms', 'definitions',
      'classifications', 'theses', 'vocabulary', 'plans', 'timeline',
      'causesConsequences', 'keyFigures', 'literaryDevices', 'texts',
      'grammar', 'phrases'
    ];
    arrayFields.forEach((f) => {
      if (merged.structure[f] && !Array.isArray(merged.structure[f])) merged.structure[f] = [];
    });
    if (merged.structure.method && !Array.isArray(merged.structure.method.steps)) merged.structure.method.steps = [];
  }
  return merged;
}

// ────────────────────────────────────────────────────────────────
// PROMPTS (conservés de v8.6, tronqués ici — identiques dans votre v8.6)
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
- Maximum 5 éléments dans les tableaux longs (parts, questions, etc.).
`.trim();

// Les prompts détaillés (buildScientificPrompts, etc.) sont identiques à v8.6
// Pour la brièveté de cette réponse, ils ne sont pas répétés.
// Copiez-les tels quels depuis votre api/progress.js actuel.

// ═══════════════════════════════════════════════════════════════
// NOUVELLES FONCTIONS — MAÎTRISE
// ═══════════════════════════════════════════════════════════════
async function saveExamResult(uid, body) {
  const { subject, chapterId, chapterTitle, score, maxScore, percentage, answers, examType } = body;

  if (!ALLOWED_SUBJECTS.has(subject)) throw { status: 400, message: 'Matière invalide.' };
  if (typeof score !== 'number' || score < 0) throw { status: 400, message: 'Score invalide.' };
  if (typeof maxScore !== 'number' || maxScore <= 0) throw { status: 400, message: 'maxScore invalide.' };

  const { db, FieldValue } = getAdminServices();
  const ref = db
    .collection('users').doc(uid)
    .collection('examResults').doc();

  const pct = Math.min(100, Math.max(0, Math.round((score / maxScore) * 100)));
  const masteryLevel = pct >= 80 ? 'mastered' : 'to_review';

  await ref.set({
    subject,
    chapterId: chapterId || null,
    chapterTitle: chapterTitle || null,
    score,
    maxScore,
    percentage: pct,
    masteryLevel,
    answers: answers || {},
    examType: examType || 'arvexa',
    type: 'arvexa',
    date: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp()
  });

  return {
    success: true,
    result: {
      id: ref.id,
      subject,
      chapterId: chapterId || null,
      percentage: pct,
      masteryLevel
    }
  };
}

async function listExamResults(uid, body) {
  const { subject, chapterId, limit = 50 } = body;
  const { db } = getAdminServices();

  let q = db.collection('users').doc(uid).collection('examResults');
  if (subject) q = q.where('subject', '==', subject);
  if (chapterId) q = q.where('chapterId', '==', chapterId);
  q = q.orderBy('date', 'desc').limit(Math.min(200, limit));

  const snap = await q.get();
  const results = snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      subject: data.subject,
      chapterId: data.chapterId,
      chapterTitle: data.chapterTitle,
      score: data.score,
      maxScore: data.maxScore,
      percentage: data.percentage,
      masteryLevel: data.masteryLevel,
      examType: data.examType,
      date: toISO(data.date)
    };
  });

  return { success: true, results };
}

async function getProgressionSummary(uid) {
  const { db } = getAdminServices();

  // 1) Avancement : sections étudiées / sections totales
  let totalSections = 0;
  let totalStudied = 0;

  const chaptersPromises = ALLOWED_SUBJECTS_ARRAY.map((subjectKey) =>
    db.collection('users').doc(uid)
      .collection('notebooks').doc(subjectKey)
      .collection('chapters')
      .get()
      .catch(() => ({ docs: [] }))
  );

  const chaptersResults = await Promise.all(chaptersPromises);
  const allChapters = [];
  chaptersResults.forEach((snap, idx) => {
    const subjectKey = ALLOWED_SUBJECTS_ARRAY[idx];
    snap.docs.forEach((d) => {
      const data = d.data();
      totalSections += Number(data.sectionsCount || 0);
      totalStudied += Number(data.sectionsStudied || 0);
      allChapters.push({
        subject: subjectKey,
        chapterId: d.id,
        title: data.title,
        sectionsCount: Number(data.sectionsCount || 0),
        sectionsStudied: Number(data.sectionsStudied || 0)
      });
    });
  });

  const advancementPercent = totalSections > 0 ? Math.round((totalStudied / totalSections) * 100) : 0;

  // 2) Maîtrise : % de chapitres avec dernière tentative ≥ 80%
  const examSnap = await db.collection('users').doc(uid).collection('examResults')
    .orderBy('date', 'desc').limit(500).get()
    .catch(() => ({ docs: [] }));

  const latestByChapter = new Map();
  examSnap.docs.forEach((d) => {
    const data = d.data();
    if (!data.chapterId) return;
    const key = `${data.subject}_${data.chapterId}`;
    if (!latestByChapter.has(key)) {
      latestByChapter.set(key, {
        subject: data.subject,
        chapterId: data.chapterId,
        percentage: Number(data.percentage || 0),
        masteryLevel: data.masteryLevel
      });
    }
  });

  let totalEvaluated = 0;
  let totalMastered = 0;
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

  // Advancement par matière
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
    advancement: {
      totalSections,
      totalStudied,
      percent: advancementPercent
    },
    mastery: {
      totalEvaluated,
      totalMastered,
      percent: masteryPercent,
      threshold: 80
    },
    bySubject
  };
}

async function markSectionStudied(uid, body) {
  const { subject, chapterId, sectionId } = body;
  if (!ALLOWED_SUBJECTS.has(subject)) throw { status: 400, message: 'Matière invalide.' };
  if (!chapterId || !sectionId) throw { status: 400, message: 'IDs manquants.' };

  const { db, FieldValue } = getAdminServices();
  const sectionRef = db.collection('users').doc(uid)
    .collection('notebooks').doc(subject)
    .collection('chapters').doc(chapterId)
    .collection('sections').doc(sectionId);

  const snap = await sectionRef.get();
  if (!snap.exists) throw { status: 404, message: 'Section introuvable.' };

  const data = snap.data();
  if (data.studiedAt) return { success: true, alreadyStudied: true };

  await sectionRef.set({ studiedAt: FieldValue.serverTimestamp() }, { merge: true });

  const chapterRef = sectionRef.parent.parent;
  await chapterRef.set({
    sectionsStudied: FieldValue.increment(1),
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });

  return { success: true, alreadyStudied: false };
}

// ═══════════════════════════════════════════════════════════════
// NOUVELLES FONCTIONS — OBJECTIFS
// ═══════════════════════════════════════════════════════════════
async function createGoal(uid, body) {
  const { type, subject, chapterId, title, target, deadline } = body;
  if (!['weekly', 'subject'].includes(type)) throw { status: 400, message: 'Type d\'objectif invalide.' };
  if (type === 'subject' && !ALLOWED_SUBJECTS.has(subject)) throw { status: 400, message: 'Matière invalide.' };
  if (!title || title.trim().length < 2) throw { status: 400, message: 'Titre trop court.' };
  if (typeof target !== 'number' || target <= 0) throw { status: 400, message: 'Cible invalide.' };

  const { db, FieldValue } = getAdminServices();
  const ref = db.collection('users').doc(uid).collection('goals').doc();

  await ref.set({
    type,
    subject: type === 'subject' ? subject : null,
    chapterId: chapterId || null,
    title: title.trim().slice(0, 200),
    target: Number(target),
    current: 0,
    deadline: deadline ? new Date(deadline) : null,
    status: 'pending',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  });

  return { success: true, goalId: ref.id };
}

async function listGoals(uid, body) {
  const { db } = getAdminServices();
  const snap = await db.collection('users').doc(uid).collection('goals')
    .orderBy('createdAt', 'desc').limit(100).get();

  const goals = snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      type: data.type,
      subject: data.subject,
      chapterId: data.chapterId,
      title: data.title,
      target: data.target,
      current: data.current,
      deadline: toISO(data.deadline),
      status: data.status,
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
  if (!snap.exists) throw { status: 404, message: 'Objectif introuvable.' };

  const updates = { updatedAt: FieldValue.serverTimestamp() };
  if (typeof current === 'number') {
    updates.current = Math.max(0, current);
    const data = snap.data();
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

// ═══════════════════════════════════════════════════════════════
// NOUVELLES FONCTIONS — NOTES DE CLASSE
// ═══════════════════════════════════════════════════════════════
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
    subject,
    chapterId: chapterId || null,
    gradeType,
    score: Number(score),
    maxScore: Number(maxScore),
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
  const grades = snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      subject: data.subject,
      chapterId: data.chapterId,
      gradeType: data.gradeType,
      score: data.score,
      maxScore: data.maxScore,
      date: toISO(data.date),
      comment: data.comment,
      type: data.type
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
  if (!snap.exists) throw { status: 404, message: 'Note introuvable.' };

  const updates = {};
  if (typeof score === 'number') updates.score = score;
  if (typeof maxScore === 'number') updates.maxScore = maxScore;
  if (typeof comment === 'string') updates.comment = comment.slice(0, 500);

  const finalScore = updates.score !== undefined ? updates.score : snap.data().score;
  const finalMax = updates.maxScore !== undefined ? updates.maxScore : snap.data().maxScore;
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

// ═══════════════════════════════════════════════════════════════
// NOUVELLES FONCTIONS — PLANIFICATEUR
// ═══════════════════════════════════════════════════════════════
async function generatePlan(uid, body) {
  const { weekStart, sessionsPerWeek = 3, duration = 45 } = body;

  // 1) Récupérer les chapitres à renforcer
  const examSnap = await getAdminServices().db
    .collection('users').doc(uid).collection('examResults')
    .orderBy('date', 'desc').limit(100).get()
    .catch(() => ({ docs: [] }));

  const latestByChapter = new Map();
  examSnap.docs.forEach((d) => {
    const data = d.data();
    if (!data.chapterId) return;
    const key = `${data.subject}_${data.chapterId}`;
    if (!latestByChapter.has(key)) {
      latestByChapter.set(key, {
        subject: data.subject,
        chapterId: data.chapterId,
        chapterTitle: data.chapterTitle,
        percentage: Number(data.percentage || 0)
      });
    }
  });

  const toReview = Array.from(latestByChapter.values())
    .filter((c) => c.percentage < 80)
    .sort((a, b) => a.percentage - b.percentage)
    .slice(0, sessionsPerWeek);

  // 2) Générer les séances
  const { db, FieldValue } = getAdminServices();
  const startDate = weekStart ? new Date(weekStart) : new Date();
  const generatedSessions = [];

  for (let i = 0; i < toReview.length; i++) {
    const c = toReview[i];
    const sessionDate = new Date(startDate);
    sessionDate.setDate(sessionDate.getDate() + i * 2); // J+0, J+2, J+4

    const ref = db.collection('users').doc(uid).collection('sessions').doc();
    await ref.set({
      date: sessionDate,
      duration: Number(duration),
      subject: c.subject,
      chapterId: c.chapterId,
      chapterTitle: c.chapterTitle,
      reason: `Maîtrise ${c.percentage}% < 80%`,
      status: 'planned',
      createdAt: FieldValue.serverTimestamp()
    });

    generatedSessions.push({
      id: ref.id,
      date: sessionDate.toISOString(),
      subject: c.subject,
      chapterTitle: c.chapterTitle,
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
  const sessions = snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      date: toISO(data.date),
      duration: data.duration,
      subject: data.subject,
      chapterId: data.chapterId,
      chapterTitle: data.chapterTitle,
      reason: data.reason,
      status: data.status
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
    date: new Date(date),
    duration: Number(duration) || 45,
    subject,
    chapterId: chapterId || null,
    chapterTitle: chapterTitle || null,
    reason: 'session_manuelle',
    status: 'planned',
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
  if (!snap.exists) throw { status: 404, message: 'Séance introuvable.' };

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

// ═══════════════════════════════════════════════════════════════
// NOUVELLES FONCTIONS — RECOMMANDATIONS
// ═══════════════════════════════════════════════════════════════
async function getRecommendations(uid) {
  const { db } = getAdminServices();
  const recos = [];

  // 1) Chapitres à renforcer
  const examSnap = await db.collection('users').doc(uid).collection('examResults')
    .orderBy('date', 'desc').limit(50).get()
    .catch(() => ({ docs: [] }));

  const latest = new Map();
  examSnap.docs.forEach((d) => {
    const data = d.data();
    if (!data.chapterId) return;
    const key = `${data.subject}_${data.chapterId}`;
    if (!latest.has(key)) latest.set(key, data);
  });

  latest.forEach((data) => {
    if (data.percentage < 80) {
      recos.push({
        priority: 1,
        type: 'review',
        subject: data.subject,
        chapterId: data.chapterId,
        title: `Revoir ${data.chapterTitle || 'un chapitre'}`,
        reason: `Dernière évaluation : ${data.percentage}% (< 80%)`
      });
    }
  });

  // 2) Objectifs en retard
  const goalsSnap = await db.collection('users').doc(uid).collection('goals')
    .where('status', 'in', ['pending', 'in_progress']).limit(20).get()
    .catch(() => ({ docs: [] }));

  goalsSnap.docs.forEach((d) => {
    const data = d.data();
    const deadline = toISO(data.deadline);
    if (deadline && new Date(deadline) < new Date()) {
      recos.push({
        priority: 2,
        type: 'goal',
        title: `Objectif en retard : ${data.title}`,
        reason: `Échéance dépassée`
      });
    }
  });

  // 3) Séances du jour
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  const sessionsSnap = await db.collection('users').doc(uid).collection('sessions')
    .where('date', '>=', today).where('date', '<', tomorrow)
    .where('status', '==', 'planned').get()
    .catch(() => ({ docs: [] }));

  sessionsSnap.docs.forEach((d) => {
    const data = d.data();
    recos.push({
      priority: 0,
      type: 'session',
      title: `Séance aujourd'hui : ${data.chapterTitle || data.subject}`,
      reason: `${data.duration} min prévues`
    });
  });

  return {
    success: true,
    recommendations: recos.sort((a, b) => a.priority - b.priority).slice(0, 5)
  };
}

// ═══════════════════════════════════════════════════════════════
// NOUVELLES FONCTIONS — QUOTA
// ═══════════════════════════════════════════════════════════════
async function getQuotaStatus(uid) {
  const { db } = getAdminServices();
  const period = monthKey();
  const quotaRef = db.collection('users').doc(uid)
    .collection('notebookQuota').doc(`sections-${period}`);

  const [userSnap, quotaSnap] = await Promise.all([
    db.collection('users').doc(uid).get(),
    quotaRef.get()
  ]);

  if (!userSnap.exists) throw { status: 404, message: 'Profil introuvable.' };
  if (isPremiumUser(userSnap.data())) {
    return { success: true, premium: true, used: 0, limit: null, remaining: null };
  }

  const used = Number(quotaSnap.data()?.count || 0);
  return {
    success: true,
    premium: false,
    used,
    limit: FREE_SECTION_LIMIT,
    remaining: Math.max(0, FREE_SECTION_LIMIT - used)
  };
}

// ═══════════════════════════════════════════════════════════════
// EXTENSION trackStudyTime — avec subject
// ═══════════════════════════════════════════════════════════════
async function trackStudyTime(uid, body) {
  const minutes = Math.min(120, Math.max(1, Math.round(Number(body.minutes) || 0)));
  if (minutes <= 0) return { success: true, skipped: true };

  const subject = body.subject && ALLOWED_SUBJECTS.has(body.subject) ? body.subject : null;
  const { db, FieldValue } = getAdminServices();
  const today = todayKey();
  const ref = db.collection('users').doc(uid).collection('dailyActivity').doc(today);

  const updates = {
    date: today,
    studyMinutes: FieldValue.increment(minutes),
    lastAt: FieldValue.serverTimestamp()
  };

  if (subject) {
    updates.subjectMinutes = {};
    updates.subjectMinutes[subject] = FieldValue.increment(minutes);
  }

  await ref.set(updates, { merge: true });

  return { success: true, addedMinutes: minutes, subject };
}

// ═══════════════════════════════════════════════════════════════
// EXTENSION computeStudyTime — subjectMinutes
// ═══════════════════════════════════════════════════════════════
async function computeStudyTime(uid) {
  const { db } = getAdminServices();
  let snap;
  try {
    snap = await db.collection('users').doc(uid).collection('dailyActivity')
      .orderBy('date', 'desc').limit(365).get();
  } catch (e) {
    return {
      totalMinutes: 0, totalHours: 0, todayMinutes: 0, weekMinutes: 0,
      bySubject: {},
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
  const bySubject = {};

  snap.docs.forEach((d) => {
    const data = d.data();
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
    totalMinutes,
    totalHours: Math.round((totalMinutes / 60) * 10) / 10,
    todayMinutes,
    weekMinutes,
    bySubject,
    formatted: {
      total: formatMinutes(totalMinutes),
      week: formatMinutes(weekMinutes),
      today: formatMinutes(todayMinutes)
    }
  };
}

// ═══════════════════════════════════════════════════════════════
// EXTENSION getChapter — sectionsStudied
// ═══════════════════════════════════════════════════════════════
async function getChapter(uid, body) {
  const { subject, chapterId } = body;
  if (!ALLOWED_SUBJECTS.has(subject)) throw { status: 400, message: 'Matière invalide.' };
  if (!chapterId) throw { status: 400, message: 'chapterId requis.' };

  const { db } = getAdminServices();
  const chapterRef = db.collection('users').doc(uid)
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
      studied: Boolean(s.studiedAt),
      studiedAt: toISO(s.studiedAt),
      time: formatRelativeDate(s.createdAt),
      status: s.studiedAt ? 'studied' : 'created'
    };
  });

  // Récupérer les résultats d'examen pour ce chapitre
  const examSnap = await db.collection('users').doc(uid).collection('examResults')
    .where('subject', '==', subject)
    .where('chapterId', '==', chapterId)
    .orderBy('date', 'desc').limit(1).get()
    .catch(() => ({ docs: [] }));

  let latestResult = null;
  if (!examSnap.empty) {
    const r = examSnap.docs[0].data();
    latestResult = {
      id: examSnap.docs[0].id,
      percentage: r.percentage,
      masteryLevel: r.masteryLevel,
      date: toISO(r.date)
    };
  }

  return {
    success: true,
    chapter: {
      id: chapterId,
      title: data.title || 'Chapitre',
      subject,
      sectionsCount: sections.length,
      sectionsStudied: sections.filter((s) => s.studied).length,
      createdAt: toISO(data.createdAt),
      updatedAt: toISO(data.updatedAt)
    },
    sections,
    latestResult
  };
}

// ═══════════════════════════════════════════════════════════════
// FONCTIONS EXISTANTES CONSERVÉES (getDashboard, listChapters,
// createChapter, createSection, getSection, updateNotes,
// deleteSection, deleteChapter, getFullLesson)
// ═══════════════════════════════════════════════════════════════
// ... [Copiez-les intégralement depuis votre v8.6 actuel]
// Seules modifications : getDashboard inclut quota, studyTime.bySubject

async function getDashboard(uid) {
  const { db } = getAdminServices();

  const chaptersPromises = ALLOWED_SUBJECTS_ARRAY.map((subjectKey) =>
    db.collection('users').doc(uid)
      .collection('notebooks').doc(subjectKey)
      .collection('chapters')
      .orderBy('updatedAt', 'desc')
      .limit(50).get()
      .catch(() => ({ docs: [] }))
  );

  const streakPromise = computeStreak(uid);
  const studyTimePromise = computeStudyTime(uid);
  const quotaPromise = getQuotaStatus(uid).catch(() => null);

  const [chaptersResults, streak, studyTime, quota] = await Promise.all([
    Promise.all(chaptersPromises),
    streakPromise,
    studyTimePromise,
    quotaPromise
  ]);

  const subjects = [];
  let totalChapters = 0;
  let totalSections = 0;
  let totalStudied = 0;

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
      key: subjectKey,
      label: info.label,
      chaptersCount: chapters.length,
      sectionsCount: subjectSections,
      sectionsStudied: subjectStudied,
      last: chapters[0]?.last || ''
    });
  });

  subjects.sort((a, b) => b.sectionsCount - a.sectionsCount);

  let recentActivity = [];
  if (subjects.length > 0) {
    const topSubject = subjects[0];
    try {
      const lastChaptersSnap = await db.collection('users').doc(uid)
        .collection('notebooks').doc(topSubject.key)
        .collection('chapters')
        .orderBy('updatedAt', 'desc').limit(3).get();
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
    } catch (e) {}
  }

  return {
    success: true,
    summary: { subjectsCount: subjects.length, totalChapters, totalSections, totalStudied },
    streak,
    studyTime,
    quota,
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
  } catch (e) { return { current: 0, best: 0 }; }
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

// [listChapters, createChapter, createSection, getSection,
//  updateNotes, deleteSection, deleteChapter, getFullLesson,
//  reserveSectionQuota, releaseSectionQuota, markDailyActivity,
//  getPromptsForProfile, buildFallbackAnalysis — copiés à l'identique]

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
  console.log(`[PROGRESS v9.0] ${action} | uid=${uid.slice(0, 8)}`);

  try {
    switch (action) {
      // Existantes
      case 'getDashboard':        return response.status(200).json(await getDashboard(uid));
      case 'listChapters':        return response.status(200).json(await listChapters(uid, body));
      case 'createChapter':       return response.status(200).json(await createChapter(uid, body));
      case 'getChapter':          return response.status(200).json(await getChapter(uid, body));
      case 'createSection':       return response.status(200).json(await createSection(uid, body));
      case 'getSection':          return response.status(200).json(await getSection(uid, body));
      case 'updateNotes':         return response.status(200).json(await updateNotes(uid, body));
      case 'deleteSection':       return response.status(200).json(await deleteSection(uid, body));
      case 'deleteChapter':       return response.status(200).json(await deleteChapter(uid, body));
      case 'getFullLesson':       return response.status(200).json(await getFullLesson(uid, body));
      case 'trackStudyTime':      return response.status(200).json(await trackStudyTime(uid, body));

      // Nouvelles
      case 'saveExamResult':      return response.status(200).json(await saveExamResult(uid, body));
      case 'listExamResults':     return response.status(200).json(await listExamResults(uid, body));
      case 'getProgressionSummary': return response.status(200).json(await getProgressionSummary(uid));
      case 'markSectionStudied':  return response.status(200).json(await markSectionStudied(uid, body));
      case 'createGoal':          return response.status(200).json(await createGoal(uid, body));
      case 'listGoals':           return response.status(200).json(await listGoals(uid, body));
      case 'updateGoal':          return response.status(200).json(await updateGoal(uid, body));
      case 'deleteGoal':          return response.status(200).json(await deleteGoal(uid, body));
      case 'createClassGrade':    return response.status(200).json(await createClassGrade(uid, body));
      case 'listClassGrades':     return response.status(200).json(await listClassGrades(uid, body));
      case 'updateClassGrade':    return response.status(200).json(await updateClassGrade(uid, body));
      case 'deleteClassGrade':    return response.status(200).json(await deleteClassGrade(uid, body));
      case 'generatePlan':        return response.status(200).json(await generatePlan(uid, body));
      case 'listSessions':        return response.status(200).json(await listSessions(uid, body));
      case 'createSession':       return response.status(200).json(await createSession(uid, body));
      case 'updateSession':       return response.status(200).json(await updateSession(uid, body));
      case 'deleteSession':       return response.status(200).json(await deleteSession(uid, body));
      case 'getRecommendations':  return response.status(200).json(await getRecommendations(uid));
      case 'getQuotaStatus':      return response.status(200).json(await getQuotaStatus(uid));

      default:
        return jsonError(response, 400, `Action inconnue : "${action}"`);
    }
  } catch (error) {
    console.error(`[PROGRESS v9.0] "${action}" failed:`, error.message);
    if (error.status) return jsonError(response, error.status, error.message, error.code);
    return jsonError(response, 500, error.message || 'Erreur serveur.');
  }
};
