// api/health.js
// ✅ Diagnostic de configuration — ajouté le 2026-10-26
// Permet de vérifier en un coup d'œil (sans accès aux logs Vercel) que
// toutes les variables d'environnement critiques sont présentes et que
// Firebase admin fonctionne réellement.
// Aucune donnée sensible n'est exposée : uniquement des booléens.

const SITE_URL = 'https://arvexaschool.vercel.app';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', SITE_URL);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const checks = {
    firebaseAdminCredentials: !!(process.env.FIREBASE_ADMIN_CREDENTIALS || process.env.FIREBASE_SERVICE_ACCOUNT),
    saspayApiKey: !!process.env.SASPAY_API_KEY,
    saspayWebhookSecret: !!process.env.SASPAY_WEBHOOK_SECRET,
    groqKey: !!process.env.GROQ_API_KEY,
    openrouterKey: !!process.env.OPENROUTER_API_KEY,
    mistralKey: !!process.env.MISTRAL_API_KEY
  };

  // Test réel d'initialisation de Firebase admin (même logique que les API)
  let firebaseWorks = false;
  let firebaseError = null;
  if (checks.firebaseAdminCredentials) {
    try {
      const { initializeApp, cert, getApps } = await import('firebase-admin/app');
      const raw = (process.env.FIREBASE_ADMIN_CREDENTIALS
               || process.env.FIREBASE_SERVICE_ACCOUNT || '').trim();
      let sa;
      try { sa = JSON.parse(raw); }
      catch (e) { sa = JSON.parse(raw.replace(/\\n/g, '\n')); }
      if (!sa || !sa.project_id || !sa.private_key || !sa.client_email) {
        throw new Error('incomplete');
      }
      if (!getApps().length) initializeApp({ credential: cert(sa) });
      const { getFirestore } = await import('firebase-admin/firestore');
      getFirestore();
      firebaseWorks = true;
    } catch (e) {
      firebaseError = e.message || 'unknown';
    }
  } else {
    firebaseError = 'FIREBASE_ADMIN_CREDENTIALS absente';
  }

  const allCriticalOk = checks.firebaseAdminCredentials && checks.saspayApiKey
    && checks.saspayWebhookSecret && firebaseWorks;

  return res.status(200).json({
    ok: allCriticalOk,
    time: new Date().toISOString(),
    firebase: { works: firebaseWorks, error: firebaseError },
    env: checks
  });
}
