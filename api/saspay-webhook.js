// api/saspay-webhook.js
// URL : https://arvexaschool.vercel.app/api/saspay-webhook

import crypto from 'crypto';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';

// Init Firebase Admin (une seule fois)
if (!getApps().length) {
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
  initializeApp({ credential: cert(sa) });
}
const db = getFirestore();

const TOLERANCE_SECONDS = 300;

export const config = { api: { bodyParser: false } };

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

function verifierSignature(rawBody, signature, timestamp, secret) {
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > TOLERANCE_SECONDS) {
    return { ok: false, reason: 'timestamp_expired' };
  }
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');
  const a = Buffer.from(signature || '');
  const b = Buffer.from(expected);
  if (a.length !== b.length) return { ok: false, reason: 'signature_invalid' };
  return crypto.timingSafeEqual(a, b)
    ? { ok: true }
    : { ok: false, reason: 'signature_invalid' };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  try {
    const rawBody = await readRawBody(req);
    const signature = req.headers['x-webhook-signature'];
    const timestamp = req.headers['x-webhook-timestamp'];
    const eventType = req.headers['x-webhook-event'];

    if (!signature || !timestamp) return res.status(401).send('Signature manquante');

    const secret = process.env.SASPAY_WEBHOOK_SECRET;
    if (!secret) {
      console.error('SASPAY_WEBHOOK_SECRET manquante');
      return res.status(500).send('Config manquante');
    }

    const check = verifierSignature(rawBody, signature, timestamp, secret);
    if (!check.ok) {
      console.warn('Webhook rejeté :', check.reason);
      return res.status(401).send('Signature invalide');
    }

    const payload = JSON.parse(rawBody);
    const event = payload.event || eventType;
    const data = payload.data || {};

    console.log('📩 Webhook SasPay :', {
      event,
      reference: data.reference,
      status: data.status,
      net_amount: data.net_amount
    });

    // ---------- ACTIVATION ABONNEMENT ----------
    if (event === 'transaction.success' && (data.type === 'PAIEMENT' || !data.type)) {
      const reference = data.reference;
      if (!reference) {
        console.warn('Référence absente du payload');
        return res.status(200).json({ received: true });
      }

      // Trouver l'utilisateur via sa référence
     const usersSnap = await db.collection('users')
  .where('saspayCheckoutReference', '==', reference)
  .limit(1)
  .get();

      if (usersSnap.empty) {
        console.warn('Aucun utilisateur pour la référence :', reference);
        return res.status(200).json({ received: true });
      }

      const userDoc = usersSnap.docs[0];
      const userData = userDoc.data();

      // Calcul de la date de fin
      const now = new Date();
      const endDate = new Date(now);
      if (userData.subscriptionPlan === 'annual') {
        endDate.setFullYear(endDate.getFullYear() + 1);
      } else {
        endDate.setMonth(endDate.getMonth() + 1);
      }

      // Mise à jour Firestore
      await userDoc.ref.update({
        subscriptionStatus: 'active',
        premium: true,
        isUnlocked: true,
        subscriptionStartDate: Timestamp.fromDate(now),
        subscriptionEndDate: Timestamp.fromDate(endDate),
        saspayTransactionId: data.id || null,
        saspayReference: reference,
        saspayAmountPaid: parseFloat(data.charged || data.amount || '0'),
        saspayNetAmount: parseFloat(data.net_amount || data.amount || '0'),
        saspayCurrency: data.currency || 'XOF',
        subscriptionPaidAt: FieldValue.serverTimestamp()
      });

      console.log('✅ Abonnement activé pour', userDoc.id);
    }

    if (event === 'transaction.failed' || event === 'transaction.cancelled') {
      const reference = data.reference;
      if (reference) {
        const usersSnap = await db.collection('users')
          .where('subscriptionRequestId', '==', reference)
          .limit(1).get();
        if (!usersSnap.empty) {
          await usersSnap.docs[0].ref.update({ subscriptionStatus: 'free' });
          console.log('❌ Abonnement remis à free pour', reference);
        }
      }
    }

    return res.status(200).json({ received: true });

  } catch (err) {
    console.error('Erreur webhook :', err);
    return res.status(200).send('Erreur loggée');
  }
      }
