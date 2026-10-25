// ================================================================
// API RÉVISEUR v7.4 — ARVEXA School
// Génération progressive + cahier persistant + lecture gratuite
// Support multi-format : scientifiques + leçons
// Providers : OpenRouter (principal) + Groq (fallback)
// Quotas : 3 crédits/jour par utilisateur
// ✅ Ajout : listCahiers (historique)
// ================================================================

const fs = require('fs');
const path = require('path');


// ────────────────────────────────────────────────────────────────
// CONFIG
// ────────────────────────────────────────────────────────────────
const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW_LIGHT = 60;
const MAX_REQUESTS_PER_WINDOW_HEAVY = 20;
const requestLog = new Map();

const FREE_REVISEUR_LIMIT = 3;

const ALLOWED_SUBJECTS = new Set(['mathematiques', 'physique', 'chimie', 'svt', 'philosophie', 'histoire', 'geographie']);
const ALLOWED_MODES = new Set(['fiche', 'flashcard']);

// ✅ Actions autorisées (avec listCahiers)
const ALLOWED_ACTIONS = new Set([
  'loadCahier',
  'generateInitial',
  'generateMore',
  'loadNotion',
  'deleteNotion',
  'quiz',
  'deleteCahier',
  'listCahiers'
]);

const LIGHT_ACTIONS = new Set(['loadCahier', 'loadNotion', 'deleteNotion', 'deleteCahier', 'listCahiers']);
const PREMIUM_ACTIONS = new Set([]);

const INITIAL_NOTIONS_COUNT = 4;
const MORE_NOTIONS_COUNT = 3;
const MAX_TOKENS_PER_CALL = 6000;
const MAX_TOTAL_NOTIONS = 20;

const KB_CACHE_TTL_MS = 10 * 60 * 1000;
const CAHIER_COLLECTION = 'reviseurCahier';

const KNOWLEDGE_MEMORY_CACHE = new Map();
let adminServices = null;

// ✅ Labels des matières
const SUBJECT_LABELS = {
  mathematiques: 'Mathématiques',
  physique: 'Physique',
  chimie: 'Chimie',
  svt: 'SVT',
  philosophie: 'Philosophie',
  histoire: 'Histoire',
  geographie: 'Géographie'
};

// ────────────────────────────────────────────────────────────────
// CLASSIFICATION DES MATIÈRES
// ────────────────────────────────────────────────────────────────
const SCIENTIFIC_SUBJECTS = new Set(['mathematiques', 'physique', 'chimie']);
const LESSON_SUBJECTS = new Set(['svt', 'philosophie', 'histoire', 'geographie']);

function getSubjectType(subject) {
  if (SCIENTIFIC_SUBJECTS.has(subject)) return 'scientific';
  if (LESSON_SUBJECTS.has(subject)) return 'lesson';
  return 'lesson';
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

function getAllNotions(chapter) {
  if (!chapter || !Array.isArray(chapter.notions)) return [];
  return chapter.notions;
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

function jsonError(response, status, error, code, debug) {
  const payload = { success: false, error, ...(code ? { code } : {}) };
  if (debug) payload.debug = debug;
  return response.status(status).json(payload);
}

async function verifyFirebaseToken(request) {
  const authorization = request.headers.authorization || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  try { return await getAdminServices().auth.verifyIdToken(match[1]); }
  catch (_) { return null; }
}

function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
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

// ✅ Nettoyage LaTeX
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
function getUsageDate() {
  return new Date().toISOString().slice(0, 10);
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

async function reserveFreeGeneration(uid) {
  const { db, FieldValue } = getAdminServices();
  const userRef = db.collection('users').doc(uid);
  const usageDate = getUsageDate();
  const usageRef = userRef.collection('reviseurUsage').doc(usageDate);

  return db.runTransaction(async (transaction) => {
    const userSnapshot = await transaction.get(userRef);
    const usageSnapshot = await transaction.get(usageRef);

    if (!userSnapshot.exists) throw new Error('profile_missing');

    if (isPremiumUser(userSnapshot.data())) {
      return { premium: true, reserved: false, usageDate };
    }

    const used = Number(usageSnapshot.data()?.count || 0);

    if (used >= FREE_REVISEUR_LIMIT) {
      return { premium: false, reserved: false, limitReached: true, used, usageDate };
    }

    transaction.set(usageRef, {
      count: used + 1,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });

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
      transaction.set(usageRef, {
        count: used,
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
    });
  } catch (_) {}
}

// ════════════════════════════════════════════════════════════════
// FOURNISSEURS IA
// ════════════════════════════════════════════════════════════════
function getProviders() {
  const providers = [];

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
  if (!maxTokens) maxTokens = MAX_TOKENS_PER_CALL;
  if (typeof temperature !== 'number') temperature = 0.2;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);

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
      }
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

async function generateWithCascade(prompt, validator, maxTokens, temperature, taskName) {
  const providers = getProviders();
  if (!providers.length) throw new Error('provider_missing');

  const errors = [];
  for (const provider of providers) {
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
    }
  }
  throw new Error('all_providers_failed: ' + errors.join(' | '));
}

// ════════════════════════════════════════════════════════════════
// PROMPTS
// ════════════════════════════════════════════════════════════════
const LATEX_RULES = `
RÈGLES LATEX :
- Toute formule mathématique entre $...$ ou $$...$$.
- INTERDIT : LaTeX brut sans $, symboles Unicode (π → $\\pi$, √ → $\\sqrt{}$, × → $\\times$, ≤ → $\\leq$, ² → $^2$).
`;

const PEDAGOGY_RULES = `
MISSION : Tu prépares un élève de Terminale D au Niger au BAC.
Contenu clair, précis, mémorisable.
`;

function buildScientificNotionsPrompt(subjectLabel, chapterTitle, notionsToGenerate) {
  const notionsList = notionsToGenerate.map((n, i) =>
    `  ${i + 1}. [id: ${n.id}] ${n.titre}${n.description_courte ? ` — ${n.description_courte}` : ''}`
  ).join('\n');

  return `Tu es professeur expert du BAC en Terminale D (${subjectLabel}).

${PEDAGOGY_RULES}

Chapitre : "${chapterTitle}"

MISSION : Génère une fiche de révision SCIENTIFIQUE pour CHACUNE des ${notionsToGenerate.length} notions suivantes :

${notionsList}

Pour CHAQUE notion, fournis :
1. comprendre (4-6 phrases)
2. formules (2-4 formules avec condition et usage)
3. methodes (3-6 étapes avec calculs)
4. exempleResolu (CHIFFRÉ, complet avec calculs)
5. piegeBAC (piège + solution)
6. astuce (mnémotechnique)

${LATEX_RULES}

FORMAT JSON :
{
  "notions": [
    {
      "notionId": "id-exact-fourni",
      "notionTitle": "Titre exact",
      "comprendre": "...",
      "formules": [{"latex": "$...$", "condition": "...", "usage": "..."}],
      "methode": {"title": "Méthode", "steps": ["..."]},
      "exempleResolu": {"enonce": "...", "etapes": ["..."], "conclusion": "..."},
      "piegeBAC": {"trap": "...", "solution": "..."},
      "astuce": "..."
    }
  ]
}

CONTRAINTES :
- EXACTEMENT ${notionsToGenerate.length} notions
- Réponds UNIQUEMENT avec le JSON`;
}

function buildLessonNotionsPrompt(subjectLabel, chapterTitle, notionsToGenerate, subjectKey) {
  const notionsList = notionsToGenerate.map((n, i) =>
    `  ${i + 1}. [id: ${n.id}] ${n.titre}${n.description_courte ? ` — ${n.description_courte}` : ''}`
  ).join('\n');

  let specificFields = '';
  let specificExample = '';

  if (subjectKey === 'svt') {
    specificFields = `3. termes (vocabulaire biologique PRÉCIS avec définitions)
4. mecanismes (processus biologiques avec étapes)`;
    specificExample = `"termes": [{"terme": "...", "definition": "..."}],
      "mecanismes": [{"nom": "...", "etapes": ["..."], "consequences": ["..."]}],`;
  } else if (subjectKey === 'histoire') {
    specificFields = `3. dates_cles (dates importantes avec événements)
4. personnages (personnages historiques avec leur rôle)
5. lieux (lieux importants)`;
    specificExample = `"dates_cles": [{"date": "1939", "evenement": "..."}],
      "personnages": [{"nom": "...", "role": "..."}],
      "lieux": [{"nom": "...", "info": "..."}],`;
  } else if (subjectKey === 'philosophie') {
    specificFields = `3. auteurs (philosophes avec leurs thèses)
4. theses principales`;
    specificExample = `"auteurs": [{"nom": "...", "idee": "..."}],`;
  } else if (subjectKey === 'geographie') {
    specificFields = `3. lieux (pays, régions, zones)
4. donnees_chiffrees (chiffres clés)`;
    specificExample = `"lieux": [{"nom": "...", "info": "..."}],`;
  }

  return `Tu es professeur expert du BAC en Terminale D (${subjectLabel}).

${PEDAGOGY_RULES}

⚠️ IMPORTANT : Cette matière est une matière de LEÇONS. Il n'y a PAS de formules mathématiques. Utilise des POINTS CLÉS, du VOCABULAIRE et des MÉCANISMES.

Chapitre : "${chapterTitle}"

MISSION : Génère une fiche de révision pour CHACUNE des ${notionsToGenerate.length} notions suivantes :

${notionsList}

Pour CHAQUE notion, fournis :
1. comprendre (4-6 phrases)
2. points_cles (3-5 points importants à retenir)
${specificFields}
${notionsToGenerate.length + 3}. exempleResolu (exemple concret SANS calculs mathématiques)
${notionsToGenerate.length + 4}. piegeBAC (piège + solution)
${notionsToGenerate.length + 5}. astuce (mnémotechnique ou astuce)

FORMAT JSON :
{
  "notions": [
    {
      "notionId": "id-exact-fourni",
      "notionTitle": "Titre exact",
      "comprendre": "...",
      "points_cles": ["...", "..."],
      ${specificExample}
      "methode": {"title": "Méthode", "steps": ["..."]},
      "exempleResolu": {"enonce": "...", "etapes": ["..."], "conclusion": "..."},
      "piegeBAC": {"trap": "...", "solution": "..."},
      "astuce": "..."
    }
  ]
}

CONTRAINTES :
- EXACTEMENT ${notionsToGenerate.length} notions
- INTERDIT d'inventer des formules mathématiques
- Réponds UNIQUEMENT avec le JSON`;
}

function buildNotionsPrompt(subjectLabel, chapterTitle, notionsToGenerate, subjectKey) {
  const subjectType = getSubjectType(subjectKey);
  if (subjectType === 'scientific') {
    return buildScientificNotionsPrompt(subjectLabel, chapterTitle, notionsToGenerate);
  }
  return buildLessonNotionsPrompt(subjectLabel, chapterTitle, notionsToGenerate, subjectKey);
}

function buildQuizPrompt(subjectLabel, chapterTitle, notions, count) {
  const notionsText = notions.map((n) => `- ${n.notionTitle || n.titre}`).join('\n');

  return `Tu es professeur expert du BAC en Terminale D (${subjectLabel}).

Chapitre : "${chapterTitle}"

Génère un QUIZ de ${count} questions sur ces notions :
${notionsText}

RÈGLES : 4 options A/B/C/D, 1 seule bonne réponse, explication pour chaque.

${LATEX_RULES}

FORMAT JSON :
{
  "quiz": [
    {
      "question": "...",
      "options": [
        {"id": "A", "text": "..."},
        {"id": "B", "text": "..."},
        {"id": "C", "text": "..."},
        {"id": "D", "text": "..."}
      ],
      "correctAnswer": "A",
      "explanation": "..."
    }
  ]
}

CONTRAINTES : EXACTEMENT ${count} questions · Réponds UNIQUEMENT avec le JSON`;
}

// ════════════════════════════════════════════════════════════════
// VALIDATIONS
// ════════════════════════════════════════════════════════════════
function validateNotionsResponse(data, subjectType) {
  if (!data || !Array.isArray(data.notions) || data.notions.length === 0) return false;

  return data.notions.every((n) => {
    if (!n.notionId || !n.notionTitle) return false;
    if (typeof n.comprendre !== 'string') return false;

    if (subjectType === 'scientific') {
      if (n.formules && !Array.isArray(n.formules)) return false;
    } else {
      if (!Array.isArray(n.points_cles) || n.points_cles.length === 0) return false;
    }
    return true;
  });
}

function validateQuiz(data) {
  return data && Array.isArray(data.quiz) && data.quiz.length >= 1 &&
    data.quiz.every((q) => q && q.question && Array.isArray(q.options) && q.options.length === 4 &&
      ['A', 'B', 'C', 'D'].includes(q.correctAnswer));
}

// ════════════════════════════════════════════════════════════════
// GESTION DU CAHIER
// ════════════════════════════════════════════════════════════════
function cahierKey(subject, chapter) {
  return `${subject}__${normalizeText(chapter).slice(0, 40)}`;
}

async function loadCahierFromDB(uid, subject, chapter) {
  try {
    const { db } = getAdminServices();
    const key = cahierKey(subject, chapter);
    const ref = db.collection('users').doc(uid).collection(CAHIER_COLLECTION).doc(key);
    const snap = await ref.get();
    if (!snap.exists) return null;
    return { id: snap.id, ...snap.data() };
  } catch (e) {
    console.warn('[CAHIER] Erreur lecture:', e.message);
    return null;
  }
}

async function saveCahierToDB(uid, subject, chapter, cahierData) {
  try {
    const { db, FieldValue } = getAdminServices();
    const key = cahierKey(subject, chapter);
    const ref = db.collection('users').doc(uid).collection(CAHIER_COLLECTION).doc(key);

    await ref.set({
      subject,
      chapter,
      notions: cahierData.notions || [],
      generatedIds: cahierData.generatedIds || [],
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: cahierData.createdAt || FieldValue.serverTimestamp()
    }, { merge: true });

    return { id: key };
  } catch (e) {
    console.error('[CAHIER] Erreur sauvegarde:', e.message);
    throw e;
  }
}

function cleanNotion(n) {
  const cleaned = {
    notionId: n.notionId || '',
    notionTitle: n.notionTitle || '',
    comprendre: n.comprendre || '',
    generatedAt: new Date().toISOString()
  };

  // SCIENTIFIQUES
  if (Array.isArray(n.formules) && n.formules.length > 0) cleaned.formules = n.formules;
  if (Array.isArray(n.proprietes) && n.proprietes.length > 0) cleaned.proprietes = n.proprietes;
  if (Array.isArray(n.methodes) && n.methodes.length > 0) cleaned.methodes = n.methodes;

  // LEÇONS
  if (Array.isArray(n.points_cles) && n.points_cles.length > 0) cleaned.points_cles = n.points_cles;
  if (Array.isArray(n.termes) && n.termes.length > 0) cleaned.termes = n.termes;
  if (Array.isArray(n.mecanismes) && n.mecanismes.length > 0) cleaned.mecanismes = n.mecanismes;
  if (Array.isArray(n.dates_cles) && n.dates_cles.length > 0) cleaned.dates_cles = n.dates_cles;
  if (Array.isArray(n.personnages) && n.personnages.length > 0) cleaned.personnages = n.personnages;
  if (Array.isArray(n.lieux) && n.lieux.length > 0) cleaned.lieux = n.lieux;
  if (Array.isArray(n.auteurs) && n.auteurs.length > 0) cleaned.auteurs = n.auteurs;

  // COMMUNS
  if (n.methode && typeof n.methode === 'object') cleaned.methode = n.methode;
  if (n.exempleResolu && typeof n.exempleResolu === 'object') cleaned.exempleResolu = n.exempleResolu;
  if (n.piegeBAC && typeof n.piegeBAC === 'object') cleaned.piegeBAC = n.piegeBAC;
  if (n.astuce) cleaned.astuce = n.astuce;

  return cleaned;
}

// ════════════════════════════════════════════════════════════════
// ACTIONS
// ════════════════════════════════════════════════════════════════

async function actionLoadCahier(uid, body) {
  const { subject, chapter } = body;
  if (!ALLOWED_SUBJECTS.has(subject)) throw { status: 400, message: 'Matière invalide.' };
  if (!chapter || typeof chapter !== 'string') throw { status: 400, message: 'Chapitre invalide.' };

  const knowledgeBase = loadKnowledgeBase(subject);
  const chapterData = knowledgeBase ? findChapter(knowledgeBase, chapter) : null;
  const allNotions = chapterData ? getAllNotions(chapterData) : [];
  const totalAvailable = allNotions.length;

  const cahier = await loadCahierFromDB(uid, subject, chapter);

  return {
    success: true,
    subject,
    chapter,
    subjectType: getSubjectType(subject),
    totalAvailable,
    generatedCount: cahier?.notions?.length || 0,
    notions: cahier?.notions || [],
    generatedIds: cahier?.generatedIds || []
  };
}

async function actionLoadNotion(uid, body) {
  const { subject, chapter, notionId } = body;
  if (!subject || !chapter || !notionId) throw { status: 400, message: 'Paramètres manquants.' };

  const cahier = await loadCahierFromDB(uid, subject, chapter);
  if (!cahier) throw { status: 404, message: 'Cahier introuvable.' };

  const notion = cahier.notions?.find((n) => n.notionId === notionId);
  if (!notion) throw { status: 404, message: 'Notion introuvable.' };

  return { success: true, notion };
}

// ✅ NOUVELLE ACTION : lister les cahiers (pour l'historique)
async function actionListCahiers(uid, body) {
  try {
    const { db } = getAdminServices();
    const limit = Math.min(100, Number(body.limit) || 50);

    // ✅ Requête simple SANS orderBy (évite les problèmes d'index Firestore)
    const snap = await db.collection('users').doc(uid)
      .collection(CAHIER_COLLECTION)
      .limit(limit)
      .get();

    const cahiers = snap.docs.map((d) => {
      const data = d.data();
      const notions = Array.isArray(data.notions) ? data.notions : [];
      const generatedIds = Array.isArray(data.generatedIds) ? data.generatedIds : [];

      return {
        id: d.id,
        subject: data.subject || '',
        subjectLabel: SUBJECT_LABELS[data.subject] || data.subject || 'Matière',
        chapter: data.chapter || 'Chapitre',
        notionsCount: notions.length,
        generatedCount: generatedIds.length,
        updatedAt: toISO(data.updatedAt || data.createdAt),
        createdAt: toISO(data.createdAt)
      };
    });

    // ✅ Tri côté serveur (JS) au lieu de Firestore
    cahiers.sort((a, b) => {
      const dateA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const dateB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      return dateB - dateA;
    });

    return {
      success: true,
      cahiers
    };
  } catch (error) {
    console.error('[REVISEUR] listCahiers échouée:', error.message);
    console.error('[REVISEUR] listCahiers stack:', error.stack);
    throw {
      status: 500,
      message: 'Impossible de charger l\'historique.',
      debug: error.message
    };
  }
}

async function actionGenerateInitial(uid, body) {
  const { subject, chapter } = body;
  if (!ALLOWED_SUBJECTS.has(subject)) throw { status: 400, message: 'Matière invalide.' };
  if (!chapter) throw { status: 400, message: 'Chapitre invalide.' };

  const knowledgeBase = loadKnowledgeBase(subject);
  const chapterData = knowledgeBase ? findChapter(knowledgeBase, chapter) : null;
  if (!chapterData) throw { status: 404, message: 'Chapitre introuvable dans la base.' };

  const allNotions = getAllNotions(chapterData);
  if (allNotions.length === 0) throw { status: 404, message: 'Aucune notion dans ce chapitre.' };

  const subjectLabel = knowledgeBase?.matiereLabel || subject;
  const chapterTitle = chapterData.titre || chapter;
  const subjectType = getSubjectType(subject);

  let cahier = await loadCahierFromDB(uid, subject, chapter);
  if (!cahier) {
    cahier = { notions: [], generatedIds: [] };
  }

  const remainingNotions = allNotions.filter((n) => !cahier.generatedIds.includes(n.id));
  if (remainingNotions.length === 0) {
    return {
      success: true,
      notions: [],
      generatedCount: cahier.notions.length,
      totalAvailable: allNotions.length,
      source: 'complete',
      message: 'Toutes les notions sont déjà générées.'
    };
  }

  const notionsToGenerate = remainingNotions.slice(0, INITIAL_NOTIONS_COUNT);
  console.log(`[REVISEUR v7.4] generateInitial | ${subject} (${subjectType}) > ${chapter} | ${notionsToGenerate.length}/${remainingNotions.length} notions`);

  let reservation = null;
  try {
    reservation = await reserveFreeGeneration(uid);
  } catch (error) {
    console.error('[REVISEUR] Erreur quota:', error.message);
    throw { status: 503, message: 'Quota temporairement indisponible.' };
  }

  if (reservation.limitReached) {
    throw {
      status: 429,
      code: 'FREE_REVISEUR_LIMIT',
      message: 'Limite gratuite atteinte. Passe à Premium.',
      used: reservation.used,
      limit: FREE_REVISEUR_LIMIT
    };
  }

  const prompt = buildNotionsPrompt(subjectLabel, chapterTitle, notionsToGenerate, subject);

  let generatedData;
  try {
    const result = await generateWithCascade(
      prompt,
      (data) => validateNotionsResponse(data, subjectType),
      MAX_TOKENS_PER_CALL,
      0.3,
      'initial'
    );
    generatedData = result.data;
  } catch (err) {
    console.error('[REVISEUR] IA échouée:', err.message);

    if (reservation?.reserved) {
      try { await releaseFreeGeneration(uid, reservation.usageDate); } catch (_) {}
    }

    throw { status: 503, message: 'Service IA temporairement indisponible. Réessaie dans une minute.' };
  }

  generatedData = deepClean(generatedData);

  const newNotions = generatedData.notions.map(cleanNotion);

  cahier.notions.push(...newNotions);
  cahier.generatedIds.push(...notionsToGenerate.map((n) => n.id));

  await saveCahierToDB(uid, subject, chapter, cahier);

  return {
    success: true,
    notions: newNotions,
    generatedCount: cahier.notions.length,
    totalAvailable: allNotions.length,
    source: 'ai',
    message: `${newNotions.length} notions générées.`,
    quota: reservation?.premium
      ? { type: 'premium', unlimited: true }
      : { type: 'free', used: reservation?.used, limit: FREE_REVISEUR_LIMIT }
  };
}

async function actionGenerateMore(uid, body) {
  const { subject, chapter } = body;
  if (!ALLOWED_SUBJECTS.has(subject)) throw { status: 400, message: 'Matière invalide.' };
  if (!chapter) throw { status: 400, message: 'Chapitre invalide.' };

  const knowledgeBase = loadKnowledgeBase(subject);
  const chapterData = knowledgeBase ? findChapter(knowledgeBase, chapter) : null;
  if (!chapterData) throw { status: 404, message: 'Chapitre introuvable.' };

  const allNotions = getAllNotions(chapterData);
  const subjectLabel = knowledgeBase?.matiereLabel || subject;
  const chapterTitle = chapterData.titre || chapter;
  const subjectType = getSubjectType(subject);

  const cahier = await loadCahierFromDB(uid, subject, chapter);
  if (!cahier) {
    throw { status: 400, message: 'Aucune génération initiale. Lance d\'abord la première génération.' };
  }

  const remainingNotions = allNotions.filter((n) => !cahier.generatedIds.includes(n.id));
  if (remainingNotions.length === 0) {
    return {
      success: true,
      notions: [],
      generatedCount: cahier.notions.length,
      totalAvailable: allNotions.length,
      source: 'complete',
      message: 'Toutes les notions sont déjà générées.'
    };
  }

  const shuffled = shuffle(remainingNotions);
  const notionsToGenerate = shuffled.slice(0, Math.min(MORE_NOTIONS_COUNT, shuffled.length));
  console.log(`[REVISEUR v7.4] generateMore | ${subject} (${subjectType}) > ${chapter} | ${notionsToGenerate.length}/${remainingNotions.length} notions`);

  let reservation = null;
  try {
    reservation = await reserveFreeGeneration(uid);
  } catch (error) {
    console.error('[REVISEUR] Erreur quota:', error.message);
    throw { status: 503, message: 'Quota temporairement indisponible.' };
  }

  if (reservation.limitReached) {
    throw {
      status: 429,
      code: 'FREE_REVISEUR_LIMIT',
      message: 'Limite gratuite atteinte. Passe à Premium.',
      used: reservation.used,
      limit: FREE_REVISEUR_LIMIT
    };
  }

  const prompt = buildNotionsPrompt(subjectLabel, chapterTitle, notionsToGenerate, subject);

  let generatedData;
  try {
    const result = await generateWithCascade(
      prompt,
      (data) => validateNotionsResponse(data, subjectType),
      MAX_TOKENS_PER_CALL,
      0.4,
      'more'
    );
    generatedData = result.data;
  } catch (err) {
    console.error('[REVISEUR] IA échouée:', err.message);

    if (reservation?.reserved) {
      try { await releaseFreeGeneration(uid, reservation.usageDate); } catch (_) {}
    }

    throw { status: 503, message: 'Service IA temporairement indisponible. Réessaie dans une minute.' };
  }

  generatedData = deepClean(generatedData);

  const newNotions = generatedData.notions.map(cleanNotion);

  cahier.notions.push(...newNotions);
  cahier.generatedIds.push(...notionsToGenerate.map((n) => n.id));

  await saveCahierToDB(uid, subject, chapter, cahier);

  return {
    success: true,
    notions: newNotions,
    generatedCount: cahier.notions.length,
    totalAvailable: allNotions.length,
    source: 'ai',
    message: `${newNotions.length} nouvelles notions générées.`,
    quota: reservation?.premium
      ? { type: 'premium', unlimited: true }
      : { type: 'free', used: reservation?.used, limit: FREE_REVISEUR_LIMIT }
  };
}

async function actionDeleteNotion(uid, body) {
  const { subject, chapter, notionId } = body;
  if (!subject || !chapter || !notionId) throw { status: 400, message: 'Paramètres manquants.' };

  const cahier = await loadCahierFromDB(uid, subject, chapter);
  if (!cahier) throw { status: 404, message: 'Cahier introuvable.' };

  cahier.notions = (cahier.notions || []).filter((n) => n.notionId !== notionId);
  cahier.generatedIds = (cahier.generatedIds || []).filter((id) => id !== notionId);

  await saveCahierToDB(uid, subject, chapter, cahier);

  return { success: true };
}

async function actionQuiz(uid, body) {
  const { subject, chapter } = body;
  const count = Math.min(15, Math.max(5, Number(body.count) || 10));

  if (!ALLOWED_SUBJECTS.has(subject)) throw { status: 400, message: 'Matière invalide.' };
  if (!chapter) throw { status: 400, message: 'Chapitre invalide.' };

  const knowledgeBase = loadKnowledgeBase(subject);
  const chapterData = knowledgeBase ? findChapter(knowledgeBase, chapter) : null;
  if (!chapterData) throw { status: 404, message: 'Chapitre introuvable.' };

  const subjectLabel = knowledgeBase?.matiereLabel || subject;
  const chapterTitle = chapterData.titre || chapter;

  const cahier = await loadCahierFromDB(uid, subject, chapter);
  const notions = cahier?.notions || [];
  if (notions.length === 0) {
    throw { status: 400, message: 'Génère d\'abord des notions avant de faire un quiz.' };
  }

  let reservation = null;
  try {
    reservation = await reserveFreeGeneration(uid);
  } catch (error) {
    console.error('[REVISEUR] Erreur quota:', error.message);
    throw { status: 503, message: 'Quota temporairement indisponible.' };
  }

  if (reservation.limitReached) {
    throw {
      status: 429,
      code: 'FREE_REVISEUR_LIMIT',
      message: 'Limite gratuite atteinte. Passe à Premium.',
      used: reservation.used,
      limit: FREE_REVISEUR_LIMIT
    };
  }

  const prompt = buildQuizPrompt(subjectLabel, chapterTitle, notions, count);

  let quizData;
  try {
    const result = await generateWithCascade(prompt, validateQuiz, 4000, 0.6, 'quiz');
    quizData = result.data;
  } catch (err) {
    console.error('[REVISEUR] Quiz IA échoué:', err.message);

    if (reservation?.reserved) {
      try { await releaseFreeGeneration(uid, reservation.usageDate); } catch (_) {}
    }

    throw { status: 503, message: 'Quiz temporairement indisponible.' };
  }

  quizData = deepClean(quizData);
  const validQuiz = (quizData.quiz || []).filter((q) => q && q.question && Array.isArray(q.options) && q.options.length === 4);

  if (validQuiz.length === 0) {
    if (reservation?.reserved) {
      try { await releaseFreeGeneration(uid, reservation.usageDate); } catch (_) {}
    }

    return {
      success: true,
      quiz: [],
      source: 'unavailable',
      message: 'Aucune question générée. Réessaie.'
    };
  }

  return {
    success: true,
    quiz: validQuiz,
    source: 'ai',
    quota: reservation?.premium
      ? { type: 'premium', unlimited: true }
      : { type: 'free', used: reservation?.used, limit: FREE_REVISEUR_LIMIT }
  };
}

async function actionDeleteCahier(uid, body) {
  const { subject, chapter } = body;
  if (!subject || !chapter) throw { status: 400, message: 'Paramètres manquants.' };

  try {
    const { db } = getAdminServices();
    const key = cahierKey(subject, chapter);
    await db.collection('users').doc(uid).collection(CAHIER_COLLECTION).doc(key).delete();
    return { success: true };
  } catch (e) {
    throw { status: 500, message: 'Impossible de supprimer le cahier.' };
  }
}

// ════════════════════════════════════════════════════════════════
// HANDLER
// ════════════════════════════════════════════════════════════════
module.exports = async function handler(request, response) {

// ✅ FIX — la config DOIT être assignée APRÈS module.exports, sinon elle
// est écrasée et maxDuration retombe à la valeur par défaut (10s sur Vercel).
module.exports.config = { maxDuration: 60 };
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

  try {
    switch (action) {
      case 'loadCahier':      return response.status(200).json(await actionLoadCahier(user.uid, body));
      case 'loadNotion':      return response.status(200).json(await actionLoadNotion(user.uid, body));
      case 'listCahiers':     return response.status(200).json(await actionListCahiers(user.uid, body));
      case 'generateInitial': return response.status(200).json(await actionGenerateInitial(user.uid, body));
      case 'generateMore':    return response.status(200).json(await actionGenerateMore(user.uid, body));
      case 'deleteNotion':    return response.status(200).json(await actionDeleteNotion(user.uid, body));
      case 'deleteCahier':    return response.status(200).json(await actionDeleteCahier(user.uid, body));
      case 'quiz':            return response.status(200).json(await actionQuiz(user.uid, body));
      default:                return jsonError(response, 400, `Action inconnue : "${action}"`);
    }
  } catch (error) {
    console.error(`[REVISEUR v7.4] "${action}" échouée:`, error.message);
    if (error.status) return jsonError(response, error.status, error.message, error.code, error.debug);
    return jsonError(response, 500, error.message || 'Erreur serveur.');
  }
};
