// api/creer-checkout.js
// Conforme à la documentation api.saspay.me — page « Paiements »
// Endpoint : POST /checkout-sessions/
// Vérifie les codes promo dans Firestore

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

// Init Firebase Admin (une seule fois)
if (!getApps().length) {
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
  initializeApp({ credential: cert(sa) });
}
const db = getFirestore();

const PRICES = { monthly: 2000, annual: 18000 };
const SITE_URL = 'https://arvexaschool.vercel.app';
const BASE = 'https://api.saspay.me/api/v1';

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', SITE_URL);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { uid, plan, promoCode } = req.body || {};

    // 1. Validation
    if (!uid || !plan) {
      return res.status(400).json({ error: 'Champs manquants : uid, plan' });
    }
    if (!PRICES[plan]) {
      return res.status(400).json({ error: 'Plan invalide (monthly ou annual)' });
    }

    // 2. Calcul du montant
    let amount = PRICES[plan];
    let promoApplied = null;

    // ✅ Vérification du code promo DANS FIRESTORE
    if (promoCode && plan === 'annual') {
      const codeUpper = promoCode.toUpperCase().trim();
      try {
        const promoSnap = await db.collection('promoCodes').doc(codeUpper).get();

        if (promoSnap.exists) {
          const promoData = promoSnap.data();
          const discount = Number(promoData.discount);

          if (discount > 0) {
            amount = Math.round(amount * (1 - discount / 100));
            promoApplied = { code: codeUpper, discount };
            console.log(`🎟️ Code promo valide : ${codeUpper} (-${discount}%)`);
          } else {
            console.warn(`Code promo ${codeUpper} sans discount valide`);
          }
        } else {
          console.warn(`Code promo ${codeUpper} inexistant dans Firestore`);
        }
      } catch (e) {
        console.warn('Erreur vérification promo :', e.message);
        // On continue sans promo plutôt que de bloquer le paiement
      }
    }

    // 3. Clé API SasPay
    const API_KEY = process.env.SASPAY_API_KEY;
    if (!API_KEY) {
      return res.status(500).json({ error: 'SASPAY_API_KEY manquante sur le serveur' });
    }

    // 4. Référence unique
    const reference = `ARV-${Date.now()}-${String(uid).slice(0, 6)}`;

    // 5. Payload SasPay
    const payload = {
      amount: amount,
      currency: 'XOF',
      reference: reference,
      description: `Abonnement ARVEXA ${plan}${promoApplied ? ` (promo ${promoApplied.code})` : ''}`,
      success_url: `${SITE_URL}/abonnement.html?statut=succes&ref=${reference}`,
      cancel_url:  `${SITE_URL}/abonnement.html?statut=annule`,
      webhook_url: `${SITE_URL}/api/saspay-webhook`
    };

    console.log('📤 Payload envoyé à SasPay :', JSON.stringify(payload, null, 2));

    // 6. Appel SasPay
    const saspayRes = await fetch(`${BASE}/checkout-sessions/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      },
      body: JSON.stringify(payload)
    });

    const data = await saspayRes.json();

    // 7. Gestion d'erreur SasPay
    if (!data.success) {
      console.error('SasPay checkout-sessions erreur :', JSON.stringify(data, null, 2));
      return res.status(500).json({
        error: data.error?.message || 'Échec création session SasPay',
        sasPayRaw: data
      });
    }

    // 8. Extraction de l'URL de checkout
    const checkoutUrl =
      data.data?.checkout_url ||
      data.data?.payment_url ||
      data.data?.url;

    if (!checkoutUrl) {
      console.error('URL checkout absente de la réponse :', JSON.stringify(data.data, null, 2));
      return res.status(500).json({
        error: 'URL de checkout absente de la réponse SasPay',
        sasPayRaw: data.data
      });
    }

    // 9. Incrémenter le compteur d'utilisation du code promo
    if (promoApplied) {
      try {
        await db.collection('promoCodes').doc(promoApplied.code).update({
          uses: FieldValue.increment(1)
        });
        console.log(`✅ Compteur uses incrémenté pour ${promoApplied.code}`);
      } catch (e) {
        console.warn('Impossible d\'incrémenter uses :', e.message);
      }
    }

    // 10. Réponse au client
    return res.status(200).json({
      ok: true,
      reference,
      checkoutUrl,
      sessionId: data.data?.id || null,
      amount,           // montant réellement facturé
      originalAmount: PRICES[plan],
      promoApplied      // null ou { code, discount }
    });

  } catch (err) {
    console.error('Erreur creer-checkout :', err);
    return res.status(500).json({
      error: 'Erreur serveur',
      detail: err.message
    });
  }
}
