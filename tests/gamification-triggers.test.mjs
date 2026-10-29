import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import { DEFAULT_CONFIG } from '../functions/engine.mjs';
test('real local triggers award and reverse XP from source events', { timeout: 90000 }, async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Emulator required');
  const app = initializeApp({ projectId: 'demo-f1predict' });
  const db = getFirestore(app);
  const uid = 'trigger-test';
  const order = Array.from({ length: 22 }, (_, i) => `d${i}`);
  const waitFor = async predicate => {
    for (let i = 0; i < 100; i++) {
      const s = (await db.doc(`gamification/2026_${uid}`).get()).data();
      if (s && predicate(s)) return s;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error('Trigger did not produce expected state');
  };
  try {
    await db.doc('gamificationConfig/current').set(DEFAULT_CONFIG);
    await db.doc(`users/${uid}`).set({ displayName: 'Test', seasonPoints: 0, lastEventScore: 0, wins: 0 });
    const deadline = Date.now() + 2000;
    await db.doc('races/r1').set({ name: 'Test', round: 1, weekendType: 'standard', cancelledSessions: { quali: true }, gamificationDriverIds: order, sessionDeadlines: { race: Timestamp.fromMillis(deadline) } });
    await db.doc(`predictions/${uid}_r1_race`).set({ userId: uid, raceId: 'r1', session: 'race', order, lockedAt: FieldValue.serverTimestamp() });
    await waitFor(s => s.xp === 45);
    await new Promise(resolve => setTimeout(resolve, Math.max(0, deadline - Date.now() + 100)));
    await db.doc('results/r1_race').set({ raceId: 'r1', session: 'race', order, calculatedAt: FieldValue.serverTimestamp() });
    const result = await waitFor(s => s.xp === 375);
    assert.equal(result.stats.bestScore, 1110);
    await db.doc('races/r1').update({ cancelledSessions: { quali: true, race: true } });
    const cancelled = await waitFor(s => s.xp === 0);
    assert.equal(cancelled.stats.currentStreak, 0);
    assert.ok(cancelled.revision > result.revision);
  } finally { await deleteApp(app); }
});
