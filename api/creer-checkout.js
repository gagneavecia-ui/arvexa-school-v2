// api/creer-checkout.js
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

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
    
    // --- INITIALISATION FIREBASE SÉCURISÉE ---
    try {
      // ✅ On utilise VOTRE variable existante
      const saJson = process.env.FIREBASE_ADMIN_CREDENTIALS;
      if (!saJson) throw new Error('Variable FIREBASE_ADMIN_CREDENTIALS absente sur Vercel');
      
      const sa = JSON.parse(saJson);
      
      // Nettoyage de la clé privée (au cas où elle contient des \n)
      if (sa.private_key) {
        sa.private_key = sa.private_key.replace(/\\n/g, '\n');
      }

      if (!sa.project_id) {
        throw new Error('Le JSON ne contient pas "project_id"');
      }

      // Chargement dynamique de firebase-admin pour éviter le crash au démarrage
      const { initializeApp, cert, getApps } = require('firebase-admin/app');
      const { getFirestore } = require('firebase-admin/firestore');

      if (!getApps().length) {
        initializeApp({ credential: cert(sa) });
        console.log('✅ Firebase initialisé pour le projet:', sa.project_id);
      }
      db = getFirestore();

    } catch (firebaseErr) {
      console.error('❌ Firebase init échouée :', firebaseErr.message);
      // On continue sans Firestore pour ne pas bloquer le paiement
    }

    // --- TRAITEMENT DU PAIEMENT ---
    const { uid, plan, promoCode } = req.body || {};
    if (!uid || !plan) return res.status(400).json({ error: 'Champs manquants' });
    if (!PRICES[plan]) return res.status(400).json({ error: 'Plan invalide' });

    let amount = PRICES[plan];
    let promoApplied = null;

    // Vérification du code promo (si Firestore est connecté)
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
      } catch (e) {
        console.warn('Erreur promo :', e.message);
      }
    }

    const API_KEY = process.env.SASPAY_API_KEY;
    if (!API_KEY) return res.status(500).json({ error: 'SASPAY_API_KEY manquante' });

    const reference = `ARV-${Date.now()}-${String(uid).slice(0, 6)}`;
    const payload = {
      amount,
      currency: 'XOF',
      reference,
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
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      return res.status(500).json({ error: 'SasPay non-JSON', raw: responseText.substring(0, 300) });
    }

    if (!data.success) {
      return res.status(500).json({ error: 'Erreur SasPay', sasPayRaw: data });
    }

    const checkoutUrl = data.data?.checkout_url || data.data?.payment_url || data.data?.url;
    if (!checkoutUrl) return res.status(500).json({ error: 'URL absente', raw: data.data });

    // Incrémentation du compteur du code promo
    if (db && promoApplied) {
      try {
        const { FieldValue } = require('firebase-admin/firestore');
        await db.collection('promoCodes').doc(promoApplied.code).update({ 
          uses: FieldValue.increment(1) 
        });
      } catch (e) { 
        console.warn('uses non incrémenté :', e.message); 
      }
    }

    return res.status(200).json({ ok: true, reference, checkoutUrl, amount, promoApplied });

  } catch (err) {
    console.error('Erreur:', err);
    return res.status(500).json({ error: 'Erreur serveur', detail: err.message });
  }
}
