// api/creer-checkout.js
// Conforme à la documentation api.saspay.me (Endpoints : POST /checkout-sessions/)

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

// Initialisation Firebase Admin
if (!getApps().length) {
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
  initializeApp({ credential: cert(sa) });
}
const db = getFirestore();

const PRICES = { monthly: 2000, annual: 18000 };
const SITE_URL = 'https://arvexaschool.vercel.app';
const BASE = 'https://api.saspay.me/api/v1';

export default async function handler(req, res) {
  // Configuration CORS
  res.setHeader('Access-Control-Allow-Origin', SITE_URL);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { uid, plan, promoCode } = req.body || {};

    if (!uid || !plan) {
      return res.status(400).json({ error: 'Champs manquants : uid, plan' });
    }
    if (!PRICES[plan]) {
      return res.status(400).json({ error: 'Plan invalide (monthly ou annual)' });
    }

    // Calcul du montant et vérification du code promo
    let amount = PRICES[plan];
    let promoApplied = null;

    if (promoCode && plan === 'annual') {
      const codeUpper = promoCode.toUpperCase().trim();
      try {
        const promoSnap = await db.collection('promoCodes').doc(codeUpper).get();
        if (promoSnap.exists) {
          const discount = Number(promoSnap.data().discount);
          if (discount > 0) {
            amount = Math.round(amount * (1 - discount / 100));
            promoApplied = { code: codeUpper, discount };
          }
        }
      } catch (e) {
        console.warn('Erreur vérification promo :', e.message);
      }
    }

    const API_KEY = process.env.SASPAY_API_KEY;
    if (!API_KEY) {
      return res.status(500).json({ error: 'SASPAY_API_KEY manquante sur le serveur' });
    }

    const reference = `ARV-${Date.now()}-${String(uid).slice(0, 6)}`;

    // Payload envoyé à SasPay
    const payload = {
      amount: amount,
      currency: 'XOF',
      reference: reference,
      description: `Abonnement ARVEXA ${plan}${promoApplied ? ` (promo ${promoApplied.code})` : ''}`,
      success_url: `${SITE_URL}/abonnement.html?statut=succes&ref=${reference}`,
      cancel_url:  `${SITE_URL}/abonnement.html?statut=annule`,
      webhook_url: `${SITE_URL}/api/saspay-webhook`
    };

    // Appel à l'API SasPay
    const saspayRes = await fetch(`${BASE}/checkout-sessions/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      },
      body: JSON.stringify(payload)
    });

    // Lecture de la réponse (gestion du JSON et du texte brut)
    const responseText = await saspayRes.text();
    let data;
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      console.error('SasPay a renvoyé du texte non-JSON :', responseText);
      return res.status(500).json({ 
        error: 'SasPay a renvoyé une erreur inattendue', 
        raw: responseText.substring(0, 500)
      });
    }

    if (!data.success) {
      console.error('Erreur SasPay :', JSON.stringify(data, null, 2));
      return res.status(500).json({ 
        error: 'Erreur SasPay', 
        sasPayRaw: data 
      });
    }

    const checkoutUrl = data.data?.checkout_url || data.data?.payment_url || data.data?.url;
    if (!checkoutUrl) {
      return res.status(500).json({ error: 'URL de checkout absente', raw: data.data });
    }

    // Incrémentation du compteur du code promo
    if (promoApplied) {
      try {
        await db.collection('promoCodes').doc(promoApplied.code).update({
          uses: FieldValue.increment(1)
        });
      } catch (e) {
        console.warn('Impossible d\'incrémenter uses :', e.message);
      }
    }

    return res.status(200).json({
      ok: true,
      reference,
      checkoutUrl,
      amount,
      promoApplied
    });

  } catch (err) {
    console.error('Erreur serveur :', err);
    return res.status(500).json({ error: 'Erreur serveur', detail: err.message });
  }
}
