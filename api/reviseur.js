// ================================================================
// API RÉVISEUR v5.1 — ARVEXA School
// Fan-out parallèle + base JSON + pool Firestore + Historique Premium
// 6 profils : scientifique / svt / philosophie / histoire / francais / langue
// ================================================================

const fs = require('fs');
const path = require('path');

module.exports.config = { maxDuration: 90 };

const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW_LIGHT = 60;
const MAX_REQUESTS_PER_WINDOW_HEAVY = 30;
const requestLog = new Map();

const FREE_REVISEUR_LIMIT = 2;

const ALLOWED_SUBJECTS = new Set(['mathematiques', 'physique', 'chimie', 'svt', 'philosophie', 'histoire', 'geographie']);
const ALLOWED_MODES = new Set(['fiche', 'flashcard']);
const ALLOWED_ACTIONS = new Set(['generate', 'quiz', 'exercises', 'listSessions', 'loadSession', 'deleteSession']);
const LIGHT_ACTIONS = new Set(['listSessions', 'loadSession', 'deleteSession']);
const PREMIUM_ACTIONS = new Set(['listSessions', 'loadSession']);

const MAX_TOKENS = {
  FICHE: 8000,
  FLASHCARDS: 4000,
  QUIZ: 4000,
  EXERCISES: 8000
};

const NOTION_BATCH_SIZE = 4;
const MAX_BATCHES = 8;
const POOL_COLLECTION = 'reviseurPool';

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
  if (KNOWLEDGE_MEMORY_CACHE.has(subject)) return KNOWLEDGE_MEMORY_CACHE.get(subject);

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
        console.log(`[REVISEUR] ✅ Base chargée : ${filename}`);
        KNOWLEDGE_MEMORY_CACHE.set(subject, data);
        return data;
      }
    } catch (error) {
      console.warn(`[REVISEUR] Erreur lecture ${filePath}:`, error.message);
    }
  }

  console.warn(`[REVISEUR] Base absente : ${filename}`);
  KNOWLEDGE_MEMORY_CACHE.set(subject, null);
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

function cleanId(str) {
  return String(str || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
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

function chunk(array, size) {
  const result = [];
  for (let i = 0; i < array.length; i += size) result.push(array.slice(i, i + size));
  return result;
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
  const parts = text.split(/(\$\$[^$]+\$\$|\$[^$]+\$)/g);
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
  const { db, FieldValue } = getAdminServices();
  const usageRef = db.collection('users').doc(uid).collection('reviseurUsage').doc(usageDate);
  try {
    await db.runTransaction(async (transaction) => {
      const snap = await transaction.get(usageRef);
      const used = Math.max(0, Number(snap.data()?.count || 0) - 1);
      transaction.set(usageRef, { count: used, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    });
  } catch (_) {}
}

// ════════════════════════════════════════════════════════════════
// FOURNISSEURS IA
// ════════════════════════════════════════════════════════════════
function getProviders() {
  const providers = [];
  if (process.env.GROQ_API_KEY) {
    providers.push(
      { name: 'Groq/gpt-oss-120b', key: process.env.GROQ_API_KEY, endpoint: 'https://api.groq.com/openai/v1/chat/completions', model: 'openai/gpt-oss-120b', jsonMode: true, headers: {} },
      { name: 'Groq/llama-3.3-70b', key: process.env.GROQ_API_KEY, endpoint: 'https://api.groq.com/openai/v1/chat/completions', model: 'llama-3.3-70b-versatile', jsonMode: true, headers: {} },
      { name: 'Groq/gpt-oss-20b', key: process.env.GROQ_API_KEY, endpoint: 'https://api.groq.com/openai/v1/chat/completions', model: 'openai/gpt-oss-20b', jsonMode: true, headers: {} },
      { name: 'Groq/llama-3.1-8b', key: process.env.GROQ_API_KEY, endpoint: 'https://api.groq.com/openai/v1/chat/completions', model: 'llama-3.1-8b-instant', jsonMode: true, headers: {} }
    );
  }
  if (process.env.OPENROUTER_API_KEY) {
    const orHeaders = {
      'HTTP-Referer': process.env.APP_ORIGIN || '',
      'X-Title': 'ARVEXA Reviseur'
    };
    providers.push(
      { name: 'OpenRouter/inkling:free', key: process.env.OPENROUTER_API_KEY, endpoint: 'https://openrouter.ai/api/v1/chat/completions', model: 'thinkingmachines/inkling:free', jsonMode: true, headers: orHeaders },
      { name: 'OpenRouter/dots3:free', key: process.env.OPENROUTER_API_KEY, endpoint: 'https://openrouter.ai/api/v1/chat/completions', model: 'dots-studio/dots3-note-preview:free', jsonMode: true, headers: orHeaders },
      { name: 'OpenRouter/inkling-small:free', key: process.env.OPENROUTER_API_KEY, endpoint: 'https://openrouter.ai/api/v1/chat/completions', model: 'thinkingmachines/inkling-small:free', jsonMode: true, headers: orHeaders }
    );
  }
  return providers;
}

async function callProvider(provider, prompt, maxTokens, temperature) {
  if (!maxTokens) maxTokens = 4000;
  if (typeof temperature !== 'number') temperature = 0.15;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
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
      throw new Error(`${provider.name}: ${msg}`);
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

  const startTime = Date.now();
  const TIME_BUDGET_MS = 80000;

  const errors = [];
  for (const provider of providers) {
    const elapsed = Date.now() - startTime;
    if (elapsed > TIME_BUDGET_MS) {
      errors.push('time_budget_exceeded');
      console.warn(`[AI] ${taskName} — budget temps épuisé (${elapsed}ms)`);
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
    }
  }
  throw new Error('all_providers_failed: ' + errors.join(' | '));
}

// ════════════════════════════════════════════════════════════════
// POOL FIRESTORE
// ════════════════════════════════════════════════════════════════
async function saveSessionToPool(subject, chapter, mode, session, uid) {
  try {
    const { db, FieldValue } = getAdminServices();
    const ref = db.collection(POOL_COLLECTION).doc();
    await ref.set({
      subject, chapter, mode, session,
      source: 'ai',
      generatedBy: uid,
      createdAt: FieldValue.serverTimestamp(),
      usedCount: 0
    });
    console.log(`[POOL] Session sauvegardée : ${subject} / ${chapter} / ${mode}`);
  } catch (e) {
    console.warn('[POOL] Erreur sauvegarde:', e.message);
  }
}

async function buildSessionFromPool(subject, chapter, mode) {
  try {
    const { db } = getAdminServices();
    const snap = await db.collection(POOL_COLLECTION)
      .where('subject', '==', subject)
      .where('mode', '==', mode)
      .limit(50)
      .get();

    if (snap.empty) return null;

    const allSessions = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    const chapterTarget = normalizeText(chapter);
    let matching = allSessions.filter((s) => normalizeText(s.chapter) === chapterTarget);
    if (matching.length === 0) matching = allSessions;

    matching.sort((a, b) => (a.usedCount || 0) - (b.usedCount || 0));
    const top = matching.slice(0, Math.max(1, Math.ceil(matching.length / 3)));
    const picked = top[Math.floor(Math.random() * top.length)];

    await db.collection(POOL_COLLECTION).doc(picked.id).update({
      usedCount: (picked.usedCount || 0) + 1,
      lastUsedAt: new Date()
    }).catch(() => {});

    return { session: picked.session, source: 'pool', poolId: picked.id };
  } catch (e) {
    console.warn('[POOL] Erreur lecture:', e.message);
    return null;
  }
}

async function buildQuizFromPool(subject, chapter, count) {
  try {
    const { db } = getAdminServices();
    const snap = await db.collection(POOL_COLLECTION)
      .where('subject', '==', subject)
      .where('mode', '==', 'quiz')
      .limit(30)
      .get();

    if (snap.empty) return null;

    const allQuizzes = snap.docs.map((d) => d.data());
    const allQuestions = [];
    allQuizzes.forEach((q) => {
      if (Array.isArray(q.session?.quiz)) allQuestions.push(...q.session.quiz);
    });

    if (allQuestions.length < count) return null;

    const picked = shuffle(allQuestions).slice(0, count);
    return { quiz: picked, source: 'pool' };
  } catch (e) { return null; }
}

async function buildUnavailableSession(chapterTitle, mode) {
  return {
    chapterTitle,
    mode,
    sections: [],
    flashcards: [],
    quiz: [],
    unavailable: true,
    message: `Le contenu pour "${chapterTitle}" n'est pas disponible pour le moment. Réessaie dans quelques minutes.`
  };
}

// ════════════════════════════════════════════════════════════════
// PROMPTS ENRICHIS
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
Tu prépares un élève de Terminale D au Niger qui peut avoir UNE SEULE
JOURNÉE pour réviser avant son examen. Ton contenu doit permettre à
cet élève de :
  1. Comprendre CHAQUE notion en profondeur
  2. Mémoriser les formules essentielles
  3. Reconnaître les pièges du BAC
  4. Appliquer les méthodes pas à pas
  5. Réussir l'examen, même en apprenant la veille
`;

function serializeNotion(notion, index) {
  const lines = [];
  lines.push(`─── NOTION ${index + 1} ───`);
  lines.push(`id: ${notion.id}`);
  lines.push(`titre: ${notion.titre}`);
  if (notion.description_courte) lines.push(`description_courte: ${notion.description_courte}`);
  if (notion.description_longue) lines.push(`description_longue: ${notion.description_longue}`);
  else if (notion.description) lines.push(`description: ${notion.description}`);

  if (Array.isArray(notion.formules)) {
    lines.push('FORMULES :');
    notion.formules.forEach((f) => {
      const latex = typeof f === 'string' ? f : (f.latex || '');
      if (latex) lines.push(`  • ${latex}`);
    });
  }
  if (Array.isArray(notion.proprietes)) {
    lines.push('PROPRIÉTÉS :');
    notion.proprietes.forEach((p) => lines.push(`  • ${p}`));
  }
  if (Array.isArray(notion.methodes)) {
    lines.push('MÉTHODES :');
    notion.methodes.forEach((m) => lines.push(`  • ${m}`));
  }
  if (notion.exemple_resolu) {
    lines.push('EXEMPLE RÉSOLU (fourni) :');
    if (notion.exemple_resolu.enonce) lines.push(`  Énoncé : ${notion.exemple_resolu.enonce}`);
    if (Array.isArray(notion.exemple_resolu.etapes)) {
      notion.exemple_resolu.etapes.forEach((e, i) => lines.push(`  Étape ${i + 1} : ${e}`));
    }
    if (notion.exemple_resolu.conclusion) lines.push(`  Conclusion : ${notion.exemple_resolu.conclusion}`);
  }
  if (Array.isArray(notion.erreurs_frequentes)) {
    lines.push('ERREURS FRÉQUENTES :');
    notion.erreurs_frequentes.forEach((e) => lines.push(`  • ${e}`));
  }
  if (Array.isArray(notion.pieges_examen)) {
    lines.push('PIÈGES D\'EXAMEN :');
    notion.pieges_examen.forEach((p) => lines.push(`  • ${p}`));
  }
  if (notion.mnemo) lines.push(`MNÉMOTECHNIQUE : ${notion.mnemo}`);
  return lines.join('\n');
}

function buildFichePrompt(subjectLabel, chapterTitle, notions) {
  const notionsSerialized = notions.map((n, i) => serializeNotion(n, i)).join('\n\n');
  const N = notions.length;

  return `Tu es un professeur expert du BAC au Niger, avec 20 ans d'expérience en Terminale D.

${PEDAGOGY_RULES}

MISSION : Génère une FICHE DE RÉVISION ULTIME pour le chapitre "${chapterTitle}" (${subjectLabel}).

═══════════════════════════════════════════════════════════════
NOTIONS OBLIGATOIRES À COUVRIR (${N} notions)
═══════════════════════════════════════════════════════════════
${notionsSerialized}

═══════════════════════════════════════════════════════════════
CE QUE TU DOIS GÉNÉRER POUR CHAQUE NOTION
═══════════════════════════════════════════════════════════════
1. COMPRENDRE (4-6 phrases)
2. FORMULES (latex + condition + usage)
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
  "keyPoints": ["3 à 5 points clés"],
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

CONTRAINTES : EXACTEMENT ${N} sections · Qualité maximale · Réponds UNIQUEMENT avec le JSON`;
}

function buildFlashcardsPrompt(subjectLabel, chapterTitle, notions) {
  const notionsSerialized = notions.map((n, i) => serializeNotion(n, i)).join('\n\n');
  const N = notions.length;
  const total = N * 5;

  return `Tu es un professeur expert du BAC au Niger.

${PEDAGOGY_RULES}

MISSION : Génère ${total} FLASHCARDS haute qualité pour "${chapterTitle}" (${subjectLabel}).

═══════════════════════════════════════════════════════════════
NOTIONS À COUVRIR
═══════════════════════════════════════════════════════════════
${notionsSerialized}

RÈGLES : 5 flashcards par notion · Types variés (definition, formule, methode, piege, application)

${LATEX_RULES}

FORMAT JSON :
{
  "chapterTitle": "${chapterTitle}",
  "flashcards": [
    { "notionId": "id", "type": "definition", "question": "...", "answer": "...", "hint": null, "difficulty": 1 }
  ]
}

CONTRAINTES : EXACTEMENT ${total} flashcards · Réponses complètes (jamais "Voir cours") · Réponds UNIQUEMENT avec le JSON`;
}

function buildQuizPrompt(subjectLabel, chapterTitle, notions, level, questionCount, seed) {
  const notionsSerialized = notions.map((n, i) => serializeNotion(n, i)).join('\n\n');

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
function validateFiche(data) {
  return data && Array.isArray(data.sections) && data.sections.length >= 1 &&
    data.sections.every((s) => s && s.notionTitle && typeof s.comprendre === 'string' && s.comprendre.length > 20);
}

function validateFlashcards(data) {
  return data && Array.isArray(data.flashcards) && data.flashcards.length >= 1 &&
    data.flashcards.every((c) => c && c.question && c.answer && c.notionId);
}

function validateQuiz(data) {
  return data && Array.isArray(data.quiz) && data.quiz.length >= 1 &&
    data.quiz.every((q) => q && q.question && Array.isArray(q.options) && q.options.length === 4 &&
      ['A', 'B', 'C', 'D'].includes(q.correctAnswer));
}

// ════════════════════════════════════════════════════════════════
// GÉNÉRATION PAR LOTS
// ════════════════════════════════════════════════════════════════
async function generateFicheByBatches(subjectLabel, chapterTitle, notions) {
  const batches = chunk(notions, NOTION_BATCH_SIZE).slice(0, MAX_BATCHES);

  const results = await Promise.allSettled(
    batches.map(async (batch, i) => {
      const prompt = buildFichePrompt(subjectLabel, chapterTitle, batch);
      const { data } = await generateWithCascade(prompt, validateFiche, MAX_TOKENS.FICHE, 0.15, `fiche-batch-${i + 1}`);
      return { batch, data };
    })
  );

  const allSections = [];
  const missingBatches = [];

  results.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value?.data?.sections) {
      allSections.push(...r.value.data.sections);
    } else {
      missingBatches.push(batches[i]);
    }
  });

  if (missingBatches.length > 0) {
    console.warn(`[REVISEUR] ${missingBatches.length} lot(s) en échec`);
  }

  const firstValid = results.find((r) => r.status === 'fulfilled' && r.value?.data);
  const extra = firstValid?.value?.data || {};

  return {
    chapterTitle,
    sections: allSections,
    keyPoints: extra.keyPoints || notions.slice(0, 5).map((n) => n.titre),
    examTraps: extra.examTraps || [],
    commonMistakes: extra.commonMistakes || [],
    partial: missingBatches.length > 0
  };
}

async function generateFlashcardsByBatches(subjectLabel, chapterTitle, notions) {
  const batches = chunk(notions, NOTION_BATCH_SIZE).slice(0, MAX_BATCHES);

  const results = await Promise.allSettled(
    batches.map(async (batch, i) => {
      const prompt = buildFlashcardsPrompt(subjectLabel, chapterTitle, batch);
      const { data } = await generateWithCascade(prompt, validateFlashcards, MAX_TOKENS.FLASHCARDS, 0.15, `flashcards-batch-${i + 1}`);
      return { batch, data };
    })
  );

  const allCards = [];
  results.forEach((r) => {
    if (r.status === 'fulfilled' && r.value?.data?.flashcards) {
      allCards.push(...r.value.data.flashcards);
    }
  });

  return { chapterTitle, flashcards: allCards };
}

async function generateQuizByBatches(subjectLabel, chapterTitle, notions, level, totalCount, seed) {
  const countPerBatch = Math.max(3, Math.ceil(totalCount / 2));
  const batches = chunk(notions, NOTION_BATCH_SIZE).slice(0, 2);

  const results = await Promise.allSettled(
    batches.map(async (batch, i) => {
      const prompt = buildQuizPrompt(subjectLabel, chapterTitle, batch, level, countPerBatch, seed);
      const { data } = await generateWithCascade(prompt, validateQuiz, MAX_TOKENS.QUIZ, 0.6, `quiz-batch-${i + 1}`);
      return { batch, data };
    })
  );

  const allQuestions = [];
  results.forEach((r) => {
    if (r.status === 'fulfilled' && r.value?.data?.quiz) {
      allQuestions.push(...r.value.data.quiz);
    }
  });

  if (allQuestions.length === 0) return null;

  return { chapterTitle, quiz: shuffle(allQuestions).slice(0, totalCount) };
}

// ════════════════════════════════════════════════════════════════
// HANDLER
// ════════════════════════════════════════════════════════════════
module.exports = async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return jsonError(response, 405, 'Méthode non autorisée.');
  }

  const body = request.body && typeof request.body === 'object' ? request.body : {};
  const action = body.action || 'generate';
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

  // ═══ HISTORIQUE : LISTER ═══
  if (action === 'listSessions') {
    try {
      const { db } = getAdminServices();
      const limit = Math.min(100, Number(body.limit) || 50);
      const snap = await db.collection('users').doc(user.uid)
        .collection('reviseurSessions')
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get();

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
    } catch (e) {
      console.error('[HISTORIQUE] listSessions error:', e.message);
      return jsonError(response, 500, 'Impossible de charger l\'historique.');
    }
  }

  // ═══ HISTORIQUE : CHARGER ═══
  if (action === 'loadSession') {
    if (!body.sessionId) return jsonError(response, 400, 'sessionId requis.');
    try {
      const { db } = getAdminServices();
      const ref = db.collection('users').doc(user.uid)
        .collection('reviseurSessions').doc(body.sessionId);
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
    } catch (e) {
      return jsonError(response, 500, 'Erreur chargement.');
    }
  }

  // ═══ HISTORIQUE : SUPPRIMER ═══
  if (action === 'deleteSession') {
    if (!body.sessionId) return jsonError(response, 400, 'sessionId requis.');
    try {
      const { db } = getAdminServices();
      await db.collection('users').doc(user.uid)
        .collection('reviseurSessions').doc(body.sessionId).delete();
      return response.status(200).json({ success: true });
    } catch (e) {
      return jsonError(response, 500, 'Erreur suppression.');
    }
  }

  // ═══ GÉNÉRATION & AUTRES ═══
  if (!ALLOWED_SUBJECTS.has(body.subject)) return jsonError(response, 400, 'Matière invalide.');
  if (typeof body.chapter !== 'string' || body.chapter.length > 100) return jsonError(response, 400, 'Chapitre invalide.');

  const knowledgeBase = loadKnowledgeBase(body.subject);
  const chapterData = knowledgeBase ? findChapter(knowledgeBase, body.chapter) : null;
  const mandatoryNotions = chapterData ? getMandatoryNotions(chapterData) : [];
  const hasKnowledge = mandatoryNotions.length > 0;

  const subjectLabel = knowledgeBase?.matiereLabel || {
    mathematiques: 'Mathématiques', physique: 'Physique', chimie: 'Chimie', svt: 'SVT',
    philosophie: 'Philosophie', histoire: 'Histoire', geographie: 'Géographie'
  }[body.subject] || body.subject;
  const chapterTitle = chapterData?.titre || body.chapter;

  console.log(`[REVISEUR v5.1] ${action} | ${body.subject} > ${body.chapter} | ${mandatoryNotions.length} notions`);

  // Quota (uniquement pour generate)
  let reservation = null;
  if (action === 'generate') {
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
  }

  try {
    // ═══ ACTION : GENERATE ═══
    if (action === 'generate') {
      if (!ALLOWED_MODES.has(body.mode)) {
        if (reservation?.reserved) { try { await releaseFreeGeneration(user.uid, reservation.usageDate); } catch (_) {} }
        return jsonError(response, 400, 'Mode invalide.');
      }

      const isFlashcard = body.mode === 'flashcard';
      let session;
      let source = 'ai';

      try {
        if (hasKnowledge) {
          session = isFlashcard
            ? await generateFlashcardsByBatches(subjectLabel, chapterTitle, mandatoryNotions)
            : await generateFicheByBatches(subjectLabel, chapterTitle, mandatoryNotions);
        } else {
          session = isFlashcard
            ? await generateFlashcardsByBatches(subjectLabel, chapterTitle, [{ id: 'chapter', titre: chapterTitle, description: '' }])
            : await generateFicheByBatches(subjectLabel, chapterTitle, [{ id: 'chapter', titre: chapterTitle, description: '' }]);
        }

        if (!session || (isFlashcard && session.flashcards?.length === 0) || (!isFlashcard && session.sections?.length === 0)) {
          throw new Error('empty_session');
        }
      } catch (aiError) {
        console.warn('[REVISEUR] IA échouée:', aiError.message);

        const pooled = await buildSessionFromPool(body.subject, body.chapter, body.mode);
        if (pooled) {
          session = pooled.session;
          source = 'pool';
          console.log('[REVISEUR] ✅ Fallback pool utilisé');
        } else {
          if (reservation?.reserved && !reservation?.premium) {
            try { await releaseFreeGeneration(user.uid, reservation.usageDate); } catch (_) {}
          }
          return response.status(200).json({
            success: true,
            session: await buildUnavailableSession(chapterTitle, body.mode),
            source: 'unavailable',
            quota: reservation?.premium ? { type: 'premium', unlimited: true } : { type: 'free', used: reservation?.used, limit: FREE_REVISEUR_LIMIT }
          });
        }
      }

      session = deepClean(session);

      // Sauvegarde en pool + historique
      if (source === 'ai') {
        await saveSessionToPool(body.subject, body.chapter, body.mode, session, user.uid);

        try {
          const { db, FieldValue } = getAdminServices();
          await db.collection('users').doc(user.uid).collection('reviseurSessions').add({
            subject: body.subject,
            subjectLabel,
            chapter: chapterTitle,
            mode: body.mode,
            notionsCovered: hasKnowledge ? mandatoryNotions.length : 0,
            session,
            createdAt: FieldValue.serverTimestamp()
          });
        } catch (e) {
          console.warn('[HISTORIQUE] Sauvegarde échouée:', e.message);
        }
      }

      return response.status(200).json({
        success: true,
        session: {
          ...session,
          subject: body.subject,
          subjectLabel,
          chapter: body.chapter,
          mode: body.mode,
          generationMode: source,
          notionsCovered: hasKnowledge ? mandatoryNotions.length : 0,
          generatedAt: new Date().toISOString()
        },
        source,
        quota: reservation?.premium ? { type: 'premium', unlimited: true } : { type: 'free', used: reservation?.used, limit: FREE_REVISEUR_LIMIT }
      });
    }

    // ═══ ACTION : QUIZ ═══
    if (action === 'quiz') {
      const count = Math.min(20, Math.max(5, Number(body.count) || 5));
      const level = Number(body.difficulty) || 2;
      const seed = hashString(Date.now() + '_' + user.uid + '_' + Math.random());

      let quizData;
      let source = 'ai';

      try {
        if (hasKnowledge) {
          quizData = await generateQuizByBatches(subjectLabel, chapterTitle, mandatoryNotions, level, count, seed);
          if (!quizData || !quizData.quiz || quizData.quiz.length === 0) throw new Error('empty_quiz');
        } else {
          throw new Error('no_knowledge_base');
        }
      } catch (e) {
        console.warn('[REVISEUR] Quiz IA échoué:', e.message);
        const pooled = await buildQuizFromPool(body.subject, body.chapter, count);
        if (pooled) {
          quizData = pooled;
          source = 'pool';
        } else {
          return response.status(200).json({
            success: true,
            quiz: [],
            source: 'unavailable',
            message: 'Quiz indisponible pour le moment.'
          });
        }
      }

      quizData = deepClean(quizData);

      if (source === 'ai') {
        try {
          const { db, FieldValue } = getAdminServices();
          await db.collection('users').doc(user.uid).collection('reviseurSessions').add({
            subject: body.subject,
            subjectLabel,
            chapter: chapterTitle,
            mode: 'quiz',
            session: { chapterTitle, quiz: quizData.quiz },
            createdAt: FieldValue.serverTimestamp()
          });
        } catch (e) {}
      }

      return response.status(200).json({ success: true, quiz: quizData.quiz || [], source, seed });
    }

    // ═══ ACTION : EXERCISES ═══
    if (action === 'exercises') {
      return response.status(200).json({ success: true, exercises: [], source: 'unavailable' });
    }

    return jsonError(response, 400, 'Action inconnue.');

  } catch (error) {
    console.error(`Action "${action}" échouée:`, error.message);
    if (reservation?.reserved && action === 'generate') {
      try { await releaseFreeGeneration(user.uid, reservation.usageDate); } catch (_) {}
    }
    return jsonError(response, 503, 'Service temporairement indisponible.');
  }
};
