import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { roomPredictionOperation as operate, predictionId } from '../functions/room-predictions.mjs';
import { DEFAULT_CONFIG } from '../functions/engine.mjs';

test('room predictions: isolation, deadlines, immutable locks, correction-safe scores and XP', async () => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST);
  const projectId = 'demo-f1predict';
  const env = await initializeTestEnvironment({ projectId, firestore: { rules: readFileSync('firestore.rules','utf8') } });
  const app = initializeApp({ projectId }, 'room-predictions');
  const db = getFirestore(app);
  const order = Array.from({ length: 22 }, (_, i) => `d${i}`);
  const time = 10000;
  const save = (uid, id, extra = {}, now = time - 1) => operate(db, uid, { action: 'roomSave', id, raceId: 'r1', session: 'race', order, lock: true, ...extra }, () => now);
  const standings = () => operate(db, 'a', { action: 'roomStandings', id: 'one' });
  try {
    await env.clearFirestore();
    const batch = db.batch();
    for (const id of ['one','two']) {
      batch.set(db.doc(`rooms/${id}`), { hostUid: 'a', memberCount: 2, capacity: 2, status: 'finalized' });
      for (const uid of ['a','b']) batch.set(db.doc(`rooms/${id}/members/${uid}`), { uid, displayName: uid, role: uid === 'a' ? 'host' : 'member' });
    }
    batch.set(db.doc('races/r1'), { name: 'Race 1', round: 1, season: '2026', weekendType: 'standard', status: 'active', gamificationDriverIds: order, sessionDeadlines: { race: Timestamp.fromMillis(time), quali: Timestamp.fromMillis(time) } });
    batch.set(db.doc('gamificationConfig/current'), DEFAULT_CONFIG);
    batch.set(db.doc('users/a'), { seasonPoints: 345 });
    batch.set(db.doc('scores/global-sentinel'), { totalPoints: 345 });
    await batch.commit();
    await assert.rejects(save(null, 'one'), { code: 'unauthenticated' });
    await assert.rejects(save('outsider', 'one'), { code: 'permission-denied' });
    for (const now of [time,time+1]) await assert.rejects(save('a','one',{},now), { code: 'failed-precondition' });
    await assert.rejects(save('a','one',{ order: Array(22).fill('d0') }), { code: 'invalid-argument' });
    await assert.rejects(save('a','one',{ order: order.slice(0,21) }), { code: 'invalid-argument' });
    await assert.rejects(save('a','one',{ session: 'sprint' }), { code: 'failed-precondition' });
    await save('a','one',{ order: order.slice(0,3), lock: false, userId: 'b', totalPoints: 99999, lockedAt: Timestamp.fromMillis(1) });
    assert.equal((await operate(db,'b',{ action:'roomPrediction',id:'one',raceId:'r1',session:'race' })).prediction, null);
    assert.equal((await operate(db,'a',{ action:'roomPrediction',id:'two',raceId:'r1',session:'race' })).prediction, null);
    await assert.rejects(operate(db,'b',{ action:'roomOthers',id:'one',raceId:'r1',session:'race' }), { code: 'permission-denied' });
    await save('a','one');
    await assert.rejects(save('a','one',{order: [...order].reverse()}), { code:'failed-precondition' });
    await assert.rejects(save('a','one',{lock:false}), { code:'failed-precondition' });
    await save('b','one',{order:[...order].reverse()});
    await assert.rejects(operate(db,'a',{ action:'roomOthers',id:'one',raceId:'r1',session:'race' },()=>time-1), {code:'permission-denied'});
    assert.equal((await operate(db,'a',{ action:'roomOthers',id:'one',raceId:'r1',session:'race' },()=>time)).predictions.length,1);
    await assert.rejects(operate(db,'outsider',{action:'roomStandings',id:'one'}),{code:'permission-denied'});
    assert.equal((await standings()).standings.find(s=>s.uid==='a').totalPoints,0);
    await db.doc('results/r1_race').set({ raceId:'r1', session:'race', order, calculatedAt: Timestamp.fromMillis(time) });
    const [first, repeated] = await Promise.all([standings(),standings()]);
    assert.equal(first.standings.find(s=>s.uid==='a').totalPoints,1110);
    assert.deepEqual(first.standings,repeated.standings);
    assert.equal(first.progress.xp,repeated.progress.xp);
    const progressRef = db.doc('rooms/one/progress/2026_a');
    const revision = (await progressRef.get()).data().revision;
    await standings();
    assert.equal((await progressRef.get()).data().revision,revision);
    assert.equal((await db.doc('users/a').get()).data().seasonPoints,345);
    assert.equal((await db.doc('scores/global-sentinel').get()).data().totalPoints,345);
    assert.equal((await db.collection('predictions').get()).size,0);
    assert.equal((await db.collection('gamification').get()).size,0);
    const secondRoom = await operate(db,'a',{action:'roomStandings',id:'two'});
    assert.equal(secondRoom.standings.find(s=>s.uid==='a').totalPoints,0);
    await db.doc('results/r1_race').update({order:[...order].reverse()});
    const corrected = await standings();
    assert.equal(corrected.standings[0].uid,'b');
    assert.ok(corrected.progress.xp < first.progress.xp);
    await db.doc('races/r1').update({cancelledSessions:{race:true}});
    const cancelled = await standings();
    assert.equal(cancelled.standings.find(s=>s.uid==='a').totalPoints,0);
    assert.equal(cancelled.progress.xp,0);
    await db.doc('races/r1').update({cancelledSessions:{}});
    await db.doc('results/r1_race').delete();
    assert.equal((await standings()).standings.find(s=>s.uid==='a').totalPoints,0);
    for (const identity of ['a','b','outsider','admin']) {
      const client = env.authenticatedContext(identity,{admin:identity==='admin'}).firestore();
      for (const path of [`rooms/one/predictions/${predictionId('a','r1','race')}`, 'rooms/one/roundScores/r1','rooms/one/rounds/r1','rooms/one/progress/2026_a','rooms/one/progress/2026_a/history/fake']) {
        await assertFails(setDoc(doc(client,path),{totalPoints:99999,order,lockedAt:new Date(1)}));
        await assertFails(getDoc(doc(client,path)));
      }
    }
    await db.doc('races/r1').update({ sessionDeadlines:{} });
    await assert.rejects(save('a','two'),{code:'failed-precondition'});
  } finally { await env.cleanup(); await deleteApp(app); }
});
