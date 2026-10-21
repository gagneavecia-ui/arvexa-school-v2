// api/creer-checkout.js
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

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
    // =========================================================
    // 1. INITIALISATION FIREBASE (Sécurisée)
    // =========================================================
    let db = null;
    try {
      if (!getApps().length) {
        const saJson = process.env.FIREBASE_SERVICE_ACCOUNT;
        if (!saJson) throw new Error('FIREBASE_SERVICE_ACCOUNT manquante');
        
        // Nettoyage des éventuels \n dans la clé privée si la variable a été copiée avec des retours à la ligne
        const sa = JSON.parse(saJson);
        if (sa.private_key) {
          sa.private_key = sa.private_key.replace(/\\n/g, '\n');
        }
        
        initializeApp({ credential: cert(sa) });
      }
      db = getFirestore();
    } catch (firebaseErr) {
      console.error('❌ Firebase init échouée :', firebaseErr.message);
      // On continue SANS Firestore. Le paiement fonctionnera, 
      // mais les codes promo ne seront pas vérifiés.
    }

    // =========================================================
    // 2. LECTURE ET VALIDATION DES DONNÉES
    // =========================================================
    const { uid, plan, promoCode } = req.body || {};

    if (!uid || !plan) {
      return res.status(400).json({ error: 'Champs manquants : uid, plan' });
    }
    if (!PRICES[plan]) {
      return res.status(400).json({ error: 'Plan invalide (monthly ou annual)' });
    }

    // =========================================================
    // 3. CALCUL DU MONTANT ET CODE PROMO
    // =========================================================
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
            console.log(`🎟️ Promo appliqué : ${codeUpper} (-${discount}%)`);
          }
        }
      } catch (e) {
        console.warn('Erreur vérification promo :', e.message);
      }
    }

    // =========================================================
    // 4. APPEL À L'API SASPAY
    // =========================================================
    const API_KEY = process.env.SASPAY_API_KEY;
    if (!API_KEY) {
      return res.status(500).json({ error: 'SASPAY_API_KEY manquante sur le serveur' });
    }

    const reference = `ARV-${Date.now()}-${String(uid).slice(0, 6)}`;

    const payload = {
      amount: amount,
      currency: 'XOF',
      reference: reference,
      description: `Abonnement ARVEXA ${plan}${promoApplied ? ` (promo ${promoApplied.code})` : ''}`,
      success_url: `${SITE_URL}/abonnement.html?statut=succes&ref=${reference}`,
      cancel_url: `${SITE_URL}/abonnement.html?statut=annule`,
      webhook_url: `${SITE_URL}/api/saspay-webhook`
    };

    console.log('📤 Payload envoyé à SasPay :', JSON.stringify(payload));

    const saspayRes = await fetch(`${BASE}/checkout-sessions/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      },
      body: JSON.stringify(payload)
    });

    // =========================================================
    // 5. GESTION DE LA RÉPONSE SASPAY
    // =========================================================
    const responseText = await saspayRes.text();
    let data;
    
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      console.error('SasPay a renvoyé du texte non-JSON :', responseText);
      return res.status(500).json({ 
        error: 'SasPay a renvoyé une erreur inattendue', 
        raw: responseText.substring(0, 300) 
      });
    }

    if (!data.success) {
      console.error('❌ Erreur SasPay :', JSON.stringify(data, null, 2));
      return res.status(500).json({ 
        error: 'Erreur SasPay', 
        sasPayRaw: data // On renvoie l'erreur exacte pour le frontend
      });
    }

    const checkoutUrl = data.data?.checkout_url || data.data?.payment_url || data.data?.url;
    if (!checkoutUrl) {
      return res.status(500).json({ error: 'URL de checkout absente', raw: data.data });
    }

    // =========================================================
    // 6. INCRÉMENTATION DU COMPTEUR PROMO (Si Firestore OK)
    // =========================================================
    if (db && promoApplied) {
      try {
        await db.collection('promoCodes').doc(promoApplied.code).update({
          uses: FieldValue.increment(1)
        });
      } catch (e) {
        console.warn('Impossible d\'incrémenter uses :', e.message);
      }
    }

    // =========================================================
    // 7. RÉPONSE AU CLIENT (SUCCÈS)
    // =========================================================
    return res.status(200).json({
      ok: true,
      reference,
      checkoutUrl,
      amount,
      promoApplied
    });

  } catch (err) {
    console.error('❌ Crash global du handler :', err);
    return res.status(500).json({ error: 'Erreur serveur', detail: err.message });
  }
}
