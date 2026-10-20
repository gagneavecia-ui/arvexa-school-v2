// api/creer-checkout.js
// Conforme à la documentation api.saspay.me — page « Paiements »
// Endpoint : POST /checkout-sessions/

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
    if (!uid || !plan) return res.status(400).json({ error: 'Champs manquants : uid, plan' });
    if (!PRICES[plan]) return res.status(400).json({ error: 'Plan invalide' });

    let amount = PRICES[plan];
    if (promoCode && plan === 'annual' && promoCode.toUpperCase() === 'PROMO25') {
      amount = Math.round(amount * 0.75);
    }

    const API_KEY = process.env.SASPAY_API_KEY;
    if (!API_KEY) return res.status(500).json({ error: 'SASPAY_API_KEY manquante' });

    const reference = `ARV-${Date.now()}-${String(uid).slice(0, 6)}`;

    // ✅ Endpoint confirmé : POST /checkout-sessions/
    // ⚠️ Pas d'Idempotency-Key : non supporté sur cet endpoint (doc explicite)
    const payload = {
      amount: amount,
      currency: 'XOF',
      reference: reference,
      description: `Abonnement ARVEXA ${plan}`,
      success_url: `${SITE_URL}/abonnement.html?statut=succes&ref=${reference}`,
      cancel_url:  `${SITE_URL}/abonnement.html?statut=annule`,
      webhook_url: `${SITE_URL}/api/saspay-webhook`
    };

    console.log('📤 Payload envoyé à SasPay :', JSON.stringify(payload, null, 2));

    const saspayRes = await fetch(`${BASE}/checkout-sessions/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      },
      body: JSON.stringify(payload)
    });

    const data = await saspayRes.json();

    if (!data.success) {
      console.error('SasPay checkout-sessions erreur :', JSON.stringify(data, null, 2));
      return res.status(500).json({
        error: data.error?.message || 'Échec création session SasPay',
        sasPayRaw: data
      });
    }

    // Extraction de l'URL de checkout depuis la réponse SasPay
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

    return res.status(200).json({
      ok: true,
      reference,
      checkoutUrl,
      sessionId: data.data?.id || null
    });

  } catch (err) {
    console.error('Erreur creer-checkout :', err);
    return res.status(500).json({ error: 'Erreur serveur', detail: err.message });
  }
}
