// ================================================================
// API PROGRESS v9.1 — ARVEXA School
// ✅ Optimisé pour Groq free tier (8 000 TPM)
// ✅ 3 tâches séquentielles (pas de rate limit)
// ✅ maxTokens calibrés pour tenir dans le quota
// ✅ Compatible multi-provider (si clés valides)
// ✅ Aucune modification du frontend
// ================================================================

module.exports.config = { maxDuration: 120 };

const WINDOW_MS = 60 * 1000;

const RATE_LIMITS = {
  getDashboard: 60, listChapters: 60, createChapter: 30, getChapter: 60,
  createSection: 10, getSection: 60, updateNotes: 60, deleteSection: 30,
  deleteChapter: 30, getFullLesson: 30, trackStudyTime: 120
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

const MIN_CONTENT_LENGTH = 100;
const MAX_CONTENT_LENGTH = 10000;   // ✅ réduit : moins d'entrée = moins de tokens

const FREE_SECTION_LIMIT = 5;

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
};

const SUPERSCRIPT_MAP = { '⁰':'0','¹':'1','²':'2','³':'3','⁴':'4','⁵':'5','⁶':'6','⁷':'7','⁸':'8','⁹':'9','⁺':'+','⁻':'-','⁼':'=','⁽':'(','⁾':')','ⁿ':'n','ⁱ':'i' };
const SUBSCRIPT_MAP = { '₀':'0','₁':'1','₂':'2','₃':'3','₄':'4','₅':'5','₆':'6','₇':'7','₈':'8','₉':'9','₊':'+','₋':'-','₌':'=','₍':'(','₎':')' };

const NO_ARG_LATEX_COMMANDS = [
  'rightleftharpoons','leftrightharpoons','longrightarrow','longleftarrow',
  'Longleftrightarrow','Longleftarrow','Longrightarrow',
  'Leftrightarrow','leftrightarrow','rightarrow','leftarrow',
  'updownarrow','hookrightarrow','hookleftarrow','Rightarrow','Leftarrow',
  'varepsilon','vartheta','varsigma','varrho','varphi','varpi',
  'cdotp','cdot','times','div','pm','mp','ast','star','bullet',
  'circ','leq','geq','neq','approx','equiv','sim','simeq','propto',
  'cong','ll','gg','subset','supset','subseteq','supseteq',
  'cup','cap','emptyset','forall','exists','nexists','neg','wedge',
  'vee','oplus','otimes','odot','sum','prod','int','oint',
  'partial','nabla','infty','aleph','ell','hbar',
  'alpha','beta','gamma','delta','epsilon','zeta','eta','theta',
  'iota','kappa','lambda','mu','nu','xi','pi','rho','sigma',
  'tau','upsilon','phi','chi','psi','omega',
  'Gamma','Delta','Theta','Lambda','Xi','Pi','Sigma','Upsilon',
  'Phi','Psi','Omega','sin','cos','tan','cot','sec','csc','log','ln','exp',
  'lim','max','min','det','mod','gcd','lcm','quad','qquad'
];

const CMD_SPACE_REGEX = new RegExp(`(\\\\(?:${NO_ARG_LATEX_COMMANDS.join('|')}))(?=[a-zA-Z0-9])`, 'g');
const HAS_UNICODE_MATH_REGEX = /[α-ωΑ-Ω×÷±∓·⋅∘∗⋆∙⊕⊗⊙≤≥≠≈≡≅∼≃∝≪≫∈∉∋⊂⊃⊆⊇⊄∪∩∅∀∃∄¬∧∨∑∏∫∮∂∇√→←↔↑↓↕⇒⇐⇔⟹⟸⟺↦↪↩↗↘↙↖⇌⇋⟶⟵∞ℵℓℏℜℑ⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿⁱ₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎]/;

function hasUnicodeMath(text) { return text && typeof text === 'string' && HAS_UNICODE_MATH_REGEX.test(text); }

function replaceUnicodeScripts(text) {
  if (!text || typeof text !== 'string') return text;
  let r = text;
  r = r.replace(/([a-zA-Z0-9}\)\]_])([⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿⁱ]+)/g, (m, base, sups) =>
    `${base}^{${sups.split('').map(c => SUPERSCRIPT_MAP[c] || c).join('')}}`);
  r = r.replace(/([a-zA-Z0-9}\)\]])([₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎]+)/g, (m, base, subs) =>
    `${base}_{${subs.split('').map(c => SUBSCRIPT_MAP[c] || c).join('')}}`);
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
  r = r.replace(/\${6,}/g, '$$$$').replace(/\${5}/g, '$$$$').replace(/\${3}/g, '$$');
  r = r.replace(/\$\s*\$/g, ' ').replace(/\$\$\s*\$\$/g, ' ');
  return r;
}

function wrapOrphanLatex(text) {
  if (!text || typeof text !== 'string') return text;
  if (!/\\[a-zA-Z]/.test(text)) return text;
  const parts = text.split(/(\$\$[\s\S]*?\$\$|\$[^$\n]+\$)/g);
  return parts.map((part, i) => (i % 2 === 1) ? part : wrapSegmentLatex(part)).join('');
}

function wrapSegmentLatex(segment) {
  if (!segment) return segment;
  if (!/\\[a-zA-Z]/.test(segment)) return segment;
  let r = segment;
  r = r.replace(/\\begin\{([a-zA-Z*]+)\}([\s\S]*?)\\end\{\1\}/g, (m) => ` $$${m}$$ `);
  const KNOWN_CMDS = new Set([...NO_ARG_LATEX_COMMANDS, 'frac','sqrt','dfrac','tfrac','cfrac','text','mathrm','mathbf','mathit','mathbb','mathcal','mathfrak','left','right','big','Big','bigg','Bigg','overline','underline','vec','hat','bar','dot','ddot','tilde','binom','choose','pmod','bmod','operatorname','sinh','cosh','tanh','arcsin','arccos','arctan','lg','log','ln','exp','quad','qquad','hspace','vspace']);
  r = r.replace(/(\\[a-zA-Z]+)((?:\s*\{[^}]*\})*)((?:\s*[_^]\s*(?:\{[^}]*\}|[a-zA-Z0-9]))*)/g, (match, cmd, args, scripts) => {
    if (!KNOWN_CMDS.has(cmd.slice(1))) return match;
    return ` $${cmd}${args || ''}${scripts || ''}$ `;
  });
  for (let i = 0; i < 5; i++) {
    const before = r;
    r = r.replace(/\$\s*([^$]*?)\s*\$\s*([+\-*/=<>()\[\]{}.,\s]*?)\s*\$\s*([^$]*?)\s*\$/g, (m, a, ops, b) => ` $${a.trim()} ${ops.trim()} ${b.trim()}$ `);
    if (before === r) break;
  }
  r = r.replace(/\$\s*\$/g, ' ').replace(/\$\s+/g, '$').replace(/\s+\$/g, '$');
  r = r.replace(/\s+/g, ' ').replace(/\s+([.,;:!?])/g, '$1');
  return r;
}

function cleanFormulaContent(formula) {
  if (!formula || typeof formula !== 'string') return formula;
  let open, close, inner;
  if (formula.startsWith('$$') && formula.endsWith('$$')) { open = '$$'; close = '$$'; inner = formula.slice(2, -2); }
  else if (formula.startsWith('$') && formula.endsWith('$')) { open = '$'; close = '$'; inner = formula.slice(1, -1); }
  else return formula;
  inner = inner.replace(/\s+/g, ' ').trim();
  inner = fixCommandSpacing(inner);
  inner = inner.replace(/^\$+/, '').replace(/\$+$/, '');
  return open + inner + close;
}

function cleanLatexText(text) {
  if (!text || typeof text !== 'string') return text;
  if (!text.trim()) return text;
  if (text.indexOf('\\') === -1 && text.indexOf('$') === -1 && !hasUnicodeMath(text)) return text;
  let r = text;
  r = normalizeDelimiters(r);
  r = cleanBrokenDelimiters(r);
  r = replaceUnicodeScripts(r);
  r = replaceUnicodeMath(r);
  r = fixCommandSpacing(r);
  r = wrapOrphanLatex(r);
  const parts = r.split(/(\$\$[\s\S]*?\$\$|\$[^$\n]+\$)/g);
  r = parts.map((part, i) => (i % 2 === 1) ? cleanFormulaContent(part) : part).join('');
  r = r.replace(/[ \t]+/g, ' ').replace(/\s+([.,;:!?])/g, '$1');
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
      if (['id','type','level','importance','correct','notionId','number'].includes(k)) { cleaned[k] = obj[k]; continue; }
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
  try { serviceAccount = JSON.parse(credentials); } catch (e) { throw new Error('firebase_admin_invalid_json'); }
  if (!serviceAccount.project_id || !serviceAccount.private_key) throw new Error('firebase_admin_invalid_credentials');
  const admin = require('firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  adminServices = { auth: admin.auth(), db: admin.firestore(), FieldValue: admin.firestore.FieldValue, Timestamp: admin.firestore.Timestamp };
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
  return response.status(status).json({ success: false, error, ...(code ? { code } : {}) });
}

function applyCors(request, response) {
  const ALLOWED_ORIGINS = ['https://arvexaschool.vercel.app','https://admin-89.vercel.app','http://localhost:3000','http://localhost:5000'];
  const origin = request.headers.origin || '';
  if (ALLOWED_ORIGINS.includes(origin)) response.setHeader('Access-Control-Allow-Origin', origin);
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
    console.error('[AUTH] failed:', error.message);
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

function formatMinutes(totalMin) {
  if (!totalMin || totalMin < 1) return '0 min';
  if (totalMin < 60) return `${totalMin} min`;
  const hours = Math.floor(totalMin / 60);
  const minutes = totalMin % 60;
  if (minutes === 0) return `${hours} h`;
  return `${hours} h ${String(minutes).padStart(2, '0')}`;
}

function isMeaningfulContent(text) {
  if (!text || typeof text !== 'string') return false;
  const words = text.match(/[a-zA-ZÀ-ÿ]{2,}/g) || [];
  return words.length >= 10;
}

function countWords(text) {
  if (!text || typeof text !== 'string') return 0;
  return (text.match(/[a-zA-ZÀ-ÿ0-9]{2,}/g) || []).length;
}

// ────────────────────────────────────────────────────────────────
// FOURNISSEURS (filtre ceux qui sont cassés)
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
      headers: { 'HTTP-Referer': process.env.APP_ORIGIN || '', 'X-Title': 'ARVEXA Notebook' }
    }
    // ⛔ Mistral retiré : HTTP 403, clé morte
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

async function callProvider(provider, { systemPrompt, userPrompt, maxTokens = 2500, timeoutMs = 25000 }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const body = {
      model: provider.model,
      temperature: 0.2,
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
    if (!result.ok) throw new Error(`${provider.name}: ${data?.error?.message || `HTTP ${result.status}`}`);

    const choice = data?.choices?.[0];
    const rawContent = choice?.message?.content;
    const finishReason = choice?.finish_reason;

    if (!rawContent) throw new Error(`${provider.name}: réponse vide`);

    const cleaned = String(rawContent).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

    let parsed = null;
    try { parsed = JSON.parse(cleaned); }
    catch (_) {
      const repaired = repairJson(cleaned);
      if (repaired) {
        console.warn(`[AI] ${provider.name} — JSON réparé (finish_reason=${finishReason})`);
        parsed = repaired;
      } else {
        throw new Error(`${provider.name}: JSON invalide`);
      }
    }

    if (finishReason === 'length' || finishReason === 'max_tokens') {
      console.warn(`[AI] ${provider.name} — Réponse tronquée (finish_reason=${finishReason})`);
    }

    return parsed;
  } finally {
    clearTimeout(timeout);
  }
}

async function callSequential(tasks, providers, totalBudgetMs = 90000) {
  const results = {};
  const startTime = Date.now();
  const provider = providers[0];   // ✅ un seul provider pour éviter le rate limit
  const delayBetweenCalls = 2000;  // ✅ 2s entre appels pour respecter 8 000 TPM

  console.log(`[SEQ] ${tasks.length} tâches séquentielles sur ${provider.name}`);

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    const remaining = totalBudgetMs - (Date.now() - startTime);

    if (remaining < 8000) {
      console.warn(`[SEQ] Budget temps épuisé, ${tasks.length - i} tâche(s) abandonnée(s)`);
      break;
    }

    const timeoutMs = Math.min(25000, remaining);

    try {
      results[task.name] = await callProvider(provider, {
        systemPrompt: task.systemPrompt,
        userPrompt: task.userPrompt,
        maxTokens: task.maxTokens,
        timeoutMs
      });
      console.log(`[SEQ] OK ${task.name} (${Math.round((Date.now() - startTime) / 1000)}s)`);
    } catch (e) {
      console.warn(`[SEQ] FAIL ${task.name}: ${e.message}`);
      // Fallback sur un autre provider si dispo
      for (const fb of providers.slice(1)) {
        if (totalBudgetMs - (Date.now() - startTime) < 10000) break;
        try {
          results[task.name] = await callProvider(fb, {
            systemPrompt: task.systemPrompt,
            userPrompt: task.userPrompt,
            maxTokens: task.maxTokens,
            timeoutMs: 20000
          });
          console.log(`[SEQ] OK ${task.name} (fallback ${fb.name})`);
          break;
        } catch (e2) {
          console.warn(`[SEQ] Fallback ${fb.name} KO: ${e2.message}`);
        }
      }
    }

    if (i < tasks.length - 1) {
      await new Promise((r) => setTimeout(r, delayBetweenCallCalls = delayBetweenCalls));
    }
  }

  return results;
}

// ────────────────────────────────────────────────────────────────
// PROMPTS (3 tâches : explanation, questions, qcm)
// ────────────────────────────────────────────────────────────────
const COMMON_RULES = `
RÈGLES :
- Travaille UNIQUEMENT sur le texte fourni.
- N'invente AUCUNE information absente du cours.
- Formules : entre $...$ ou $$...$$.
- Réponds UNIQUEMENT en JSON valide, sans markdown.
`.trim();

function buildPrompts(subjectLabel, rawInput, profile) {
  const context = `Matière : ${subjectLabel}\n\nCOURS :\n${rawInput}`;

  const hints = {
    scientific: 'Privilégie définitions, propriétés, formules et méthodes.',
    svt:        'Privilégie définitions, mécanismes, étapes et relations.',
    philosophy: 'Privilégie concepts, thèses, arguments et exemples.',
    history:    'Privilégie faits, dates, acteurs, causes et conséquences.'
  };
  const hint = hints[profile] || hints.scientific;

  return [
    {
      name: 'explanation',
      maxTokens: 3000,   // ✅ calibré pour 8 000 TPM avec 3 tâches
      systemPrompt: 'Tu es professeur expert. JSON uniquement.',
      userPrompt: `Explique ce cours à un élève de Terminale D.

${context}

${COMMON_RULES}
${hint}

RÈGLES D'EXPLICATION :
- Français simple et direct.
- Explique les termes techniques.
- Décris les mécanismes étape par étape.
- Ne te contente pas de définir : explique pourquoi/comment.
- 2 à 4 parties selon la richesse du cours (pas plus, pour rester concis).

Format JSON :
{
  "sectionTitle": "Titre (max 60 caractères)",
  "understanding": "Ce que l'élève doit comprendre (2-3 phrases)",
  "parts": [
    {
      "partTitle": "Titre",
      "mainIdea": "Idée principale",
      "simpleExplanation": "Explication pédagogique",
      "keyTerms": [{"term": "...", "meaning": "..."}],
      "toRemember": "À retenir"
    }
  ]
}

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'questions',
      maxTokens: 2500,
      systemPrompt: 'JSON uniquement.',
      userPrompt: `Génère 8 questions de révision sur ce cours.

${context}

${COMMON_RULES}
${hint}

Chaque réponse doit être complète (3 phrases minimum).

Format JSON :
{
  "questions": [
    {
      "id": "q1",
      "level": 1,
      "type": "definition",
      "question": "...",
      "answer": "...",
      "mustHave": ["élément 1"],
      "importance": 1
    }
  ]
}

Génère exactement 8 questions (pas plus, pour rester concis).

Réponds UNIQUEMENT avec le JSON.`
    },
    {
      name: 'qcm',
      maxTokens: 2000,
      systemPrompt: 'JSON uniquement.',
      userPrompt: `Génère 5 QCM sur ce cours.

${context}

${COMMON_RULES}
${hint}

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
      "explanation": "..."
    }
  ]
}

Génère exactement 5 QCM.

Réponds UNIQUEMENT avec le JSON.`
    }
  ];
}

// ────────────────────────────────────────────────────────────────
// VALIDATION SOUPLE
// ────────────────────────────────────────────────────────────────
function filterUsableParts(parts) {
  if (!Array.isArray(parts)) return [];
  return parts.filter((p) => {
    if (!p || typeof p !== 'object') return false;
    const idea = String(p.mainIdea || '').trim();
    const expl = String(p.simpleExplanation || '').trim();
    return (idea.length > 0) || (countWords(expl) >= 5);
  });
}

function filterValidQuestions(questions) {
  if (!Array.isArray(questions)) return [];
  return questions.filter((q) => {
    if (!q || typeof q !== 'object') return false;
    const question = String(q.question || '').trim();
    const answer = String(q.answer || '').trim();
    if (question.length < 5) return false;
    if (answer.length < 5) return false;
    if (countWords(answer) < 3) return false;
    if (Array.isArray(q.mustHave)) q.mustHave = q.mustHave.filter((m) => String(m || '').trim().length > 0);
    else q.mustHave = [];
    return true;
  });
}

function filterValidQcm(qcmList) {
  if (!Array.isArray(qcmList)) return [];
  return qcmList.filter((q) => {
    if (!q || typeof q !== 'object') return false;
    const question = String(q.question || '').trim();
    const options = Array.isArray(q.options) ? q.options : [];
    const correct = String(q.correct || '').trim();
    const optionIds = options.map((o) => String(o?.id || '')).filter(Boolean);
    return question.length >= 5 && options.length >= 2 && optionIds.includes(correct);
  });
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
    if (isPremiumUser(userSnap.data())) return { allowed: true, premium: true, used: 0, limit: Infinity, reserved: false };
    const quotaSnap = await transaction.get(quotaRef);
    const used = Number(quotaSnap.data()?.count || 0);
    if (used >= FREE_SECTION_LIMIT) return { allowed: false, used, limit: FREE_SECTION_LIMIT, premium: false, reserved: false };
    transaction.set(quotaRef, { count: used + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
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
      transaction.set(quotaRef, { count: used, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    });
  } catch (err) { console.warn('[QUOTA] release failed:', err.message); }
}

async function markDailyActivity(uid, inc = {}) {
  const { db, FieldValue } = getAdminServices();
  const dateKey = todayKey();
  const ref = db.collection('users').doc(uid).collection('dailyActivity').doc(dateKey);
  await ref.set({ date: dateKey, sectionsCreated: FieldValue.increment(inc.sectionsCreated || 0), lastAt: FieldValue.serverTimestamp() }, { merge: true });
}

async function trackStudyTime(uid, body) {
  const minutes = Math.min(120, Math.max(1, Math.round(Number(body.minutes) || 0)));
  if (minutes <= 0) return { success: true, skipped: true };
  const { db, FieldValue } = getAdminServices();
  const today = todayKey();
  const ref = db.collection('users').doc(uid).collection('dailyActivity').doc(today);
  await ref.set({ date: today, studyMinutes: FieldValue.increment(minutes), lastAt: FieldValue.serverTimestamp() }, { merge: true });
  return { success: true, addedMinutes: minutes };
}

async function computeStudyTime(uid) {
  const { db } = getAdminServices();
  let snap;
  try { snap = await db.collection('users').doc(uid).collection('dailyActivity').orderBy('date', 'desc').limit(365).get(); }
  catch (e) { return { totalMinutes: 0, totalHours: 0, todayMinutes: 0, weekMinutes: 0, formatted: { total: '0 min', week: '0 min', today: '0 min' } }; }
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
  const weekAgoKey = weekAgo.toISOString().slice(0, 10);
  let totalMinutes = 0, todayMinutes = 0, weekMinutes = 0;
  snap.docs.forEach((d) => {
    const data = d.data();
    const minutes = Number(data.studyMinutes || 0);
    totalMinutes += minutes;
    if (data.date === today) todayMinutes += minutes;
    if (data.date >= weekAgoKey) weekMinutes += minutes;
  });
  return { totalMinutes, totalHours: Math.round((totalMinutes / 60) * 10) / 10, todayMinutes, weekMinutes, formatted: { total: formatMinutes(totalMinutes), week: formatMinutes(weekMinutes), today: formatMinutes(todayMinutes) } };
}

// ═══════════════════════════════════════════════════════════════
// ACTIONS
// ═══════════════════════════════════════════════════════════════
async function getDashboard(uid) {
  const { db } = getAdminServices();
  const chaptersPromises = ALLOWED_SUBJECTS_ARRAY.map((s) =>
    db.collection('users').doc(uid).collection('notebooks').doc(s).collection('chapters').orderBy('updatedAt', 'desc').limit(50).get().catch(() => ({ docs: [] }))
  );
  const [chaptersResults, streak, studyTime] = await Promise.all([Promise.all(chaptersPromises), computeStreak(uid), computeStudyTime(uid)]);
  const subjects = []; let totalChapters = 0; let totalSections = 0;
  ALLOWED_SUBJECTS_ARRAY.forEach((k, i) => {
    const snap = chaptersResults[i];
    if (!snap.docs || snap.docs.length === 0) return;
    const chapters = snap.docs.map((d) => {
      const data = d.data();
      return { id: d.id, title: data.title || 'Chapitre', sectionsCount: data.sectionsCount || 0, last: formatRelativeDate(data.updatedAt || data.createdAt) };
    });
    const ts = chapters.reduce((s, c) => s + c.sectionsCount, 0);
    totalChapters += chapters.length; totalSections += ts;
    subjects.push({ key: k, label: SUBJECT_INFO[k].label, chaptersCount: chapters.length, sectionsCount: ts, last: chapters[0]?.last || '' });
  });
  subjects.sort((a, b) => b.sectionsCount - a.sectionsCount);
  let recentActivity = [];
  if (subjects.length > 0) {
    const top = subjects[0];
    try {
      const s = await db.collection('users').doc(uid).collection('notebooks').doc(top.key).collection('chapters').orderBy('updatedAt', 'desc').limit(3).get();
      recentActivity = s.docs.map((d) => {
        const data = d.data();
        return { subject: top.key, subjectLabel: top.label, chapterId: d.id, chapterTitle: data.title || 'Chapitre', sectionsCount: data.sectionsCount || 0, time: formatRelativeDate(data.updatedAt || data.createdAt) };
      });
    } catch (e) { recentActivity = []; }
  }
  return { success: true, summary: { subjectsCount: subjects.length, totalChapters, totalSections }, streak, studyTime, subjects, recentActivity };
}

async function computeStreak(uid) {
  const { db } = getAdminServices();
  let snap;
  try { snap = await db.collection('users').doc(uid).collection('dailyActivity').orderBy('date', 'desc').limit(90).get(); }
  catch (e) { return { current: 0, best: 0 }; }
  if (snap.docs.length === 0) return { current: 0, best: 0 };
  const activeDates = new Set(snap.docs.map((d) => d.data().date).filter(Boolean));
  let current = 0; const today = new Date();
  for (let i = 0; i < 90; i++) {
    const d = new Date(today); d.setDate(today.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    if (activeDates.has(key)) current++; else break;
  }
  const sorted = Array.from(activeDates).sort();
  let best = 0, run = 0, prev = null;
  sorted.forEach((ds) => {
    if (prev) { const diff = Math.round((new Date(ds) - new Date(prev)) / 86400000); run = diff === 1 ? run + 1 : 1; }
    else run = 1;
    best = Math.max(best, run); prev = ds;
  });
  return { current, best };
}

async function listChapters(uid, body) {
  const { subject } = body;
  if (!ALLOWED_SUBJECTS.has(subject)) throw { status: 400, message: 'Matière invalide.' };
  const { db } = getAdminServices();
  const snap = await db.collection('users').doc(uid).collection('notebooks').doc(subject).collection('chapters').orderBy('updatedAt', 'desc').limit(100).get();
  const chapters = snap.docs.map((d) => {
    const data = d.data();
    return { id: d.id, title: data.title || 'Chapitre', sectionsCount: data.sectionsCount || 0, createdAt: toISO(data.createdAt), updatedAt: toISO(data.updatedAt), last: formatRelativeDate(data.updatedAt || data.createdAt) };
  });
  return { success: true, chapters };
}

async function createChapter(uid, body) {
  const { subject, title } = body;
  if (!ALLOWED_SUBJECTS.has(subject)) throw { status: 400, message: 'Matière invalide.' };
  if (!title || typeof title !== 'string' || title.trim().length < 2) throw { status: 400, message: 'Titre trop court.' };
  const { db, FieldValue } = getAdminServices();
  const cleanTitle = title.trim().slice(0, 100);
  const ref = db.collection('users').doc(uid).collection('notebooks').doc(subject).collection('chapters').doc();
  await ref.set({ title: cleanTitle, sectionsCount: 0, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  return { success: true, chapter: { id: ref.id, title: cleanTitle, sectionsCount: 0, last: 'à l\'instant' } };
}

async function getChapter(uid, body) {
  const { subject, chapterId } = body;
  if (!ALLOWED_SUBJECTS.has(subject)) throw { status: 400, message: 'Matière invalide.' };
  if (!chapterId) throw { status: 400, message: 'chapterId requis.' };
  const { db } = getAdminServices();
  const chapterRef = db.collection('users').doc(uid).collection('notebooks').doc(subject).collection('chapters').doc(chapterId);
  const chapterSnap = await chapterRef.get();
  if (!chapterSnap.exists) throw { status: 404, message: 'Chapitre introuvable.' };
  const data = chapterSnap.data();
  const sectionsSnap = await chapterRef.collection('sections').orderBy('createdAt', 'asc').get();
  const sections = sectionsSnap.docs.map((d) => {
    const s = d.data();
    const analysis = s.analysis || {};
    const questionsCount = Array.isArray(analysis.questions) ? analysis.questions.length : 0;
    const qcmCount = Array.isArray(analysis.qcm) ? analysis.qcm.length : 0;
    return { id: d.id, title: s.title || 'Section', questionsCount, qcmCount, time: formatRelativeDate(s.createdAt), status: 'done' };
  });
  return { success: true, chapter: { id: chapterId, title: data.title || 'Chapitre', subject, sectionsCount: sections.length, createdAt: toISO(data.createdAt), updatedAt: toISO(data.updatedAt) }, sections };
}

async function createSection(uid, body) {
  const { subject, chapterId, rawInput } = body;

  if (!ALLOWED_SUBJECTS.has(subject)) throw { status: 400, message: 'Matière invalide.' };
  if (!chapterId) throw { status: 400, message: 'chapterId requis.' };
  if (!rawInput || typeof rawInput !== 'string') throw { status: 400, message: 'Contenu manquant.' };

  const trimmed = rawInput.trim();
  if (trimmed.length < MIN_CONTENT_LENGTH) throw { status: 400, message: `Contenu trop court (min ${MIN_CONTENT_LENGTH} caractères).` };
  if (trimmed.length > MAX_CONTENT_LENGTH) throw { status: 400, message: `Contenu trop long (max ${MAX_CONTENT_LENGTH}).` };
  if (!isMeaningfulContent(trimmed)) throw { status: 400, message: 'Contenu trop court ou sans texte exploitable (10 mots minimum).' };

  const quota = await reserveSectionQuota(uid);
  if (!quota.allowed) throw { status: 429, message: `Limite gratuite atteinte (${quota.limit} sections/mois). Passe à Premium.`, code: 'FREE_SECTION_LIMIT' };

  const { db, FieldValue } = getAdminServices();
  const chapterRef = db.collection('users').doc(uid).collection('notebooks').doc(subject).collection('chapters').doc(chapterId);
  const chapterSnap = await chapterRef.get();
  if (!chapterSnap.exists) {
    if (quota.reserved) await releaseSectionQuota(uid);
    throw { status: 404, message: 'Chapitre introuvable.' };
  }

  const info = SUBJECT_INFO[subject];
  const providers = getProviders();
  if (!providers.length) {
    if (quota.reserved) await releaseSectionQuota(uid);
    throw { status: 503, message: 'Aucun fournisseur IA disponible.' };
  }

  const tasks = buildPrompts(info.label, trimmed, info.profile);

  console.log(`[PROGRESS] ${tasks.length} tâches séquentielles sur ${providers.length} provider(s)`);

  let rawResults;
  try {
    rawResults = await callSequential(tasks, providers, 90000);
  } catch (err) {
    if (quota.reserved) await releaseSectionQuota(uid);
    throw err;
  }

  // ✅ Fusion souple
  const explanation = rawResults.explanation || {};
  const rawParts = Array.isArray(explanation.parts) ? explanation.parts : [];
  const usableParts = filterUsableParts(rawParts);

  const validQuestions = filterValidQuestions(rawResults.questions?.questions || []);
  const validQcm = filterValidQcm(rawResults.qcm?.qcm || []);

  let understanding = String(explanation.understanding || '').trim();
  if (!understanding && usableParts.length > 0) understanding = 'Voici les notions essentielles à retenir de cette section.';
  if (usableParts.length === 0) {
    const available = [];
    if (validQuestions.length > 0) available.push(`${validQuestions.length} question(s)`);
    if (validQcm.length > 0) available.push(`${validQcm.length} QCM`);
    understanding = available.length > 0
      ? `L'explication détaillée n'a pas pu être générée. Tu peux réviser avec : ${available.join(', ')} ci-dessous.`
      : `L'analyse n'a produit aucun contenu exploitable. Essaie avec un texte plus complet.`;
  }

  const analysis = {
    profile: info.profile,
    sectionTitle: explanation.sectionTitle || 'Section',
    explanation: { sectionTitle: explanation.sectionTitle || 'Section', understanding, parts: usableParts },
    structure: null,
    questions: validQuestions,
    qcm: validQcm
  };

  const cleanedAnalysis = deepClean(analysis);

  console.log(`[PROGRESS] Résultat — parts=${usableParts.length}, questions=${validQuestions.length}, qcm=${validQcm.length}`);

  const sectionRef = chapterRef.collection('sections').doc();
  const sectionId = sectionRef.id;

  await sectionRef.set({
    title: cleanedAnalysis.sectionTitle || 'Section',
    rawInput: trimmed,
    profile: info.profile,
    analysis: cleanedAnalysis,
    userNotes: '',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  });

  await chapterRef.set({ sectionsCount: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  await markDailyActivity(uid, { sectionsCreated: 1 });

  return {
    success: true,
    sectionId,
    section: { id: sectionId, title: cleanedAnalysis.sectionTitle || 'Section', rawInput: trimmed, profile: info.profile, analysis: cleanedAnalysis, userNotes: '' }
  };
}

async function getSection(uid, body) {
  const { subject, chapterId, sectionId } = body;
  if (!ALLOWED_SUBJECTS.has(subject)) throw { status: 400, message: 'Matière invalide.' };
  if (!chapterId || !sectionId) throw { status: 400, message: 'IDs manquants.' };
  const { db } = getAdminServices();
  const ref = db.collection('users').doc(uid).collection('notebooks').doc(subject).collection('chapters').doc(chapterId).collection('sections').doc(sectionId);
  const snap = await ref.get();
  if (!snap.exists) throw { status: 404, message: 'Section introuvable.' };
  const s = snap.data();
  return { success: true, section: { id: sectionId, title: s.title || 'Section', subject, chapterId, rawInput: s.rawInput || '', profile: s.profile || 'scientific', analysis: s.analysis || {}, userNotes: s.userNotes || '', createdAt: toISO(s.createdAt), time: formatRelativeDate(s.createdAt) } };
}

async function updateNotes(uid, body) {
  const { subject, chapterId, sectionId, userNotes } = body;
  if (!ALLOWED_SUBJECTS.has(subject)) throw { status: 400, message: 'Matière invalide.' };
  if (!chapterId || !sectionId) throw { status: 400, message: 'IDs manquants.' };
  if (typeof userNotes !== 'string') throw { status: 400, message: 'userNotes invalide.' };
  const { db, FieldValue } = getAdminServices();
  const ref = db.collection('users').doc(uid).collection('notebooks').doc(subject).collection('chapters').doc(chapterId).collection('sections').doc(sectionId);
  await ref.set({ userNotes: userNotes.slice(0, 8000), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return { success: true };
}

async function deleteSection(uid, body) {
  const { subject, chapterId, sectionId } = body;
  if (!ALLOWED_SUBJECTS.has(subject)) throw { status: 400, message: 'Matière invalide.' };
  if (!chapterId || !sectionId) throw { status: 400, message: 'IDs manquants.' };
  const { db, FieldValue } = getAdminServices();
  const chapterRef = db.collection('users').doc(uid).collection('notebooks').doc(subject).collection('chapters').doc(chapterId);
  const sectionRef = chapterRef.collection('sections').doc(sectionId);
  const snap = await sectionRef.get();
  if (!snap.exists) throw { status: 404, message: 'Section introuvable.' };
  await sectionRef.delete();
  await chapterRef.set({ sectionsCount: FieldValue.increment(-1), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return { success: true };
}

async function deleteChapter(uid, body) {
  const { subject, chapterId } = body;
  if (!ALLOWED_SUBJECTS.has(subject)) throw { status: 400, message: 'Matière invalide.' };
  if (!chapterId) throw { status: 400, message: 'chapterId requis.' };
  const { db } = getAdminServices();
  const chapterRef = db.collection('users').doc(uid).collection('notebooks').doc(subject).collection('chapters').doc(chapterId);
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
  const chapterRef = db.collection('users').doc(uid).collection('notebooks').doc(subject).collection('chapters').doc(chapterId);
  const chapterSnap = await chapterRef.get();
  if (!chapterSnap.exists) throw { status: 404, message: 'Chapitre introuvable.' };
  const sectionsSnap = await chapterRef.collection('sections').orderBy('createdAt', 'asc').get();
  const sections = sectionsSnap.docs.map((d) => {
    const s = d.data();
    return { id: d.id, title: s.title || 'Section', profile: s.profile || 'scientific', analysis: s.analysis || {}, userNotes: s.userNotes || '' };
  });
  return { success: true, chapter: { id: chapterId, title: chapterSnap.data().title || 'Chapitre', subject }, sections };
}

// ═══════════════════════════════════════════════════════════════
// HANDLER
// ═══════════════════════════════════════════════════════════════
module.exports = async function handler(request, response) {
  applyCors(request, response);
  if (request.method === 'OPTIONS') return response.status(204).end();
  if (request.method !== 'POST') { response.setHeader('Allow', 'POST'); return jsonError(response, 405, 'Méthode non autorisée.'); }

  const body = request.body && typeof request.body === 'object' ? request.body : {};
  const action = body.action || '';

  let user;
  try { user = await verifyFirebaseToken(request); }
  catch (e) { console.error('Auth error:', e.message); return jsonError(response, 503, 'Service temporairement indisponible.'); }
  if (!user) return jsonError(response, 401, 'Connexion requise.', 'AUTH_REQUIRED');

  if (rateLimitedByUid(user.uid, action)) return jsonError(response, 429, 'Trop de requêtes.', 'RATE_LIMITED');

  const uid = user.uid;
  console.log(`[PROGRESS v9.1] ${action} | uid=${uid.slice(0, 8)}`);

  try {
    switch (action) {
      case 'getDashboard':   return response.status(200).json(await getDashboard(uid));
      case 'listChapters':   return response.status(200).json(await listChapters(uid, body));
      case 'createChapter':  return response.status(200).json(await createChapter(uid, body));
      case 'getChapter':     return response.status(200).json(await getChapter(uid, body));
      case 'createSection':  return response.status(200).json(await createSection(uid, body));
      case 'getSection':     return response.status(200).json(await getSection(uid, body));
      case 'updateNotes':    return response.status(200).json(await updateNotes(uid, body));
      case 'deleteSection':  return response.status(200).json(await deleteSection(uid, body));
      case 'deleteChapter':  return response.status(200).json(await deleteChapter(uid, body));
      case 'getFullLesson':  return response.status(200).json(await getFullLesson(uid, body));
      case 'trackStudyTime': return response.status(200).json(await trackStudyTime(uid, body));
      default: return jsonError(response, 400, `Action inconnue : "${action}"`);
    }
  } catch (error) {
    console.error(`[PROGRESS v9.1] "${action}" failed:`, error.message);
    if (error.status) return jsonError(response, error.status, error.message, error.code);
    return jsonError(response, 500, error.message || 'Erreur serveur.');
  }
};
