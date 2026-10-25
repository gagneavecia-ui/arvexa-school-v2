// api/saspay-webhook.mjs
// 🔒 Version sécurisée (v2) :
//  - BUG CORRIGÉ : usersSnap[0] → usersSnap.docs[0] (crash de la branche d'échec)
//  - Le montant payé est vérifié contre l'enregistrement serveur
//    (saspayPendingCheckouts) avant toute activation d'abonnement
//  - Le plan d'abonnement vient du serveur, plus du document client
//  - Idempotence : un webhook déjà traité ne réactive pas deux fois

import crypto from 'crypto';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';

// ✅ FIX CRITIQUE (2026-10-26) — le webhook crashait au CHARGEMENT du module
// (FUNCTION_INVOCATION_FAILED) : il lisait FIREBASE_SERVICE_ACCOUNT, variable
// qui n'existe pas dans Vercel, et initialisait Firebase de façon immédiate.
// Toutes les autres API utilisent FIREBASE_ADMIN_CREDENTIALS avec init paresseux.
// → L'activation d'abonnement n'a JAMAIS fonctionné en production.
// Désormais : init paresseuse à l'intérieur du handler + variable correcte
// + validation robuste + réponse JSON claire en cas de mauvaise config
// (SasPay peut réessayer au lieu de recevoir un crash silencieux).
let _db = null;
let _initError = null;

function ensureFirebase() {
  if (_db) return _db;
  if (_initError) throw _initError;
  try {
    const raw = (process.env.FIREBASE_ADMIN_CREDENTIALS
             || process.env.FIREBASE_SERVICE_ACCOUNT || '').trim();
    if (!raw) throw new Error('FIREBASE_ADMIN_CREDENTIALS manquante dans Vercel');

    let sa;
    try { sa = JSON.parse(raw); }
    catch (e) {
      // Piège classique Vercel : clé privée collée avec \n littéraux
      sa = JSON.parse(raw.replace(/\\n/g, '\n'));
    }
    if (!sa || !sa.project_id || !sa.private_key || !sa.client_email) {
      throw new Error('Service account incomplet (project_id / private_key / client_email)');
    }

    if (!getApps().length) initializeApp({ credential: cert(sa) });
    _db = getFirestore();
    return _db;
  } catch (e) {
    _initError = e;
    throw e;
  }
}

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
  return crypto.timingSafeEqual(a, b) ? { ok: true } : { ok: false, reason: 'signature_invalid' };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  try {
    // ✅ FIX — initialisation paresseuse : en cas de mauvaise config, on
    // renvoie une erreur claire (SasPay réessaie) au lieu d'un crash muet.
    let db;
    try {
      db = ensureFirebase();
    } catch (cfgErr) {
      console.error('🔴 Config Firebase admin invalide :', cfgErr.message);
      return res.status(500).json({
        error: 'server_config',
        detail: 'Firebase admin non configuré sur le serveur',
        received: true
      });
    }

    const rawBody = await readRawBody(req);
    const signature = req.headers['x-webhook-signature'];
    const timestamp = req.headers['x-webhook-timestamp'];
    const eventType = req.headers['x-webhook-event'];

    if (!signature || !timestamp) {
      return res.status(401).send('Signature manquante');
    }

    const secret = process.env.SASPAY_WEBHOOK_SECRET;
    if (!secret) {
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

    console.log('📩 Webhook reçu :', { event, reference: data.reference, status: data.status });

    // ─── Activation de l'abonnement ────────────────────────────────
    if (event === 'transaction.success' && (data.type === 'PAIEMENT' || !data.type)) {
      const reference = data.reference;
      if (!reference) return res.status(200).json({ received: true });

      // 🔒 1. Retrouver le checkout enregistré par le serveur (creer-checkout)
      const pendingRef = db.collection('saspayPendingCheckouts').doc(reference);
      const pendingSnap = await pendingRef.get();

      if (!pendingSnap.exists) {
        // Fail-closed : sans enregistrement serveur, on n'active rien.
        console.error('🚫 Checkout inconnu (aucun enregistrement serveur) :', reference);
        return res.status(200).json({ received: true, activated: false, reason: 'unknown_reference' });
      }

      const pending = pendingSnap.data();

      // 🔒 2. Idempotence : déjà traité → no-op
      if (pending.status === 'processed') {
        console.log('↩️  Webhook déjà traité (idempotent) :', reference);
        return res.status(200).json({ received: true, idempotent: true });
      }

      // 🔒 3. Vérification du montant réellement payé
      const paidAmount = parseFloat(data.charged || data.amount || '0');
      const expectedAmount = Number(pending.amount || 0);
      if (!paidAmount || paidAmount < expectedAmount) {
        console.error(`🚫 Montant insuffisant : payé=${paidAmount}, attendu=${expectedAmount} (${reference})`);
        return res.status(200).json({ received: true, activated: false, reason: 'amount_mismatch' });
      }

      // 🔒 4. Le plan vient du serveur (plus jamais du document client)
      const userRef = db.collection('users').doc(pending.uid);
      const userSnap = await userRef.get();
      if (!userSnap.exists) {
        console.error('🚫 Utilisateur introuvable pour le checkout :', pending.uid, reference);
        return res.status(200).json({ received: true, activated: false, reason: 'user_not_found' });
      }

      const now = new Date();
      const endDate = new Date(now);
      if (pending.plan === 'annual') {
        endDate.setFullYear(endDate.getFullYear() + 1);
      } else {
        endDate.setMonth(endDate.getMonth() + 1);
      }

      const batch = db.batch();
      batch.update(userRef, {
        subscriptionStatus: 'active',
        premium: true,
        isUnlocked: true,
        subscriptionPlan: pending.plan,
        subscriptionStartDate: Timestamp.fromDate(now),
        subscriptionEndDate: Timestamp.fromDate(endDate),
        saspayTransactionId: data.id || null,
        saspayReference: reference,
        saspayAmountPaid: paidAmount,
        subscriptionPaidAt: FieldValue.serverTimestamp()
      });
      batch.update(pendingRef, {
        status: 'processed',
        processedAt: FieldValue.serverTimestamp(),
        paidAmount
      });
      await batch.commit();

      console.log('✅ Abonnement activé pour', pending.uid, `(${pending.plan}, ${paidAmount} XOF)`);
    }

    // ─── Gestion des échecs ────────────────────────────────────────
    if (event === 'transaction.failed' || event === 'transaction.cancelled') {
      const reference = data.reference;
      if (reference) {
        const pendingRef = db.collection('saspayPendingCheckouts').doc(reference);
        const pendingSnap = await pendingRef.get();

        if (pendingSnap.exists) {
          const uid = pendingSnap.data().uid;
          await pendingRef.update({ status: 'failed', processedAt: FieldValue.serverTimestamp() });

          // On ne dégrade un compte QUE s'il n'a pas déjà un abonnement actif
          // et que le checkout en cours est bien celui de cette référence.
          const userRef = db.collection('users').doc(uid);
          const userSnap = await userRef.get();
          if (userSnap.exists) {
            const u = userSnap.data();
            if (u.subscriptionStatus !== 'active' && u.saspayCheckoutReference === reference) {
              await userRef.update({ subscriptionStatus: 'free' });
              console.log('⚪ Paiement échoué, statut remis à free :', uid);
            }
          }
        } else {
          // Ancien flux (checkout antérieur au v2) : recherche par référence.
          // 🐛 BUG CORRIGÉ ici : usersSnap[0] n'existe pas → usersSnap.docs[0]
          const usersSnap = await db.collection('users')
            .where('saspayCheckoutReference', '==', reference)
            .limit(1).get();
          if (!usersSnap.empty) {
            const u = usersSnap.docs[0].data();
            if (u.subscriptionStatus !== 'active') {
              await usersSnap.docs[0].ref.update({ subscriptionStatus: 'free' });
            }
          }
        }
      }
    }

    return res.status(200).json({ received: true });

  } catch (err) {
    console.error('Erreur webhook :', err);
    return res.status(200).send('Erreur loggée');
  }
}
