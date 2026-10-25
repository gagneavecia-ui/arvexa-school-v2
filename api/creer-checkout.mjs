// api/creer-checkout.mjs
// 🔒 Version sécurisée (v2) :
//  - Le montant est TOUJOURS calculé côté serveur (clientAmount ignoré/supprimé)
//  - Remises promo plafonnées (-90 % max) et code sanitisé
//  - Le checkout est enregistré côté serveur (saspayPendingCheckouts) :
//    le webhook vérifie montant + plan contre cette référence avant d'activer

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const PRICES = { monthly: 2000, annual: 18000 };
const SITE_URL = 'https://arvexaschool.vercel.app';
const BASE = 'https://api.saspay.me/api/v1';

if (!getApps().length) {
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
  initializeApp({ credential: cert(sa) });
}
const db = getFirestore();

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', SITE_URL);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // 🔒 clientAmount volontairement ignoré : seul le serveur décide du prix
    const { uid, plan, promoCode, customerEmail, customerName } = req.body || {};

    if (!uid || !plan) return res.status(400).json({ error: 'Champs manquants' });
    if (!PRICES[plan]) return res.status(400).json({ error: 'Plan invalide' });
    if (typeof uid !== 'string' || uid.length > 128) return res.status(400).json({ error: 'UID invalide' });

    let amount = PRICES[plan];
    let promoApplied = null;

    // 1. Vérification du code promo (lecture directe via SDK admin)
    if (promoCode && plan === 'annual') {
      try {
        const codeUpper = String(promoCode).toUpperCase().trim().replace(/[^A-Z0-9_-]/g, '');
        if (codeUpper && codeUpper.length <= 40) {
          const promoSnap = await db.collection('promoCodes').doc(codeUpper).get();
          if (promoSnap.exists) {
            const discount = Number(promoSnap.data()?.discount || 0);
            // 🔒 Plafond de sécurité : jamais plus de 90 % de remise
            if (discount > 0 && discount <= 90) {
              amount = Math.round(amount * (1 - discount / 100));
              promoApplied = { code: codeUpper, discount };
            }
          }
        }
      } catch (e) {
        console.warn('Erreur promo :', e.message);
      }
    }

    // 2. Référence générée côté serveur
    const reference = `ARV-${Date.now()}-${String(uid).slice(0, 6)}`;

    // 3. Appel SasPay
    const API_KEY = process.env.SASPAY_API_KEY;
    if (!API_KEY) return res.status(500).json({ error: 'SASPAY_API_KEY manquante' });

    const payload = {
      amount,
      currency: 'XOF',
      country: 'NE', // Force le Niger
      reference,
      description: `Abonnement ARVEXA ${plan}${promoApplied ? ` (promo ${promoApplied.code})` : ''}`,
      customer_name: String(customerName || 'Élève ARVEXA').substring(0, 80),
      customer_email: String(customerEmail || 'eleve@arvexaschool.com').substring(0, 120),
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

    if (!data.success) {
      return res.status(500).json({ error: 'Erreur SasPay', sasPayRaw: data });
    }

    const checkoutUrl = data.data?.checkout_url || data.data?.payment_url || data.data?.url;
    if (!checkoutUrl) return res.status(500).json({ error: 'URL absente', raw: data.data });

    // 4. 🔒 Enregistrement serveur du checkout attendu :
    //    le webhook comparera le montant réellement payé à `amount` ci-dessous.
    try {
      const batch = db.batch();
      batch.set(db.collection('saspayPendingCheckouts').doc(reference), {
        uid,
        plan,
        amount,
        promo: promoApplied ? promoApplied.code : null,
        status: 'pending',
        createdAt: FieldValue.serverTimestamp()
      });
      batch.set(db.collection('users').doc(uid), {
        saspayCheckoutReference: reference,
        saspayCheckoutSessionId: data.data?.id || null,
        saspayCheckoutStartedAt: FieldValue.serverTimestamp()
      }, { merge: true });
      await batch.commit();
    } catch (e) {
      // Échec d'écriture : le paiement peut continuer, mais le webhook refusera
      // d'activer l'abonnement sans enregistrement serveur (fail-closed).
      console.error('🔴 Écriture Firestore impossible pour', reference, ':', e.message);
    }

    return res.status(200).json({ ok: true, reference, checkoutUrl, amount, promoApplied });

  } catch (err) {
    console.error('Erreur:', err);
    return res.status(500).json({ error: 'Erreur serveur', detail: err.message });
  }
}
