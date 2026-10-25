// ================================================================
// ANALYTICS — ARVEXA School v3 (ultra-robuste, page-safe)
// Ne bloque JAMAIS la page. Toutes les erreurs sont silencieuses.
// ================================================================

(function () {
  'use strict';

  // ⚡ Protection : si déjà initialisé, on sort
  if (window.__arvexaAnalyticsInit) return;
  window.__arvexaAnalyticsInit = true;

  // ✅ PRIV — mécanisme d'opt-out conforme à la politique de confidentialité :
  // l'élève peut désactiver la télémétrie locale à tout moment :
  //   localStorage.setItem('arvexa_analytics_optout', '1')
  // (aucune donnée n'est collectée ni envoyée tant que ce drapeau est présent)
  try {
    if (localStorage.getItem('arvexa_analytics_optout') === '1'
        || navigator.doNotTrack === '1') {
      console.info('[Analytics] Collecte désactivée (opt-out).');
      return;
    }
  } catch (e) {}

  // ⚡ Protection globale : n'importe quelle erreur ici ne doit pas
  //    affecter la page
  try {

    // ─────────────────────────────────────────────────────────────
    // CONFIG
    // ─────────────────────────────────────────────────────────────
    const FIREBASE_CONFIG = {
      apiKey: "AIzaSyDHscOXw3rLuhV6z1Cny-bdYCumqpnG7QE",
      authDomain: "arvexa-fbf10.firebaseapp.com",
      projectId: "arvexa-fbf10",
      storageBucket: "arvexa-fbf10.firebasestorage.app",
      messagingSenderId: "920108330053",
      appId: "1:920108330053:web:f532d71cbc2c824bc7472c"
    };

    const START_DELAY = 3000;        // démarrer 3s après le chargement
    const FLUSH_INTERVAL = 30000;    // flush toutes les 30s
    const SESSION_TIMEOUT = 30 * 60 * 1000;
    const SESSION_KEY = 'arvexa_analytics_session';
    const LAST_ACTIVE_KEY = 'arvexa_analytics_last_active';

    // ─────────────────────────────────────────────────────────────
    // ÉTAT
    // ─────────────────────────────────────────────────────────────
    let firebase = null;
    let auth = null;
    let db = null;
    let currentUid = null;
    let queue = null;
    let flushTimer = null;
    let pageEntryTime = Date.now();
    let currentSessionId = null;
    let isFlushing = false;
    let isStarted = false;

    // ─────────────────────────────────────────────────────────────
    // UTILITAIRES
    // ─────────────────────────────────────────────────────────────
    const now = () => Date.now();

    const getDeviceType = () => {
      try {
        const w = window.innerWidth;
        if (w < 768) return 'mobile';
        if (w < 1024) return 'tablet';
        return 'desktop';
      } catch (e) { return 'unknown'; }
    };

    const getTimeOfDay = () => {
      try {
        const h = new Date().getHours();
        if (h < 6) return 'nuit';
        if (h < 12) return 'matin';
        if (h < 18) return 'apresmidi';
        if (h < 22) return 'soir';
        return 'nuit';
      } catch (e) { return 'matin'; }
    };

    const getDayOfWeek = () => {
      try {
        const days = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
        return days[new Date().getDay()];
      } catch (e) { return 'lundi'; }
    };

    const getTodayKey = () => {
      try { return new Date().toISOString().slice(0, 10); }
      catch (e) { return '2026-01-01'; }
    };

    const cleanKey = (s) => {
      try { return String(s || '').replace(/[.\/\s#?=&]/g, '_').slice(0, 60); }
      catch (e) { return 'unknown'; }
    };

    const detectPage = () => {
      try {
        const path = window.location.pathname
          .replace(/^\//, '')
          .replace(/\.html$/, '')
          .replace(/\/$/, '');
        return cleanKey(path || 'index');
      } catch (e) { return 'index'; }
    };

    const detectSubject = () => {
      try {
        const params = new URLSearchParams(window.location.search);
        return {
          subject: params.get('subject') || null,
          chapter: params.get('chapter') || null,
          tab: params.get('tab') || null
        };
      } catch (e) {
        return { subject: null, chapter: null, tab: null };
      }
    };

    // ─────────────────────────────────────────────────────────────
    // QUEUE
    // ─────────────────────────────────────────────────────────────
    function resetQueue() {
      queue = {
        date: getTodayKey(),
        pages: {},
        features: {},
        byTimeOfDay: {},
        byDayOfWeek: {},
        contents: {},
        results: [],
        totalTime: 0,
        sessions: 0,
        device: getDeviceType()
      };
    }

    // ─────────────────────────────────────────────────────────────
    // SESSION
    // ─────────────────────────────────────────────────────────────
    function initSession() {
      try {
        const last = parseInt(localStorage.getItem(LAST_ACTIVE_KEY) || '0', 10);
        const existing = localStorage.getItem(SESSION_KEY);

        if (!existing || (now() - last) > SESSION_TIMEOUT) {
          currentSessionId = 'sess_' + now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
          localStorage.setItem(SESSION_KEY, currentSessionId);
          if (queue) queue.sessions++;
        } else {
          currentSessionId = existing;
        }
        localStorage.setItem(LAST_ACTIVE_KEY, String(now()));
      } catch (e) {
        currentSessionId = 'sess_' + now();
      }
    }

    // ─────────────────────────────────────────────────────────────
    // TRACKERS
    // ─────────────────────────────────────────────────────────────
    function trackPageView() {
      try {
        if (!queue) resetQueue();
        const page = detectPage();
        queue.pages[page] = (queue.pages[page] || 0) + 1;
      } catch (e) {}
    }

    function trackTimeSpent() {
      try {
        if (!queue) resetQueue();
        const duration = Math.round((now() - pageEntryTime) / 1000);
        if (duration > 2 && duration < 3600) {
          queue.totalTime += duration;
          const tod = getTimeOfDay();
          const dow = getDayOfWeek();
          queue.byTimeOfDay[tod] = (queue.byTimeOfDay[tod] || 0) + duration;
          queue.byDayOfWeek[dow] = (queue.byDayOfWeek[dow] || 0) + duration;
        }
        pageEntryTime = now();
      } catch (e) {}
    }

    function trackAutoFeature() {
      try {
        if (!queue) resetQueue();
        const page = detectPage();

        const featureMap = {
          calculatrice: 'calculatrice',
          formulaires: 'formulaire',
          'tableau-periodique': 'tableau_periodique',
          exam: 'mode_examen',
          reviseur: 'reviseur',
          'arv-pilot': 'arv_pilot',
          groupe: 'groupe',
          planificateur: 'planificateur',
          abonnement: 'abonnement',
          profil: 'profil',
          notifications: 'notifications',
          lecture: 'lecture',
          chapitre: 'chapitre',
          matiere: 'matiere'
        };

        const feature = featureMap[page];
        if (feature) {
          queue.features[feature] = (queue.features[feature] || 0) + 1;
        }
      } catch (e) {}
    }

    function trackContent() {
      try {
        if (!queue) resetQueue();
        const info = detectSubject();
        if (info.subject) {
          const key = 'subject_' + cleanKey(info.subject);
          queue.contents[key] = (queue.contents[key] || 0) + 1;
        }
      } catch (e) {}
    }

    // ─────────────────────────────────────────────────────────────
    // FLUSH
    // ─────────────────────────────────────────────────────────────
    async function flush() {
      try {
        if (isFlushing || !queue || !currentUid || !db) return;

        const hasData =
          queue.totalTime > 0 ||
          Object.keys(queue.pages).length > 0 ||
          Object.keys(queue.features).length > 0 ||
          queue.results.length > 0;
        if (!hasData) return;

        isFlushing = true;

        const snapshot = JSON.parse(JSON.stringify(queue));
        const currentDate = snapshot.date;
        resetQueue();

        // Import dynamique (silencieux en cas d'échec)
        let doc, setDoc, addDoc, collection, serverTimestamp, increment;
        try {
          const fsMod = await import('https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js');
          doc = fsMod.doc;
          setDoc = fsMod.setDoc;
          addDoc = fsMod.addDoc;
          collection = fsMod.collection;
          serverTimestamp = fsMod.serverTimestamp;
          increment = fsMod.increment;
        } catch (e) {
          isFlushing = false;
          return;
        }

        const aggRef = doc(db, 'users', currentUid, 'analytics_daily', currentDate);

        const updates = {
          date: currentDate,
          device: snapshot.device,
          lastSeenAt: serverTimestamp()
        };

        Object.entries(snapshot.pages).forEach(([k, v]) => {
          updates[`pages.${k}`] = increment(v);
        });
        Object.entries(snapshot.features).forEach(([k, v]) => {
          updates[`features.${k}`] = increment(v);
        });
        Object.entries(snapshot.byTimeOfDay).forEach(([k, v]) => {
          updates[`byTimeOfDay.${k}`] = increment(v);
        });
        Object.entries(snapshot.byDayOfWeek).forEach(([k, v]) => {
          updates[`byDayOfWeek.${k}`] = increment(v);
        });
        Object.entries(snapshot.contents).forEach(([k, v]) => {
          updates[`contents.${k}`] = increment(v);
        });

        if (snapshot.totalTime > 0) updates.totalTime = increment(snapshot.totalTime);
        if (snapshot.sessions > 0) updates.sessions = increment(snapshot.sessions);

        if (snapshot.results.length > 0) {
          const resultsRef = collection(db, 'users', currentUid, 'analytics_daily', currentDate, 'results');
          await Promise.all(
            snapshot.results.map((r) =>
              addDoc(resultsRef, { ...r, createdAt: serverTimestamp() }).catch(() => {})
            )
          );
          updates.resultsCount = increment(snapshot.results.length);
        }

        await setDoc(aggRef, updates, { merge: true });
      } catch (e) {
        // silencieux
      } finally {
        isFlushing = false;
      }
    }

    // ─────────────────────────────────────────────────────────────
    // LIFECYCLE
    // ─────────────────────────────────────────────────────────────
    function startFlushTimer() {
      try {
        if (flushTimer) clearInterval(flushTimer);
        flushTimer = setInterval(() => {
          try { trackTimeSpent(); } catch (e) {}
          flush();
        }, FLUSH_INTERVAL);
      } catch (e) {}
    }

    function bindLifecycle() {
      try {
        document.addEventListener('visibilitychange', () => {
          try {
            if (document.visibilityState === 'hidden') {
              trackTimeSpent();
              flush();
            } else {
              pageEntryTime = now();
              initSession();
            }
          } catch (e) {}
        });

        window.addEventListener('beforeunload', () => {
          try { trackTimeSpent(); flush(); } catch (e) {}
        });

        window.addEventListener('online', () => {
          try { flush(); } catch (e) {}
        });
      } catch (e) {}
    }

    // ─────────────────────────────────────────────────────────────
    // DÉMARRAGE
    // ─────────────────────────────────────────────────────────────
 // ⚡ Liste des emails admin à exclure du tracking
const ADMIN_EMAILS = ['gagneavecia@gmail.com'];

async function isAdminUser(uid) {
  try {
    // Lire le rôle dans Firestore
    const fsMod = await import('https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js');
    const userRef = fsMod.doc(db, 'users', uid);
    const snap = await fsMod.getDoc(userRef);
    if (!snap.exists()) return false;
    const data = snap.data();
    if (data.role === 'admin') return true;
    if (data.email && ADMIN_EMAILS.includes(data.email)) return true;
    return false;
  } catch (e) {
    console.warn('[Analytics] isAdminUser error:', e.message);
    return false;
  }
}

async function startTracking(uid) {
  try {
    // ⚡ Vérifier si c'est un admin → ne rien tracker
    const isAdmin = await isAdminUser(uid);
    if (isAdmin) {
      console.log('📊 [Analytics] Admin détecté → tracking désactivé');
      return;
    }

    currentUid = uid;
    resetQueue();
    initSession();
    trackPageView();
    trackAutoFeature();
    trackContent();
    startFlushTimer();
    flush();
    isStarted = true;
    console.log('📊 [Analytics] Tracking actif pour', uid);
  } catch (e) {
    console.warn('[Analytics] startTracking error:', e.message);
  }
}

    function stopTracking() {
      try {
        trackTimeSpent();
        flush().finally(() => {
          currentUid = null;
          if (flushTimer) clearInterval(flushTimer);
          isStarted = false;
        });
      } catch (e) {}
    }

    // ─────────────────────────────────────────────────────────────
    // INITIALISATION FIREBASE (silencieuse, robuste)
    // ─────────────────────────────────────────────────────────────
    async function initFirebase() {
      try {
        // Import dynamique des modules Firebase
        const appMod = await import('https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js');
        const authMod = await import('https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js');
        const fsMod = await import('https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js');

        const initializeApp = appMod.initializeApp;
        const getApps = appMod.getApps;
        const getApp = appMod.getApp;
        const getAuth = authMod.getAuth;
        const onAuthStateChanged = authMod.onAuthStateChanged;
        const initializeFirestore = fsMod.initializeFirestore;
        const persistentLocalCache = fsMod.persistentLocalCache;
        const persistentSingleTabManager = fsMod.persistentSingleTabManager;
        const getFirestore = fsMod.getFirestore;

        // Réutiliser l'app existante si possible, sinon créer
        const app = (getApps && getApps().length > 0)
          ? getApp()
          : initializeApp(FIREBASE_CONFIG);

        auth = getAuth(app);

        try {
          db = initializeFirestore(app, {
            localCache: persistentLocalCache({
              tabManager: persistentSingleTabManager()
            })
          });
        } catch (e) {
          // Si déjà initialisé → récupérer l'instance
          db = getFirestore(app);
        }

        // Écouter l'utilisateur Firebase
        onAuthStateChanged(auth, (user) => {
          try {
            if (user && (!currentUid || currentUid !== user.uid)) {
              startTracking(user.uid);
            } else if (!user && currentUid) {
              stopTracking();
            }
          } catch (e) {}
        });

        console.log('📊 [Analytics] Firebase prêt (attente auth)');
      } catch (e) {
        console.warn('[Analytics] Init échouée (silencieux):', e.message);
        // On abandonne silencieusement, la page continue normalement
      }
    }

    // ─────────────────────────────────────────────────────────────
    // LANCEMENT DIFFÉRÉ (pour ne pas ralentir la page)
    // ─────────────────────────────────────────────────────────────
    function boot() {
      // Attendre 3 secondes avant de démarrer
      setTimeout(() => {
        initFirebase();
      }, START_DELAY);

      bindLifecycle();
    }

    // Démarrer quand le DOM est prêt
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot);
    } else {
      boot();
    }

    // ─────────────────────────────────────────────────────────────
    // API PUBLIQUE (optionnelle, pour les pages qui veulent tracker plus)
    // ─────────────────────────────────────────────────────────────
    window.arvexaAnalytics = {
      trackResult: (data) => {
        try {
          if (!queue) resetQueue();
          queue.results.push({
            kind: cleanKey(data.kind),
            subject: cleanKey(data.subject || ''),
            score: Number(data.score) || 0,
            total: Number(data.total) || 0,
            difficulty: data.difficulty ? cleanKey(data.difficulty) : null,
            ts: now()
          });
          if (queue.results.length > 50) queue.results = queue.results.slice(-50);
        } catch (e) {}
      },
      trackFeature: (name, extra) => {
        try {
          if (!queue) resetQueue();
          const key = cleanKey(name);
          queue.features[key] = (queue.features[key] || 0) + 1;
        } catch (e) {}
      },
      trackContent: (data) => {
        try {
          if (!queue) resetQueue();
          if (data.subject) {
            const key = 'subject_' + cleanKey(data.subject);
            queue.contents[key] = (queue.contents[key] || 0) + 1;
          }
        } catch (e) {}
      },
      flush: () => { try { flush(); } catch (e) {} },
      _queue: () => { try { return JSON.parse(JSON.stringify(queue || {})); } catch (e) { return {}; } },
      _uid: () => currentUid
    };

    console.log('📊 ARVEXA Analytics v3 (ultra-robuste) — démarrage dans 3s');

  } catch (globalError) {
    // ⚡ N'importe quelle erreur → silencieux total, la page n'est PAS affectée
    console.warn('[Analytics] Erreur globale (page protégée):', globalError.message);
  }

})();
