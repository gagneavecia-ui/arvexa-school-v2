// auth-guard.js — ARVEXA School
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

const app = getApps().length ? getApps()[0] : initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);

let persistenceReady = null;

async function ensurePersistence() {
  if (persistenceReady) return persistenceReady;
  persistenceReady = setPersistence(auth, browserLocalPersistence).catch((e) => {
    console.warn("[AuthGuard] setPersistence:", e.message);
  });
  return persistenceReady;
}

export async function requireAuth({ onUser, onNoUser, redirectTo = null, graceMs = 800 } = {}) {
  await ensurePersistence();

  let resolved = false;
  let graceTimer = null;
  let maxTimer = null;

  const finish = (user) => {
    if (resolved) return;
    resolved = true;
    if (graceTimer) clearTimeout(graceTimer);
    if (maxTimer) clearTimeout(maxTimer);

    if (user) {
      console.log("[AuthGuard] Session restaurée");
      if (typeof onUser === "function") onUser(user);
    } else {
      console.log("[AuthGuard] Aucune session");
      if (typeof onNoUser === "function") onNoUser();
      else if (redirectTo) {
        try { sessionStorage.setItem("redirectAfterLogin", window.location.pathname); } catch (e) {}
        window.location.replace(redirectTo);
      }
    }
  };

  const unsubscribe = onAuthStateChanged(auth, (user) => {
    if (resolved) return;

    if (user) {
      finish(user);
      unsubscribe();
      return;
    }

    if (graceTimer) clearTimeout(graceTimer);
    graceTimer = setTimeout(() => {
      if (resolved) return;
      if (auth.currentUser) { finish(auth.currentUser); return; }
      const hasSession = localStorage.getItem("arvexa_session");
      const hasUserData = localStorage.getItem("arvexa_user_data");
      if ((hasSession || hasUserData) && !navigator.onLine) return;
      finish(null);
    }, graceMs);
  });

  maxTimer = setTimeout(() => {
    if (resolved) return;
    if (auth.currentUser) finish(auth.currentUser);
    else finish(null);
  }, 5000);

  return { auth, app, unsubscribe };
}

export { auth, app };
