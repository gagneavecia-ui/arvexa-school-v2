// api/creer-checkout.js
// URL : https://arvexaschool.vercel.app/api/creer-checkout

import { randomUUID } from 'crypto';

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
    if (!PRICES[plan]) return res.status(400).json({ error: 'Plan invalide (monthly ou annual)' });

    // Recalcul du prix côté serveur
    let amount = PRICES[plan];
    if (promoCode && plan === 'annual' && promoCode.toUpperCase() === 'PROMO25') {
      amount = Math.round(amount * 0.75);
    }

    const API_KEY = process.env.SASPAY_API_KEY;
    if (!API_KEY) return res.status(500).json({ error: 'SASPAY_API_KEY manquante' });

    const reference = `ARV-${Date.now()}-${String(uid).slice(0, 6)}`;

    // ⚠️ On essaie 3 endpoints dans l'ordre — le premier qui répond 2xx gagne.
    // Les logs Vercel nous diront lequel fonctionne.
    const endpoints = [
      `${BASE}/payments/checkout/initialize/`,
      `${BASE}/payments/initialize/`,
      `${BASE}/checkout/initialize/`
    ];

    const payload = {
      amount,
      currency: 'XOF',
      reference,
      description: `Abonnement ARVEXA ${plan}`,
      success_url: `${SITE_URL}/abonnement.html?statut=succes&ref=${reference}`,
      cancel_url:  `${SITE_URL}/abonnement.html?statut=annule`,
      webhook_url: `${SITE_URL}/api/saspay-webhook`
    };

    let lastError = null;
    for (const endpoint of endpoints) {
      try {
        const r = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${API_KEY}`,
            'Idempotency-Key': randomUUID()
          },
          body: JSON.stringify(payload)
        });

        const data = await r.json().catch(() => ({}));

        if (r.status === 404) {
          console.log(`Endpoint ${endpoint} → 404, essai suivant`);
          lastError = { endpoint, status: 404, data };
          continue;
        }

        console.log(`✅ Endpoint utilisé : ${endpoint} (HTTP ${r.status})`);

        if (!r.ok || !data.success) {
          return res.status(500).json({
            error: data.error?.message || `Échec SasPay (HTTP ${r.status})`,
            endpoint,
            detail: data
          });
        }

        return res.status(200).json({
          ok: true,
          reference,
          endpoint,
          checkoutUrl: data.data?.checkout_url || data.data?.payment_url || data.data?.url,
          raw: data.data
        });

      } catch (e) {
        lastError = { endpoint, error: e.message };
      }
    }

    return res.status(500).json({
      error: 'Aucun endpoint SasPay n\'a répondu. Vérifiez les logs Vercel.',
      attempts: lastError
    });

  } catch (err) {
    console.error('Erreur creer-checkout :', err);
    return res.status(500).json({ error: 'Erreur serveur', detail: err.message });
  }
            }
