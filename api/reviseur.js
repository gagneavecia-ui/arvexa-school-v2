// ================================================================
// API RÉVISEUR v7.0 — ARVEXA School
// Refonte : génération progressive + cahier persistant + lecture gratuite
// Providers : OpenRouter (principal) + Groq (fallback)
// ================================================================

const fs = require('fs');
const path = require('path');

module.exports.config = { maxDuration: 60 };

// ────────────────────────────────────────────────────────────────
// CONFIG
// ────────────────────────────────────────────────────────────────
const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW_LIGHT = 60;
const MAX_REQUESTS_PER_WINDOW_HEAVY = 20;
const requestLog = new Map();

const FREE_REVISEUR_LIMIT = 3;  // 3 générations gratuites par jour

const ALLOWED_SUBJECTS = new Set(['mathematiques', 'physique', 'chimie', 'svt', 'philosophie', 'histoire', 'geographie']);
const ALLOWED_MODES = new Set(['fiche', 'flashcard']);

// ✅ Nouvelles actions
const ALLOWED_ACTIONS = new Set([
  'loadCahier',       // 📖 Lecture gratuite
  'generateInitial',  // ⚡ Première génération
  'generateMore',     // ⚡ Nouvelles notions
  'loadNotion',       // 👁️ Voir une notion
  'deleteNotion',     // 🗑️ Supprimer une notion
  'quiz',             // 🎯 Générer un quiz
  'deleteCahier'      // 🗑️ Effacer le cahier
]);

const LIGHT_ACTIONS = new Set(['loadCahier', 'loadNotion', 'deleteNotion', 'deleteCahier']);
const PREMIUM_ACTIONS = new Set([]); // pour l'instant, tout est gratuit

// ✅ Nouvelles constantes de génération
const INITIAL_NOTIONS_COUNT = 4;   // Première génération : 4 notions
const MORE_NOTIONS_COUNT = 3;      // Générations suivantes : 3 notions
const MAX_TOKENS_PER_CALL = 6000;  // ~5000 tokens effectifs
const MAX_TOTAL_NOTIONS = 20;      // Limite maximale par chapitre

const KB_CACHE_TTL_MS = 10 * 60 * 1000;
const CAHIER_COLLECTION = 'reviseurCahier';

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

// ✅ Nettoyage LaTeX (identique à v6.0)
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
// FOURNISSEURS IA
// ════════════════════════════════════════════════════════════════
// 1. OpenRouter gpt-oss-120b (payant mais très bon — fallback si Groq sature)
// 2. Groq gpt-oss-120b (rapide)
// 3. Groq gpt-oss-20b (ultra-rapide, plus léger)
function getProviders() {
  const providers = [];

  // 🥇 OpenRouter (priorité pour la qualité)
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

  // 🥈🥉 Groq
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
// PROMPTS — Version allégée pour génération progressive
// ════════════════════════════════════════════════════════════════
const LATEX_RULES = `
RÈGLES LATEX :
- Toute formule entre $...$ (inline) ou $$...$$ (display).
- INTERDIT : LaTeX brut sans $, symboles Unicode (π → $\\pi$, √ → $\\sqrt{}$, × → $\\times$, ≤ → $\\leq$, ² → $^2$).
`;

const PEDAGOGY_RULES = `
MISSION : Tu prépares un élève de Terminale D au Niger au BAC.
Contenu clair, précis, mémorisable.
`;

// ✅ Nouveau prompt : génération de N notions précises
function buildNotionsPrompt(subjectLabel, chapterTitle, notionsToGenerate) {
  const notionsList = notionsToGenerate.map((n, i) =>
    `  ${i + 1}. [id: ${n.id}] ${n.titre}${n.description_courte ? ` — ${n.description_courte}` : ''}`
  ).join('\n');

  return `Tu es professeur expert du BAC en Terminale D (${subjectLabel}).

${PEDAGOGY_RULES}

Chapitre : "${chapterTitle}"

MISSION : Génère une fiche de révision pour CHACUNE des ${notionsToGenerate.length} notions suivantes :

${notionsList}

Pour CHAQUE notion, fournis :
1. comprendre (4-6 phrases)
2. formules (2-4 formules avec condition)
3. methode (3-6 étapes)
4. exempleResolu (chiffré, complet)
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
      "formules": [{"latex": "$...$", "condition": "..."}],
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

// ✅ Prompt pour le quiz
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
function validateNotionsResponse(data) {
  return data && Array.isArray(data.notions) && data.notions.length >= 1 &&
    data.notions.every((n) => n && n.notionId && n.notionTitle && typeof n.comprendre === 'string');
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

// ════════════════════════════════════════════════════════════════
// ACTIONS
// ════════════════════════════════════════════════════════════════

// 📖 Charger le cahier (GRATUIT)
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
    totalAvailable,
    generatedCount: cahier?.notions?.length || 0,
    notions: cahier?.notions || [],
    generatedIds: cahier?.generatedIds || []
  };
}

// 👁️ Voir une notion (GRATUIT)
async function actionLoadNotion(uid, body) {
  const { subject, chapter, notionId } = body;
  if (!subject || !chapter || !notionId) throw { status: 400, message: 'Paramètres manquants.' };

  const cahier = await loadCahierFromDB(uid, subject, chapter);
  if (!cahier) throw { status: 404, message: 'Cahier introuvable.' };

  const notion = cahier.notions?.find((n) => n.notionId === notionId);
  if (!notion) throw { status: 404, message: 'Notion introuvable.' };

  return { success: true, notion };
}

// ⚡ Première génération (4 notions)
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

  // Charge le cahier existant
  let cahier = await loadCahierFromDB(uid, subject, chapter);
  if (!cahier) {
    cahier = { notions: [], generatedIds: [] };
  }

  // Sélectionne les N premières notions non générées
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
  console.log(`[REVISEUR v7.0] generateInitial | ${subject} > ${chapter} | ${notionsToGenerate.length}/${remainingNotions.length} notions`);

  const prompt = buildNotionsPrompt(subjectLabel, chapterTitle, notionsToGenerate);

  let generatedData;
  let source = 'ai';
  try {
    const result = await generateWithCascade(prompt, validateNotionsResponse, MAX_TOKENS_PER_CALL, 0.3, 'initial');
    generatedData = result.data;
  } catch (err) {
    console.error('[REVISEUR] IA échouée:', err.message);
    throw { status: 503, message: 'Service IA temporairement indisponible. Réessaie dans une minute.' };
  }

  generatedData = deepClean(generatedData);

  // Sauvegarde
  const newNotions = generatedData.notions.map((n) => ({
    notionId: n.notionId,
    notionTitle: n.notionTitle,
    comprendre: n.comprendre || '',
    formules: n.formules || [],
    methode: n.methode || {},
    exempleResolu: n.exempleResolu || {},
    piegeBAC: n.piegeBAC || {},
    astuce: n.astuce || '',
    generatedAt: new Date().toISOString()
  }));

  cahier.notions.push(...newNotions);
  cahier.generatedIds.push(...notionsToGenerate.map((n) => n.id));

  await saveCahierToDB(uid, subject, chapter, cahier);

  return {
    success: true,
    notions: newNotions,
    generatedCount: cahier.notions.length,
    totalAvailable: allNotions.length,
    source,
    message: `${newNotions.length} notions générées.`
  };
}

// ⚡ Nouvelles notions (3 par appel)
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

  // Sélectionne aléatoirement 3 notions restantes
  const shuffled = shuffle(remainingNotions);
  const notionsToGenerate = shuffled.slice(0, Math.min(MORE_NOTIONS_COUNT, shuffled.length));
  console.log(`[REVISEUR v7.0] generateMore | ${subject} > ${chapter} | ${notionsToGenerate.length}/${remainingNotions.length} notions`);

  const prompt = buildNotionsPrompt(subjectLabel, chapterTitle, notionsToGenerate);

  let generatedData;
  try {
    const result = await generateWithCascade(prompt, validateNotionsResponse, MAX_TOKENS_PER_CALL, 0.4, 'more');
    generatedData = result.data;
  } catch (err) {
    console.error('[REVISEUR] IA échouée:', err.message);
    throw { status: 503, message: 'Service IA temporairement indisponible. Réessaie dans une minute.' };
  }

  generatedData = deepClean(generatedData);

  const newNotions = generatedData.notions.map((n) => ({
    notionId: n.notionId,
    notionTitle: n.notionTitle,
    comprendre: n.comprendre || '',
    formules: n.formules || [],
    methode: n.methode || {},
    exempleResolu: n.exempleResolu || {},
    piegeBAC: n.piegeBAC || {},
    astuce: n.astuce || '',
    generatedAt: new Date().toISOString()
  }));

  cahier.notions.push(...newNotions);
  cahier.generatedIds.push(...notionsToGenerate.map((n) => n.id));

  await saveCahierToDB(uid, subject, chapter, cahier);

  return {
    success: true,
    notions: newNotions,
    generatedCount: cahier.notions.length,
    totalAvailable: allNotions.length,
    source: 'ai',
    message: `${newNotions.length} nouvelles notions générées.`
  };
}

// 🗑️ Supprimer une notion
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

// 🎯 Générer un quiz
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

  const prompt = buildQuizPrompt(subjectLabel, chapterTitle, notions, count);

  let quizData;
  try {
    const result = await generateWithCascade(prompt, validateQuiz, 4000, 0.6, 'quiz');
    quizData = result.data;
  } catch (err) {
    console.error('[REVISEUR] Quiz échoué:', err.message);
    throw { status: 503, message: 'Quiz temporairement indisponible.' };
  }

  quizData = deepClean(quizData);
  const validQuiz = (quizData.quiz || []).filter((q) => q && q.question && Array.isArray(q.options) && q.options.length === 4);

  return {
    success: true,
    quiz: validQuiz,
    source: 'ai'
  };
}

// 🗑️ Effacer tout le cahier
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
      case 'loadCahier':     return response.status(200).json(await actionLoadCahier(user.uid, body));
      case 'loadNotion':     return response.status(200).json(await actionLoadNotion(user.uid, body));
      case 'generateInitial': return response.status(200).json(await actionGenerateInitial(user.uid, body));
      case 'generateMore':   return response.status(200).json(await actionGenerateMore(user.uid, body));
      case 'deleteNotion':   return response.status(200).json(await actionDeleteNotion(user.uid, body));
      case 'deleteCahier':   return response.status(200).json(await actionDeleteCahier(user.uid, body));
      case 'quiz':           return response.status(200).json(await actionQuiz(user.uid, body));
      default:               return jsonError(response, 400, `Action inconnue : "${action}"`);
    }
  } catch (error) {
    console.error(`[REVISEUR v7.0] "${action}" échouée:`, error.message);
    if (error.status) return jsonError(response, error.status, error.message, error.code);
    return jsonError(response, 500, error.message || 'Erreur serveur.');
  }
};
