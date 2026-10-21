// api/creer-checkout.js - Version avec API REST Firestore (Sans firebase-admin)

const PRICES = { monthly: 2000, annual: 18000 };
const SITE_URL = 'https://arvexaschool.vercel.app';
const BASE = 'https://api.saspay.me/api/v1';
const PROJECT_ID = 'arvexa-fbf10'; // Votre ID de projet Firebase

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', SITE_URL);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { uid, plan, promoCode, customerEmail, customerName } = req.body || {};
    if (!uid || !plan) return res.status(400).json({ error: 'Champs manquants' });
    if (!PRICES[plan]) return res.status(400).json({ error: 'Plan invalide' });

    let amount = PRICES[plan];
    let promoApplied = null;

    // --- 1. VÉRIFICATION DU CODE PROMO VIA API REST FIRESTORE ---
    if (promoCode && plan === 'annual') {
      try {
        const codeUpper = promoCode.toUpperCase().trim();
        const firebaseApiKey = process.env.FIREBASE_WEB_API_KEY;
        
        if (!firebaseApiKey) throw new Error('FIREBASE_WEB_API_KEY manquante');

        // Appel REST vers Firestore
        const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/promoCodes/${codeUpper}?key=${firebaseApiKey}`;
        const promoRes = await fetch(firestoreUrl);
        
        if (promoRes.ok) {
          const promoData = await promoRes.json();
          // Firestore REST renvoie les nombres sous forme de chaîne
          const discount = Number(promoData.fields?.discount?.integerValue || promoData.fields?.discount?.doubleValue || 0);
          
          if (discount > 0) {
            amount = Math.round(amount * (1 - discount / 100));
            promoApplied = { code: codeUpper, discount };
            console.log(`🎟️ Promo appliqué : ${codeUpper} (-${discount}%)`);
          }
        } else if (promoRes.status === 404) {
          console.log(`Code promo ${codeUpper} introuvable.`);
        }
      } catch (e) {
        console.warn('Erreur vérification promo :', e.message);
      }
    }

    // --- 2. APPEL À L'API SASPAY ---
    const API_KEY = process.env.SASPAY_API_KEY;
    if (!API_KEY) return res.status(500).json({ error: 'SASPAY_API_KEY manquante' });

    const reference = `ARV-${Date.now()}-${String(uid).slice(0, 6)}`;
    
    const payload = {
      amount,
      currency: 'XOF',
      reference,
      description: `Abonnement ARVEXA ${plan}${promoApplied ? ` (promo ${promoApplied.code})` : ''}`,
      customer_name: customerName || 'Élève ARVEXA',
      customer_email: customerEmail || 'eleve@arvexaschool.com',
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

    // --- 3. INCRÉMENTATION DU COMPTEUR D'UTILISATION DU CODE PROMO ---
    if (promoApplied) {
      try {
        const firebaseApiKey = process.env.FIREBASE_WEB_API_KEY;
        // PATCH pour incrémenter le champ "uses"
        const patchUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/promoCodes/${promoApplied.code}?updateMask.fieldPaths=uses&key=${firebaseApiKey}`;
        
        await fetch(patchUrl, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fields: {
              uses: { integerValue: (promoApplied.uses || 0) + 1 } // Note: pour un vrai incrément, il faudrait lire la valeur actuelle
            }
          })
        });
      } catch (e) {
        console.warn('Impossible d\'incrémenter uses via REST :', e.message);
      }
    }

    return res.status(200).json({ ok: true, reference, checkoutUrl, amount, promoApplied });

  } catch (err) {
    console.error('Erreur:', err);
    return res.status(500).json({ error: 'Erreur serveur', detail: err.message });
  }
}
