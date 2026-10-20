// api/creer-checkout.js - VERSION DE TEST (SANS FIRESTORE)

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
    const { uid, plan, promoCode } = req.body || {};

    if (!uid || !plan) {
      return res.status(400).json({ error: 'Champs manquants' });
    }

    let amount = PRICES[plan];
    let promoApplied = null;

    // ⚠️ TEST : Code promo en dur, sans Firestore
    if (promoCode && plan === 'annual' && promoCode.toUpperCase() === 'PROMO25') {
      amount = Math.round(amount * 0.75);
      promoApplied = { code: 'PROMO25', discount: 25 };
    }

    const API_KEY = process.env.SASPAY_API_KEY;
    if (!API_KEY) {
      return res.status(500).json({ error: 'SASPAY_API_KEY manquante' });
    }

    const reference = `ARV-${Date.now()}-${String(uid).slice(0, 6)}`;

    const payload = {
      amount: amount,
      currency: 'XOF',
      reference: reference,
      description: `Abonnement ARVEXA ${plan}`,
      success_url: `${SITE_URL}/abonnement.html?statut=succes&ref=${reference}`,
      cancel_url:  `${SITE_URL}/abonnement.html?statut=annule`,
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

    // ⚠️ IMPORTANT : On lit le texte d'abord pour éviter l'erreur "Unexpected token"
    const textData = await saspayRes.text();
    let data;
    
    try {
      data = JSON.parse(textData);
    } catch (e) {
      console.error('SasPay a renvoyé du HTML/texte :', textData);
      return res.status(500).json({ 
        error: 'SasPay a renvoyé une erreur non-JSON', 
        raw: textData.substring(0, 200) 
      });
    }

    if (!data.success) {
      console.error('Erreur SasPay :', data);
      return res.status(500).json({ error: 'Erreur SasPay', sasPayRaw: data });
    }

    const checkoutUrl = data.data?.checkout_url || data.data?.payment_url || data.data?.url;
    if (!checkoutUrl) {
      return res.status(500).json({ error: 'URL absente', raw: data.data });
    }

    return res.status(200).json({
      ok: true,
      reference,
      checkoutUrl,
      amount
    });

  } catch (err) {
    console.error('Erreur crash serveur :', err);
    return res.status(500).json({ error: 'Erreur serveur', detail: err.message });
  }
}
