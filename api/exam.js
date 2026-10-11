// ================================================================
// API EXAM v3.3 — ARVEXA School
// 7 matières : maths, physique, chimie, svt, philo, histoire, geographie
// 3 exercices × 5 questions par sujet
// 100% gratuit : Groq (4 modèles) + OpenRouter (3 modèles :free)
// Version SANS backticks (compatible copier-coller partout)
// ================================================================

module.exports.config = { maxDuration: 90 };

var WINDOW_MS = 60 * 1000;
var MAX_REQUESTS_PER_WINDOW = 3;
var requestLog = new Map();

var ALLOWED_SUBJECTS = new Set([
  'mathematiques', 'physique', 'chimie', 'svt',
  'philosophie', 'histoire', 'geographie'
]);

var ALLOWED_DIFFICULTIES = new Set(['easy', 'medium', 'hard', 'bac']);
var ALLOWED_DURATIONS = new Set([30, 60, 90, 120, 180]);
var REQUIRED_EXERCISES = 3;
var QUESTIONS_PER_EXERCISE = 5;
var FREE_EXAM_LIMIT = 2;

var SUBJECT_LABELS = {
  'mathematiques': 'Mathématiques',
  'physique': 'Physique',
  'chimie': 'Chimie',
  'svt': 'SVT',
  'philosophie': 'Philosophie',
  'histoire': 'Histoire',
  'geographie': 'Géographie'
};

var CHOICE_SUBJECTS = new Set(['mathematiques', 'physique', 'chimie']);

var adminServices = null;

function getAdminServices() {
  if (adminServices) return adminServices;
  var credentials = process.env.FIREBASE_ADMIN_CREDENTIALS;
  if (!credentials) throw new Error('firebase_admin_not_configured');
  var admin = require('firebase-admin');
  var serviceAccount = JSON.parse(credentials);
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

function clientIp(request) {
  return String(request.headers['x-forwarded-for'] || (request.socket && request.socket.remoteAddress) || 'unknown')
    .split(',')[0].trim();
}

function rateLimited(ip) {
  var now = Date.now();
  var recent = (requestLog.get(ip) || []).filter(function (t) { return now - t < WINDOW_MS; });
  recent.push(now);
  requestLog.set(ip, recent);
  return recent.length > MAX_REQUESTS_PER_WINDOW;
}

function jsonError(response, status, error, code) {
  var payload = { success: false, error: error };
  if (code) payload.code = code;
  return response.status(status).json(payload);
}

function applyCors(request, response) {
  var ALLOWED_ORIGINS = [
    'https://arvexaschool.vercel.app',
    'https://admin-89.vercel.app',
    'http://localhost:3000',
    'http://localhost:5000'
  ];
  var origin = request.headers.origin || '';
  if (ALLOWED_ORIGINS.indexOf(origin) !== -1) {
    response.setHeader('Access-Control-Allow-Origin', origin);
  }
  response.setHeader('Vary', 'Origin');
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  response.setHeader('Access-Control-Max-Age', '86400');
}

async function verifyFirebaseToken(request) {
  var authorization = request.headers.authorization || '';
  var match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  try {
    var services = getAdminServices();
    return await services.auth.verifyIdToken(match[1]);
  } catch (error) {
    console.error('[EXAM AUTH] failed:', error.message);
    return null;
  }
}

function isPremiumUser(data) {
  if (!data) return false;
  var status = data.subscriptionStatus || 'none';
  if (status === 'pending') return false;
  var hasPremium = data.premium === true || data.isUnlocked === true || data.hasDeposited === true;
  var end = data.subscriptionEndDate && data.subscriptionEndDate.toDate ? data.subscriptionEndDate.toDate()
    : (data.subscriptionEndDate && data.subscriptionEndDate.seconds ? new Date(data.subscriptionEndDate.seconds * 1000) : null);
  if (hasPremium && end) return end.getTime() > Date.now();
  if (status === 'expired') return false;
  if (hasPremium && !end) return true;
  return false;
}

function examSubjectToNotebookKey(examSubject) {
  var map = {
    'mathematiques': 'mathematiques',
    'physique': 'physique',
    'chimie': 'chimie',
    'svt': 'svt',
    'philosophie': 'philosophie',
    'histoire': 'histoire',
    'geographie': 'geographie'
  };
  return map[examSubject] || null;
}

function normalizeSubjectKey(raw) {
  if (!raw) return null;
  var s = String(raw).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '_').replace(/[^a-z_]/g, '');
  var map = {
    mathematiques: 'mathematiques', maths: 'mathematiques', math: 'mathematiques',
    physique: 'physique', physiques: 'physique',
    chimie: 'chimie', svt: 'svt',
    philosophie: 'philosophie', philo: 'philosophie',
    histoire: 'histoire',
    geographie: 'geographie', geo: 'geographie'
  };
  return map[s] || s;
}

function normalizeText(str) {
  return String(str || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function findChapterFuzzy(chapters, targetTitle) {
  if (!Array.isArray(chapters) || !targetTitle) return null;
  var target = normalizeText(targetTitle);
  if (!target) return null;
  for (var i = 0; i < chapters.length; i++) {
    if (normalizeText(chapters[i].title) === target) return chapters[i];
  }
  if (target.length > 3) {
    for (var j = 0; j < chapters.length; j++) {
      var t = normalizeText(chapters[j].title);
      if (t.length > 3 && (t.indexOf(target) !== -1 || target.indexOf(t) !== -1)) return chapters[j];
    }
  }
  return null;
}

async function loadNotebookContext(uid, subject, chapterId, chapterTitle) {
  var services = getAdminServices();
  var db = services.db;
  var notebookKey = examSubjectToNotebookKey(subject);
  if (!notebookKey) return null;

  var actualChapterId = chapterId;
  var chapterData = null;

  if (chapterId) {
    var chapterRef = db.collection('users').doc(uid)
      .collection('notebooks').doc(notebookKey)
      .collection('chapters').doc(chapterId);
    var snap = await chapterRef.get();
    if (snap.exists) {
      chapterData = Object.assign({ id: chapterId }, snap.data());
    }
  }

  if (!chapterData && chapterTitle) {
    var chaptersSnap = await db.collection('users').doc(uid)
      .collection('notebooks').doc(notebookKey)
      .collection('chapters').get().catch(function () { return { docs: [] }; });
    var allChapters = chaptersSnap.docs.map(function (d) {
      return Object.assign({ id: d.id }, d.data());
    });
    var found = findChapterFuzzy(allChapters, chapterTitle);
    if (found) { chapterData = found; actualChapterId = found.id; }
  }

  if (!chapterData) return null;

  var sectionsSnap = await db.collection('users').doc(uid)
    .collection('notebooks').doc(notebookKey)
    .collection('chapters').doc(actualChapterId)
    .collection('sections').orderBy('createdAt', 'asc').get();

  if (sectionsSnap.docs.length === 0) return null;

  var allSections = sectionsSnap.docs.map(function (d) {
    var s = d.data();
    return { id: d.id, title: s.title || 'Section', rawInput: s.rawInput || '', analysis: s.analysis || {} };
  });

  var sections = allSections.slice(0, 5);

  var contentText = sections.map(function (s, i) {
    var text = '━━━ SECTION ' + (i + 1) + ' : ' + s.title + ' ━━━\n';
    text += 'Contenu source :\n' + s.rawInput.slice(0, 1500) + '\n\n';
    var a = s.analysis || {};
    if (a.explanation && a.explanation.understanding) text += 'À comprendre : ' + a.explanation.understanding + '\n';
    if (Array.isArray(a.explanation && a.explanation.parts)) {
      a.explanation.parts.slice(0, 5).forEach(function (p) {
        text += '\n• ' + (p.partTitle || 'Partie') + ' :\n';
        if (p.mainIdea) text += '  Idée : ' + p.mainIdea + '\n';
        if (p.simpleExplanation) text += '  Explication : ' + p.simpleExplanation + '\n';
        if (p.toRemember) text += '  À retenir : ' + p.toRemember + '\n';
      });
    }
    if (Array.isArray(a.questions)) {
      text += '\nQuestions déjà posées :\n';
      a.questions.slice(0, 8).forEach(function (q, j) { text += '  Q' + (j + 1) + ' : ' + q.question + '\n'; });
    }
    if (a.structure) {
      var st = a.structure;
      if (Array.isArray(st.formulas) && st.formulas.length > 0) {
        text += '\nFormules clés :\n';
        st.formulas.slice(0, 8).forEach(function (f) { text += '  - ' + (f.latex || '') + '\n'; });
      }
      if (Array.isArray(st.definitions) && st.definitions.length > 0) {
        text += '\nDéfinitions :\n';
        st.definitions.slice(0, 10).forEach(function (d) { text += '  - ' + d.term + ' : ' + d.definition + '\n'; });
      }
      if (Array.isArray(st.mechanisms) && st.mechanisms.length > 0) {
        text += '\nMécanismes :\n';
        st.mechanisms.slice(0, 5).forEach(function (m) {
          text += '  - ' + (m.name || '') + '\n';
          if (Array.isArray(m.steps)) m.steps.slice(0, 6).forEach(function (step, si) { text += '    ' + (si + 1) + '. ' + step + '\n'; });
        });
      }
      if (Array.isArray(st.timeline) && st.timeline.length > 0) {
        text += '\nChronologie :\n';
        st.timeline.slice(0, 10).forEach(function (t) { text += '  - ' + t.date + ' : ' + t.event + '\n'; });
      }
    }
    return text;
  }).join('\n\n');

  return {
    notebookKey: notebookKey,
    chapterId: actualChapterId,
    chapterTitle: chapterData.title || chapterTitle || 'Chapitre',
    sectionsCount: sections.length,
    contentText: contentText
  };
}

function getProviders() {
  var providers = [];

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

  if (process.env.OPENROUTER_API_KEY) {
    var orHeaders = {
      'HTTP-Referer': process.env.APP_ORIGIN || '',
      'X-Title': 'ARVEXA Exam'
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

async function callProvider(provider, prompt, maxTokens) {
  if (!maxTokens) maxTokens = 12000;
  var controller = new AbortController();
  var timeout = setTimeout(function () { controller.abort(); }, 45000);
  try {
    console.log('[AI] ' + provider.name + ' | prompt: ' + prompt.length + ' car | max_tokens: ' + maxTokens);

    var body = {
      model: provider.model,
      temperature: 0.15,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: 'Tu produis exclusivement du JSON valide. Tu respectes scrupuleusement le schéma demandé.' },
        { role: 'user', content: prompt }
      ]
    };
    if (provider.jsonMode) body.response_format = { type: 'json_object' };

    var headers = {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + provider.key
    };
    if (provider.headers) {
      Object.keys(provider.headers).forEach(function (k) { headers[k] = provider.headers[k]; });
    }

    var result = await fetch(provider.endpoint, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body),
      signal: controller.signal
    });

    var data = await result.json().catch(function () { return null; });

    if (!result.ok) {
      var msg = (data && data.error && data.error.message) || (data && data.message) || ('HTTP ' + result.status);
      throw new Error(provider.name + ': ' + msg);
    }

    var content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!content) {
      throw new Error(provider.name + ': réponse vide');
    }

    console.log('[AI] ' + provider.name + ' — réponse: ' + content.length + ' car');

    var cleaned = String(content).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

    try {
      return JSON.parse(cleaned);
    } catch (parseError) {
      console.warn('[AI] ' + provider.name + ' — JSON invalide. Début: ' + cleaned.slice(0, 200));
      throw new Error(provider.name + ': JSON invalide');
    }
  } finally {
    clearTimeout(timeout);
  }
}

function getUsageDate() {
  return new Date().toISOString().slice(0, 10);
}

async function reserveFreeGeneration(uid) {
  var services = getAdminServices();
  var db = services.db;
  var FieldValue = services.FieldValue;
  var userRef = db.collection('users').doc(uid);
  var usageDate = getUsageDate();
  var usageRef = userRef.collection('examUsage').doc(usageDate);

  return db.runTransaction(async function (transaction) {
    var userSnapshot = await transaction.get(userRef);
    var usageSnapshot = await transaction.get(usageRef);
    if (!userSnapshot.exists) throw new Error('profile_missing');
    if (isPremiumUser(userSnapshot.data())) return { premium: true, reserved: false };
    var used = Number((usageSnapshot.data() || {}).count || 0);
    if (used >= FREE_EXAM_LIMIT) return { premium: false, reserved: false, limitReached: true, used: used };
    transaction.set(usageRef, { count: used + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { premium: false, reserved: true, usageDate: usageDate, used: used + 1 };
  });
}

async function releaseFreeGeneration(uid, usageDate) {
  if (!usageDate) return;
  var services = getAdminServices();
  var db = services.db;
  var FieldValue = services.FieldValue;
  var usageRef = db.collection('users').doc(uid).collection('examUsage').doc(usageDate);
  try {
    await db.runTransaction(async function (transaction) {
      var snapshot = await transaction.get(usageRef);
      var used = Math.max(0, Number((snapshot.data() || {}).count || 0) - 1);
      transaction.set(usageRef, { count: used, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    });
  } catch (_) {}
}

async function saveExamResult(uid, body, result) {
  var services = getAdminServices();
  var db = services.db;
  var FieldValue = services.FieldValue;
  var selected = body.exam.subjects.find(function (s) { return s.id === body.subjectId; }) || body.exam.subjects[0];
  var difficulties = Array.isArray(result && result.exercises) ? result.exercises.map(function (ex) {
    return {
      number: ex.number,
      score: Number(ex.score || 0),
      maxScore: Number(ex.maxScore || 6.67),
      advice: String(ex.advice || '').slice(0, 500)
    };
  }) : [];

  await db.collection('users').doc(uid).collection('examResults').add({
    subject: SUBJECT_LABELS[body.exam.subject] || body.exam.subject,
    subjectKey: normalizeSubjectKey(body.exam.subject),
    subjectId: body.subjectId,
    chapter: body.exam.chapter || 'all',
    chapterTitle: (selected && selected.title) || 'Examen',
    score: Number((result && (result.score || result.totalScore)) || 0),
    totalScore: 20,
    percentage: Number((result && result.percentage) || Math.round((Number((result && result.score) || 0) / 20) * 100)),
    grade: (result && result.grade) || null,
    result: Object.assign({}, result, { exercises: difficulties }),
    difficulties: difficulties,
    answerCount: Object.values(body.answers || {}).filter(Boolean).length,
    examTitle: (selected && selected.title) || 'Examen',
    fromNotebook: Boolean(body.notebookContext),
    notebookChapterId: (body.notebookContext && body.notebookContext.chapterId) || null,
    createdAt: FieldValue.serverTimestamp(),
    date: FieldValue.serverTimestamp()
  });
}

function validateConfig(body) {
  var config = {
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
  if (config.exerciseCount !== REQUIRED_EXERCISES) return 'Chaque sujet doit contenir ' + REQUIRED_EXERCISES + ' exercices.';
  if (config.chapter.length > 100) return 'Chapitre invalide.';
  return null;
}

function validateCorrection(body) {
  if (!body.exam || !Array.isArray(body.exam.subjects) || !body.subjectId || !body.answers || typeof body.answers !== 'object') return 'Données de correction invalides.';
  if (JSON.stringify(body).length > 250000) return 'Examen trop volumineux.';
  return null;
}

var STRUCTURE_CONTROL = '\n' +
'═══════════════════════════════════════════════════════════════\n' +
'CONTRÔLE STRUCTUREL OBLIGATOIRE — AVANT DE RÉPONDRE\n' +
'═══════════════════════════════════════════════════════════════\n' +
'Vérifie que ton JSON contient EXACTEMENT :\n\n' +
'1. "subjects" : un tableau de 2 objets\n' +
'2. Chaque objet "subject" contient :\n' +
'   - "id" : "subject_1" ou "subject_2"\n' +
'   - "title" : "Sujet 1 — Consolidation" ou "Sujet 2 — Approfondissement"\n' +
'   - "level" : "consolidation" ou "approfondissement"\n' +
'   - "instructions" : "..."\n' +
'   - "exercises" : un tableau de EXACTEMENT ' + REQUIRED_EXERCISES + ' objets\n\n' +
'3. Chaque "exercise" contient :\n' +
'   - "number" : 1, 2 ou 3\n' +
'   - "title" : "..."\n' +
'   - "points" : 6.67\n' +
'   - "statement" : "..."\n' +
'   - "questions" : un tableau de EXACTEMENT ' + QUESTIONS_PER_EXERCISE + ' objets\n\n' +
'4. Chaque "question" contient :\n' +
'   - "number" : "1.a", "1.b", etc.\n' +
'   - "text" : "..."\n' +
'   - "points" : 1.33\n' +
'   - "type" : "choice" OU "text"\n' +
'   - SI "type"="choice" : "options" (4 objets) + "correctAnswer" (A, B, C ou D)\n' +
'   - SI "type"="text" : PAS de "options" et PAS de "correctAnswer"\n\n' +
'COMPTE MENTALEMENT : ' + REQUIRED_EXERCISES + ' exercices × ' + QUESTIONS_PER_EXERCISE + ' questions = ' + (REQUIRED_EXERCISES * QUESTIONS_PER_EXERCISE) + ' questions par sujet.\n\n' +
'Réponds UNIQUEMENT avec le JSON complet et valide.';

function generationPromptFromNotebook(config, notebookContext) {
  var subjectLabel = SUBJECT_LABELS[config.subject] || config.subject;
  var usesChoices = CHOICE_SUBJECTS.has(config.subject);
  var questionFormat = usesChoices
    ? 'Pour les questions de calcul, utilise type "choice" avec 4 propositions et correctAnswer A/B/C/D. Pour les questions de raisonnement, utilise type "text".'
    : 'Pour chaque question, utilise le type "text" sauf si c\'est un QCM explicite.';

  return 'Tu es un professeur expert du BAC au Niger, spécialiste de ' + subjectLabel + '.\n\n' +
    'L\'élève a étudié un chapitre précis dans son cahier. Génère DEUX sujets basés STRICTEMENT sur ce contenu.\n\n' +
    '═══════════════════════════════════════════════════════════════\n' +
    'CONTENU DU CHAPITRE ÉTUDIÉ PAR L\'ÉLÈVE\n' +
    '═══════════════════════════════════════════════════════════════\n' +
    'Chapitre : ' + notebookContext.chapterTitle + '\n' +
    'Matière : ' + subjectLabel + '\n' +
    'Sections : ' + notebookContext.sectionsCount + '\n\n' +
    notebookContext.contentText + '\n\n' +
    '═══════════════════════════════════════════════════════════════\n' +
    'RÈGLE ABSOLUE DE PÉRIMÈTRE\n' +
    '═══════════════════════════════════════════════════════════════\n' +
    '1. Génère UNIQUEMENT à partir du contenu ci-dessus.\n' +
    '2. INTERDICTION d\'inventer ou d\'ajouter des connaissances externes.\n' +
    '3. Chaque question doit être traçable au contenu.\n\n' +
    'SUJET 1 — "Consolidation" (facile à moyen) : notions de base.\n' +
    'SUJET 2 — "Approfondissement" (moyen à difficile) : angles exigeants.\n\n' +
    'RÈGLES LATEX : formules entre $...$ ou $$...$$. JAMAIS de symboles Unicode bruts.\n\n' +
    questionFormat + '\n\n' +
    'FORMAT JSON ATTENDU :\n' +
    '{\n' +
    '  "subject": "' + config.subject + '",\n' +
    '  "level": "' + config.level + '",\n' +
    '  "duration": ' + config.duration + ',\n' +
    '  "totalPoints": 20,\n' +
    '  "chapter": "' + config.chapter + '",\n' +
    '  "fromNotebook": true,\n' +
    '  "subjects": [\n' +
    '    {\n' +
    '      "id": "subject_1",\n' +
    '      "title": "Sujet 1 — Consolidation",\n' +
    '      "level": "consolidation",\n' +
    '      "instructions": "...",\n' +
    '      "exercises": [\n' +
    '        {\n' +
    '          "number": 1,\n' +
    '          "title": "...",\n' +
    '          "points": 6.67,\n' +
    '          "statement": "...",\n' +
    '          "questions": [\n' +
    '            {\n' +
    '              "number": "1.a",\n' +
    '              "text": "...",\n' +
    '              "points": 1.33,\n' +
    '              "type": "choice",\n' +
    '              "options": [{"id":"A","text":"..."},{"id":"B","text":"..."},{"id":"C","text":"..."},{"id":"D","text":"..."}],\n' +
    '              "correctAnswer": "A"\n' +
    '            }\n' +
    '          ]\n' +
    '        }\n' +
    '      ]\n' +
    '    },\n' +
    '    {\n' +
    '      "id": "subject_2",\n' +
    '      "title": "Sujet 2 — Approfondissement",\n' +
    '      "level": "approfondissement",\n' +
    '      "instructions": "...",\n' +
    '      "exercises": []\n' +
    '    }\n' +
    '  ]\n' +
    '}\n\n' +
    STRUCTURE_CONTROL;
}

function generationPrompt(config) {
  var subjectLabel = SUBJECT_LABELS[config.subject] || config.subject;
  var usesChoices = CHOICE_SUBJECTS.has(config.subject);
  var questionFormat = usesChoices
    ? 'Pour les questions de calcul, utilise type "choice" avec 4 propositions et correctAnswer A/B/C/D. Pour les questions de raisonnement, utilise type "text".'
    : 'Pour chaque question, utilise le type "text" sauf si c\'est un QCM explicite.';

  return 'Tu es un professeur expert du BAC au Niger, spécialiste de ' + subjectLabel + '.\n\n' +
    'Génère DEUX sujets d\'examen de niveau Terminale D.\n\n' +
    'Matière : ' + subjectLabel + '\n' +
    'Niveau : ' + config.level + '\n' +
    'Chapitre : ' + (config.chapter === 'all' ? 'tous les chapitres' : config.chapter) + '\n' +
    'Difficulté : ' + config.difficulty + '\n' +
    'Durée : ' + config.duration + ' minutes\n\n' +
    'SUJET 1 — Consolidation (facile à moyen).\n' +
    'SUJET 2 — Approfondissement (moyen à difficile).\n\n' +
    'RÈGLES LATEX : formules entre $...$ ou $$...$$.\n\n' +
    questionFormat + '\n\n' +
    'FORMAT JSON ATTENDU :\n' +
    '{\n' +
    '  "subject": "' + config.subject + '",\n' +
    '  "level": "' + config.level + '",\n' +
    '  "duration": ' + config.duration + ',\n' +
    '  "totalPoints": 20,\n' +
    '  "chapter": "' + config.chapter + '",\n' +
    '  "fromNotebook": false,\n' +
    '  "subjects": [\n' +
    '    { "id": "subject_1", "title": "Sujet 1 — Consolidation", "level": "consolidation", "instructions": "...", "exercises": [] },\n' +
    '    { "id": "subject_2", "title": "Sujet 2 — Approfondissement", "level": "approfondissement", "instructions": "...", "exercises": [] }\n' +
    '  ]\n' +
    '}\n\n' +
    STRUCTURE_CONTROL;
}

function correctionPrompt(body) {
  var subject = body.exam.subjects.find(function (s) { return s.id === body.subjectId; });
  if (!subject) throw new Error('subject_not_found');

  var questionsDetail = [];
  subject.exercises.forEach(function (exercise, exIdx) {
    exercise.questions.forEach(function (question, qIdx) {
      var key = body.subjectId + ':' + exIdx + ':' + qIdx;
      var studentAnswer = body.answers[key] || null;
      questionsDetail.push({
        exerciseNumber: exercise.number || (exIdx + 1),
        questionNumber: question.number || ((exIdx + 1) + '.' + (qIdx + 1)),
        questionText: question.text,
        type: question.type || 'text',
        points: Number(question.points) || 1.33,
        correctAnswer: question.correctAnswer || null,
        studentAnswer: studentAnswer,
        answered: studentAnswer !== null && studentAnswer !== ''
      });
    });
  });

  return 'Tu es un professeur correcteur expert du BAC au Niger.\n\n' +
    'MISSION : Corrige chaque question et attribue les points.\n\n' +
    'RÈGLES :\n' +
    '- QCM : réponse exacte = tous les points, sinon 0\n' +
    '- Texte libre : évalue le fond, la méthode, la rigueur\n' +
    '- Réponse vide : 0 point\n\n' +
    'DONNÉES :\n' +
    JSON.stringify(questionsDetail, null, 2) + '\n\n' +
    'FORMAT JSON :\n' +
    '{\n' +
    '  "score": 0, "totalScore": 20, "percentage": 0, "grade": "Insuffisant",\n' +
    '  "exercises": [\n' +
    '    { "number": 1, "title": "...", "score": 5.0, "maxScore": 6.67, "correctAnswers": 3, "totalQuestions": 5,\n' +
    '      "questions": [ { "number": "1.1", "questionText": "...", "type": "choice", "studentAnswer": "B", "correctAnswer": "A",\n' +
    '        "points": 1.33, "maxPoints": 1.33, "status": "correct", "feedback": "🎉 Bravo !", "betterMethod": "...", "toReview": null } ],\n' +
    '      "explanation": "...", "advice": "..." }\n' +
    '  ],\n' +
    '  "revisionTopics": ["..."],\n' +
    '  "globalFeedback": { "strengths": ["..."], "weaknesses": ["..."], "encouragement": "..." }\n' +
    '}\n\n' +
    'Réponds UNIQUEMENT avec l\'objet JSON.';
}

function repairExamStructure(exam, subjectName) {
  if (!exam || typeof exam !== 'object') return null;

  var supportsChoices = CHOICE_SUBJECTS.has(subjectName);

  if (!Array.isArray(exam.subjects)) {
    if (Array.isArray(exam.exams)) exam.subjects = exam.exams;
    else if (Array.isArray(exam.sujets)) exam.subjects = exam.sujets;
    else return null;
  }

  if (exam.subjects.length === 0) return null;

  if (exam.subjects.length === 1) {
    var first = exam.subjects[0];
    var copy = JSON.parse(JSON.stringify(first));
    copy.id = 'subject_2';
    copy.title = (first.title || 'Sujet 1').replace('Consolidation', 'Approfondissement');
    copy.level = 'approfondissement';
    copy.instructions = 'Ce sujet approfondit votre maîtrise.';
    exam.subjects.push(copy);
  }

  exam.subjects = exam.subjects.slice(0, 2);

  exam.subjects.forEach(function (subject, sIdx) {
    if (!subject.id) subject.id = 'subject_' + (sIdx + 1);
    if (!subject.title) subject.title = 'Sujet ' + (sIdx + 1);
    if (!subject.level) subject.level = sIdx === 0 ? 'consolidation' : 'approfondissement';
    if (!subject.instructions) subject.instructions = 'Traitez le sujet dans le temps imparti.';

    if (!Array.isArray(subject.exercises)) {
      if (Array.isArray(subject.exos)) subject.exercises = subject.exos;
      else if (Array.isArray(subject.problems)) subject.exercises = subject.problems;
      else subject.exercises = [];
    }

    while (subject.exercises.length < REQUIRED_EXERCISES) {
      var num = subject.exercises.length + 1;
      subject.exercises.push({
        number: num,
        title: 'Exercice ' + num,
        points: 6.67,
        statement: 'Traitez l\'exercice ' + num + ' en détaillant votre raisonnement.',
        questions: []
      });
    }

    subject.exercises = subject.exercises.slice(0, REQUIRED_EXERCISES);

    subject.exercises.forEach(function (exercise, eIdx) {
      if (!exercise.number) exercise.number = eIdx + 1;
      if (!exercise.title) exercise.title = 'Exercice ' + (eIdx + 1);
      if (!exercise.points) exercise.points = 6.67;
      if (!exercise.statement) exercise.statement = 'Traitez cet exercice.';

      if (!Array.isArray(exercise.questions)) {
        if (Array.isArray(exercise.items)) exercise.questions = exercise.items;
        else exercise.questions = [];
      }

      while (exercise.questions.length < QUESTIONS_PER_EXERCISE) {
        var qNum = exercise.questions.length + 1;
        exercise.questions.push({
          number: (eIdx + 1) + '.' + String.fromCharCode(96 + qNum),
          text: 'Question ' + qNum + ' de l\'exercice ' + (eIdx + 1) + '.',
          points: 1.33,
          type: 'text'
        });
      }

      exercise.questions = exercise.questions.slice(0, QUESTIONS_PER_EXERCISE);

      exercise.questions.forEach(function (question, qIdx) {
        if (!question.number) question.number = (eIdx + 1) + '.' + String.fromCharCode(97 + qIdx);
        if (!question.text) question.text = question.question || 'Question';
        if (!question.points) question.points = 1.33;

        if (!question.type) {
          question.type = (Array.isArray(question.options) && question.options.length === 4) ? 'choice' : 'text';
        }
if (question.type === 'choice') {
  // ⚡ Si options absentes ou mauvais format → convertir en texte libre
  if (!Array.isArray(question.options) || question.options.length !== 4) {
    question.type = 'text';
    delete question.options;
    delete question.correctAnswer;
  } else {
    // ⚡ Normaliser les options (forcé A/B/C/D)
    var letters = ['A', 'B', 'C', 'D'];
    question.options = question.options.map(function (opt, oi) {
      var text = '';
      if (typeof opt === 'string') text = opt;
      else if (opt && typeof opt === 'object') text = opt.text || opt.label || opt.value || String(opt);
      else text = String(opt || '');
      return { id: letters[oi], text: String(text || '').trim() || ('Réponse ' + letters[oi]) };
    });

    // ⚡ Normaliser la bonne réponse
    var correct = question.correctAnswer;
    if (correct === null || correct === undefined) {
      correct = 'A';
    } else if (typeof correct === 'number') {
      correct = letters[correct] || 'A';
    } else {
      correct = String(correct).toUpperCase().trim();
      // Si c'est un texte au lieu d'une lettre → chercher la bonne lettre
      if (['A', 'B', 'C', 'D'].indexOf(correct) === -1) {
        // Chercher l'option dont le texte correspond
        var matchIdx = -1;
        for (var m = 0; m < question.options.length; m++) {
          if (question.options[m].text === String(question.correctAnswer)) { matchIdx = m; break; }
        }
        correct = matchIdx !== -1 ? letters[matchIdx] : 'A';
      }
    }
    question.correctAnswer = correct;
  }
}
        else {
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
  var supportsChoices = CHOICE_SUBJECTS.has(subjectName);
  var validQuestion = function (question) {
    if (!supportsChoices || question.type !== 'choice') {
      return ['text', 'number', 'formula', 'choice'].indexOf(question.type) !== -1;
    }
    return Array.isArray(question.options) && question.options.length === 4
      && question.options.every(function (option) { return option && option.id && option.text; })
      && ['A', 'B', 'C', 'D'].indexOf(question.correctAnswer) !== -1;
  };
  return exam && typeof exam === 'object' && Array.isArray(exam.subjects) && exam.subjects.length === 2
    && exam.subjects.every(function (subject) {
      return Array.isArray(subject.exercises) && subject.exercises.length === REQUIRED_EXERCISES
        && subject.exercises.every(function (exercise) {
          return Array.isArray(exercise.questions) && exercise.questions.length === QUESTIONS_PER_EXERCISE
            && exercise.questions.every(validQuestion);
        });
    });
}

async function generateWithFallback(prompt, subjectName) {
  var providers = getProviders();
  if (!providers.length) throw new Error('provider_missing');

  // ⚡ NOUVEAU : budget temps de 80 secondes
  var startTime = Date.now();
  var TIME_BUDGET_MS = 80000;

  var errors = [];
  for (var i = 0; i < providers.length; i++) {
    // ⚡ NOUVEAU : arrêter si on a déjà dépassé le budget
    var elapsed = Date.now() - startTime;
    if (elapsed > TIME_BUDGET_MS) {
      console.warn('[AI] Budget temps épuisé après ' + elapsed + 'ms — arrêt cascade');
      errors.push('time_budget_exceeded');
      break;
    }

    var provider = providers[i];
    try {
      console.log('[AI] Tentative ' + provider.name + '...');
      var rawExam = await callProvider(provider, prompt);

      // ⚡ Force la normalisation des options (A/B/C/D) MEME si structure valide
      rawExam = repairExamStructure(rawExam, subjectName);

      if (validateGeneratedExam(rawExam, subjectName)) {
        console.log('[AI] OK ' + provider.name + ' — structure valide');
        return { exam: rawExam, provider: provider.name };
      }

      console.log('[AI] FIX ' + provider.name + ' — tentative de réparation...');
      var repaired = repairExamStructure(rawExam, subjectName);

      if (repaired && validateGeneratedExam(repaired, subjectName)) {
        console.log('[AI] OK ' + provider.name + ' — réparation réussie');
        return { exam: repaired, provider: provider.name + ' (réparé)' };
      }

      errors.push(provider.name + ': structure invalide');
      console.warn('[AI] FAIL ' + provider.name + ' : structure invalide');
    } catch (error) {
      errors.push(provider.name + ': ' + error.message);
      console.warn('[AI] FAIL ' + provider.name + ' échec: ' + error.message);
    }
  }
  throw new Error('all_providers_failed: ' + errors.join(' | '));
}

async function correctWithFallback(prompt) {
  var providers = getProviders();
  if (!providers.length) throw new Error('provider_missing');
  var errors = [];
  for (var i = 0; i < providers.length; i++) {
    var provider = providers[i];
    try {
      console.log('[AI] Correction avec ' + provider.name + '...');
      var result = await callProvider(provider, prompt, 14000);
      if (result && typeof result === 'object' && Array.isArray(result.exercises)) {
        console.log('[AI] OK ' + provider.name + ' — correction valide');
        return { result: result, provider: provider.name };
      }
      errors.push(provider.name + ': structure invalide');
    } catch (error) {
      errors.push(provider.name + ': ' + error.message);
      console.warn('[AI] FAIL ' + provider.name + ' correction échouée: ' + error.message);
    }
  }
  throw new Error('all_providers_failed: ' + errors.join(' | '));
}

function buildLocalExam(config) {
  var useChoices = CHOICE_SUBJECTS.has(config.subject);
  var options = useChoices ? [
    { id: 'A', text: 'Réponse A' }, { id: 'B', text: 'Réponse B' },
    { id: 'C', text: 'Réponse C' }, { id: 'D', text: 'Réponse D' }
  ] : null;
  var pointsPerExercise = Math.round((20 / REQUIRED_EXERCISES) * 100) / 100;
  var pointsPerQuestion = Math.round((pointsPerExercise / QUESTIONS_PER_EXERCISE) * 100) / 100;

  var buildSubjects = function (id, title, level, instructions) {
    var exercises = [];
    for (var exIdx = 0; exIdx < REQUIRED_EXERCISES; exIdx++) {
      var questions = [];
      for (var qIdx = 0; qIdx < QUESTIONS_PER_EXERCISE; qIdx++) {
        var q = {
          number: (exIdx + 1) + '.' + (qIdx + 1),
          text: 'Question ' + (qIdx + 1) + ' sur le thème ' + (config.chapter === 'all' ? 'principal' : config.chapter) + '.',
          points: pointsPerQuestion,
          type: useChoices ? 'choice' : 'text'
        };
        if (options) {
          q.options = options;
          q.correctAnswer = 'A';
        }
        questions.push(q);
      }
      exercises.push({
        number: exIdx + 1,
        title: 'Exercice ' + (exIdx + 1),
        points: pointsPerExercise,
        statement: 'Énoncé de l\'exercice ' + (exIdx + 1) + '. Montrez votre méthode.',
        questions: questions
      });
    }
    return { id: id, title: title, level: level, instructions: instructions, exercises: exercises };
  };

  return {
    subject: config.subject,
    level: config.level,
    duration: config.duration,
    totalPoints: 20,
    chapter: config.chapter,
    fromNotebook: false,
    subjects: [
      buildSubjects('subject_1', 'Sujet 1 — Consolidation', 'consolidation', 'Vérifie votre compréhension des notions essentielles.'),
      buildSubjects('subject_2', 'Sujet 2 — Approfondissement', 'approfondissement', 'Approfondit votre maîtrise.')
    ]
  };
}

function correctQCMDeterministic(subject, subjectId, answers) {
  var exercises = [];
  subject.exercises.forEach(function (exercise, exIdx) {
    var exerciseResult = {
      number: exercise.number || (exIdx + 1),
      title: exercise.title || ('Exercice ' + (exIdx + 1)),
      score: 0, maxScore: 0, correctAnswers: 0,
      totalQuestions: exercise.questions.length,
      questions: [], wrongAnswers: [], explanation: '', advice: ''
    };
    var textQuestions = [];

    exercise.questions.forEach(function (question, qIdx) {
      var key = subjectId + ':' + exIdx + ':' + qIdx;
      var studentAnswer = answers[key];
      var points = Number(question.points) || 1.33;
      exerciseResult.maxScore += points;

      var questionResult = {
        number: question.number || ((exIdx + 1) + '.' + (qIdx + 1)),
        questionText: question.text,
        type: question.type || 'text',
        studentAnswer: studentAnswer || null,
        correctAnswer: question.correctAnswer || null,
        points: 0, maxPoints: points, status: 'pending',
        feedback: '', betterMethod: null, toReview: null
      };

      if (question.type === 'choice' && question.correctAnswer) {
        if (studentAnswer === question.correctAnswer) {
          questionResult.status = 'correct';
          questionResult.points = points;
          exerciseResult.score += points;
          exerciseResult.correctAnswers++;
        } else if (!studentAnswer) {
          questionResult.status = 'unanswered';
        } else {
          questionResult.status = 'wrong';
          exerciseResult.wrongAnswers.push({
            number: questionResult.number,
            studentAnswer: studentAnswer, correctAnswer: question.correctAnswer, question: question.text
          });
        }
      } else {
        textQuestions.push({ exerciseIndex: exIdx, questionIndex: qIdx, questionResult: questionResult });
      }
      exerciseResult.questions.push(questionResult);
    });
    exercises.push({ exerciseResult: exerciseResult, textQuestions: textQuestions });
  });
  return exercises;
}

async function correctExamHybrid(exam, subjectId, answers, uid) {
  var subject = exam.subjects.find(function (s) { return s.id === subjectId; });
  if (!subject) throw new Error('subject_not_found');

  var deterministicResults = correctQCMDeterministic(subject, subjectId, answers);
  var hasTextQuestions = deterministicResults.some(function (r) { return r.textQuestions.length > 0; });

  if (hasTextQuestions) {
    try {
      var prompt = correctionPrompt({ exam: Object.assign({}, exam, { subjects: [subject] }), subjectId: subjectId, answers: answers });
      var aiResponse = await correctWithFallback(prompt);
      var aiResult = aiResponse.result;

      if (Array.isArray(aiResult && aiResult.exercises)) {
        aiResult.exercises.forEach(function (aiEx, exIdx) {
          var target = deterministicResults[exIdx];
          if (!target) return;
          var aiQuestions = Array.isArray(aiEx.questions) ? aiEx.questions : [];
          aiQuestions.forEach(function (aiQ) {
            var match = target.exerciseResult.questions.find(function (q) { return String(q.number) === String(aiQ.number); });
            if (!match) return;
            if (match.status === 'pending') {
              match.points = Number(aiQ.points) || 0;
              match.status = aiQ.status || (match.points > 0 ? 'correct' : 'wrong');
              if (match.status === 'correct') {
                target.exerciseResult.score += match.points;
                target.exerciseResult.correctAnswers++;
              }
            }
            match.feedback = aiQ.feedback || match.feedback;
            match.betterMethod = aiQ.betterMethod || match.betterMethod;
            match.toReview = aiQ.toReview || match.toReview;
            if (aiQ.correctAnswer) match.correctAnswer = aiQ.correctAnswer;
          });
          if (aiEx.explanation) target.exerciseResult.explanation = aiEx.explanation;
          if (aiEx.advice) target.exerciseResult.advice = aiEx.advice;
        });
      }
      if (Array.isArray(aiResult && aiResult.revisionTopics)) deterministicResults.revisionTopics = aiResult.revisionTopics;
      if (aiResult && aiResult.globalFeedback) deterministicResults.globalFeedback = aiResult.globalFeedback;
    } catch (error) {
      console.warn('AI correction failed, deterministic only:', error.message);
      deterministicResults.forEach(function (r) {
        r.textQuestions.forEach(function (tq) {
          tq.questionResult.status = 'unanswered';
          tq.questionResult.feedback = 'Correction IA temporairement indisponible. Réessaie plus tard.';
        });
        if (!r.exerciseResult.explanation) {
          r.exerciseResult.explanation = 'Correction partielle : QCM corrigés automatiquement.';
        }
      });
    }
  }

  var finalExercises = deterministicResults.map(function (r) { return r.exerciseResult; });
  var rawScore = finalExercises.reduce(function (sum, ex) { return sum + ex.score; }, 0);
  var score = Math.min(20, Math.round(rawScore * 100) / 100);
  var percentage = Math.round((score / 20) * 100);

  var grade = 'Insuffisant';
  if (percentage >= 90) grade = 'Excellent';
  else if (percentage >= 80) grade = 'Très bien';
  else if (percentage >= 70) grade = 'Bien';
  else if (percentage >= 60) grade = 'Assez bien';
  else if (percentage >= 50) grade = 'Passable';

  var revisionTopics = deterministicResults.revisionTopics || [];
  if (!revisionTopics.length) {
    finalExercises.forEach(function (ex) {
      if (ex.score < ex.maxScore * 0.5) revisionTopics.push('Revoir ' + (ex.title || ('Exercice ' + ex.number)));
    });
  }

  var globalFeedback = deterministicResults.globalFeedback || {
    strengths: [], weaknesses: [],
    encouragement: percentage >= 70 ? 'Bon travail global !' : 'Continue tes efforts.'
  };

  return { score: score, totalScore: 20, percentage: percentage, grade: grade, exercises: finalExercises, revisionTopics: revisionTopics, globalFeedback: globalFeedback };
}

module.exports = async function handler(request, response) {
  applyCors(request, response);
  if (request.method === 'OPTIONS') return response.status(204).end();
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return jsonError(response, 405, 'Méthode non autorisée.');
  }
  if (rateLimited(clientIp(request))) {
    return jsonError(response, 429, 'Vous avez atteint votre limite de génération.');
  }

  var firebaseConfigured = Boolean(process.env.FIREBASE_ADMIN_CREDENTIALS);
  var verifiedUser = null;
  try { verifiedUser = await verifyFirebaseToken(request); }
  catch (error) { console.error('Firebase token verification failed:', error.message); }

  if (!verifiedUser && !firebaseConfigured) verifiedUser = { uid: 'local-fallback-user' };
  else if (!verifiedUser) return jsonError(response, 401, 'Connexion requise.');

  var body = request.body && typeof request.body === 'object' ? request.body : {};
  var action = body.action || 'generate';

  if (action === 'generate') {
    var validationError = validateConfig(body);
    if (validationError) return jsonError(response, 400, validationError);

    if (!firebaseConfigured || verifiedUser.uid === 'local-fallback-user') {
      return response.status(200).json({ success: true, exam: buildLocalExam(body) });
    }

    var reservation;
    try { reservation = await reserveFreeGeneration(verifiedUser.uid); }
    catch (error) {
      console.error('Exam usage check failed:', error.message);
      return jsonError(response, 503, 'Vérification du quota indisponible.');
    }

    if (reservation.limitReached) {
      return response.status(429).json({
        success: false, error: 'Limite gratuite atteinte.',
        code: 'FREE_EXAM_LIMIT', used: reservation.used, limit: FREE_EXAM_LIMIT
      });
    }

    try {
      var providers = getProviders();
      console.log('[EXAM] ' + providers.length + ' fournisseur(s): ' + providers.map(function (p) { return p.name; }).join(', '));

      if (!providers.length) return response.status(200).json({ success: true, exam: buildLocalExam(body) });

      var notebookContext = null;
      if (body.notebookContext && (body.notebookContext.chapterId || body.notebookContext.chapterTitle)) {
        try {
          notebookContext = await loadNotebookContext(verifiedUser.uid, body.subject, body.notebookContext.chapterId, body.notebookContext.chapterTitle);
          if (notebookContext) console.log('[EXAM] Contexte cahier : ' + notebookContext.sectionsCount + ' sections');
        } catch (e) { console.warn('[EXAM] Erreur cahier:', e.message); }
      }

      var prompt = notebookContext ? generationPromptFromNotebook(body, notebookContext) : generationPrompt(body);
      console.log('[EXAM] Prompt: ' + prompt.length + ' caractères');

      var genResult = await generateWithFallback(prompt, body.subject);
      var exam = genResult.exam;
      var provider = genResult.provider;

      var examWithMeta = Object.assign({}, exam, {
        chapter: body.chapter,
        fromNotebook: Boolean(notebookContext),
        notebookSectionsCount: (notebookContext && notebookContext.sectionsCount) || 0
      });

      return response.status(200).json({
        success: true, exam: examWithMeta,
        meta: { provider: provider, fromNotebook: Boolean(notebookContext), sectionsUsed: (notebookContext && notebookContext.sectionsCount) || 0 }
      });
    } catch (error) {
      console.error('Exam generation failed:', error.message);
      if (reservation && reservation.reserved) {
        try { await releaseFreeGeneration(verifiedUser.uid, reservation.usageDate); } catch (_) {}
      }
      return response.status(200).json({ success: true, exam: buildLocalExam(body) });
    }
  }

  if (action === 'correct') {
    var validationErrorC = validateCorrection(body);
    if (validationErrorC) return jsonError(response, 400, validationErrorC);

    try {
      var result = await correctExamHybrid(body.exam, body.subjectId, body.answers, verifiedUser.uid);
      if (firebaseConfigured && verifiedUser.uid !== 'local-fallback-user') {
        try { await saveExamResult(verifiedUser.uid, body, result); }
        catch (e) { console.error('Exam result save failed:', e.message); }
      }
      return response.status(200).json({ success: true, result: result });
    } catch (error) {
      console.error('Exam correction failed:', error.message);
      return response.status(200).json({
        success: true,
        result: {
          score: 0, totalScore: 20, percentage: 0, grade: 'Indéterminé',
          exercises: [], revisionTopics: [],
          globalFeedback: { strengths: [], weaknesses: [], encouragement: 'Correction indisponible. Réessaie.' }
        }
      });
    }
  }

  return jsonError(response, 400, 'Action invalide.');
};
