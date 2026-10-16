// ================================================================
// API RÉVISEUR v7.0 — ARVEXA School
// Génération progressive + Cahier persistant
// Providers : OpenRouter (principal) + Groq (fallback)
// ================================================================

const fs = require('fs');
const path = require('path');

module.exports.config = { maxDuration: 120 };

const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW_LIGHT = 60;
const MAX_REQUESTS_PER_WINDOW_HEAVY = 30;
const requestLog = new Map();

const FREE_REVISEUR_LIMIT = 2;

// ✅ Nouvelle config : génération progressive
const INITIAL_NOTIONS_COUNT = 4;       // Première génération
const FOLLOWUP_NOTIONS_COUNT = 3;      // Générations suivantes
const MAX_NOTIONS_PER_BATCH = 4;       // Max par appel IA

const ALLOWED_SUBJECTS = new Set(['mathematiques', 'physique', 'chimie', 'svt', 'philosophie', 'histoire', 'geographie']);
const ALLOWED_MODES = new Set(['fiche', 'flashcard']);

const ALLOWED_ACTIONS = new Set([
  'loadCahier',           // Charger le cahier complet (GRATUIT)
  'loadNotion',           // Voir une notion précise (GRATUIT)
  'generateInitial',      // Première génération (4 notions)
  'generateMore',         // Générer plus (3 notions)
  'deleteNotion',         // Supprimer une notion
  'quiz',                 // Quiz
  // Compatibilité anciennes actions
  'generate', 'listSessions', 'loadSession', 'deleteSession'
]);

const LIGHT_ACTIONS = new Set([
  'loadCahier', 'loadNotion', 'deleteNotion',
  'listSessions', 'loadSession', 'deleteSession'
]);
const PREMIUM_ACTIONS = new Set(['listSessions', 'loadSession']);

const MAX_TOKENS = {
  NOTIONS_BATCH: 6000,    // Une génération de 3-4 notions
  QUIZ: 4000
};

const GLOBAL_TIME_BUDGET_MS = 90000;
const POOL_COLLECTION = 'reviseurPool';
const CAHIER_COLLECTION = 'reviseurCahier';
const KB_CACHE_TTL_MS = 10 * 60 * 1000;

const KNOWLEDGE_MEMORY_CACHE = new Map();
let adminServices = null;

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
    FieldValue: admin.firestore.FieldValue
  };
  return adminServices;
}

// ════════════════════════════════════════════════════════════════
// BASE DE CONNAISSANCES
// ════════════════════════════════════════════════════════════════
function loadKnowledgeBase(subject) {
  if (KNOWLEDGE_MEMORY_CACHE.has(subject)) {
    const entry = KNOWLEDGE_MEMORY_CACHE.get(subject);
    if (entry && (Date.now() - entry.cachedAt) < KB_CACHE_TTL_MS) {
      return entry.data;
    }
  }

  const filename = `bac-${subject}.json`;
  const candidates = [
    path.join(process.cwd(), filename),
    path.join(process.cwd(), 'api', filename),
    path.join(__dirname, filename),
    path.join(__dirname, '..', filename)
  ];

  for (const filePath of candidates) {
    try {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const data = JSON.parse(raw);
        if (!data || !Array.isArray(data.chapitres)) throw new Error('structure_invalid');

        data.chapitres.forEach((ch) => {
          if (Array.isArray(ch.notions)) {
            ch.notions = ch.notions.filter((n) => n && n.id && n.titre);
          }
        });

        console.log(`[REVISEUR] ✅ Base chargée : ${filename}`);
        KNOWLEDGE_MEMORY_CACHE.set(subject, { data, cachedAt: Date.now() });
        return data;
      }
    } catch (error) {
      console.warn(`[REVISEUR] Erreur lecture ${filePath}:`, error.message);
    }
  }

  console.warn(`[REVISEUR] Base absente : ${filename}`);
  return null;
}

function normalizeText(str) {
  return String(str || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
}

function findChapter(knowledgeBase, chapterName) {
  if (!knowledgeBase || !chapterName) return null;
  const target = normalizeText(chapterName);
  for (const ch of knowledgeBase.chapitres || []) {
    if (normalizeText(ch.titre) === target || normalizeText(ch.id) === target) return ch;
  }
  for (const ch of knowledgeBase.chapitres || []) {
    const chNorm = normalizeText(ch.titre);
    if (chNorm.includes(target) || target.includes(chNorm)) return ch;
  }
  return null;
}

function getMandatoryNotions(chapter) {
  if (!chapter || !Array.isArray(chapter.notions)) return [];
  return chapter.notions.filter((n) => n.obligatoire !== false);
}

// ════════════════════════════════════════════════════════════════
// UTILITAIRES
// ════════════════════════════════════════════════════════════════
function clientIp(request) {
  return String(request.headers['x-forwarded-for'] || request.socket?.remoteAddress || 'unknown').split(',')[0].trim();
}

function rateLimited(ip, maxRequests) {
  const limit = typeof maxRequests === 'number' ? maxRequests : MAX_REQUESTS_PER_WINDOW_HEAVY;
  const now = Date.now();
  const recent = (requestLog.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  requestLog.set(ip, recent);
  return recent.length > limit;
}

function jsonError(response, status, error, code) {
  return response.status(status).json({ success: false, error, ...(code ? { code } : {}) });
}

async function verifyFirebaseToken(request) {
  const authorization = request.headers.authorization || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  try { return await getAdminServices().auth.verifyIdToken(match[1]); }
  catch (_) { return null; }
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

function hashString(str) {
  let hash = 5381;
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) + hash) + s.charCodeAt(i);
    hash = hash & 0xffffffff;
  }
  return Math.abs(hash).toString(36);
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

function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isValidQuizQuestion(q) {
  return q &&
    typeof q.question === 'string' && q.question.trim() &&
    Array.isArray(q.options) && q.options.length === 4 &&
    ['A', 'B', 'C', 'D'].includes(String(q.correctAnswer || '').toUpperCase());
}

function parseRetryDelayMs(errorMessage) {
  const match = String(errorMessage || '').match(/try again in ([\d.]+)\s*s/i);
  if (!match) return 0;
  const seconds = parseFloat(match[1]);
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 120) return 0;
  return Math.ceil(seconds * 1000) + 1000;
}

function isRetryableRateLimit(errorMessage) {
  const msg = String(errorMessage || '').toLowerCase();
  if (msg.includes('request too large')) return false;
  if (msg.includes('model is unavailable')) return false;
  return msg.includes('rate limit') ||
         msg.includes('rate_limit') ||
         msg.includes('too many requests') ||
         msg.includes('429') ||
         msg.includes('quota');
}

function isDefinitiveError(errorMessage) {
  const msg = String(errorMessage || '').toLowerCase();
  return msg.includes('request too large') ||
         msg.includes('model is unavailable') ||
         msg.includes('does not exist') ||
         msg.includes('is not a valid model');
}

// ════════════════════════════════════════════════════════════════
// POST-TRAITEMENT LATEX
// ════════════════════════════════════════════════════════════════
const UNICODE_TO_LATEX = {
  'π': '\\pi ', '√': '\\sqrt{}', '×': '\\times ', '÷': '\\div ',
  '≤': '\\leq ', '≥': '\\geq ', '≠': '\\neq ', '∞': '\\infty ',
  '→': '\\to ', '∈': '\\in ', '∉': '\\notin ', '⊂': '\\subset ',
  '∑': '\\sum ', '∫': '\\int ', 'Δ': '\\Delta ', 'α': '\\alpha ',
  'β': '\\beta ', 'γ': '\\gamma ', 'δ': '\\delta ', 'θ': '\\theta ',
  'λ': '\\lambda ', 'μ': '\\mu ', 'σ': '\\sigma ', 'ω': '\\omega ',
  '²': '^{2}', '³': '^{3}', '¹': '^{1}', '⁴': '^{4}', 'ⁿ': '^{n}',
  '·': '\\cdot ', '⁻': '^{-}', '±': '\\pm '
};

function replaceUnicodeMath(text) {
  if (!text || typeof text !== 'string') return text;
  let r = text;
  for (const [u, l] of Object.entries(UNICODE_TO_LATEX)) r = r.split(u).join(l);
  return r;
}

function wrapOrphanLatex(text) {
  if (!text || typeof text !== 'string') return text;
  if (text.includes('$')) return text;
  let r = text;
  r = r.replace(/(\\[a-zA-Z]+(?:\{[^}]*\}){1,3})/g, ' $$$1$$ ');
  r = r.replace(/(\\[a-zA-Z]+)(?![a-zA-Z{]|\$)/g, ' $$$1$$ ');
  r = r.replace(/([_^]\{[^}]*\})/g, ' $$$1$$ ');
  r = r.replace(/\${3,}/g, '$$').replace(/\$\s*\$/g, '').replace(/\s+/g, ' ').trim();
  return r;
}

function escapeHtmlOutsideLatex(text) {
  if (!text || typeof text !== 'string') return text;
  const parts = text.split(/(\$\$[\s\S]*?\$\$|\$[^$\n]+\$)/g);
  return parts.map((part, i) => {
    if (i % 2 === 1) return part;
    return part.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }).join('');
}

function cleanText(text) {
  if (!text || typeof text !== 'string') return text;
  return escapeHtmlOutsideLatex(wrapOrphanLatex(replaceUnicodeMath(text)));
}

function deepClean(obj) {
  if (typeof obj === 'string') return cleanText(obj);
  if (Array.isArray(obj)) return obj.map(deepClean);
  if (obj && typeof obj === 'object') {
    const c = {};
    for (const k in obj) c[k] = deepClean(obj[k]);
    return c;
  }
  return obj;
}

// ════════════════════════════════════════════════════════════════
// QUOTAS
// ════════════════════════════════════════════════════════════════
function getUsageDate() { return new Date().toISOString().slice(0, 10); }

async function reserveFreeGeneration(uid) {
  const { db, FieldValue } = getAdminServices();
  const userRef = db.collection('users').doc(uid);
  const usageDate = getUsageDate();
  const usageRef = userRef.collection('reviseurUsage').doc(usageDate);

  return db.runTransaction(async (transaction) => {
    const userSnapshot = await transaction.get(userRef);
    const usageSnapshot = await transaction.get(usageRef);
    if (!userSnapshot.exists) throw new Error('profile_missing');
    if (isPremiumUser(userSnapshot.data())) return { premium: true, reserved: false, usageDate };

    const used = Number(usageSnapshot.data()?.count || 0);
    if (used >= FREE_REVISEUR_LIMIT) return { premium: false, reserved: false, limitReached: true, used, usageDate };

    transaction.set(usageRef, { count: used + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { premium: false, reserved: true, usageDate, used: used + 1 };
  });
}

async function releaseFreeGeneration(uid, usageDate) {
  if (!usageDate) return;
  try {
    const { db, FieldValue } = getAdminServices();
    const usageRef = db.collection('users').doc(uid).collection('reviseurUsage').doc(usageDate);
    await db.runTransaction(async (transaction) => {
      const snap = await transaction.get(usageRef);
      const used = Math.max(0, Number(snap.data()?.count || 0) - 1);
      transaction.set(usageRef, { count: used, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    });
  } catch (_) {}
}

// ════════════════════════════════════════════════════════════════
// FOURNISSEURS IA — v7.0
// OpenRouter (principal) + Groq (fallback)
// ════════════════════════════════════════════════════════════════
function getProviders() {
  const providers = [];

  // 🥇 PRINCIPAL : OpenRouter
  if (process.env.OPENROUTER_API_KEY) {
    providers.push({
      name: 'OpenRouter/gpt-oss-120b',
      key: process.env.OPENROUTER_API_KEY,
      endpoint: 'https://openrouter.ai/api/v1/chat/completions',
      model: 'openai/gpt-oss-120b',
      jsonMode: true,
      headers: {
        'HTTP-Referer': process.env.APP_ORIGIN || 'https://arvexaschool.vercel.app',
        'X-Title': 'ARVEXA Reviseur'
      }
    });
  }

  // 🥈 FALLBACK 1 : Groq gpt-oss-120b
  if (process.env.GROQ_API_KEY) {
    providers.push(
      {
        name: 'Groq/gpt-oss-120b',
        key: process.env.GROQ_API_KEY,
        endpoint: 'https://api.groq.com/openai/v1/chat/completions',
        model: 'openai/gpt-oss-120b',
        jsonMode: true,
        headers: {}
      },
      // 🥉 FALLBACK 2 : Groq gpt-oss-20b
      {
        name: 'Groq/gpt-oss-20b',
        key: process.env.GROQ_API_KEY,
        endpoint: 'https://api.groq.com/openai/v1/chat/completions',
        model: 'openai/gpt-oss-20b',
        jsonMode: true,
        headers: {}
      }
    );
  }

  return providers;
}

async function callProvider(provider, prompt, maxTokens, temperature) {
  if (!maxTokens) maxTokens = 4000;
  if (typeof temperature !== 'number') temperature = 0.15;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    console.log(`[AI] ${provider.name} | prompt: ${prompt.length} car | max_tokens: ${maxTokens}`);

    const body = {
      model: provider.model,
      temperature,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: 'Tu produis exclusivement du JSON valide. Tu respectes scrupuleusement le schéma demandé.' },
        { role: 'user', content: prompt }
      ]
    };
    if (provider.jsonMode) body.response_format = { type: 'json_object' };

    const result = await fetch(provider.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.key}`, ...provider.headers },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    const data = await result.json().catch(() => null);
    if (!result.ok) {
      const msg = data?.error?.message || data?.message || `HTTP ${result.status}`;
      const err = new Error(`${provider.name}: ${msg}`);
      err.status = result.status;
      if (result.status === 429 || /rate limit/i.test(msg)) {
        err.isRateLimit = true;
        err.retryDelayMs = parseRetryDelayMs(msg);
      }
      if (/request too large/i.test(msg)) err.isRequestTooLarge = true;
      throw err;
    }

    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error(`${provider.name}: réponse vide`);

    console.log(`[AI] ${provider.name} — réponse: ${content.length} car`);

    const cleaned = String(content).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

    let parsed;
    try { parsed = JSON.parse(cleaned); }
    catch (e) {
      console.warn(`[AI] ${provider.name} — JSON invalide. Début: ${cleaned.slice(0, 200)}`);
      throw new Error(`${provider.name}: JSON invalide`);
    }

    return parsed;
  } finally {
    clearTimeout(timeout);
  }
}

async function generateWithCascade(prompt, validator, maxTokens, temperature, taskName, deadline) {
  const providers = getProviders();
  if (!providers.length) throw new Error('provider_missing');

  const errors = [];

  for (const provider of providers) {
    if (deadline && Date.now() > deadline) {
      errors.push('time_budget_exceeded');
      break;
    }

    try {
      console.log(`[AI] ${taskName} → tentative ${provider.name}...`);
      const data = await callProvider(provider, prompt, maxTokens, temperature);
      if (!validator || validator(data)) {
        console.log(`[AI] ✅ ${taskName} → ${provider.name}`);
        return { data, provider: provider.name };
      }
      errors.push(`${provider.name}: structure invalide`);
    } catch (error) {
      errors.push(`${provider.name}: ${error.message}`);
      console.warn(`[AI] ❌ ${taskName} → ${provider.name}: ${error.message}`);

      if (isDefinitiveError(error.message) || error.isRequestTooLarge) {
        continue;
      }

      if (error.isRateLimit && error.retryDelayMs > 0 && deadline && Date.now() + error.retryDelayMs < deadline) {
        const waitMs = Math.min(error.retryDelayMs, 20000);
        console.log(`[AI] ${taskName} — attente ${waitMs}ms avant retry`);
        await sleep(waitMs);
        try {
          const data = await callProvider(provider, prompt, maxTokens, temperature);
          if (!validator || validator(data)) {
            console.log(`[AI] ✅ ${taskName} → ${provider.name} (retry)`);
            return { data, provider: provider.name };
          }
        } catch (e) {
          console.warn(`[AI] ❌ ${taskName} → retry ${provider.name}: ${e.message}`);
        }
      }
    }
  }

  throw new Error('all_providers_failed: ' + errors.join(' | '));
}

// ════════════════════════════════════════════════════════════════
// CAHIER — STOCKAGE DES NOTIONS GÉNÉRÉES
// ════════════════════════════════════════════════════════════════
function cahierDocId(subject, chapter) {
  return `${subject}_${hashString(normalizeText(chapter))}`;
}

async function loadCahierFromFirestore(uid, subject, chapter) {
  const { db } = getAdminServices();
  const ref = db.collection('users').doc(uid).collection(CAHIER_COLLECTION).doc(cahierDocId(subject, chapter));
  const snap = await ref.get();
  if (!snap.exists) return { notions: [], notionIds: [] };
  const data = snap.data();
  return {
    notions: data.notions || [],
    notionIds: data.notionIds || [],
    totalDisponible: data.totalDisponible || 0
  };
}

async function saveNotionsToCahier(uid, subject, chapter, newNotions, totalDisponible) {
  const { db, FieldValue } = getAdminServices();
  const ref = db.collection('users').doc(uid).collection(CAHIER_COLLECTION).doc(cahierDocId(subject, chapter));
  const snap = await ref.get();

  const existingNotions = snap.exists ? (snap.data().notions || []) : [];
  const existingIds = snap.exists ? (snap.data().notionIds || []) : [];

  const allNotions = [...existingNotions, ...newNotions];
  const allIds = [...existingIds, ...newNotions.map((n) => n.notionId)];

  await ref.set({
    subject,
    chapter,
    notions: allNotions,
    notionIds: allIds,
    totalDisponible,
    lastUpdate: FieldValue.serverTimestamp()
  }, { merge: true });

  return { total: allNotions.length, ids: allIds };
}

// ════════════════════════════════════════════════════════════════
// SÉLECTION DES NOTIONS À GÉNÉRER
// ════════════════════════════════════════════════════════════════
function selectNotionsToGenerate(allNotions, alreadyGeneratedIds, count) {
  // Filtrer celles pas encore générées
  const remaining = allNotions.filter((n) => !alreadyGeneratedIds.includes(n.id));

  if (remaining.length === 0) {
    return { selected: [], remaining: 0 };
  }

  // Prendre les premières `count` (ordre du chapitre)
  const selected = remaining.slice(0, Math.min(count, remaining.length));
  return {
    selected,
    remaining: remaining.length - selected.length
  };
}

// ════════════════════════════════════════════════════════════════
// PROMPTS — Nouveau format ciblé (3-4 notions seulement)
// ════════════════════════════════════════════════════════════════
const LATEX_RULES = `
═══════════════════════════════════════════════════════════════
RÈGLES LATEX — OBLIGATOIRES ET STRICTES
═══════════════════════════════════════════════════════════════
1. TOUTE formule mathématique DOIT être entre $...$ (inline) ou $$...$$ (display).
2. INTERDIT ABSOLU d'écrire du LaTeX brut sans $.
3. INTERDIT ABSOLU d'utiliser des symboles Unicode mathématiques :
   π → $\\pi$, √ → $\\sqrt{}$, × → $\\times$, ÷ → $\\div$, ≤ → $\\leq$,
   ≥ → $\\geq$, ≠ → $\\neq$, ∞ → $\\infty$, → → $\\to$, ∈ → $\\in$,
   ∑ → $\\sum$, ∫ → $\\int$, Δ → $\\Delta$, ² → $^2$, ³ → $^3$
4. Unités : $9{,}81\\,\\text{m/s}^2$
5. Fractions : $\\frac{...}{...}$
6. Vecteurs : $\\vec{u}$
7. Ensembles : $\\mathbb{R}$, $\\mathbb{N}$, $\\mathbb{C}$
`;

const PEDAGOGY_RULES = `
═══════════════════════════════════════════════════════════════
MISSION PÉDAGOGIQUE
═══════════════════════════════════════════════════════════════
Tu prépares un élève de Terminale D au Niger qui prépare le BAC.
Ton contenu doit permettre à cet élève de :
  1. Comprendre CHAQUE notion en profondeur
  2. Mémoriser les formules essentielles
  3. Reconnaître les pièges du BAC
  4. Appliquer les méthodes pas à pas
`;

function serializeNotionBrief(notion) {
  const lines = [];
  lines.push(`─── ${notion.titre} ───`);
  lines.push(`id: ${notion.id}`);
  if (notion.description_courte) lines.push(`description: ${notion.description_courte}`);
  if (Array.isArray(notion.formules)) {
    notion.formules.forEach((f) => {
      const latex = typeof f === 'string' ? f : (f.latex || '');
      if (latex) lines.push(`  • ${latex}`);
    });
  }
  return lines.join('\n');
}

function buildNotionsPrompt(subjectLabel, chapterTitle, notions) {
  const notionsSerialized = notions.map((n) => serializeNotionBrief(n)).join('\n\n');
  const N = notions.length;

  return `Tu es un professeur expert du BAC au Niger, avec 20 ans d'expérience en Terminale D.

${PEDAGOGY_RULES}

MISSION : Génère une FICHE DE RÉVISION COMPLÈTE pour ${N} notion(s) du chapitre "${chapterTitle}" (${subjectLabel}).

═══════════════════════════════════════════════════════════════
NOTIONS À COUVRIR (${N} notion${N > 1 ? 's' : ''})
═══════════════════════════════════════════════════════════════
${notionsSerialized}

═══════════════════════════════════════════════════════════════
POUR CHAQUE NOTION, GÉNÈRE :
═══════════════════════════════════════════════════════════════
1. COMPRENDRE (4-6 phrases simples)
2. FORMULES CLÉS (latex + condition + usage)
3. MÉTHODE PAS À PAS (3-7 étapes)
4. EXEMPLE RÉSOLU (chiffré, complet)
5. PIÈGE DU BAC
6. ASTUCE MNÉMOTECHNIQUE

${LATEX_RULES}

═══════════════════════════════════════════════════════════════
FORMAT JSON ATTENDU
═══════════════════════════════════════════════════════════════
{
  "chapterTitle": "${chapterTitle}",
  "sections": [
    {
      "notionId": "id-exact-fourni",
      "notionTitle": "Titre exact",
      "comprendre": "Explication (4-6 phrases)",
      "formules": [{ "latex": "$...$", "condition": "...", "usage": "..." }],
      "methode": { "title": "Méthode", "steps": ["...", "..."] },
      "exempleResolu": { "enonce": "...", "etapes": ["..."], "conclusion": "..." },
      "piegeBAC": { "trap": "...", "solution": "..." },
      "astuce": "..."
    }
  ]
}

CONTRAINTES STRICTES :
- EXACTEMENT ${N} section${N > 1 ? 's' : ''} dans le tableau "sections"
- Chaque notionId DOIT correspondre exactement à l'id fourni
- Qualité maximale
- Réponds UNIQUEMENT avec le JSON`;
}

function buildQuizPrompt(subjectLabel, chapterTitle, notions, level, questionCount, seed) {
  const notionsSerialized = notions.map((n) => serializeNotionBrief(n)).join('\n\n');

  return `Tu es un professeur expert du BAC au Niger.

${PEDAGOGY_RULES}

MISSION : Génère un QUIZ de ${questionCount} questions pour "${chapterTitle}" (${subjectLabel}).

SEED : ${seed} (utilise ce seed pour varier)

═══════════════════════════════════════════════════════════════
NOTIONS À COUVRIR
═══════════════════════════════════════════════════════════════
${notionsSerialized}

RÈGLES : Niveau ${level}/4 · 4 options A/B/C/D · Options fausses plausibles

${LATEX_RULES}

FORMAT JSON :
{
  "quiz": [
    {
      "notionId": "id",
      "level": 1,
      "question": "...",
      "options": [
        { "id": "A", "text": "..." },
        { "id": "B", "text": "..." },
        { "id": "C", "text": "..." },
        { "id": "D", "text": "..." }
      ],
      "correctAnswer": "A",
      "explanation": "..."
    }
  ]
}

CONTRAINTES : EXACTEMENT ${questionCount} questions · Réponds UNIQUEMENT avec le JSON`;
}

// ════════════════════════════════════════════════════════════════
// VALIDATIONS
// ════════════════════════════════════════════════════════════════
function validateNotions(data) {
  return data && Array.isArray(data.sections) && data.sections.length >= 1 &&
    data.sections.every((s) => s && s.notionTitle && typeof s.comprendre === 'string' && s.comprendre.length > 20);
}

function validateQuiz(data) {
  return data && Array.isArray(data.quiz) && data.quiz.length >= 1 &&
    data.quiz.every((q) => q && q.question && Array.isArray(q.options) && q.options.length === 4 &&
      ['A', 'B', 'C', 'D'].includes(q.correctAnswer));
}

// ════════════════════════════════════════════════════════════════
// FALLBACK POOL
// ════════════════════════════════════════════════════════════════
async function buildNotionsFromPool(subject, chapter, wantedNotions) {
  try {
    const { db } = getAdminServices();
    const snap = await db.collection(POOL_COLLECTION)
      .where('subject', '==', subject)
      .where('mode', '==', 'fiche')
      .limit(30)
      .get();

    if (snap.empty) return null;

    const allPoolSessions = snap.docs.map((d) => d.data());
    const matchingSessions = allPoolSessions.filter((s) => normalizeText(s.chapter) === normalizeText(chapter));

    if (matchingSessions.length === 0) return null;

    // Extraire les sections de toutes les sessions du pool
    const allSections = [];
    matchingSessions.forEach((s) => {
      if (Array.isArray(s.session?.sections)) {
        allSections.push(...s.session.sections);
      }
    });

    // Filtrer pour ne garder que les notions demandées
    const wantedIds = wantedNotions.map((n) => n.id);
    const filtered = allSections.filter((s) => wantedIds.includes(s.notionId));

    if (filtered.length === 0) return null;

    return { sections: filtered, source: 'pool' };
  } catch (e) {
    console.warn('[POOL] Erreur:', e.message);
    return null;
  }
}

// ════════════════════════════════════════════════════════════════
// HANDLER PRINCIPAL
// ════════════════════════════════════════════════════════════════
module.exports = async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return jsonError(response, 405, 'Méthode non autorisée.');
  }

  const body = request.body && typeof request.body === 'object' ? request.body : {};
  const action = body.action || 'loadCahier';
  const isLight = LIGHT_ACTIONS.has(action);
  const rateLimit = isLight ? MAX_REQUESTS_PER_WINDOW_LIGHT : MAX_REQUESTS_PER_WINDOW_HEAVY;

  if (rateLimited(clientIp(request), rateLimit)) {
    return jsonError(response, 429, isLight
      ? 'Trop de requêtes. Patiente quelques secondes.'
      : 'Trop de demandes. Réessaie dans une minute.');
  }

  let user;
  try { user = await verifyFirebaseToken(request); }
  catch (e) { return jsonError(response, 503, 'Service indisponible.'); }
  if (!user) return jsonError(response, 401, 'Connexion requise.', 'AUTH_REQUIRED');

  if (!ALLOWED_ACTIONS.has(action)) return jsonError(response, 400, 'Action invalide.');

  // ═══ VÉRIFICATION PREMIUM ═══
  if (PREMIUM_ACTIONS.has(action)) {
    try {
      const { db } = getAdminServices();
      const userSnap = await db.collection('users').doc(user.uid).get();
      if (!userSnap.exists) {
        return jsonError(response, 404, 'Profil utilisateur introuvable.');
      }
      if (!isPremiumUser(userSnap.data())) {
        return jsonError(response, 403, 'L\'historique est réservé aux comptes Premium.', 'PREMIUM_REQUIRED');
      }
    } catch (e) {
      console.error('[HISTORIQUE] Premium check failed:', e.message);
      return jsonError(response, 503, 'Service temporairement indisponible.');
    }
  }

  // ═══ VALIDATION SUBJECT/CHAPTER (pour les actions qui en ont besoin) ═══
  const needsSubject = ['loadCahier', 'loadNotion', 'generateInitial', 'generateMore', 'deleteNotion', 'generate', 'quiz'].includes(action);
  if (needsSubject) {
    if (!ALLOWED_SUBJECTS.has(body.subject)) return jsonError(response, 400, 'Matière invalide.');
    if (typeof body.chapter !== 'string' || body.chapter.length > 100) return jsonError(response, 400, 'Chapitre invalide.');
  }

  try {
    // ═══ ACTION : LOAD CAHIER (GRATUIT) ═══
    if (action === 'loadCahier') {
      const { subject, chapter } = body;
      const cahier = await loadCahierFromFirestore(user.uid, subject, chapter);
      return response.status(200).json({
        success: true,
        notions: cahier.notions,
        notionIds: cahier.notionIds,
        total: cahier.notions.length
      });
    }

    // ═══ ACTION : LOAD NOTION (GRATUIT) ═══
    if (action === 'loadNotion') {
      const { subject, chapter, notionId } = body;
      if (!notionId) return jsonError(response, 400, 'notionId requis.');
      const cahier = await loadCahierFromFirestore(user.uid, subject, chapter);
      const notion = cahier.notions.find((n) => n.notionId === notionId);
      if (!notion) return jsonError(response, 404, 'Notion introuvable.');
      return response.status(200).json({ success: true, notion });
    }

    // ═══ ACTION : DELETE NOTION (GRATUIT) ═══
    if (action === 'deleteNotion') {
      const { subject, chapter, notionId } = body;
      if (!notionId) return jsonError(response, 400, 'notionId requis.');
      const { db } = getAdminServices();
      const ref = db.collection('users').doc(user.uid).collection(CAHIER_COLLECTION).doc(cahierDocId(subject, chapter));
      const snap = await ref.get();
      if (!snap.exists) return jsonError(response, 404, 'Cahier introuvable.');
      const data = snap.data();
      const newNotions = (data.notions || []).filter((n) => n.notionId !== notionId);
      const newIds = (data.notionIds || []).filter((id) => id !== notionId);
      await ref.update({ notions: newNotions, notionIds: newIds });
      return response.status(200).json({ success: true });
    }

    // ═══ ACTIONS DE GÉNÉRATION ═══
    if (action === 'generateInitial' || action === 'generateMore') {
      const { subject, chapter } = body;
      const wantCount = action === 'generateInitial' ? INITIAL_NOTIONS_COUNT : FOLLOWUP_NOTIONS_COUNT;

      // Charger la base de connaissances
      const knowledgeBase = loadKnowledgeBase(subject);
      const chapterData = knowledgeBase ? findChapter(knowledgeBase, chapter) : null;
      const mandatoryNotions = chapterData ? getMandatoryNotions(chapterData) : [];
      const hasKnowledge = mandatoryNotions.length > 0;

      if (!hasKnowledge) {
        return jsonError(response, 400, 'Ce chapitre n\'est pas disponible dans la base.', 'CHAPTER_NOT_READY');
      }

      const subjectLabel = knowledgeBase?.matiereLabel || {
        mathematiques: 'Mathématiques', physique: 'Physique', chimie: 'Chimie', svt: 'SVT',
        philosophie: 'Philosophie', histoire: 'Histoire', geographie: 'Géographie'
      }[subject] || subject;
      const chapterTitle = chapterData?.titre || chapter;

      // Charger le cahier existant
      const cahier = await loadCahierFromFirestore(user.uid, subject, chapter);

      // Sélectionner les notions à générer
      const { selected, remaining } = selectNotionsToGenerate(mandatoryNotions, cahier.notionIds, wantCount);

      if (selected.length === 0) {
        return response.status(200).json({
          success: true,
          notions: [],
          message: 'Toutes les notions de ce chapitre ont déjà été générées.',
          total: cahier.notions.length,
          totalDisponible: mandatoryNotions.length
        });
      }

      // Réservation du quota gratuit
      let reservation = null;
      try { reservation = await reserveFreeGeneration(user.uid); }
      catch (error) { return jsonError(response, 503, 'Quota temporairement indisponible.'); }

      if (reservation.limitReached) {
        return response.status(429).json({
          success: false,
          error: 'Limite gratuite atteinte. Passe à Premium.',
          code: 'FREE_REVISEUR_LIMIT',
          used: reservation.used,
          limit: FREE_REVISEUR_LIMIT
        });
      }

      let generatedNotions = [];
      let source = 'ai';

      try {
        // Construire le prompt ciblé
        const prompt = buildNotionsPrompt(subjectLabel, chapterTitle, selected);
        const deadline = Date.now() + GLOBAL_TIME_BUDGET_MS;

        const { data } = await generateWithCascade(
          prompt, validateNotions, MAX_TOKENS.NOTIONS_BATCH, 0.15,
          `${action}-${selected.length}notions`, deadline
        );

        // Extraire et filtrer les sections générées
        generatedNotions = (data.sections || [])
          .filter((s) => s.notionId && s.notionTitle)
          .map((s) => {
            const notionOrig = selected.find((n) => n.id === s.notionId);
            return {
              notionId: s.notionId,
              notionTitle: s.notionTitle,
              comprendre: s.comprendre || '',
              formules: s.formules || [],
              methode: s.methode || null,
              exempleResolu: s.exempleResolu || null,
              piegeBAC: s.piegeBAC || null,
              astuce: s.astuce || '',
              generatedAt: new Date().toISOString()
            };
          });

        if (generatedNotions.length === 0) {
          throw new Error('no_notions_generated');
        }

        // Nettoyage LaTeX
        generatedNotions = deepClean(generatedNotions);

      } catch (aiError) {
        console.warn('[REVISEUR] IA échouée:', aiError.message);

        // Tentative de fallback pool
        const pooled = await buildNotionsFromPool(subject, chapter, selected);
        if (pooled) {
          generatedNotions = pooled.sections;
          source = 'pool';
          console.log('[REVISEUR] ✅ Fallback pool utilisé');
        } else {
          if (reservation?.reserved) {
            try { await releaseFreeGeneration(user.uid, reservation.usageDate); } catch (_) {}
          }
          return jsonError(response, 503, 'Impossible de générer les notions. Réessaie dans quelques minutes.');
        }
      }

      // Sauvegarder dans le cahier
      await saveNotionsToCahier(user.uid, subject, chapter, generatedNotions, mandatoryNotions.length);

      // Historique (compatibilité)
      try {
        const { db, FieldValue } = getAdminServices();
        await db.collection('users').doc(user.uid).collection('reviseurSessions').add({
          subject,
          subjectLabel,
          chapter: chapterTitle,
          mode: 'fiche',
          notionsCovered: generatedNotions.length,
          session: { sections: generatedNotions },
          createdAt: FieldValue.serverTimestamp()
        });
      } catch (e) {}

      return response.status(200).json({
        success: true,
        notions: generatedNotions,
        total: cahier.notions.length + generatedNotions.length,
        totalDisponible: mandatoryNotions.length,
        remaining,
        source,
        quota: reservation?.premium
          ? { type: 'premium', unlimited: true }
          : { type: 'free', used: reservation?.used, limit: FREE_REVISEUR_LIMIT }
      });
    }

    // ═══ ACTION : QUIZ ═══
    if (action === 'quiz') {
      const { subject, chapter } = body;
      const count = Math.min(20, Math.max(5, Number(body.count) || 5));
      const level = Math.min(4, Math.max(1, Number(body.difficulty) || 2));
      const seed = hashString(Date.now() + '_' + user.uid + '_' + Math.random());

      const knowledgeBase = loadKnowledgeBase(subject);
      const chapterData = knowledgeBase ? findChapter(knowledgeBase, chapter) : null;
      const mandatoryNotions = chapterData ? getMandatoryNotions(chapterData) : [];

      if (mandatoryNotions.length === 0) {
        return jsonError(response, 400, 'Chapitre non disponible.', 'CHAPTER_NOT_READY');
      }

      const subjectLabel = knowledgeBase?.matiereLabel || subject;
      const chapterTitle = chapterData?.titre || chapter;

      // Charger les notions déjà générées pour limiter le contexte
      const cahier = await loadCahierFromFirestore(user.uid, subject, chapter);
      const notionsForQuiz = cahier.notions.length > 0
        ? mandatoryNotions.filter((n) => cahier.notionIds.includes(n.id)).slice(0, 6)
        : mandatoryNotions.slice(0, 6);

      try {
        const prompt = buildQuizPrompt(subjectLabel, chapterTitle, notionsForQuiz, level, count, seed);
        const deadline = Date.now() + GLOBAL_TIME_BUDGET_MS;

        const { data } = await generateWithCascade(
          prompt, validateQuiz, MAX_TOKENS.QUIZ, 0.6,
          'quiz', deadline
        );

        const validQuiz = (data.quiz || []).filter(isValidQuizQuestion);
        const cleanedQuiz = deepClean(validQuiz);

        return response.status(200).json({ success: true, quiz: cleanedQuiz, source: 'ai', seed });
      } catch (err) {
        console.warn('[REVISEUR] Quiz échoué:', err.message);
        return response.status(200).json({
          success: true,
          quiz: [],
          source: 'unavailable',
          message: 'Quiz indisponible pour le moment.'
        });
      }
    }

    // ═══ COMPATIBILITÉ : action "generate" (ancien format) ═══
    if (action === 'generate') {
      // Rediriger vers generateInitial ou generateMore
      const isInitial = !body.includeFlashcards;
      const targetAction = isInitial ? 'generateInitial' : 'generateMore';

      // Reconstruire la requête
      const redirectBody = { ...body, action: targetAction };
      const mockRequest = { ...request, body: redirectBody };

      // Appeler récursivement
      const mockResponse = {
        status: (code) => ({
          json: (data) => {
            return response.status(code).json(data);
          }
        })
      };

      return module.exports(mockRequest, mockResponse);
    }

    // ═══ HISTORIQUE (compatibilité) ═══
    if (action === 'listSessions') {
      const { db } = getAdminServices();
      const limit = Math.min(100, Number(body.limit) || 50);
      const snap = await db.collection('users').doc(user.uid)
        .collection('reviseurSessions').orderBy('createdAt', 'desc').limit(limit).get();

      const sessions = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          subject: data.subject || '',
          subjectLabel: data.subjectLabel || data.subject || '',
          chapter: data.chapter || '',
          mode: data.mode || 'fiche',
          notionsCovered: Number(data.notionsCovered || 0),
          createdAt: toISO(data.createdAt)
        };
      });

      return response.status(200).json({ success: true, sessions });
    }

    if (action === 'loadSession') {
      if (!body.sessionId) return jsonError(response, 400, 'sessionId requis.');
      const { db } = getAdminServices();
      const ref = db.collection('users').doc(user.uid).collection('reviseurSessions').doc(body.sessionId);
      const snap = await ref.get();
      if (!snap.exists) return jsonError(response, 404, 'Session introuvable.');
      const data = snap.data();
      return response.status(200).json({
        success: true,
        session: {
          id: snap.id,
          subject: data.subject,
          subjectLabel: data.subjectLabel,
          chapter: data.chapter,
          mode: data.mode,
          session: data.session || {},
          createdAt: toISO(data.createdAt)
        }
      });
    }

    if (action === 'deleteSession') {
      if (!body.sessionId) return jsonError(response, 400, 'sessionId requis.');
      const { db } = getAdminServices();
      await db.collection('users').doc(user.uid).collection('reviseurSessions').doc(body.sessionId).delete();
      return response.status(200).json({ success: true });
    }

    return jsonError(response, 400, 'Action inconnue.');

  } catch (error) {
    console.error(`[REVISEUR v7.0] Action "${action}" échouée:`, error.message);
    return jsonError(response, 500, error.message || 'Erreur serveur.');
  }
};
