// ================================================================
// API EXAM v5.1 — ARVEXA School
// Mode examen 100% IA + Pool Firestore + Correction pédagogique
// Historique Premium · Rate limit adaptatif
// ================================================================

module.exports.config = { maxDuration: 90 };

const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW_LIGHT = 60;   // Actions légères (listExams, loadExam, deleteExam)
const MAX_REQUESTS_PER_WINDOW_HEAVY = 3;    // Actions lourdes (generate, correct)
const requestLog = new Map();

const ALLOWED_SUBJECTS = new Set(['mathematiques', 'physique', 'chimie', 'svt', 'philosophie', 'histoire', 'geographie']);
const ALLOWED_DIFFICULTIES = new Set(['easy', 'medium', 'hard', 'bac']);
const ALLOWED_DURATIONS = new Set([30, 60, 90, 120, 180]);
const ALLOWED_ACTIONS = new Set(['generate', 'correct', 'listExams', 'loadExam', 'deleteExam']);
const LIGHT_ACTIONS = new Set(['listExams', 'loadExam', 'deleteExam']);
const PREMIUM_ACTIONS = new Set(['listExams', 'loadExam']);  // 🔒 Premium requis
const REQUIRED_EXERCISES = 3;
const QUESTIONS_PER_EXERCISE = 5;
const TOTAL_POINTS = 20;
const FREE_EXAM_LIMIT = 2;
const POOL_COLLECTION = 'examPool';

const SUBJECT_LABELS = {
  mathematiques: 'Mathématiques',
  physique: 'Physique',
  chimie: 'Chimie',
  svt: 'SVT',
  philosophie: 'Philosophie',
  histoire: 'Histoire',
  geographie: 'Géographie'
};

const CHOICE_SUBJECTS = new Set(['mathematiques', 'physique', 'chimie']);

let adminServices = null;

// ════════════════════════════════════════════════════════════════
// FIREBASE ADMIN
// ════════════════════════════════════════════════════════════════
function getAdminServices() {
  if (adminServices) return adminServices;
  const credentials = process.env.FIREBASE_ADMIN_CREDENTIALS;
  if (!credentials) throw new Error('firebase_admin_not_configured');
  const admin = require('firebase-admin');
  const serviceAccount = JSON.parse(credentials);
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
  const payload = { success: false, error };
  if (code) payload.code = code;
  return response.status(status).json(payload);
}

function applyCors(request, response) {
  const ALLOWED_ORIGINS = [
    'https://arvexaschool.vercel.app',
    'https://admin-89.vercel.app',
    'http://localhost:3000',
    'http://localhost:5000'
  ];
  const origin = request.headers.origin || '';
  if (ALLOWED_ORIGINS.indexOf(origin) !== -1) {
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

function round2(n) {
  return Math.round(n * 100) / 100;
}

// ════════════════════════════════════════════════════════════════
// POST-TRAITEMENT LATEX
// ════════════════════════════════════════════════════════════════
const UNICODE_TO_LATEX = {
  'π': '\\pi ', '√': '\\sqrt{}', '×': '\\times ', '÷': '\\div ',
  '≤': '\\leq ', '≥': '\\geq ', '≠': '\\neq ', '∞': '\\infty ',
  '→': '\\to ', '∈': '\\in ', '∑': '\\sum ', '∫': '\\int ',
  'Δ': '\\Delta ', 'α': '\\alpha ', 'β': '\\beta ', 'γ': '\\gamma ',
  'θ': '\\theta ', 'λ': '\\lambda ', 'μ': '\\mu ', 'σ': '\\sigma ',
  '²': '^{2}', '³': '^{3}', '¹': '^{1}', '⁴': '^{4}', 'ⁿ': '^{n}',
  '·': '\\cdot ', '±': '\\pm ', '⁰': '^{0}'
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
  const usageRef = userRef.collection('examUsage').doc(usageDate);

  return db.runTransaction(async (transaction) => {
    const userSnapshot = await transaction.get(userRef);
    const usageSnapshot = await transaction.get(usageRef);
    if (!userSnapshot.exists) throw new Error('profile_missing');
    if (isPremiumUser(userSnapshot.data())) return { premium: true, reserved: false };
    const used = Number(usageSnapshot.data()?.count || 0);
    if (used >= FREE_EXAM_LIMIT) return { premium: false, reserved: false, limitReached: true, used };
    transaction.set(usageRef, { count: used + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { premium: false, reserved: true, usageDate, used: used + 1 };
  });
}

async function releaseFreeGeneration(uid, usageDate) {
  if (!usageDate) return;
  const { db, FieldValue } = getAdminServices();
  const usageRef = db.collection('users').doc(uid).collection('examUsage').doc(usageDate);
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
      'X-Title': 'ARVEXA Exam'
    };
    providers.push(
      { name: 'OpenRouter/inkling:free', key: process.env.OPENROUTER_API_KEY, endpoint: 'https://openrouter.ai/api/v1/chat/completions', model: 'thinkingmachines/inkling:free', jsonMode: true, headers: orHeaders },
      { name: 'OpenRouter/dots3:free', key: process.env.OPENROUTER_API_KEY, endpoint: 'https://openrouter.ai/api/v1/chat/completions', model: 'dots-studio/dots3-note-preview:free', jsonMode: true, headers: orHeaders },
      { name: 'OpenRouter/inkling-small:free', key: process.env.OPENROUTER_API_KEY, endpoint: 'https://openrouter.ai/api/v1/chat/completions', model: 'thinkingmachines/inkling-small:free', jsonMode: true, headers: orHeaders }
    );
  }
  return providers;
}

async function callProvider(provider, prompt, maxTokens) {
  if (!maxTokens) maxTokens = 12000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    console.log(`[AI] ${provider.name} | prompt: ${prompt.length} car | max_tokens: ${maxTokens}`);

    const body = {
      model: provider.model,
      temperature: 0.15,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: 'Tu produis exclusivement du JSON valide. Tu respectes scrupuleusement le schéma demandé.' },
        { role: 'user', content: prompt }
      ]
    };
    if (provider.jsonMode) body.response_format = { type: 'json_object' };

    const headers = {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + provider.key
    };
    if (provider.headers) Object.assign(headers, provider.headers);

    const result = await fetch(provider.endpoint, {
      method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal
    });

    const data = await result.json().catch(() => null);
    if (!result.ok) {
      const msg = data?.error?.message || data?.message || ('HTTP ' + result.status);
      throw new Error(provider.name + ': ' + msg);
    }

    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error(provider.name + ': réponse vide');

    console.log(`[AI] ${provider.name} — réponse: ${content.length} car`);

    const cleaned = String(content).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

    try { return JSON.parse(cleaned); }
    catch (e) {
      console.warn(`[AI] ${provider.name} — JSON invalide. Début: ${cleaned.slice(0, 200)}`);
      throw new Error(provider.name + ': JSON invalide');
    }
  } finally {
    clearTimeout(timeout);
  }
}

// ════════════════════════════════════════════════════════════════
// POOL FIRESTORE
// ════════════════════════════════════════════════════════════════
async function saveExercisesToPool(exam, subject, difficulty, uid) {
  try {
    const { db, FieldValue } = getAdminServices();
    const batch = db.batch();
    let savedCount = 0;

    exam.subjects.forEach((subjectData) => {
      subjectData.exercises.forEach((exercise) => {
        if (!exercise.questions || exercise.questions.length === 0) return;
        const ref = db.collection(POOL_COLLECTION).doc();
        batch.set(ref, {
          subject,
          level: subjectData.level,
          difficulty,
          chapter: exam.chapter || 'all',
          title: exercise.title || 'Exercice',
          points: exercise.points || 6.67,
          statement: exercise.statement || '',
          questions: exercise.questions || [],
          source: 'ai',
          generatedBy: uid,
          createdAt: FieldValue.serverTimestamp(),
          usedCount: 0
        });
        savedCount++;
      });
    });

    if (savedCount > 0) {
      await batch.commit();
      console.log(`[POOL] ${savedCount} exercices sauvegardés pour ${subject}`);
    }
  } catch (e) {
    console.warn('[POOL] Erreur sauvegarde:', e.message);
  }
}

async function buildExamFromPool(config) {
  try {
    const { db, FieldValue } = getAdminServices();
    const snap = await db.collection(POOL_COLLECTION)
      .where('subject', '==', config.subject)
      .limit(100)
      .get();

    if (snap.empty) return null;

    const allEx = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    let filtered = allEx.filter((e) => e.difficulty === config.difficulty);
    if (filtered.length < 6) filtered = allEx;

    const consolidation = filtered.filter((e) => e.level === 'consolidation');
    const approfondissement = filtered.filter((e) => e.level === 'approfondissement');

    if (consolidation.length < 3) {
      consolidation.push(...filtered.filter((e) => !consolidation.includes(e)));
    }
    if (approfondissement.length < 3) {
      approfondissement.push(...filtered.filter((e) => !approfondissement.includes(e)));
    }

    if (consolidation.length < 3 || approfondissement.length < 3) return null;

    consolidation.sort((a, b) => (a.usedCount || 0) - (b.usedCount || 0));
    approfondissement.sort((a, b) => (a.usedCount || 0) - (b.usedCount || 0));

    const pickedCons = shuffle(consolidation.slice(0, Math.min(8, consolidation.length))).slice(0, 3);
    const pickedApp = shuffle(approfondissement.slice(0, Math.min(8, approfondissement.length))).slice(0, 3);

    const batch = db.batch();
    [...pickedCons, ...pickedApp].forEach((ex) => {
      batch.update(db.collection(POOL_COLLECTION).doc(ex.id), {
        usedCount: FieldValue.increment(1),
        lastUsedAt: FieldValue.serverTimestamp()
      });
    });
    await batch.commit().catch(() => {});

    console.log('[POOL] Examen reconstruit depuis le pool');

    return {
      subject: config.subject,
      level: config.level,
      duration: config.duration,
      totalPoints: TOTAL_POINTS,
      chapter: config.chapter,
      fromNotebook: false,
      subjects: [
        {
          id: 'subject_1',
          title: 'Sujet 1 — Consolidation',
          level: 'consolidation',
          instructions: 'Traitez les exercices dans le temps imparti.',
          exercises: pickedCons
        },
        {
          id: 'subject_2',
          title: 'Sujet 2 — Approfondissement',
          level: 'approfondissement',
          instructions: 'Traitez les exercices dans le temps imparti.',
          exercises: pickedApp
        }
      ],
      _fromPool: true
    };
  } catch (e) {
    console.warn('[POOL] Erreur reconstruction:', e.message);
    return null;
  }
}

async function buildUnavailableExam(config) {
  return {
    subject: config.subject,
    level: config.level,
    duration: config.duration,
    totalPoints: TOTAL_POINTS,
    chapter: config.chapter,
    fromNotebook: false,
    unavailable: true,
    message: 'Le service est temporairement indisponible et aucun contenu n\'est en cache. Merci de réessayer dans quelques minutes.',
    subjects: [
      { id: 'subject_1', title: 'Indisponible', level: 'consolidation', instructions: '', exercises: [] },
      { id: 'subject_2', title: 'Indisponible', level: 'approfondissement', instructions: '', exercises: [] }
    ]
  };
}

// ════════════════════════════════════════════════════════════════
// PROMPTS
// ════════════════════════════════════════════════════════════════
const LATEX_RULES = `
═══════════════════════════════════════════════════════════════
RÈGLES LATEX — OBLIGATOIRES
═══════════════════════════════════════════════════════════════
1. Formule mathématique TOUJOURS entre $...$ ou $$...$$.
2. INTERDIT de mettre du LaTeX brut sans $.
3. INTERDIT d'utiliser des symboles Unicode : π → $\\pi$, √ → $\\sqrt{}$, × → $\\times$, ≤ → $\\leq$, ≥ → $\\geq$, ∞ → $\\infty$, Δ → $\\Delta$, ² → $^2$, etc.
4. Fractions : $\\frac{...}{...}$. Vecteurs : $\\vec{u}$. Ensembles : $\\mathbb{R}$.
5. Unités avec petit espace : $9{,}81\\,\\text{m/s}^2$.
`;

const PEDAGOGY_RULES = `
═══════════════════════════════════════════════════════════════
MISSION PÉDAGOGIQUE
═══════════════════════════════════════════════════════════════
Tu prépares un élève de Terminale D au Niger pour le BAC.
Les exercices doivent être :
- Réalistes (niveau BAC)
- Progressifs (facile → difficile)
- Résolubles en 5-15 minutes
- Chaque question teste UNE notion précise
- Chaque question a UNE SEULE bonne réponse (pour QCM)

Les points sont FIXES :
- Chaque exercice vaut exactement 6.67 points (× 3 = 20.01 → arrondi à 20)
- Chaque question vaut exactement 1.33 points (× 5 = 6.65)
- NE JAMAIS attribuer de points différents
`;

const STRUCTURE_CONTROL = `
═══════════════════════════════════════════════════════════════
CONTRÔLE STRUCTUREL OBLIGATOIRE
═══════════════════════════════════════════════════════════════
Ton JSON contient EXACTEMENT :
- "subjects" : tableau de 2 objets
- Chaque subject a : "id" ("subject_1" / "subject_2"), "title", "level", "instructions", "exercises" (3 objets)
- Chaque exercise a : "number" (1-3), "title", "points" (6.67), "statement", "questions" (5 objets)
- Chaque question a : "number" ("1.a"), "text", "points" (1.33), "type" ("choice" ou "text")
  - Si "choice" : "options" (4 objets {id:A/B/C/D, text}) + "correctAnswer" (A/B/C/D)
  - Si "text" : PAS d'options, PAS de correctAnswer
`;

function generationPrompt(config) {
  const subjectLabel = SUBJECT_LABELS[config.subject] || config.subject;
  const usesChoices = CHOICE_SUBJECTS.has(config.subject);
  const qFormat = usesChoices
    ? 'Pour les questions de calcul : type "choice" avec 4 options A/B/C/D. Pour les questions de raisonnement : type "text".'
    : 'Toutes les questions : type "text" (sauf QCM explicite).';

  return `Tu es un professeur expert du BAC au Niger.

${PEDAGOGY_RULES}

MISSION : Génère DEUX sujets d'examen complets.

Matière : ${subjectLabel}
Niveau : ${config.level}
Chapitre : ${config.chapter === 'all' ? 'tous les chapitres' : config.chapter}
Difficulté : ${config.difficulty}
Durée : ${config.duration} minutes

SUJET 1 — "Consolidation" (facile à moyen) : tester les bases.
SUJET 2 — "Approfondissement" (moyen à difficile) : aller plus loin.

${qFormat}

${LATEX_RULES}

FORMAT JSON :
{
  "subject": "${config.subject}",
  "level": "${config.level}",
  "duration": ${config.duration},
  "totalPoints": 20,
  "chapter": "${config.chapter}",
  "subjects": [
    { "id": "subject_1", "title": "Sujet 1 — Consolidation", "level": "consolidation", "instructions": "...", "exercises": [] },
    { "id": "subject_2", "title": "Sujet 2 — Approfondissement", "level": "approfondissement", "instructions": "...", "exercises": [] }
  ]
}

${STRUCTURE_CONTROL}

Réponds UNIQUEMENT avec le JSON complet et valide.`;
}

function generationPromptFromNotebook(config, notebookContext) {
  const subjectLabel = SUBJECT_LABELS[config.subject] || config.subject;
  const usesChoices = CHOICE_SUBJECTS.has(config.subject);
  const qFormat = usesChoices
    ? 'Pour les questions de calcul : type "choice". Pour les questions de raisonnement : type "text".'
    : 'Toutes les questions : type "text".';

  return `Tu es un professeur expert du BAC au Niger.

${PEDAGOGY_RULES}

L'élève a étudié un chapitre dans son cahier. Génère DEUX sujets basés STRICTEMENT sur ce contenu.

Chapitre : ${notebookContext.chapterTitle}
Matière : ${subjectLabel}
Sections : ${notebookContext.sectionsCount}

═══════════════════════════════════════════════════════════════
CONTENU DU CHAPITRE ÉTUDIÉ
═══════════════════════════════════════════════════════════════
${notebookContext.contentText}

RÈGLE ABSOLUE : génère UNIQUEMENT à partir du contenu ci-dessus.

${qFormat}
${LATEX_RULES}

FORMAT JSON :
{
  "subject": "${config.subject}",
  "level": "${config.level}",
  "duration": ${config.duration},
  "totalPoints": 20,
  "chapter": "${config.chapter}",
  "fromNotebook": true,
  "subjects": [
    { "id": "subject_1", "title": "Sujet 1 — Consolidation", "level": "consolidation", "instructions": "...", "exercises": [] },
    { "id": "subject_2", "title": "Sujet 2 — Approfondissement", "level": "approfondissement", "instructions": "...", "exercises": [] }
  ]
}

${STRUCTURE_CONTROL}

Réponds UNIQUEMENT avec le JSON.`;
}

function correctionPrompt(body) {
  const subject = body.exam.subjects.find((s) => s.id === body.subjectId) || body.exam.subjects[0];
  if (!subject) throw new Error('subject_not_found');

  const questionsDetail = [];
  subject.exercises.forEach((exercise, exIdx) => {
    exercise.questions.forEach((question, qIdx) => {
      const key = body.subjectId + ':' + exIdx + ':' + qIdx;
      questionsDetail.push({
        exerciseNumber: exercise.number || (exIdx + 1),
        exerciseStatement: exercise.statement || '',
        questionNumber: question.number || ((exIdx + 1) + '.' + (qIdx + 1)),
        questionText: question.text,
        type: question.type || 'text',
        options: question.options || null,
        points: Number(question.points) || 1.33,
        correctAnswer: question.correctAnswer || null,
        studentAnswer: body.answers[key] || null,
        answered: body.answers[key] !== null && body.answers[key] !== ''
      });
    });
  });

  return `Tu es un professeur correcteur expert du BAC au Niger. Ton rôle : corriger CHAQUE question avec une PÉDAGOGIE MAXIMALE pour que l'élève COMPRENNE, même s'il a raté.

${PEDAGOGY_RULES}

MISSION DE CORRECTION :
Pour CHAQUE question, tu dois produire une analyse pédagogique complète.

DONNÉES (chaque question avec réponse élève) :
${JSON.stringify(questionsDetail, null, 2)}

═══════════════════════════════════════════════════════════════
CE QUE TU DOIS GÉNÉRER POUR CHAQUE QUESTION
═══════════════════════════════════════════════════════════════
1. "explanation" : Explication complète de POURQUOI la bonne réponse est correcte (3-6 phrases).

2. "steps" : Tableau des ÉTAPES du calcul à suivre pour résoudre la question.
   Chaque étape = 1 phrase claire avec les calculs intermédiaires.
   Minimum 3 étapes, maximum 7 étapes.

3. "concept" : La notion/théorème testée (une phrase).

4. "whyWrong" : Si l'élève a raté, explication de SON erreur probable (1-2 phrases).

5. "commonMistake" : L'erreur classique que les élèves font sur cette question.

6. "toReview" : Ce qu'il faut revoir pour réussir cette question la prochaine fois (1 phrase).

7. "betterMethod" : Une astuce ou méthode plus rapide (si pertinent).

8. "feedback" : Message encourageant adapté au statut :
   - correct : "🎉 Bravo !"
   - wrong : "Presque ! Regarde la méthode ci-dessous."
   - unanswered : "Pas de réponse. Voici comment on fait."

═══════════════════════════════════════════════════════════════
CALCUL DES POINTS — RÈGLES STRICTES
═══════════════════════════════════════════════════════════════
- Chaque question vaut exactement le "points" fourni (généralement 1.33).
- QCM correct = points maximaux. QCM faux = 0.
- QCM non répondu = 0.
- Texte libre : évalue le fond. Peut donner 0, 0.5, 1, ou 1.33 pt.
- Le score d'un exercice = somme des points des 5 questions.
- Score TOTAL sur 20.

${LATEX_RULES}

FORMAT JSON :
{
  "score": 15.5,
  "totalScore": 20,
  "percentage": 77,
  "grade": "Bien",
  "exercises": [
    {
      "number": 1,
      "title": "Exercice 1 — Résolution",
      "score": 5.0,
      "maxScore": 6.67,
      "correctAnswers": 4,
      "totalQuestions": 5,
      "questions": [
        {
          "number": "1.1",
          "questionText": "Énoncé complet de la question",
          "type": "choice",
          "studentAnswer": "B",
          "correctAnswer": "A",
          "points": 1.33,
          "maxPoints": 1.33,
          "status": "wrong",
          "explanation": "Explication complète 3-6 phrases...",
          "steps": ["Étape 1...", "Étape 2...", "Étape 3..."],
          "concept": "Notion testée",
          "whyWrong": "Pourquoi ta réponse est fausse...",
          "commonMistake": "Erreur classique à éviter...",
          "toReview": "À revoir : ...",
          "betterMethod": "Astuce...",
          "feedback": "Presque ! Regarde la méthode."
        }
      ],
      "explanation": "Bilan global de l'exercice",
      "advice": "Conseil pour progresser"
    }
  ],
  "revisionTopics": ["Notion 1", "Notion 2"],
  "globalFeedback": {
    "strengths": ["Point fort 1"],
    "weaknesses": ["Faiblesse 1"],
    "encouragement": "Message personnalisé"
  }
}

Réponds UNIQUEMENT avec l'objet JSON.`;
}

// ════════════════════════════════════════════════════════════════
// RÉPARATION & VALIDATION
// ════════════════════════════════════════════════════════════════
function repairExamStructure(exam, subjectName) {
  if (!exam || typeof exam !== 'object') return null;
  const supportsChoices = CHOICE_SUBJECTS.has(subjectName);

  if (!Array.isArray(exam.subjects)) {
    if (Array.isArray(exam.exams)) exam.subjects = exam.exams;
    else if (Array.isArray(exam.sujets)) exam.subjects = exam.sujets;
    else return null;
  }
  if (exam.subjects.length === 0) return null;
  if (exam.subjects.length === 1) {
    const copy = JSON.parse(JSON.stringify(exam.subjects[0]));
    copy.id = 'subject_2';
    copy.title = 'Sujet 2 — Approfondissement';
    copy.level = 'approfondissement';
    copy.instructions = 'Approfondit votre maîtrise.';
    exam.subjects.push(copy);
  }
  exam.subjects = exam.subjects.slice(0, 2);

  exam.subjects.forEach((subject, sIdx) => {
    if (!subject.id) subject.id = 'subject_' + (sIdx + 1);
    if (!subject.title) subject.title = 'Sujet ' + (sIdx + 1);
    if (!subject.level) subject.level = sIdx === 0 ? 'consolidation' : 'approfondissement';
    if (!subject.instructions) subject.instructions = 'Traitez le sujet.';

    if (!Array.isArray(subject.exercises)) subject.exercises = [];

    while (subject.exercises.length < REQUIRED_EXERCISES) {
      const num = subject.exercises.length + 1;
      subject.exercises.push({
        number: num, title: 'Exercice ' + num, points: 6.67,
        statement: '', questions: []
      });
    }
    subject.exercises = subject.exercises.slice(0, REQUIRED_EXERCISES);

    subject.exercises.forEach((exercise, eIdx) => {
      if (!exercise.number) exercise.number = eIdx + 1;
      if (!exercise.title) exercise.title = 'Exercice ' + (eIdx + 1);
      if (!exercise.points) exercise.points = 6.67;
      if (!exercise.statement) exercise.statement = '';
      if (!Array.isArray(exercise.questions)) exercise.questions = [];

      while (exercise.questions.length < QUESTIONS_PER_EXERCISE) {
        const qNum = exercise.questions.length + 1;
        exercise.questions.push({
          number: (eIdx + 1) + '.' + String.fromCharCode(96 + qNum),
          text: '', points: 1.33, type: 'text'
        });
      }
      exercise.questions = exercise.questions.slice(0, QUESTIONS_PER_EXERCISE);

      exercise.questions.forEach((question, qIdx) => {
        if (!question.number) question.number = (eIdx + 1) + '.' + String.fromCharCode(97 + qIdx);
        if (!question.text) question.text = question.question || '';
        if (!question.points) question.points = 1.33;

        if (!question.type) {
          question.type = (Array.isArray(question.options) && question.options.length === 4) ? 'choice' : 'text';
        }

        if (question.type === 'choice') {
          if (!Array.isArray(question.options) || question.options.length !== 4) {
            question.type = 'text';
            delete question.options;
            delete question.correctAnswer;
          } else {
            const letters = ['A', 'B', 'C', 'D'];
            question.options = question.options.map((opt, oi) => {
              const text = typeof opt === 'string' ? opt : (opt?.text || opt?.label || String(opt || ''));
              return { id: letters[oi], text: String(text || '').trim() || ('Option ' + letters[oi]) };
            });

            let correct = question.correctAnswer;
            if (correct === null || correct === undefined) correct = 'A';
            else if (typeof correct === 'number') correct = letters[correct] || 'A';
            else {
              correct = String(correct).toUpperCase().trim();
              if (['A', 'B', 'C', 'D'].indexOf(correct) === -1) correct = 'A';
            }
            question.correctAnswer = correct;
          }
        } else {
          delete question.options;
          delete question.correctAnswer;
        }

        if (!supportsChoices && question.type === 'choice') {
          question.type = 'text';
          delete question.options;
          delete question.correctAnswer;
        }
      });
    });
  });

  return exam;
}

function validateGeneratedExam(exam, subjectName) {
  const supportsChoices = CHOICE_SUBJECTS.has(subjectName);
  const validQuestion = (q) => {
    if (!supportsChoices || q.type !== 'choice') return ['text', 'number', 'formula', 'choice'].indexOf(q.type) !== -1;
    return Array.isArray(q.options) && q.options.length === 4 && ['A', 'B', 'C', 'D'].indexOf(q.correctAnswer) !== -1;
  };
  return exam && Array.isArray(exam.subjects) && exam.subjects.length === 2 &&
    exam.subjects.every((s) =>
      Array.isArray(s.exercises) && s.exercises.length === REQUIRED_EXERCISES &&
      s.exercises.every((ex) =>
        Array.isArray(ex.questions) && ex.questions.length === QUESTIONS_PER_EXERCISE &&
        ex.questions.every(validQuestion)
      )
    );
}

async function generateWithFallback(prompt, subjectName) {
  const providers = getProviders();
  if (!providers.length) throw new Error('provider_missing');

  const startTime = Date.now();
  const TIME_BUDGET_MS = 80000;
  const errors = [];

  for (let i = 0; i < providers.length; i++) {
    const elapsed = Date.now() - startTime;
    if (elapsed > TIME_BUDGET_MS) {
      errors.push('time_budget_exceeded');
      break;
    }

    const provider = providers[i];
    try {
      console.log('[AI] Tentative ' + provider.name + '...');
      let rawExam = await callProvider(provider, prompt);
      rawExam = repairExamStructure(rawExam, subjectName);

      if (validateGeneratedExam(rawExam, subjectName)) {
        console.log('[AI] OK ' + provider.name);
        return { exam: rawExam, provider: provider.name };
      }

      errors.push(provider.name + ': structure invalide');
    } catch (error) {
      errors.push(provider.name + ': ' + error.message);
      console.warn('[AI] FAIL ' + provider.name + ': ' + error.message);
    }
  }
  throw new Error('all_providers_failed: ' + errors.join(' | '));
}

async function correctWithFallback(prompt) {
  const providers = getProviders();
  if (!providers.length) throw new Error('provider_missing');
  const errors = [];
  for (const provider of providers) {
    try {
      const result = await callProvider(provider, prompt, 14000);
      if (result && typeof result === 'object' && Array.isArray(result.exercises)) {
        return { result, provider: provider.name };
      }
      errors.push(provider.name + ': structure invalide');
    } catch (error) {
      errors.push(provider.name + ': ' + error.message);
    }
  }
  throw new Error('all_providers_failed: ' + errors.join(' | '));
}

// ════════════════════════════════════════════════════════════════
// CORRECTION HYBRIDE
// ════════════════════════════════════════════════════════════════
function correctQCMDeterministic(subject, subjectId, answers) {
  const exercises = [];
  subject.exercises.forEach((exercise, exIdx) => {
    const exRes = {
      number: exercise.number || (exIdx + 1),
      title: exercise.title || ('Exercice ' + (exIdx + 1)),
      score: 0,
      maxScore: 0,
      correctAnswers: 0,
      totalQuestions: exercise.questions.length,
      questions: [],
      wrongAnswers: [],
      explanation: '',
      advice: ''
    };
    const textQuestions = [];

    exercise.questions.forEach((question, qIdx) => {
      const key = subjectId + ':' + exIdx + ':' + qIdx;
      const studentAnswer = answers[key];
      const points = Number(question.points) || 1.33;
      exRes.maxScore += points;

      const qRes = {
        number: question.number || ((exIdx + 1) + '.' + (qIdx + 1)),
        questionText: question.text || '',
        type: question.type || 'text',
        studentAnswer: studentAnswer || null,
        correctAnswer: question.correctAnswer || null,
        points: 0,
        maxPoints: points,
        status: 'pending',
        feedback: '',
        explanation: '',
        steps: [],
        concept: '',
        whyWrong: null,
        commonMistake: null,
        toReview: null,
        betterMethod: null
      };

      if (question.type === 'choice' && question.correctAnswer) {
        if (studentAnswer === question.correctAnswer) {
          qRes.status = 'correct';
          qRes.points = points;
          exRes.score += points;
          exRes.correctAnswers++;
        } else if (!studentAnswer) {
          qRes.status = 'unanswered';
        } else {
          qRes.status = 'wrong';
          exRes.wrongAnswers.push({
            number: qRes.number,
            studentAnswer,
            correctAnswer: question.correctAnswer,
            question: question.text
          });
        }
      } else {
        textQuestions.push({ exerciseIndex: exIdx, questionIndex: qIdx, questionResult: qRes });
      }
      exRes.questions.push(qRes);
    });
    exercises.push({ exerciseResult: exRes, textQuestions });
  });
  return exercises;
}

async function correctExamHybrid(exam, subjectId, answers, uid) {
  const subject = exam.subjects.find((s) => s.id === subjectId) || exam.subjects[0];
  if (!subject) throw new Error('subject_not_found');

  const deterministicResults = correctQCMDeterministic(subject, subjectId, answers);
  const hasTextQuestions = deterministicResults.some((r) => r.textQuestions.length > 0);

  if (hasTextQuestions) {
    try {
      const prompt = correctionPrompt({ exam: { ...exam, subjects: [subject] }, subjectId, answers });
      const aiResponse = await correctWithFallback(prompt);
      const aiResult = aiResponse.result;

      if (Array.isArray(aiResult?.exercises)) {
        aiResult.exercises.forEach((aiEx, exIdx) => {
          const target = deterministicResults[exIdx];
          if (!target) return;

          const aiQuestions = Array.isArray(aiEx.questions) ? aiEx.questions : [];
          aiQuestions.forEach((aiQ) => {
            const match = target.exerciseResult.questions.find((q) => String(q.number) === String(aiQ.number));
            if (!match) return;

            if (aiQ.explanation) match.explanation = aiQ.explanation;
            if (Array.isArray(aiQ.steps) && aiQ.steps.length > 0) match.steps = aiQ.steps;
            if (aiQ.concept) match.concept = aiQ.concept;
            if (aiQ.whyWrong) match.whyWrong = aiQ.whyWrong;
            if (aiQ.commonMistake) match.commonMistake = aiQ.commonMistake;
            if (aiQ.toReview) match.toReview = aiQ.toReview;
            if (aiQ.betterMethod) match.betterMethod = aiQ.betterMethod;
            if (aiQ.feedback) match.feedback = aiQ.feedback;
            if (aiQ.correctAnswer && !match.correctAnswer) match.correctAnswer = aiQ.correctAnswer;

            if (match.status === 'pending') {
              match.points = Number(aiQ.points) || 0;
              match.status = aiQ.status || (match.points > 0 ? 'correct' : 'wrong');
              if (match.status === 'correct') {
                target.exerciseResult.score += match.points;
                target.exerciseResult.correctAnswers++;
              }
            }
          });

          if (aiEx.explanation) target.exerciseResult.explanation = aiEx.explanation;
          if (aiEx.advice) target.exerciseResult.advice = aiEx.advice;
        });
      }

      if (Array.isArray(aiResult?.revisionTopics)) deterministicResults.revisionTopics = aiResult.revisionTopics;
      if (aiResult?.globalFeedback) deterministicResults.globalFeedback = aiResult.globalFeedback;
    } catch (error) {
      console.warn('AI correction failed:', error.message);
      deterministicResults.forEach((r) => {
        r.textQuestions.forEach((tq) => {
          tq.questionResult.status = 'unanswered';
          tq.questionResult.feedback = 'Correction IA temporairement indisponible.';
          tq.questionResult.explanation = 'Nous n\'avons pas pu corriger cette question. Réessaie plus tard.';
        });
      });
    }
  }

  // CALCUL FINAL DU SCORE (BLINDÉ)
  const finalExercises = deterministicResults.map((r) => r.exerciseResult);

  let rawScore = 0;
  let maxPossibleScore = 0;

  finalExercises.forEach((ex) => {
    ex.score = 0;
    ex.maxScore = 0;
    ex.correctAnswers = 0;

    ex.questions.forEach((q) => {
      const qMax = Number(q.maxPoints) || 1.33;
      const qPoints = Math.max(0, Math.min(qMax, Number(q.points) || 0));

      q.points = round2(qPoints);
      q.maxPoints = round2(qMax);

      ex.score += qPoints;
      ex.maxScore += qMax;

      if (q.status === 'correct') ex.correctAnswers++;
    });

    ex.score = round2(ex.score);
    ex.maxScore = round2(ex.maxScore);

    rawScore += ex.score;
    maxPossibleScore += ex.maxScore;
  });

  let finalScore;
  if (maxPossibleScore > 0) {
    finalScore = (rawScore / maxPossibleScore) * TOTAL_POINTS;
  } else {
    finalScore = 0;
  }

  finalScore = round2(Math.max(0, Math.min(TOTAL_POINTS, finalScore)));
  const percentage = Math.round((finalScore / TOTAL_POINTS) * 100);

  let grade = 'Insuffisant';
  if (percentage >= 90) grade = 'Excellent';
  else if (percentage >= 80) grade = 'Très bien';
  else if (percentage >= 70) grade = 'Bien';
  else if (percentage >= 60) grade = 'Assez bien';
  else if (percentage >= 50) grade = 'Passable';

  finalExercises.forEach((ex) => {
    if (maxPossibleScore > 0) {
      ex.score = round2((ex.score / ex.maxScore) * (ex.maxScore / maxPossibleScore * TOTAL_POINTS));
      ex.maxScore = round2(ex.maxScore / maxPossibleScore * TOTAL_POINTS);
    }
  });

  const revisionTopics = deterministicResults.revisionTopics || [];
  if (!revisionTopics.length) {
    finalExercises.forEach((ex) => {
      if (ex.score < ex.maxScore * 0.5) revisionTopics.push('Revoir ' + (ex.title || ('Exercice ' + ex.number)));
    });
  }

  const globalFeedback = deterministicResults.globalFeedback || {
    strengths: [],
    weaknesses: [],
    encouragement: percentage >= 70 ? 'Bon travail global !' : 'Continue tes efforts.'
  };

  return {
    score: finalScore,
    totalScore: TOTAL_POINTS,
    percentage,
    grade,
    exercises: finalExercises,
    revisionTopics,
    globalFeedback
  };
}

// ════════════════════════════════════════════════════════════════
// SAUVEGARDE RÉSULTAT
// ════════════════════════════════════════════════════════════════
async function saveExamResult(uid, body, result) {
  const { db, FieldValue } = getAdminServices();
  const selected = body.exam.subjects.find((s) => s.id === body.subjectId) || body.exam.subjects[0];
  const difficulties = Array.isArray(result?.exercises) ? result.exercises.map((ex) => ({
    number: ex.number,
    score: Number(ex.score || 0),
    maxScore: Number(ex.maxScore || 6.67),
    advice: String(ex.advice || '').slice(0, 500)
  })) : [];

  await db.collection('users').doc(uid).collection('examResults').add({
    subject: SUBJECT_LABELS[body.exam.subject] || body.exam.subject,
    subjectKey: body.exam.subject,
    chapter: body.exam.chapter || 'all',
    chapterTitle: selected?.title || 'Examen',
    score: Number(result?.score || 0),
    totalScore: TOTAL_POINTS,
    percentage: Number(result?.percentage || 0),
    grade: result?.grade || null,
    result: { ...result, exercises: result?.exercises || [] },
    difficulties,
    answerCount: Object.values(body.answers || {}).filter(Boolean).length,
    examTitle: selected?.title || 'Examen',
    fromNotebook: Boolean(body.notebookContext),
    createdAt: FieldValue.serverTimestamp(),
    date: FieldValue.serverTimestamp()
  });
}

// ════════════════════════════════════════════════════════════════
// VALIDATIONS
// ════════════════════════════════════════════════════════════════
function validateConfig(body) {
  const config = {
    subject: String(body.subject || ''),
    level: String(body.level || ''),
    chapter: String(body.chapter || 'all'),
    difficulty: String(body.difficulty || ''),
    duration: Number(body.duration),
    exerciseCount: Number(body.exerciseCount)
  };
  if (!ALLOWED_SUBJECTS.has(config.subject)) return 'Matière invalide.';
  if (config.level !== 'Terminale D') return 'Niveau invalide.';
  if (!ALLOWED_DIFFICULTIES.has(config.difficulty)) return 'Difficulté invalide.';
  if (!ALLOWED_DURATIONS.has(config.duration)) return 'Durée invalide.';
  if (config.exerciseCount !== REQUIRED_EXERCISES) return 'Nombre d\'exercices invalide.';
  if (config.chapter.length > 100) return 'Chapitre invalide.';
  return null;
}

function validateCorrection(body) {
  if (!body.exam || !Array.isArray(body.exam.subjects) || !body.subjectId || !body.answers) return 'Données invalides.';
  if (JSON.stringify(body).length > 250000) return 'Examen trop volumineux.';
  return null;
}

// ════════════════════════════════════════════════════════════════
// CHARGEMENT CONTEXTE CAHIER
// ════════════════════════════════════════════════════════════════
async function loadNotebookContext(uid, subject, chapterId, chapterTitle) {
  const { db } = getAdminServices();
  const notebookKey = subject;
  if (!notebookKey) return null;

  function normalizeText(str) {
    return String(str || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
  }

  let chapterData = null;
  let actualChapterId = chapterId;

  if (chapterId) {
    const snap = await db.collection('users').doc(uid)
      .collection('notebooks').doc(notebookKey)
      .collection('chapters').doc(chapterId).get();
    if (snap.exists) chapterData = { id: chapterId, ...snap.data() };
  }

  if (!chapterData && chapterTitle) {
    const chaptersSnap = await db.collection('users').doc(uid)
      .collection('notebooks').doc(notebookKey)
      .collection('chapters').get().catch(() => ({ docs: [] }));

    const target = normalizeText(chapterTitle);
    const found = chaptersSnap.docs.find((d) => {
      const t = normalizeText(d.data().title);
      return t === target || t.includes(target) || target.includes(t);
    });
    if (found) {
      chapterData = { id: found.id, ...found.data() };
      actualChapterId = found.id;
    }
  }

  if (!chapterData) return null;

  const sectionsSnap = await db.collection('users').doc(uid)
    .collection('notebooks').doc(notebookKey)
    .collection('chapters').doc(actualChapterId)
    .collection('sections').orderBy('createdAt', 'asc').get();

  if (sectionsSnap.empty) return null;

  const sections = sectionsSnap.docs.slice(0, 5).map((d) => {
    const s = d.data();
    return { id: d.id, title: s.title || 'Section', rawInput: s.rawInput || '', analysis: s.analysis || {} };
  });

  const contentText = sections.map((s, i) => {
    let text = `━━━ SECTION ${i + 1} : ${s.title} ━━━\n`;
    text += 'Contenu : ' + s.rawInput.slice(0, 1500) + '\n';
    const a = s.analysis || {};
    if (a.explanation?.understanding) text += 'À comprendre : ' + a.explanation.understanding + '\n';
    return text;
  }).join('\n\n');

  return {
    notebookKey, chapterId: actualChapterId,
    chapterTitle: chapterData.title || chapterTitle || 'Chapitre',
    sectionsCount: sections.length,
    contentText
  };
}

// ════════════════════════════════════════════════════════════════
// HANDLER PRINCIPAL
// ════════════════════════════════════════════════════════════════
module.exports = async function handler(request, response) {
  applyCors(request, response);
  if (request.method === 'OPTIONS') return response.status(204).end();
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return jsonError(response, 405, 'Méthode non autorisée.');
  }

  // Rate limit adaptatif selon l'action
  const body = request.body && typeof request.body === 'object' ? request.body : {};
  const action = body.action || 'generate';
  const isLight = LIGHT_ACTIONS.has(action);
  const rateLimit = isLight ? MAX_REQUESTS_PER_WINDOW_LIGHT : MAX_REQUESTS_PER_WINDOW_HEAVY;

  if (rateLimited(clientIp(request), rateLimit)) {
    return jsonError(response, 429, isLight
      ? 'Trop de requêtes. Patiente quelques secondes.'
      : 'Trop de tentatives. Attends une minute.');
  }

  const verifiedUser = await verifyFirebaseToken(request).catch(() => null);
  if (!verifiedUser) return jsonError(response, 401, 'Connexion requise.', 'AUTH_REQUIRED');

  if (!ALLOWED_ACTIONS.has(action)) return jsonError(response, 400, 'Action invalide.');

  // ═══ VÉRIFICATION PREMIUM POUR L'HISTORIQUE ═══
  if (PREMIUM_ACTIONS.has(action)) {
    try {
      const { db } = getAdminServices();
      const userSnap = await db.collection('users').doc(verifiedUser.uid).get();
      if (!userSnap.exists) {
        return jsonError(response, 404, 'Profil utilisateur introuvable.');
      }
      if (!isPremiumUser(userSnap.data())) {
        return jsonError(
          response,
          403,
          'L\'historique des examens est réservé aux comptes Premium.',
          'PREMIUM_REQUIRED'
        );
      }
    } catch (e) {
      console.error('[HISTORIQUE] Premium check failed:', e.message);
      return jsonError(response, 503, 'Service temporairement indisponible.');
    }
  }

  // ═══ HISTORIQUE : LISTER ═══
  if (action === 'listExams') {
    try {
      const { db } = getAdminServices();
      const limit = Math.min(100, Number(body.limit) || 50);
      const snap = await db.collection('users').doc(verifiedUser.uid)
        .collection('examResults')
        .orderBy('createdAt', 'desc').limit(limit).get();

      const exams = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          subject: data.subject || 'Examen',
          subjectKey: data.subjectKey || '',
          chapterTitle: data.chapterTitle || '',
          examTitle: data.examTitle || 'Examen',
          score: Number(data.score || 0),
          totalScore: Number(data.totalScore || 20),
          percentage: Number(data.percentage || 0),
          grade: data.grade || null,
          createdAt: toISO(data.createdAt)
        };
      });

      return response.status(200).json({ success: true, exams });
    } catch (e) {
      console.error('[HISTORIQUE EXAMS] error:', e.message);
      return jsonError(response, 500, 'Impossible de charger l\'historique.');
    }
  }

  // ═══ HISTORIQUE : CHARGER ═══
  if (action === 'loadExam') {
    if (!body.examId) return jsonError(response, 400, 'examId requis.');
    try {
      const { db } = getAdminServices();
      const ref = db.collection('users').doc(verifiedUser.uid).collection('examResults').doc(body.examId);
      const snap = await ref.get();
      if (!snap.exists) return jsonError(response, 404, 'Examen introuvable.');
      const data = snap.data();
      return response.status(200).json({
        success: true,
        exam: {
          id: snap.id,
          subject: data.subject,
          subjectKey: data.subjectKey || '',
          chapterTitle: data.chapterTitle || '',
          examTitle: data.examTitle || 'Examen',
          score: Number(data.score || 0),
          totalScore: Number(data.totalScore || 20),
          percentage: Number(data.percentage || 0),
          grade: data.grade || null,
          result: data.result || null,
          createdAt: toISO(data.createdAt)
        }
      });
    } catch (e) {
      return jsonError(response, 500, 'Erreur chargement.');
    }
  }

  // ═══ HISTORIQUE : SUPPRIMER (autorisé même sans Premium) ═══
  if (action === 'deleteExam') {
    if (!body.examId) return jsonError(response, 400, 'examId requis.');
    try {
      const { db } = getAdminServices();
      await db.collection('users').doc(verifiedUser.uid).collection('examResults').doc(body.examId).delete();
      return response.status(200).json({ success: true });
    } catch (e) {
      return jsonError(response, 500, 'Erreur suppression.');
    }
  }

  // ═══ GÉNÉRATION ═══
  if (action === 'generate') {
    const validationError = validateConfig(body);
    if (validationError) return jsonError(response, 400, validationError);

    const reservation = await reserveFreeGeneration(verifiedUser.uid).catch(() => null);
    if (!reservation) return jsonError(response, 503, 'Vérification du quota indisponible.');

    if (reservation.limitReached) {
      return response.status(429).json({
        success: false, error: 'Limite gratuite atteinte.',
        code: 'FREE_EXAM_LIMIT', used: reservation.used, limit: FREE_EXAM_LIMIT
      });
    }

    try {
      const providers = getProviders();
      if (!providers.length) throw new Error('provider_missing');

      let notebookContext = null;
      if (body.notebookContext && (body.notebookContext.chapterId || body.notebookContext.chapterTitle)) {
        try {
          notebookContext = await loadNotebookContext(
            verifiedUser.uid, body.subject,
            body.notebookContext.chapterId, body.notebookContext.chapterTitle
          );
        } catch (e) { console.warn('[EXAM] Contexte cahier échoué:', e.message); }
      }

      const prompt = notebookContext
        ? generationPromptFromNotebook(body, notebookContext)
        : generationPrompt(body);

      const genResult = await generateWithFallback(prompt, body.subject);
      let exam = genResult.exam;

      exam = deepClean(exam);

      await saveExercisesToPool(exam, body.subject, body.difficulty, verifiedUser.uid);

      exam.chapter = body.chapter;
      exam.fromNotebook = Boolean(notebookContext);
      exam.notebookSectionsCount = notebookContext?.sectionsCount || 0;

      return response.status(200).json({
        success: true,
        exam,
        meta: { provider: genResult.provider, fromNotebook: Boolean(notebookContext) }
      });
    } catch (error) {
      console.error('Exam generation failed:', error.message);
      if (reservation?.reserved) {
        try { await releaseFreeGeneration(verifiedUser.uid, reservation.usageDate); } catch (_) {}
      }

      const pooled = await buildExamFromPool(body);
      if (pooled) {
        return response.status(200).json({ success: true, exam: pooled, fallback: true, source: 'pool' });
      }

      return response.status(200).json({
        success: true,
        exam: await buildUnavailableExam(body),
        unavailable: true
      });
    }
  }

  // ═══ CORRECTION ═══
  if (action === 'correct') {
    const validationError = validateCorrection(body);
    if (validationError) return jsonError(response, 400, validationError);

    try {
      const result = await correctExamHybrid(body.exam, body.subjectId, body.answers, verifiedUser.uid);
      try { await saveExamResult(verifiedUser.uid, body, result); }
      catch (e) { console.error('Save exam result failed:', e.message); }

      return response.status(200).json({ success: true, result });
    } catch (error) {
      console.error('Exam correction failed:', error.message);
      return response.status(200).json({
        success: true,
        result: {
          score: 0, totalScore: TOTAL_POINTS, percentage: 0, grade: 'Indéterminé',
          exercises: [], revisionTopics: [],
          globalFeedback: { strengths: [], weaknesses: [], encouragement: 'Correction indisponible.' }
        }
      });
    }
  }

  return jsonError(response, 400, 'Action inconnue.');
};
