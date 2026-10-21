// api/creer-checkout.js
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const PRICES = { monthly: 2000, annual: 18000 };
const SITE_URL = 'https://arvexaschool.vercel.app';
const BASE = 'https://api.saspay.me/api/v1';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', SITE_URL);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    let db = null;
    try {
      if (!getApps().length) {
        // ✅ Utilisation des variables séparées
        const projectId = process.env.FIREBASE_PROJECT_ID;
        const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
        let privateKey = process.env.FIREBASE_PRIVATE_KEY;

        if (!projectId || !clientEmail || !privateKey) {
          throw new Error('Variables Firebase manquantes sur Vercel');
        }

        // Remplacement des \n littéraux par de vrais retours à la ligne
        privateKey = privateKey.replace(/\\n/g, '\n');

        initializeApp({
          credential: cert({
            project_id: projectId,
            client_email: clientEmail,
            private_key: privateKey,
          }),
        });
        console.log('✅ Firebase initialisé via variables séparées');
      }
      db = getFirestore();
    } catch (firebaseErr) {
      console.error('❌ Firebase init échouée :', firebaseErr.message);
      // On continue sans Firestore pour ne pas bloquer le paiement
    }

    const { uid, plan, promoCode } = req.body || {};
    if (!uid || !plan) return res.status(400).json({ error: 'Champs manquants' });
    if (!PRICES[plan]) return res.status(400).json({ error: 'Plan invalide' });

    let amount = PRICES[plan];
    let promoApplied = null;

    if (db && promoCode && plan === 'annual') {
      try {
        const codeUpper = promoCode.toUpperCase().trim();
        const promoSnap = await db.collection('promoCodes').doc(codeUpper).get();
        if (promoSnap.exists) {
          const discount = Number(promoSnap.data().discount);
          if (discount > 0) {
            amount = Math.round(amount * (1 - discount / 100));
            promoApplied = { code: codeUpper, discount };
          }
        }
      } catch (e) { console.warn('Erreur promo :', e.message); }
    }

    const API_KEY = process.env.SASPAY_API_KEY;
    if (!API_KEY) return res.status(500).json({ error: 'SASPAY_API_KEY manquante' });

    const reference = `ARV-${Date.now()}-${String(uid).slice(0, 6)}`;
    const payload = {
      amount, currency: 'XOF', reference,
      description: `Abonnement ARVEXA ${plan}`,
      success_url: `${SITE_URL}/abonnement.html?statut=succes&ref=${reference}`,
      cancel_url: `${SITE_URL}/abonnement.html?statut=annule`,
      webhook_url: `${SITE_URL}/api/saspay-webhook`
    };

    const saspayRes = await fetch(`${BASE}/checkout-sessions/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` },
      body: JSON.stringify(payload)
    });

    const responseText = await saspayRes.text();
    let data;
    try { data = JSON.parse(responseText); } catch (e) {
      return res.status(500).json({ error: 'SasPay non-JSON', raw: responseText.substring(0, 300) });
    }

    if (!data.success) return res.status(500).json({ error: 'Erreur SasPay', sasPayRaw: data });

    const checkoutUrl = data.data?.checkout_url || data.data?.payment_url || data.data?.url;
    if (!checkoutUrl) return res.status(500).json({ error: 'URL absente', raw: data.data });

    if (db && promoApplied) {
      try { await db.collection('promoCodes').doc(promoApplied.code).update({ uses: FieldValue.increment(1) }); } catch (e) { console.warn(e.message); }
    }

    return res.status(200).json({ ok: true, reference, checkoutUrl, amount, promoApplied });

  } catch (err) {
    console.error('Erreur:', err);
    return res.status(500).json({ error: 'Erreur serveur', detail: err.message });
  }
}
