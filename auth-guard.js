// auth-guard.js — ARVEXA School
// Corrections appliquées :
//  - C1 : redirectTo préserve pathname + search + hash et n'écrase pas redirectAfterLogin
//  - C2 : second niveau d'attente (1500 ms) quand session + userData présents et online
//  - C3 : graceMs par défaut = 600 ms (aligné sur les autres pages protégées)
//  - C4 : listener 'online' relance la résolution si session présente et finish différé
//  - C5 : unsubscribe() systématique dans finish()
//  - C6 : getApps().find('[DEFAULT]') au lieu de getApps()[0]
// ================================================================

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDHscOXw3rLuhV6z1Cny-bdYCumqpnG7QE",
  authDomain: "arvexa-fbf10.firebaseapp.com",
  projectId: "arvexa-fbf10",
  storageBucket: "arvexa-fbf10.firebasestorage.app",
  messagingSenderId: "920108330053",
  appId: "1:920108330053:web:f532d71cbc2c824bc7472c"
};

// ✅ C6 — récupérer l'app par défaut, pas "la première app trouvée"
const defaultApp = getApps().find((a) => a.name === '[DEFAULT]');
const app = defaultApp || initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);

let persistenceReady = null;

async function ensurePersistence() {
  if (persistenceReady) return persistenceReady;
  persistenceReady = setPersistence(auth, browserLocalPersistence).catch((e) => {
    console.warn("[AuthGuard] setPersistence:", e.code || e.message);
  });
  return persistenceReady;
}

export async function requireAuth({
  onUser,
  onNoUser,
  redirectTo = null,
  graceMs = 600,   // ✅ C3 — aligné sur les autres pages protégées
  extraGraceMs = 1500  // ✅ C2 — second niveau quand session + userData
} = {}) {
  await ensurePersistence();

  let resolved = false;
  let graceTimer = null;
  let extraGraceTimer = null;
  let maxTimer = null;
  let unsubscribeFn = null;
  let onlineHandler = null;

  const cleanup = () => {
    if (graceTimer) { clearTimeout(graceTimer); graceTimer = null; }
    if (extraGraceTimer) { clearTimeout(extraGraceTimer); extraGraceTimer = null; }
    if (maxTimer) { clearTimeout(maxTimer); maxTimer = null; }
    if (onlineHandler) {
      window.removeEventListener('online', onlineHandler);
      onlineHandler = null;
    }
    if (unsubscribeFn) {
      try { unsubscribeFn(); } catch (e) {}
      unsubscribeFn = null;
    }
  };

  const finish = (user) => {
    if (resolved) return;
    resolved = true;
    cleanup();  // ✅ C5 — unsubscribe systématique

    if (user) {
      console.log("[AuthGuard] Session restaurée");
      if (typeof onUser === "function") onUser(user);
    } else {
      console.log("[AuthGuard] Aucune session");
      if (typeof onNoUser === "function") {
        onNoUser();
      } else if (redirectTo) {
        // ✅ C1 — préserver l'URL complète et ne pas écraser un redirect existant
        try {
          const existing = sessionStorage.getItem("redirectAfterLogin")
                        || sessionStorage.getItem("redirectAfterAuth");
          if (!existing) {
            sessionStorage.setItem(
              "redirectAfterLogin",
              window.location.pathname + window.location.search + window.location.hash
            );
          }
        } catch (e) {}
        window.location.replace(redirectTo);
      }
    }
  };

  unsubscribeFn = onAuthStateChanged(auth, (user) => {
    if (resolved) return;

    if (user) {
      finish(user);
      return;
    }

    // Premier tick null → grâce initiale
    if (graceTimer) return;
    graceTimer = setTimeout(() => {
      graceTimer = null;
      if (resolved) return;
      if (auth.currentUser) { finish(auth.currentUser); return; }

      const hasSession = localStorage.getItem("arvexa_session");
      const hasUserData = localStorage.getItem("arvexa_user_data");

      // ✅ C2 — second niveau : si session + userData + online, on attend davantage
      // avant de considérer l'utilisateur comme déconnecté.
      if (hasSession && hasUserData) {
        if (!navigator.onLine) {
          // Hors-ligne : on attend le retour réseau, sans résoudre (C4)
          if (!onlineHandler) {
            onlineHandler = () => {
              if (resolved) return;
              if (auth.currentUser) {
                finish(auth.currentUser);
              } else {
                // Réseau revenu mais toujours pas d'utilisateur : on laisse
                // Firebase émettre un nouvel événement, ou on finit après extraGrace.
                if (extraGraceTimer) return;
                extraGraceTimer = setTimeout(() => {
                  extraGraceTimer = null;
                  if (resolved) return;
                  if (auth.currentUser) finish(auth.currentUser);
                  else finish(null);
                }, extraGraceMs);
              }
            };
            window.addEventListener('online', onlineHandler);
          }
          return;
        }

        // Online mais session présente → petite attente supplémentaire
        if (extraGraceTimer) return;
        extraGraceTimer = setTimeout(() => {
          extraGraceTimer = null;
          if (resolved) return;
          if (auth.currentUser) { finish(auth.currentUser); return; }
          finish(null);
        }, extraGraceMs);
        return;
      }

      // Pas de session du tout → déconnecté
      finish(null);
    }, graceMs);
  });

  maxTimer = setTimeout(() => {
    if (resolved) return;
    if (auth.currentUser) finish(auth.currentUser);
    else finish(null);
  }, 5000);

  return { auth, app, unsubscribe: () => cleanup() };
}

export { auth, app };
