// ================================================================
// ARVEXA AUTH CORE — Noyau blindé + Guard + Bootstrap
// Version : 1.1.0 — chargement conditionnel
// ================================================================
// Injection dans une page :
//   <script src="arvexa-auth-core.js" defer></script>
//
// NOUVEAU en v1.1.0 :
//   - Overlay UNIQUEMENT si aucune preuve de session n'existe
//   - Rendu immédiat si cache présent (localStorage ou currentUser)
//   - Marqueur sessionStorage 'arvexa_auth_ready' pour éviter l'overlay
//     lors des navigations entre pages du même onglet
//   - Correction silencieuse si Firebase contredit le cache
// ================================================================

(function () {
  'use strict';

  if (window.__arvexaAuthCoreLoaded) {
    console.warn('[AuthCore] Déjà chargé — ignoré');
    return;
  }
  window.__arvexaAuthCoreLoaded = true;

  // ────────────────────────────────────────────────────────────
  // CONFIG
  // ────────────────────────────────────────────────────────────
  const FIREBASE_CONFIG = {
    apiKey: "AIzaSyDHscOXw3rLuhV6z1Cny-bdYCumqpnG7QE",
    authDomain: "arvexa-fbf10.firebaseapp.com",
    projectId: "arvexa-fbf10",
    storageBucket: "arvexa-fbf10.firebasestorage.app",
    messagingSenderId: "920108330053",
    appId: "1:920108330053:web:f532d71cbc2c824bc7472c"
  };

  const SESSION_KEY = 'arvexa_session';
  const USER_DATA_KEY = 'arvexa_user_data';
  const LAST_UID_KEY = 'arvexa_last_uid';
  const AUTH_READY_KEY = 'arvexa_auth_ready';           // ✅ NEW — marqueur par onglet
  const REDIRECT_KEY_LOGIN = 'redirectAfterLogin';
  const REDIRECT_KEY_AUTH = 'redirectAfterAuth';

  const GRACE_MS = 1200;
  const EXTRA_GRACE_MS = 1500;
  const MAX_TIMER_MS = 5000;
  const HEARTBEAT_MS = 30000;
  const REDIRECT_LOCK_MS = 3000;
  const OVERLAY_SAFETY_MS = 2500;  // ✅ Overlay auto-retiré après 2,5 s max

  const PUBLIC_PATHS = [
    'login', 'register', 'forgot-password', 'auth-choice',
    'onboarding', 'conditions', 'confidentialite', 'offline',
    '404', 'diagnostic'
  ];

  // ────────────────────────────────────────────────────────────
  // ÉTAT INTERNE
  // ────────────────────────────────────────────────────────────
  let _app = null;
  let _auth = null;
  let _db = null;
  let _currentUser = null;
  let _currentUserData = null;
  let _isAuthResolved = false;
  let _graceTimer = null;
  let _extraGraceTimer = null;
  let _maxTimer = null;
  let _heartbeatTimer = null;
  let _redirectLockTimer = null;
  let _overlaySafetyTimer = null;
  let _isRedirecting = false;
  let _listeners = [];
  let _subscribed = false;
  let _initPromise = null;
  let _modules = null;

  // ────────────────────────────────────────────────────────────
  // HELPERS PRÉCOCES (avant Firebase)
  // ────────────────────────────────────────────────────────────
  function isPublicPage() {
    const path = location.pathname.toLowerCase();
    return PUBLIC_PATHS.some(p => path.includes(p));
  }

  function readSession() {
    try {
      const session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      const userData = JSON.parse(localStorage.getItem(USER_DATA_KEY) || 'null');
      const lastUid = localStorage.getItem(LAST_UID_KEY);
      return { session, userData, lastUid };
    } catch (e) {
      return { session: null, userData: null, lastUid: null };
    }
  }

  // ✅ NEW — La session est-elle déjà confirmée dans CET onglet ?
  function isSessionConfirmedInTab() {
    try {
      return sessionStorage.getItem(AUTH_READY_KEY) === '1';
    } catch (e) {
      return false;
    }
  }

  // ✅ NEW — Marquer la session comme confirmée dans cet onglet
  function markSessionConfirmedInTab() {
    try {
      sessionStorage.setItem(AUTH_READY_KEY, '1');
    } catch (e) {}
  }

  // ✅ NEW — Retirer le marqueur (déconnexion)
  function unmarkSessionConfirmedInTab() {
    try {
      sessionStorage.removeItem(AUTH_READY_KEY);
    } catch (e) {}
  }

  // ✅ NEW — Décider si on doit afficher l'overlay
  function shouldShowOverlay() {
    // Jamais sur les pages publiques
    if (isPublicPage()) return false;

    // Jamais si déjà confirmé dans cet onglet
    if (isSessionConfirmedInTab()) return false;

    // Jamais si cache complet présent
    const { session, userData } = readSession();
    if (session && session.uid && userData) {
      return false;  // On a tout en cache → rendu immédiat
    }

    // Sinon : première visite dans cet onglet sans cache complet → overlay
    return true;
  }

  // ────────────────────────────────────────────────────────────
  // UTILITAIRES
  // ────────────────────────────────────────────────────────────
  function isNetworkError(error) {
    if (!error) return false;
    const code = error.code || '';
    return (
      code === 'auth/network-request-failed' ||
      code === 'auth/timeout' ||
      code === 'auth/internal-error' ||
      /network|fetch|offline|timeout/i.test(error.message || '')
    );
  }

  function isFatalAuthError(error) {
    if (!error) return false;
    const code = error.code || '';
    return (
      code === 'auth/user-disabled' ||
      code === 'auth/user-not-found' ||
      code === 'auth/invalid-user-token' ||
      code === 'auth/user-token-expired' ||
      code === 'auth/requires-recent-login'
    );
  }

  function persistSession(user, userData) {
    if (!user) return;
    try {
      const sessionData = {
        uid: user.uid,
        email: user.email || '',
        lastActive: Date.now()
      };
      localStorage.setItem(SESSION_KEY, JSON.stringify(sessionData));
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(sessionData));
      localStorage.setItem(LAST_UID_KEY, user.uid);

      if (userData) {
        localStorage.setItem(USER_DATA_KEY, JSON.stringify({
          ...userData,
          _uid: user.uid,
          _cachedAt: Date.now()
        }));
      }
    } catch (e) {
      console.warn('[AuthCore] persistSession:', e.message);
    }
  }

  function clearSession() {
    try {
      localStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(USER_DATA_KEY);
      localStorage.removeItem(LAST_UID_KEY);
      sessionStorage.removeItem(SESSION_KEY);
      sessionStorage.removeItem(REDIRECT_KEY_LOGIN);
      sessionStorage.removeItem(REDIRECT_KEY_AUTH);
      sessionStorage.removeItem(AUTH_READY_KEY);
    } catch (e) {
      console.warn('[AuthCore] clearSession:', e.message);
    }
  }

  function getCachedUserData(uid) {
    try {
      const cached = JSON.parse(localStorage.getItem(USER_DATA_KEY) || 'null');
      if (!cached) return null;
      if (cached._uid && uid && cached._uid !== uid) {
        localStorage.removeItem(USER_DATA_KEY);
        return null;
      }
      return cached;
    } catch (e) {
      return null;
    }
  }

  function safeRedirect(url) {
    if (_isRedirecting) {
      console.warn('[AuthCore] Redirection ignorée (déjà en cours):', url);
      return;
    }
    _isRedirecting = true;

    if (_graceTimer) { clearTimeout(_graceTimer); _graceTimer = null; }
    if (_extraGraceTimer) { clearTimeout(_extraGraceTimer); _extraGraceTimer = null; }
    if (_maxTimer) { clearTimeout(_maxTimer); _maxTimer = null; }
    if (_heartbeatTimer) { clearInterval(_heartbeatTimer); _heartbeatTimer = null; }
    if (_overlaySafetyTimer) { clearTimeout(_overlaySafetyTimer); _overlaySafetyTimer = null; }

    if (_redirectLockTimer) { clearTimeout(_redirectLockTimer); }
    _redirectLockTimer = setTimeout(() => { _isRedirecting = false; }, REDIRECT_LOCK_MS);

    console.warn('[AuthCore] Redirection vers:', url);
    window.location.replace(url);
  }

  function getRedirectTarget() {
    try {
      const raw = sessionStorage.getItem(REDIRECT_KEY_LOGIN)
               || sessionStorage.getItem(REDIRECT_KEY_AUTH);
      if (!raw || typeof raw !== 'string') return 'index.html';
      const lower = raw.toLowerCase();
      const forbidden = ['login.html', 'auth-choice.html', 'register.html', 'forgot-password.html'];
      if (forbidden.some(f => lower.includes(f))) return 'index.html';
      if (/^https?:\/\//i.test(raw)) return 'index.html';
      if (/^javascript:/i.test(raw)) return 'index.html';
      if (raw.startsWith('//')) return 'index.html';
      return raw;
    } catch (e) {
      return 'index.html';
    }
  }

  function saveRedirectTarget(url) {
    try {
      const existing = sessionStorage.getItem(REDIRECT_KEY_LOGIN)
                    || sessionStorage.getItem(REDIRECT_KEY_AUTH);
      if (!existing) {
        sessionStorage.setItem(REDIRECT_KEY_LOGIN, url);
      }
    } catch (e) {}
  }

  function notifyListeners(event, payload) {
    const snapshot = _listeners.slice();
    snapshot.forEach(({ handler, once, id, event: evt }) => {
      if (evt !== event && evt !== '*') return;
      try { handler(event, payload); }
      catch (e) { console.warn('[AuthCore] listener error:', e); }
      if (once) {
        const idx = _listeners.findIndex(l => l.id === id);
        if (idx !== -1) _listeners.splice(idx, 1);
      }
    });
  }

  // ────────────────────────────────────────────────────────────
  // OVERLAY — UNIQUEMENT SI NÉCESSAIRE
  // ────────────────────────────────────────────────────────────
  function showBootOverlay() {
    if (document.getElementById('__arvexa_boot_overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = '__arvexa_boot_overlay';
    overlay.style.cssText = `
      position: fixed; inset: 0; z-index: 999999;
      background: #0A0A0A;
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      gap: 20px; opacity: 1;
      transition: opacity 0.25s ease;
      pointer-events: auto;
    `;
    overlay.innerHTML = `
      <div style="
        width: 44px; height: 44px;
        border: 3px solid rgba(184,134,11,0.15);
        border-top-color: #E0B84A;
        border-radius: 50%;
        animation: __arvexa_boot_spin 0.8s linear infinite;
      "></div>
      <div style="
        font-family: 'Playfair Display', Georgia, serif;
        font-size: 17px; font-weight: 700;
        color: #F5F0E8; letter-spacing: 0.05em;
      ">ARVEXA School</div>
    `;

    if (!document.getElementById('__arvexa_boot_style')) {
      const style = document.createElement('style');
      style.id = '__arvexa_boot_style';
      style.textContent = `@keyframes __arvexa_boot_spin { to { transform: rotate(360deg); } }`;
      document.head.appendChild(style);
    }

    if (document.body) {
      document.body.appendChild(overlay);
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        document.body.appendChild(overlay);
      }, { once: true });
    }

    // ✅ Safety : retirer dans TOUS les cas après 2,5 s
    if (_overlaySafetyTimer) clearTimeout(_overlaySafetyTimer);
    _overlaySafetyTimer = setTimeout(() => {
      console.warn('[AuthCore] Overlay retiré par sécurité (timeout)');
      removeBootOverlay();
    }, OVERLAY_SAFETY_MS);
  }

  function removeBootOverlay() {
    const el = document.getElementById('__arvexa_boot_overlay');
    if (!el) return;
    if (_overlaySafetyTimer) { clearTimeout(_overlaySafetyTimer); _overlaySafetyTimer = null; }
    el.style.opacity = '0';
    setTimeout(() => {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 250);
  }

  // ────────────────────────────────────────────────────────────
  // BANDEAU "COMPTE EN PAUSE"
  // ────────────────────────────────────────────────────────────
  function showPausedBanner() {
    if (document.getElementById('__arvexa_paused_banner')) return;
    const banner = document.createElement('div');
    banner.id = '__arvexa_paused_banner';
    banner.style.cssText = `
      position: fixed;
      top: calc(16px + env(safe-area-inset-top, 0px));
      left: 50%;
      transform: translateX(-50%);
      max-width: calc(100% - 32px);
      width: 440px;
      background: rgba(184, 92, 58, 0.95);
      color: #fff;
      padding: 12px 18px;
      border-radius: 12px;
      font-family: 'Inter', sans-serif;
      font-size: 13px;
      font-weight: 500;
      z-index: 999998;
      box-shadow: 0 8px 30px rgba(0,0,0,0.4);
      display: flex;
      align-items: center;
      gap: 10px;
    `;
    banner.innerHTML = `
      <span style="font-size:16px;">⏸️</span>
      <span style="flex:1;">Ton compte est temporairement en pause. Contacte le support.</span>
      <button type="button" style="
        background: transparent; border: none;
        color: #fff; cursor: pointer;
        font-size: 16px; padding: 0 4px;
      ">×</button>
    `;
    banner.querySelector('button').addEventListener('click', () => banner.remove());
    document.body.appendChild(banner);
  }

  // ────────────────────────────────────────────────────────────
  // MODULES FIREBASE
  // ────────────────────────────────────────────────────────────
  async function loadModules() {
    if (_modules) return _modules;
    const [
      { initializeApp, getApps },
      authMod,
      firestoreMod
    ] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js'),
      import('https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js')
    ]);
    _modules = {
      initializeApp, getApps,
      ...authMod,
      ...firestoreMod
    };
    return _modules;
  }

  async function initFirebase() {
    if (_app && _auth && _db) return { app: _app, auth: _auth, db: _db };
    const M = await loadModules();
    const existing = M.getApps().find(a => a.name === '[DEFAULT]');
    _app = existing || M.initializeApp(FIREBASE_CONFIG);
    _auth = M.getAuth(_app);
    try {
      _db = M.initializeFirestore(_app, {
        localCache: M.persistentLocalCache({
          tabManager: M.persistentSingleTabManager()
        })
      });
    } catch (e) {
      _db = M.getFirestore(_app);
      console.warn('[AuthCore] Firestore déjà initialisé:', e.message);
    }
    M.setPersistence(_auth, M.browserLocalPersistence).catch(e => {
      console.warn('[AuthCore] Persistance locale indisponible:', e.code || e.message);
    });
    console.log('[AuthCore] Firebase initialisé');
    return { app: _app, auth: _auth, db: _db };
  }

  // ────────────────────────────────────────────────────────────
  // CHECK ACCOUNT STATUS
  // ────────────────────────────────────────────────────────────
  async function checkAccountStatus(user) {
    if (!user || !_db) return { status: 'unknown' };
    const M = _modules;
    try {
      const ref = M.doc(_db, 'users', user.uid);
      const snap = await M.getDoc(ref);
      if (!snap.exists()) return { status: 'no-profile' };
      const data = snap.data();
      _currentUserData = data;
      try {
        localStorage.setItem(USER_DATA_KEY, JSON.stringify({
          ...data,
          _uid: user.uid,
          _cachedAt: Date.now()
        }));
      } catch (e) {}
      if (data.accountStatus === 'blocked') return { status: 'blocked', data };
      if (data.accountStatus === 'paused') return { status: 'paused', data };
      return { status: 'active', data };
    } catch (e) {
      console.warn('[AuthCore] checkAccountStatus:', e.code || e.message);
      if (isNetworkError(e)) return { status: 'network-error' };
      return { status: 'error', error: e };
    }
  }

  // ────────────────────────────────────────────────────────────
  // HANDLERS
  // ────────────────────────────────────────────────────────────
  async function handleConfirmedUser(user) {
    _currentUser = user;
    persistSession(user);
    // ✅ Marquer la session comme confirmée dans cet onglet
    markSessionConfirmedInTab();

    notifyListeners('signed-in', { user });

    const account = await checkAccountStatus(user);

    if (account.status === 'blocked') {
      notifyListeners('blocked', { user, data: account.data });
      try { sessionStorage.setItem('arvexa_account_blocked', '1'); } catch (e) {}
      try { await _modules.signOut(_auth); } catch (e) {}
      clearSession();
      safeRedirect('auth-choice.html');
      return;
    }

    if (account.status === 'paused') {
      notifyListeners('paused', { user, data: account.data });
      return;
    }

    if (account.status === 'no-profile') {
      notifyListeners('no-profile', { user });
      return;
    }

    if (account.status === 'network-error') {
      notifyListeners('network-error', { error: account.error });
      return;
    }

    notifyListeners('active', { user, data: account.data });
  }

  function handleConfirmedNull() {
    console.warn('[AuthCore] Session confirmée absente');
    _currentUser = null;
    clearSession();
    // ✅ Retirer le marqueur
    unmarkSessionConfirmedInTab();
    notifyListeners('signed-out', {});
    if (!isPublicPage()) {
      saveRedirectTarget(location.pathname + location.search + location.hash);
      safeRedirect('login.html');
    }
  }

  function startHeartbeat() {
    if (_heartbeatTimer) clearInterval(_heartbeatTimer);
    _heartbeatTimer = setInterval(async () => {
      if (!_auth || !_auth.currentUser) return;
      try {
        await _modules.getIdToken(_auth.currentUser, false);
      } catch (e) {
        if (isNetworkError(e)) return;
        if (isFatalAuthError(e)) handleConfirmedNull();
      }
    }, HEARTBEAT_MS);
  }

  // ────────────────────────────────────────────────────────────
  // SUBSCRIPTION AUTH
  // ────────────────────────────────────────────────────────────
  function subscribeAuth() {
    if (_subscribed) return;
    _subscribed = true;

    // ✅ Si un utilisateur est déjà disponible IMMÉDIATEMENT,
    //    on marque et on affiche sans attendre.
    if (_auth.currentUser) {
      _currentUser = _auth.currentUser;
      _isAuthResolved = true;
      markSessionConfirmedInTab();
      removeBootOverlay();
      // Vérifier le statut en arrière-plan (sans bloquer)
      checkAccountStatus(_currentUser).then(account => {
        if (account.status === 'blocked') {
          notifyListeners('blocked', { user: _currentUser, data: account.data });
          try { sessionStorage.setItem('arvexa_account_blocked', '1'); } catch (e) {}
          _modules.signOut(_auth).catch(() => {});
          clearSession();
          safeRedirect('auth-choice.html');
        } else if (account.status === 'paused') {
          notifyListeners('paused', { user: _currentUser, data: account.data });
        } else if (account.status === 'active') {
          notifyListeners('active', { user: _currentUser, data: account.data });
        }
      }).catch(() => {});
    }

    _modules.onAuthStateChanged(_auth, async (user) => {
      // ─── Premier tick ───
      if (!_isAuthResolved) {
        if (user) {
          if (_graceTimer) { clearTimeout(_graceTimer); _graceTimer = null; }
          if (_extraGraceTimer) { clearTimeout(_extraGraceTimer); _extraGraceTimer = null; }
          if (_maxTimer) { clearTimeout(_maxTimer); _maxTimer = null; }
          _isAuthResolved = true;
          await handleConfirmedUser(user);
          return;
        }

        if (_graceTimer) return;

        _graceTimer = setTimeout(async () => {
          _graceTimer = null;
          if (_isAuthResolved) return;

          if (_auth.currentUser) {
            _isAuthResolved = true;
            if (_extraGraceTimer) { clearTimeout(_extraGraceTimer); _extraGraceTimer = null; }
            if (_maxTimer) { clearTimeout(_maxTimer); _maxTimer = null; }
            await handleConfirmedUser(_auth.currentUser);
            return;
          }

          const { session, userData } = readSession();
          const hasSession = !!(session && session.uid);
          const hasUserData = !!userData;

          if (hasSession && hasUserData) {
            if (_extraGraceTimer) return;
            _extraGraceTimer = setTimeout(async () => {
              _extraGraceTimer = null;
              if (_isAuthResolved) return;
              if (_auth.currentUser) {
                _isAuthResolved = true;
                if (_maxTimer) { clearTimeout(_maxTimer); _maxTimer = null; }
                await handleConfirmedUser(_auth.currentUser);
                return;
              }
              _isAuthResolved = true;
              if (_maxTimer) { clearTimeout(_maxTimer); _maxTimer = null; }
              handleConfirmedNull();
            }, EXTRA_GRACE_MS);
            return;
          }

          _isAuthResolved = true;
          if (_maxTimer) { clearTimeout(_maxTimer); _maxTimer = null; }
          handleConfirmedNull();
        }, GRACE_MS);

        return;
      }

      // ─── Ticks ultérieurs ───
      if (user) {
        if (_currentUser && user.uid === _currentUser.uid) return;
        _currentUser = user;
        await handleConfirmedUser(user);
      } else {
        if (_currentUser) {
          _currentUser = null;
          clearSession();
          unmarkSessionConfirmedInTab();
          notifyListeners('signed-out', { reason: 'auth-null' });
          if (!isPublicPage()) {
            saveRedirectTarget(location.pathname + location.search + location.hash);
            safeRedirect('login.html');
          }
        }
      }
    });

    _maxTimer = setTimeout(async () => {
      if (_isAuthResolved) return;
      if (_auth.currentUser) {
        _isAuthResolved = true;
        if (_graceTimer) { clearTimeout(_graceTimer); _graceTimer = null; }
        if (_extraGraceTimer) { clearTimeout(_extraGraceTimer); _extraGraceTimer = null; }
        await handleConfirmedUser(_auth.currentUser);
      } else {
        _isAuthResolved = true;
        if (_graceTimer) { clearTimeout(_graceTimer); _graceTimer = null; }
        if (_extraGraceTimer) { clearTimeout(_extraGraceTimer); _extraGraceTimer = null; }
        handleConfirmedNull();
      }
    }, MAX_TIMER_MS);
  }

  // ────────────────────────────────────────────────────────────
  // API PUBLIQUE
  // ────────────────────────────────────────────────────────────
  const api = {
    get auth() { return _auth; },
    get db() { return _db; },
    get app() { return _app; },
    get currentUser() { return _currentUser || (_auth ? _auth.currentUser : null); },
    get currentUserData() { return _currentUserData; },
    get isResolved() { return _isAuthResolved; },

    async init() {
      if (_initPromise) return _initPromise;
      _initPromise = (async () => {
        try {
          await initFirebase();
          subscribeAuth();
          startHeartbeat();
        } catch (e) {
          console.error('[AuthCore] Init échec:', e);
        }
        return { user: _currentUser, userData: _currentUserData, auth: _auth, db: _db };
      })();
      return _initPromise;
    },

    on(event, handler, opts = {}) {
      const entry = {
        id: Math.random().toString(36).slice(2),
        event,
        handler,
        once: !!opts.once
      };
      _listeners.push(entry);
      return () => {
        const idx = _listeners.findIndex(l => l.id === entry.id);
        if (idx !== -1) _listeners.splice(idx, 1);
      };
    },

    waitForUser(timeoutMs = 10000) {
      return new Promise((resolve, reject) => {
        if (_currentUser) return resolve(_currentUser);
        if (_isAuthResolved && !_currentUser) return resolve(null);

        const timer = setTimeout(() => {
          unsubAll();
          reject(new Error('waitForUser timeout'));
        }, timeoutMs);

        const unsub1 = api.on('signed-in', ({ user }) => {
          clearTimeout(timer); unsubAll(); resolve(user);
        }, { once: true });

        const unsub2 = api.on('signed-out', () => {
          clearTimeout(timer); unsubAll(); resolve(null);
        }, { once: true });

        const unsub3 = api.on('active', ({ user }) => {
          clearTimeout(timer); unsubAll(); resolve(user);
        }, { once: true });

        const unsubAll = () => { unsub1(); unsub2(); unsub3(); };
      });
    },

    async getUserData(forceRefresh = false) {
      const user = api.currentUser;
      if (!user || !_db) return null;
      if (!forceRefresh) {
        const cached = getCachedUserData(user.uid);
        if (cached) { _currentUserData = cached; return cached; }
      }
      let lastError = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const ref = _modules.doc(_db, 'users', user.uid);
          const snap = await _modules.getDoc(ref);
          if (!snap.exists()) return null;
          const data = snap.data();
          _currentUserData = data;
          persistSession(user, data);
          return data;
        } catch (e) {
          lastError = e;
          if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 400));
        }
      }
      return getCachedUserData(user.uid);
    },

    async logout(redirect = 'auth-choice.html') {
      if (_isRedirecting) return;
      _isRedirecting = true;
      if (_heartbeatTimer) { clearInterval(_heartbeatTimer); _heartbeatTimer = null; }
      if (_graceTimer) { clearTimeout(_graceTimer); _graceTimer = null; }
      if (_extraGraceTimer) { clearTimeout(_extraGraceTimer); _extraGraceTimer = null; }
      if (_maxTimer) { clearTimeout(_maxTimer); _maxTimer = null; }
      if (_overlaySafetyTimer) { clearTimeout(_overlaySafetyTimer); _overlaySafetyTimer = null; }
      clearSession();
      unmarkSessionConfirmedInTab();
      try { await _modules.signOut(_auth); } catch (e) {}
      window.location.replace(redirect);
    },

    async withNetworkRetry(fn, { attempts = 3, baseDelay = 400 } = {}) {
      let lastError = null;
      for (let i = 0; i < attempts; i++) {
        try { return await fn(); }
        catch (e) {
          lastError = e;
          if (!isNetworkError(e) || i === attempts - 1) throw e;
          await new Promise(r => setTimeout(r, baseDelay * (i + 1)));
        }
      }
      throw lastError;
    },

    status() {
      return {
        loaded: true,
        hasApp: !!_app,
        hasAuth: !!_auth,
        hasDb: !!_db,
        isResolved: _isAuthResolved,
        currentUser: _currentUser ? _currentUser.uid : null,
        isRedirecting: _isRedirecting,
        isOnline: navigator.onLine,
        hasSessionStorage: !!localStorage.getItem(SESSION_KEY),
        hasUserDataStorage: !!localStorage.getItem(USER_DATA_KEY),
        sessionConfirmedInTab: isSessionConfirmedInTab(),
        listeners: _listeners.length,
        heartbeatActive: !!_heartbeatTimer,
        isPublicPage: isPublicPage(),
        wouldShowOverlay: shouldShowOverlay()
      };
    },

    cleanup() {
      if (_heartbeatTimer) { clearInterval(_heartbeatTimer); _heartbeatTimer = null; }
      if (_graceTimer) { clearTimeout(_graceTimer); _graceTimer = null; }
      if (_extraGraceTimer) { clearTimeout(_extraGraceTimer); _extraGraceTimer = null; }
      if (_maxTimer) { clearTimeout(_maxTimer); _maxTimer = null; }
      if (_overlaySafetyTimer) { clearTimeout(_overlaySafetyTimer); _overlaySafetyTimer = null; }
    }
  };

  // ────────────────────────────────────────────────────────────
  // DÉMARRAGE — OVERLAY CONDITIONNEL
  // ────────────────────────────────────────────────────────────
  // ✅ N'afficher l'overlay QUE si nécessaire
  const willShowOverlay = shouldShowOverlay();
  if (willShowOverlay) {
    showBootOverlay();
  }

  // Écouter les événements pour retirer l'overlay
  api.on('signed-in', () => removeBootOverlay());
  api.on('active', () => removeBootOverlay());
  api.on('paused', () => { removeBootOverlay(); showPausedBanner(); });
  api.on('blocked', () => removeBootOverlay());
  api.on('no-profile', () => removeBootOverlay());
  api.on('signed-out', () => removeBootOverlay());
  api.on('network-error', () => removeBootOverlay());

  // ✅ Si pas d'overlay nécessaire, s'assurer qu'il n'y en a pas
  if (!willShowOverlay) {
    removeBootOverlay();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { api.init(); }, { once: true });
  } else {
    api.init();
  }

  window.ArvexaAuth = api;
  console.log('[AuthCore] ✅ Noyau chargé (overlay:', willShowOverlay ? 'oui' : 'non', ')');
})();
