import { createHash } from 'node:crypto';
import { calculate, validateConfig, millis } from './engine.mjs';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const docs = snap => snap.docs.map(d => ({ ...d.data(), id: d.id }));

export async function verifyPrediction(db, id, eventTime) {
  // Only new server-timestamped locks receive eligibility evidence. Never trust
  // a user-supplied `verified` flag or re-issue evidence after order changes.
  await db.runTransaction(async tx => {
    const ref = db.doc(`predictions/${id}`);
    const p = (await tx.get(ref)).data();
    if (!p?.userId || !p.raceId || !p.session) return;
    const receipt = db.doc(`predictionEvidence/${id}`);
    const old = await tx.get(receipt);
    if (old.exists || !Array.isArray(p.order) || p.order.length !== 22 || !millis(p.lockedAt)) return;
    const eventMs = Date.parse(eventTime);
    // Firestore document commit time must correspond to this lock timestamp.
    if (!Number.isFinite(eventMs) || Math.abs(eventMs - millis(p.lockedAt)) > 2000) return;
    tx.create(receipt, { uid: p.userId, fingerprint: hash([p.userId, p.raceId, p.session, p.order, millis(p.lockedAt)]) });
  });
}

export async function reconcileUser(db, uid) {
  return db.runTransaction(async tx => {
    const configSnap = await tx.get(db.doc('gamificationConfig/current'));
    if (!configSnap.exists || !configSnap.data().enabled) return false;
    const config = validateConfig(configSnap.data());
    const ref = db.doc(`gamification/${config.season}_${uid}`);
    const [profile, previous, races, predictions, results, evidence] = await Promise.all([
      tx.get(db.doc(`users/${uid}`)), tx.get(ref), tx.get(db.collection('races')),
      tx.get(db.collection('predictions').where('userId', '==', uid)),
      tx.get(db.collection('results')), tx.get(db.collection('predictionEvidence').where('uid', '==', uid))
    ]);
    if (!profile.exists) return false;
    const proof = new Map(docs(evidence).map(e => [e.id, e.fingerprint]));
    const preds = docs(predictions).map(p => ({ ...p, verified: proof.get(p.id) === hash([p.userId, p.raceId, p.session, p.order, millis(p.lockedAt)]) }));
    const state = calculate({ uid, config, races: docs(races), predictions: preds, results: docs(results) });
    const fingerprint = hash(state);
    const old = previous.data();
    if (old?.fingerprint === fingerprint) return false;
    const revision = (old?.revision || 0) + 1;
    const changes = [];
    for (const id of new Set([...Object.keys(old?.awards || {}), ...Object.keys(state.awards)])) {
      const before = old?.awards?.[id], after = state.awards[id];
      if (JSON.stringify(before) !== JSON.stringify(after)) changes.push({ event: id, delta: (after?.xp || 0) - (before?.xp || 0), reason: after?.reason || `Reversed: ${before.reason}` });
    }
    const updatedAt = new Date();
    tx.set(ref, { ...state, uid, fingerprint, revision, updatedAt });
    tx.create(ref.collection('history').doc(String(revision).padStart(10, '0')), {
      revision, updatedAt, configVersion: config.version, delta: state.xp - (old?.xp || 0), total: state.xp, changes
    });
    return true;
  });
}

export async function reconcileAll(db) {
  // Page users, processing sequentially to bound concurrent Firestore load.
  let last;
  for (;;) {
    let q = db.collection('users').orderBy('__name__').limit(50);
    if (last) q = q.startAfter(last);
    const page = await q.get();
    for (const user of page.docs) await reconcileUser(db, user.id);
    if (page.size < 50) break;
    last = page.docs.at(-1);
  }
}

export async function reconcileUsers(db, uids) {
  for (const uid of [...new Set(uids)].filter(Boolean)) await reconcileUser(db, uid);
}

export async function reconcileRaceUsers(db, raceId) {
  const snap = await db.collection('predictions').where('raceId', '==', raceId).select('userId').get();
  await reconcileUsers(db, snap.docs.map(d => d.get('userId')));
}
