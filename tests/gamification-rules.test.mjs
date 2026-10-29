import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { DEFAULT_CONFIG } from '../functions/engine.mjs';
import { reconcileUser, verifyPrediction } from '../functions/processor.mjs';

test('rules deny forged awards; reconciliation is atomic and idempotent', async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Firestore emulator required');
  const projectId = 'demo-f1predict';
  const env = await initializeTestEnvironment({ projectId, firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
  const app = initializeApp({ projectId }, 'gamification-test');
  const backend = getFirestore(app);
  try {
    await env.clearFirestore();
    const user = env.authenticatedContext('u').firestore();
    const other = env.authenticatedContext('v').firestore();
    const admin = env.authenticatedContext('admin', { admin: true }).firestore();
    const anonymous = env.unauthenticatedContext().firestore();
    const profile = { displayName: 'Test driver', seasonPoints: 0, lastEventScore: 0, wins: 0 };
    await assertFails(setDoc(doc(user, 'users/u'), { ...profile, xp: 1000, admin: true }));
    await assertSucceeds(setDoc(doc(user, 'users/u'), profile));
    await assertFails(updateDoc(doc(user, 'users/u'), { xp: 1000 }));
    const order = Array.from({ length: 22 }, (_, i) => `d${i}`);
    await backend.doc('gamificationConfig/current').set(DEFAULT_CONFIG);
    await backend.doc('races/r1').set({ round: 1, name: 'Test GP', weekendType: 'standard', gamificationDriverIds: order, sessionDeadlines: { quali: Timestamp.fromMillis(Date.now() + 60000), race: Timestamp.fromMillis(Date.now() + 60000) } });
    const p = { userId: 'u', raceId: 'r1', session: 'quali', order };
    await assertSucceeds(setDoc(doc(user, 'predictions/u_r1_quali'), { ...p, order: order.slice(0, 2) }));
    await assertFails(updateDoc(doc(user, 'predictions/u_r1_quali'), { order, lockedAt: new Date(1) }));
    await assertSucceeds(updateDoc(doc(user, 'predictions/u_r1_quali'), { order, lockedAt: serverTimestamp() }));
    const pred = (await backend.doc('predictions/u_r1_quali').get()).data();
    await verifyPrediction(backend, 'u_r1_quali', pred.lockedAt.toDate().toISOString());
    await assertFails(updateDoc(doc(user, 'predictions/u_r1_quali'), { order: [...order].reverse() }));
    for (const client of [user, other, admin, anonymous]) {
      await assertFails(setDoc(doc(client, 'gamification/2026_u'), { uid: 'u', xp: 999999 }));
      await assertFails(setDoc(doc(client, 'gamification/2026_u/history/fake'), { delta: 99 }));
      await assertFails(setDoc(doc(client, 'predictionEvidence/fake'), { uid: 'u' }));
      await assertFails(setDoc(doc(client, 'gamificationConfig/current'), DEFAULT_CONFIG));
    }
    await Promise.all([reconcileUser(backend, 'u'), reconcileUser(backend, 'u')]);
    const state = (await backend.doc('gamification/2026_u').get()).data();
    assert.equal(state.xp, 45);
    assert.equal(state.revision, 1);
    assert.equal((await backend.collection('gamification/2026_u/history').get()).size, 1);
    await assertSucceeds(getDoc(doc(user, 'gamification/2026_u')));
    await assertFails(getDoc(doc(other, 'gamification/2026_u')));
    await assertFails(getDoc(doc(anonymous, 'gamification/2026_u')));
    await backend.doc('races/r1').update({ cancelledSessions: { quali: true } });
    await reconcileUser(backend, 'u');
    const after = (await backend.doc('gamification/2026_u').get()).data();
    assert.equal(after.xp, 0);
    assert.equal(after.revision, 2);
    assert.equal((await backend.doc('gamification/2026_u/history/0000000002').get()).data().delta, -45);
    assert.equal(await reconcileUser(backend, 'u'), false);
    assert.deepEqual((await backend.doc('users/u').get()).data(), profile);
  } finally { await env.cleanup(); await deleteApp(app); }
});
