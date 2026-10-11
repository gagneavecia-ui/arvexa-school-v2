// ================================================================
// API RÉVISEUR v4.0 — ARVEXA School
// Fan-out parallèle + cascade multi-modèles gratuits
// 6 profils : scientifique / svt / philosophie / histoire-geo /
//             francais / langue
// Cache admin conservé (pending / approved)
// Post-traitement réparateur par profil
// ================================================================

const fs = require('fs');
const path = require('path');

module.exports.config = { maxDuration: 90 };

const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 30;
const requestLog = new Map();

const FREE_REVISEUR_LIMIT = 2;

const ALLOWED_SUBJECTS = new Set(['mathematiques', 'physique', 'chimie', 'svt', 'philosophie', 'histoire', 'geographie']);
const ALLOWED_MODES = new Set(['fiche', 'flashcard']);
const ALLOWED_ACTIONS = new Set(['generate', 'quiz', 'exercises', 'approveCache', 'listPendingCaches']);

const MAX_TOKENS = {
  FICHE: 8000,
  FLASHCARDS: 4000,
  QUIZ: 4000,
  EXERCISES: 8000
};

const NOTION_BATCH_SIZE = 4;
const MAX_BATCHES = 8;
const KNOWLEDGE_CACHE_COLLECTION = 'knowledgeCache';

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

  // ⚡ Plusieurs chemins possibles selon l'environnement (Vercel, local, etc.)
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
        console.log(`[REVISEUR] ✅ Base chargée : ${filename} (depuis ${filePath})`);
        KNOWLEDGE_MEMORY_CACHE.set(subject, data);
        return data;
      }
    } catch (error) {
      console.warn(`[REVISEUR] Erreur lecture ${filePath}:`, error.message);
    }
  }

  console.log(`[REVISEUR] Base absente : ${filename} (essayé ${candidates.length} chemins)`);
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

function rateLimited(ip) {
  const now = Date.now();
  const recent = (requestLog.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  requestLog.set(ip, recent);
  return recent.length > MAX_REQUESTS_PER_WINDOW;
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

async function isAdmin(uid) {
  try {
    const { db } = getAdminServices();
    const snap = await db.collection('users').doc(uid).get();
    if (!snap.exists) return false;
    const data = snap.data();
    return data.role === 'admin' || data.email === 'gagneavecia@gmail.com';
  } catch (_) { return false; }
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
// PROVIDERS — Cascade 100% gratuite (Groq + OpenRouter :free)
// ════════════════════════════════════════════════════════════════
function getProviders() {
  const providers = [];

  // ⚡ GROQ — 4 modèles en cascade
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
        name: 'Groq/llama-3.3-70b',
        key: process.env.GROQ_API_KEY,
        endpoint: 'https://api.groq.com/openai/v1/chat/completions',
        model: 'llama-3.3-70b-versatile',
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
      },
      {
        name: 'Groq/llama-3.1-8b',
        key: process.env.GROQ_API_KEY,
        endpoint: 'https://api.groq.com/openai/v1/chat/completions',
        model: 'llama-3.1-8b-instant',
        jsonMode: true,
        headers: {}
      }
    );
  }

  // ⚡ OPENROUTER — 3 modèles :free en cascade
  if (process.env.OPENROUTER_API_KEY) {
    const orHeaders = {
      'HTTP-Referer': process.env.APP_ORIGIN || '',
      'X-Title': 'ARVEXA Reviseur'
    };
    providers.push(
      {
        name: 'OpenRouter/inkling:free',
        key: process.env.OPENROUTER_API_KEY,
        endpoint: 'https://openrouter.ai/api/v1/chat/completions',
        model: 'thinkingmachines/inkling:free',
        jsonMode: true,
        headers: orHeaders
      },
      {
        name: 'OpenRouter/dots3:free',
        key: process.env.OPENROUTER_API_KEY,
        endpoint: 'https://openrouter.ai/api/v1/chat/completions',
        model: 'dots-studio/dots3-note-preview:free',
        jsonMode: true,
        headers: orHeaders
      },
      {
        name: 'OpenRouter/inkling-small:free',
        key: process.env.OPENROUTER_API_KEY,
        endpoint: 'https://openrouter.ai/api/v1/chat/completions',
        model: 'thinkingmachines/inkling-small:free',
        jsonMode: true,
        headers: orHeaders
      }
    );
  }

  return providers;
}

async function callProvider(provider, prompt, maxTokens = 4000, temperature = 0.15) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
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

// ════════════════════════════════════════════════════════════════
// GÉNÉRATION AVEC CASCADE (remplace l'ancien fallback)
// ════════════════════════════════════════════════════════════════
async function generateWithCascade(prompt, validator, maxTokens = 4000, temperature = 0.15, taskName = 'task') {
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
      console.warn(`[AI] ❌ ${taskName} → ${provider.name}: structure invalide`);
    } catch (error) {
      errors.push(`${provider.name}: ${error.message}`);
      console.warn(`[AI] ❌ ${taskName} → ${provider.name}: ${error.message}`);
    }
  }
  throw new Error('all_providers_failed: ' + errors.join(' | '));
}

// ════════════════════════════════════════════════════════════════
// CACHE PERMANENT (fiche + flashcards)
// ════════════════════════════════════════════════════════════════
function buildCacheKey(subject, chapter, mode) {
  return `${subject}_${cleanId(chapter)}_${mode}`;
}

async function getApprovedCache(subject, chapter, mode) {
  try {
    const { db } = getAdminServices();
    const key = buildCacheKey(subject, chapter, mode);
    const ref = db.collection(KNOWLEDGE_CACHE_COLLECTION).doc(key);
    const snap = await ref.get();
    if (!snap.exists) return null;
    const data = snap.data();
    if (data.status !== 'approved' || !data.content) return null;
    ref.update({ usedCount: (data.usedCount || 0) + 1 }).catch(() => {});
    return data.content;
  } catch (error) {
    console.warn('[CACHE] Lecture échouée:', error.message);
    return null;
  }
}

async function saveCacheAsPending(subject, chapter, mode, content, uid) {
  try {
    const { db, FieldValue } = getAdminServices();
    const key = buildCacheKey(subject, chapter, mode);
    const ref = db.collection(KNOWLEDGE_CACHE_COLLECTION).doc(key);
    const snap = await ref.get();
    if (snap.exists && snap.data().status === 'approved') return;

    await ref.set({
      subject, chapter, mode,
      content,
      status: 'pending',
      generatedBy: uid,
      generatedAt: FieldValue.serverTimestamp(),
      usedCount: 0
    }, { merge: true });
    console.log(`[CACHE] Contenu enregistré en attente: ${key}`);
  } catch (error) {
    console.warn('[CACHE] Écriture échouée:', error.message);
  }
}

async function approveCache(cacheKey) {
  const { db, FieldValue } = getAdminServices();
  await db.collection(KNOWLEDGE_CACHE_COLLECTION).doc(cacheKey).update({
    status: 'approved',
    approvedAt: FieldValue.serverTimestamp()
  });
}

// ════════════════════════════════════════════════════════════════
// POST-TRAITEMENT RÉPARATEUR (par profil)
// ════════════════════════════════════════════════════════════════
function wrapOrphanLatex(text) {
  if (!text || typeof text !== 'string') return text;
  if (text.includes('$')) return text;
  let r = text;
  r = r.replace(/(\\[a-zA-Z]+(?:\{[^}]*\}){1,2})/g, ' $$$1$$ ');
  r = r.replace(/(\\[a-zA-Z]+)(?![a-zA-Z{]|\$)/g, ' $$$1$$ ');
  r = r.replace(/([_^]\{[^}]*\})/g, ' $$$1$$ ');
  r = r.replace(/\${3,}/g, '$$').replace(/\$\s*\$/g, '').replace(/\s+/g, ' ').trim();
  return r;
}

function deepClean(obj) {
  if (typeof obj === 'string') return wrapOrphanLatex(obj);
  if (Array.isArray(obj)) return obj.map(deepClean);
  if (obj && typeof obj === 'object') {
    const cleaned = {};
    for (const k in obj) cleaned[k] = deepClean(obj[k]);
    return cleaned;
  }
  return obj;
}

// Réparation générique (champs communs à tous les profils)
function repairCommon(data) {
  if (!data || typeof data !== 'object') return data;
  if (data.sectionTitle) data.sectionTitle = String(data.sectionTitle).slice(0, 80);
  if (Array.isArray(data.keyIdeas)) {
    data.keyIdeas = data.keyIdeas
      .filter((x) => x !== null && x !== undefined)
      .map((x) => typeof x === 'string' ? x : (x.text || x.idea || String(x)))
      .slice(0, 8);
  }
  return data;
}

// Réparation pour profil scientifique
function repairScientific(data) {
  data = repairCommon(data);
  if (Array.isArray(data.formulas)) {
    data.formulas = data.formulas
      .filter((f) => f && typeof f === 'object')
      .map((f) => ({
        latex: f.latex || f.formule || f.expression || '',
        description: f.description || '',
        condition: f.condition || '',
        usage: f.usage || '',
        variables: Array.isArray(f.variables)
          ? f.variables.map((v) => ({
              symbol: v.symbol || v.symbole || '',
              meaning: v.meaning || v.signification || '',
              unit: v.unit || v.unite || ''
            }))
          : []
      }))
      .slice(0, 10);
  }
  if (data.method && Array.isArray(data.method.steps)) {
    data.method.steps = data.method.steps
      .map((s) => typeof s === 'string' ? s : (s.text || s.step || String(s)))
      .slice(0, 8);
  }
  if (Array.isArray(data.examples)) {
    data.examples = data.examples
      .filter((e) => e && typeof e === 'object')
      .map((e) => ({
        enonce: e.enonce || e.statement || '',
        steps: Array.isArray(e.steps) ? e.steps.map((s) => typeof s === 'string' ? s : String(s)).slice(0, 6) : [],
        result: e.result || e.resultat || ''
      }))
      .slice(0, 6);
  }
  if (Array.isArray(data.traps)) {
    data.traps = data.traps
      .filter((t) => t && typeof t === 'object')
      .map((t) => ({ trap: t.trap || t.piege || '', solution: t.solution || '' }))
      .slice(0, 5);
  }
  return data;
}

// Réparation pour profil SVT
function repairSvt(data) {
  data = repairCommon(data);
  if (Array.isArray(data.mechanisms)) {
    data.mechanisms = data.mechanisms
      .filter((m) => m && typeof m === 'object')
      .map((m) => ({
        name: m.name || m.nom || '',
        steps: Array.isArray(m.steps) ? m.steps.map((s) => typeof s === 'string' ? s : String(s)).slice(0, 8) : [],
        relations: Array.isArray(m.relations) ? m.relations.slice(0, 6) : [],
        consequences: Array.isArray(m.consequences) ? m.consequences.slice(0, 6) : []
      }))
      .slice(0, 8);
  }
  if (Array.isArray(data.definitions)) {
    data.definitions = data.definitions
      .filter((d) => d && typeof d === 'object')
      .map((d) => ({
        term: d.term || d.terme || '',
        definition: d.definition || ''
      }))
      .slice(0, 12);
  }
  if (Array.isArray(data.classifications)) {
    data.classifications = data.classifications
      .filter((c) => c && typeof c === 'object')
      .map((c) => ({
        category: c.category || c.categorie || '',
        items: Array.isArray(c.items) ? c.items.slice(0, 10) : []
      }))
      .slice(0, 5);
  }
  return data;
}

// Réparation pour profil philosophie
function repairPhilosophy(data) {
  data = repairCommon(data);
  if (Array.isArray(data.parts)) {
    data.parts = data.parts
      .filter((p) => p && typeof p === 'object')
      .map((p) => ({
        partTitle: p.partTitle || p.title || '',
        mainIdea: p.mainIdea || p.idea || '',
        simpleExplanation: p.simpleExplanation || p.explanation || '',
        keyTerms: Array.isArray(p.keyTerms) ? p.keyTerms.slice(0, 8) : [],
        arguments: Array.isArray(p.arguments) ? p.arguments.slice(0, 8) : [],
        everydayExamples: Array.isArray(p.everydayExamples) ? p.everydayExamples.slice(0, 5) : [],
        toRemember: p.toRemember || p.memorize || ''
      }))
      .slice(0, 8);
  }
  if (Array.isArray(data.theses)) {
    data.theses = data.theses
      .filter((t) => t && typeof t === 'object')
      .map((t) => ({
        thesis: t.thesis || t.these || '',
        arguments: Array.isArray(t.arguments) ? t.arguments.slice(0, 6) : []
      }))
      .slice(0, 6);
  }
  if (Array.isArray(data.vocabulary)) {
    data.vocabulary = data.vocabulary
      .filter((v) => v && typeof v === 'object')
      .map((v) => ({ term: v.term || v.terme || '', meaning: v.meaning || v.signification || '' }))
      .slice(0, 15);
  }
  if (Array.isArray(data.plans)) {
    data.plans = data.plans
      .filter((p) => p && typeof p === 'object')
      .map((p) => ({
        title: p.title || p.titre || '',
        parties: Array.isArray(p.parties) ? p.parties.slice(0, 6) : []
      }))
      .slice(0, 4);
  }
  return data;
}

// Réparation pour profil histoire-géo
function repairHistory(data) {
  data = repairCommon(data);
  if (Array.isArray(data.timeline)) {
    data.timeline = data.timeline
      .filter((t) => t && typeof t === 'object')
      .map((t) => ({ date: t.date || '', event: t.event || t.evenement || '' }))
      .slice(0, 20);
  }
  if (Array.isArray(data.causesConsequences)) {
    data.causesConsequences = data.causesConsequences
      .filter((c) => c && typeof c === 'object')
      .map((c) => ({ cause: c.cause || '', consequence: c.consequence || c.consequence || '' }))
      .slice(0, 10);
  }
  if (Array.isArray(data.keyFigures)) {
    data.keyFigures = data.keyFigures
      .filter((f) => f && typeof f === 'object')
      .map((f) => ({ name: f.name || f.nom || '', role: f.role || '' }))
      .slice(0, 10);
  }
  if (Array.isArray(data.vocabulary)) {
    data.vocabulary = data.vocabulary
      .filter((v) => v && typeof v === 'object')
      .map((v) => ({ term: v.term || v.terme || '', meaning: v.meaning || v.signification || '' }))
      .slice(0, 15);
  }
  return data;
}

// Réparation pour profil français
function repairFrench(data) {
  data = repairCommon(data);
  if (Array.isArray(data.literaryDevices)) {
    data.literaryDevices = data.literaryDevices
      .filter((d) => d && typeof d === 'object')
      .map((d) => ({
        name: d.name || d.nom || '',
        definition: d.definition || '',
        example: d.example || d.exemple || ''
      }))
      .slice(0, 10);
  }
  if (Array.isArray(data.vocabulary)) {
    data.vocabulary = data.vocabulary
      .filter((v) => v && typeof v === 'object')
      .map((v) => ({ term: v.term || v.terme || '', meaning: v.meaning || v.signification || '' }))
      .slice(0, 15);
  }
  if (Array.isArray(data.texts)) {
    data.texts = data.texts
      .filter((t) => t && typeof t === 'object')
      .map((t) => ({
        title: t.title || t.titre || '',
        author: t.author || t.auteur || '',
        analysis: t.analysis || t.analyse || ''
      }))
      .slice(0, 6);
  }
  return data;
}

// Réparation pour profil langue
function repairLanguage(data) {
  data = repairCommon(data);
  if (Array.isArray(data.vocabulary)) {
    data.vocabulary = data.vocabulary
      .filter((v) => v && typeof v === 'object')
      .map((v) => ({
        english: v.english || v.en || v.word || '',
        french: v.french || v.fr || v.traduction || '',
        phonetic: v.phonetic || v.phonetique || ''
      }))
      .slice(0, 25);
  }
  if (Array.isArray(data.grammar)) {
    data.grammar = data.grammar
      .filter((g) => g && typeof g === 'object')
      .map((g) => ({
        rule: g.rule || g.regle || '',
        explanation_fr: g.explanation_fr || g.explanation || '',
        examples: Array.isArray(g.examples)
          ? g.examples.map((ex) => ({
              english: ex.english || ex.en || '',
              french: ex.french || ex.fr || ''
            })).slice(0, 6)
          : []
      }))
      .slice(0, 10);
  }
  if (Array.isArray(data.phrases)) {
    data.phrases = data.phrases
      .filter((p) => p && typeof p === 'object')
      .map((p) => ({ english: p.english || p.en || '', french: p.french || p.fr || '' }))
      .slice(0, 15);
  }
  return data;
}

function repairByProfile(data, profile) {
  if (!data || typeof data !== 'object') return data;
  switch (profile) {
    case 'scientific': return repairScientific(data);
    case 'svt':        return repairSvt(data);
    case 'philosophy': return repairPhilosophy(data);
    case 'history':    return repairHistory(data);
    case 'french':     return repairFrench(data);
    case 'language':   return repairLanguage(data);
    default:           return repairCommon(data);
  }
}

// ════════════════════════════════════════════════════════════════
// RÈGLES LATEX
// ════════════════════════════════════════════════════════════════
const LATEX_RULES = `
RÈGLE LATEX — OBLIGATOIRE :
- Toute formule DOIT être entre $...$ (inline) ou $$...$$ (display).
- INTERDIT : LaTeX brut sans $.
- INTERDIT : symboles Unicode bruts (π, √, ², ≤, ≥, ∞, →, ×, ·, ≠, ∈, ∑, ∫, Δ).
`.trim();

// ════════════════════════════════════════════════════════════════
// PROMPTS
// ════════════════════════════════════════════════════════════════
function serializeNotion(notion, index) {
  const lines = [];
  lines.push(`─── NOTION ${index + 1} ───`);
  lines.push(`id: ${notion.id}`);
  lines.push(`titre: ${notion.titre}`);
  if (notion.description) lines.push(`description: ${notion.description}`);
  if (Array.isArray(notion.formules)) notion.formules.forEach((f) => lines.push(`  • Formule: ${f}`));
  if (Array.isArray(notion.proprietes)) notion.proprietes.forEach((p) => lines.push(`  • Propriété: ${p}`));
  if (Array.isArray(notion.methodes)) notion.methodes.forEach((m) => lines.push(`  • Méthode: ${m}`));
  if (Array.isArray(notion.erreurs_frequentes)) notion.erreurs_frequentes.forEach((e) => lines.push(`  • Erreur: ${e}`));
  if (Array.isArray(notion.pieges_examen)) notion.pieges_examen.forEach((p) => lines.push(`  • Piège: ${p}`));
  return lines.join('\n');
}

function buildFichePrompt(subjectLabel, chapterTitle, notions) {
  const notionsSerialized = notions.map((n, i) => serializeNotion(n, i)).join('\n\n');
  const N = notions.length;

  return `Tu es un professeur expert du BAC au Niger. Génère une FICHE DE RÉVISION ULTRA-DÉTAILLÉE.

Matière : ${subjectLabel}
Chapitre : ${chapterTitle}

NOTIONS À COUVRIR (${N} notions) :
${notionsSerialized}

${LATEX_RULES}

FORMAT JSON :
{
  "chapterTitle": "${chapterTitle}",
  "keyPoints": ["Point clé 1", "Point clé 2", "Point clé 3"],
  "sections": [
    {
      "notionId": "id-exact",
      "notionTitle": "Titre exact",
      "comprendre": "Intuition + définition formelle, 3-5 phrases.",
      "formules": [
        { "latex": "$z = a + bi$", "condition": "pour $a,b \\in \\mathbb{R}$", "usage": "Définition" }
      ],
      "methode": {
        "title": "Méthode d'application",
        "steps": ["Étape 1", "Étape 2", "Étape 3"]
      },
      "exempleResolu": {
        "enonce": "Énoncé complet",
        "etapes": ["Étape 1", "Étape 2", "Étape 3"],
        "conclusion": "Résultat final"
      },
      "piegeBAC": { "trap": "Erreur classique", "solution": "Comment l'éviter" },
      "astuce": "Mnémo court"
    }
  ],
  "examTraps": [{"trap": "Piège global", "solution": "Solution"}],
  "commonMistakes": ["Erreur 1", "Erreur 2"]
}

CONTRAINTES :
- EXACTEMENT ${N} sections
- Aucune section vide
- Réponds UNIQUEMENT avec le JSON`;
}

function buildFlashcardsPrompt(subjectLabel, chapterTitle, notions) {
  const notionsSerialized = notions.map((n, i) => serializeNotion(n, i)).join('\n\n');
  const N = notions.length;
  const total = N * 4;

  return `Tu es un professeur expert du BAC au Niger. Génère ${total} FLASHCARDS.

Matière : ${subjectLabel}
Chapitre : ${chapterTitle}

NOTIONS :
${notionsSerialized}

FORMAT JSON :
{
  "chapterTitle": "${chapterTitle}",
  "flashcards": [
    { "notionId": "id", "type": "definition", "question": "...", "answer": "...", "hint": null, "difficulty": 1 }
  ]
}

CONTRAINTES :
- EXACTEMENT ${total} flashcards (4 par notion)
- Types : "definition", "formule", "methode", "piege"
- Réponds UNIQUEMENT avec le JSON`;
}

function buildQuizPrompt(subjectLabel, chapterTitle, notions, level, questionCount, seed) {
  const notionsSerialized = notions.map((n, i) => serializeNotion(n, i)).join('\n\n');

  return `Tu es un professeur expert du BAC au Niger. Génère un QUIZ UNIQUE.

SEED : ${seed}

Matière : ${subjectLabel}
Chapitre : ${chapterTitle}
Difficulté : ${level}/4

NOTIONS :
${notionsSerialized}

${LATEX_RULES}

FORMAT JSON :
{
  "quiz": [
    {
      "notionId": "id",
      "level": 1,
      "question": "...",
      "options": [{"id":"A","text":"..."},{"id":"B","text":"..."},{"id":"C","text":"..."},{"id":"D","text":"..."}],
      "correctAnswer": "A",
      "explanation": "..."
    }
  ]
}

CONTRAINTES :
- EXACTEMENT ${questionCount} questions
- 4 options par question
- Réponds UNIQUEMENT avec le JSON`;
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
      ['A','B','C','D'].includes(q.correctAnswer));
}

// ════════════════════════════════════════════════════════════════
// FALLBACK LOCAL
// ════════════════════════════════════════════════════════════════
function buildFallbackFiche(chapterTitle, notions) {
  const sections = notions.map((n) => {
    const formules = (n.formules || []).map((f) => ({ latex: f, condition: '', usage: '' }));
    const methodeSteps = (n.methodes || []).length > 0 ? n.methodes : ['Lire attentivement', 'Appliquer la formule', 'Vérifier'];
    const piegeTrap = (n.pieges_examen && n.pieges_examen[0]) || (n.erreurs_frequentes && n.erreurs_frequentes[0]) || 'À identifier';

    return {
      notionId: n.id,
      notionTitle: n.titre,
      comprendre: n.description || `Notion essentielle du chapitre ${chapterTitle}.`,
      formules: formules.length > 0 ? formules : [{ latex: 'À compléter', condition: '', usage: '' }],
      methode: { title: 'Méthode', steps: methodeSteps },
      exempleResolu: {
        enonce: `Exemple sur « ${n.titre} »`,
        etapes: ['Identifier les données', 'Appliquer', 'Vérifier'],
        conclusion: 'Voir le cours'
      },
      piegeBAC: { trap: piegeTrap, solution: 'Relire la notion' },
      astuce: (n.proprietes && n.proprietes[0]) || 'Répète régulièrement.'
    };
  });

  return {
    chapterTitle,
    sections,
    keyPoints: notions.slice(0, 5).map((n) => n.titre),
    examTraps: [],
    commonMistakes: []
  };
}

function buildFallbackFlashcards(chapterTitle, notions) {
  const cards = [];
  notions.forEach((n) => {
    cards.push({ notionId: n.id, type: 'definition', question: `C'est quoi « ${n.titre} » ?`, answer: n.description || 'Voir cours.', hint: null, difficulty: 1 });
    cards.push({ notionId: n.id, type: 'formule', question: `Formule de « ${n.titre} » ?`, answer: (n.formules && n.formules[0]) || 'Voir cours.', hint: null, difficulty: 1 });
    cards.push({ notionId: n.id, type: 'methode', question: `Comment appliquer « ${n.titre} » ?`, answer: (n.methodes && n.methodes[0]) || 'Voir méthode.', hint: null, difficulty: 2 });
    cards.push({ notionId: n.id, type: 'piege', question: `Piège de « ${n.titre} » ?`, answer: (n.pieges_examen && n.pieges_examen[0]) || 'Voir cours.', hint: null, difficulty: 2 });
  });
  return { chapterTitle, flashcards: cards };
}

function buildFallbackQuiz(chapterTitle, notions, count) {
  const quiz = [];
  const pool = notions.length > 0 ? notions : [{ id: 'default', titre: chapterTitle, description: 'Notion du chapitre' }];
  for (let i = 0; i < count; i++) {
    const n = pool[i % pool.length];
    quiz.push({
      notionId: n.id,
      level: 1,
      question: `Question de révision sur « ${n.titre} » (${i + 1})`,
      options: [
        { id: 'A', text: 'Réponse A' },
        { id: 'B', text: 'Réponse B' },
        { id: 'C', text: 'Réponse C' },
        { id: 'D', text: 'Réponse D' }
      ],
      correctAnswer: 'A',
      explanation: 'Quiz de secours.'
    });
  }
  return { chapterTitle, quiz };
}

// ════════════════════════════════════════════════════════════════
// GÉNÉRATION PAR LOTS (fan-out parallèle)
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
      // ⚡ Réparer chaque section individuellement
      const repaired = r.value.data.sections.map((s) => repairByProfile(s, 'scientific'));
      allSections.push(...repaired);
    } else {
      missingBatches.push(batches[i]);
    }
  });

  missingBatches.forEach((batch) => {
    const fb = buildFallbackFiche(chapterTitle, batch);
    allSections.push(...fb.sections);
  });

  const firstValid = results.find((r) => r.status === 'fulfilled' && r.value?.data);
  const extra = firstValid?.value?.data || {};

  return {
    chapterTitle,
    sections: allSections,
    keyPoints: extra.keyPoints || notions.slice(0, 5).map((n) => n.titre),
    examTraps: extra.examTraps || [],
    commonMistakes: extra.commonMistakes || []
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
  const missingBatches = [];

  results.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value?.data?.flashcards) {
      allCards.push(...r.value.data.flashcards);
    } else {
      missingBatches.push(batches[i]);
    }
  });

  missingBatches.forEach((batch) => {
    const fb = buildFallbackFlashcards(chapterTitle, batch);
    allCards.push(...fb.flashcards);
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

  if (allQuestions.length === 0) {
    console.warn('[REVISEUR] Quiz IA vide → fallback');
    return buildFallbackQuiz(chapterTitle, notions, totalCount);
  }

  return { chapterTitle, quiz: allQuestions.slice(0, totalCount) };
}

// ════════════════════════════════════════════════════════════════
// HANDLER
// ════════════════════════════════════════════════════════════════
module.exports = async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return jsonError(response, 405, 'Méthode non autorisée.');
  }
  if (rateLimited(clientIp(request))) return jsonError(response, 429, 'Trop de demandes.');

  let user;
  try { user = await verifyFirebaseToken(request); }
  catch (e) { return jsonError(response, 503, 'Service indisponible.'); }
  if (!user) return jsonError(response, 401, 'Connexion requise.', 'AUTH_REQUIRED');

  const body = request.body && typeof request.body === 'object' ? request.body : {};
  const action = body.action || 'generate';

  if (!ALLOWED_ACTIONS.has(action)) return jsonError(response, 400, 'Action invalide.');
  if (!ALLOWED_SUBJECTS.has(body.subject)) return jsonError(response, 400, 'Matière invalide.');
  if (typeof body.chapter !== 'string' || body.chapter.length > 100) return jsonError(response, 400, 'Chapitre invalide.');

  // ── Admin : approuver un cache ──
  if (action === 'approveCache') {
    const admin = await isAdmin(user.uid);
    if (!admin) return jsonError(response, 403, 'Réservé aux admins.', 'ADMIN_REQUIRED');
    if (!body.cacheKey) return jsonError(response, 400, 'cacheKey requis.');
    try {
      await approveCache(body.cacheKey);
      return response.status(200).json({ success: true });
    } catch (e) {
      return jsonError(response, 500, e.message);
    }
  }

  // ── Admin : lister les caches en attente ──
  if (action === 'listPendingCaches') {
    const admin = await isAdmin(user.uid);
    if (!admin) return jsonError(response, 403, 'Réservé aux admins.', 'ADMIN_REQUIRED');
    try {
      const { db } = getAdminServices();
      const snap = await db.collection(KNOWLEDGE_CACHE_COLLECTION).where('status', '==', 'pending').get();
      const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      return response.status(200).json({ success: true, items });
    } catch (e) {
      return jsonError(response, 500, e.message);
    }
  }

  // ── Chargement base ──
  const knowledgeBase = loadKnowledgeBase(body.subject);
  const chapterData = knowledgeBase ? findChapter(knowledgeBase, body.chapter) : null;
  const mandatoryNotions = chapterData ? getMandatoryNotions(chapterData) : [];
  const hasKnowledge = mandatoryNotions.length > 0;

 const subjectLabel = knowledgeBase?.matiereLabel ||
  {
    mathematiques: 'Mathématiques',
    physique: 'Physique',
    chimie: 'Chimie',
    svt: 'SVT',
    philosophie: 'Philosophie',
    histoire: 'Histoire',
    geographie: 'Géographie'
  }[body.subject] ||
  body.subject;
  const chapterTitle = chapterData?.titre || body.chapter;

  console.log(`[REVISEUR v4] ${action} | ${body.subject} > ${body.chapter} | ${mandatoryNotions.length} notions`);

  // ── Réservation quota ──
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
    // ═══════════════════════════════════════════════════════
    // ACTION : GENERATE (fiche / flashcards) — CACHÉ
    // ═══════════════════════════════════════════════════════
    if (action === 'generate') {
      if (!ALLOWED_MODES.has(body.mode)) {
        if (reservation?.reserved) { try { await releaseFreeGeneration(user.uid, reservation.usageDate); } catch (_) {} }
        return jsonError(response, 400, 'Mode invalide.');
      }

      const isFlashcard = body.mode === 'flashcard';

      // 1. Cache approuvé ?
      const cached = await getApprovedCache(body.subject, body.chapter, body.mode);
      if (cached) {
        console.log('[REVISEUR] ✅ Cache approuvé servi');
        if (reservation?.reserved && !reservation?.premium) {
          try { await releaseFreeGeneration(user.uid, reservation.usageDate); } catch (_) {}
        }
        return response.status(200).json({
          success: true,
          session: { ...cached, subject: body.subject, chapter: body.chapter, mode: body.mode },
          source: 'cache',
          quota: reservation?.premium
            ? { type: 'premium', unlimited: true }
            : { type: 'free', used: reservation?.used, limit: FREE_REVISEUR_LIMIT }
        });
      }

      // 2. Génération IA
      let session;
      let source = 'ai';

      try {
        if (hasKnowledge) {
          session = isFlashcard
            ? await generateFlashcardsByBatches(subjectLabel, chapterTitle, mandatoryNotions)
            : await generateFicheByBatches(subjectLabel, chapterTitle, mandatoryNotions);
        } else {
          session = isFlashcard
            ? buildFallbackFlashcards(chapterTitle, [])
            : buildFallbackFiche(chapterTitle, []);
          source = 'fallback';
        }
      } catch (aiError) {
        console.warn('[REVISEUR] IA échouée:', aiError.message);
        session = isFlashcard
          ? buildFallbackFlashcards(chapterTitle, mandatoryNotions)
          : buildFallbackFiche(chapterTitle, mandatoryNotions);
        source = 'fallback';
      }

      // ⚡ Post-traitement final (wrap LaTeX)
      session = deepClean(session);

      // 3. Sauvegarde en pending
      if (hasKnowledge && source === 'ai') {
        saveCacheAsPending(body.subject, body.chapter, body.mode, session, user.uid).catch(() => {});
      }

      return response.status(200).json({
        success: true,
        session: {
          ...session,
          subject: body.subject,
          chapter: body.chapter,
          mode: body.mode,
          generationMode: source,
          notionsCovered: hasKnowledge ? mandatoryNotions.length : 0,
          generatedAt: new Date().toISOString()
        },
        source,
        quota: reservation?.premium
          ? { type: 'premium', unlimited: true }
          : { type: 'free', used: reservation?.used, limit: FREE_REVISEUR_LIMIT }
      });
    }

    // ═══════════════════════════════════════════════════════
    // ACTION : QUIZ — PAS DE CACHE
    // ═══════════════════════════════════════════════════════
    if (action === 'quiz') {
      const count = Math.min(20, Math.max(5, Number(body.count) || 5));
      const level = Number(body.difficulty) || 2;
      const seed = hashString(Date.now() + '_' + user.uid + '_' + Math.random());

      console.log(`[REVISEUR] Quiz — seed: ${seed}`);

      let quizData;
      let source = 'ai';

      try {
        if (hasKnowledge) {
          quizData = await generateQuizByBatches(subjectLabel, chapterTitle, mandatoryNotions, level, count, seed);
        } else {
          quizData = buildFallbackQuiz(chapterTitle, [], count);
          source = 'fallback';
        }
      } catch (e) {
        console.warn('[REVISEUR] Quiz IA échoué:', e.message);
        quizData = buildFallbackQuiz(chapterTitle, mandatoryNotions, count);
        source = 'fallback';
      }

      quizData = deepClean(quizData);

      return response.status(200).json({
        success: true,
        quiz: quizData.quiz || [],
        source,
        seed
      });
    }

    // ═══════════════════════════════════════════════════════
    // ACTION : EXERCISES — PAS DE CACHE
    // ═══════════════════════════════════════════════════════
    if (action === 'exercises') {
      const seed = hashString(Date.now() + '_' + user.uid);

      let exercisesData = { chapterTitle, exercises: [] };
      let source = 'ai';

      try {
        if (hasKnowledge) {
          const prompt = `Génère 4 exercices progressifs par notion.\nSeed: ${seed}\n\n${mandatoryNotions.map((n, i) => serializeNotion(n, i)).join('\n\n')}\n\nFormat JSON: {"exercises":[{"notionId":"...","level":1,"enonce":"...","indice":"...","correction":{"etapes":["..."],"reponse":"..."}}]}`;
          const { data } = await generateWithCascade(prompt, (d) => d && Array.isArray(d.exercises), MAX_TOKENS.EXERCISES, 0.6, 'exercises');
          exercisesData = { chapterTitle, exercises: data.exercises || [] };
        } else {
          source = 'fallback';
        }
      } catch (e) {
        console.warn('[REVISEUR] Exercices IA échoué:', e.message);
        source = 'fallback';
      }

      return response.status(200).json({ success: true, exercises: exercisesData.exercises || [], source, seed });
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
