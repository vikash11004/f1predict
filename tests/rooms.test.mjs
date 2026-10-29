import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, collection, getDocs } from 'firebase/firestore';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import rooms from '../functions/rooms.cjs';
const { roomOperation: operate } = rooms;

test('room validation rejects unauthenticated and invalid creation', async () => {
  await assert.rejects(operate(null, null, {}), { code: 'unauthenticated' });
  const db = { collection: () => ({}) };
  for (const capacity of [0, 1, 101, 2.5, '10']) {
    await assert.rejects(operate(db, 'host', { action: 'create', name: 'Test', capacity }), { code: 'invalid-argument' });
  }
});

test('atomic rooms, invitation permissions, finalization and isolation', async () => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, 'Run through Firestore emulator');
  const projectId = 'demo-f1predict';
  const env = await initializeTestEnvironment({ projectId, firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
  const app = initializeApp({ projectId }, 'room-tests');
  const db = getFirestore(app);
  const create = (uid, requestId, capacity = 3, allowInvites = true) => operate(db, uid, { action: 'create', requestId, name: 'Paddock', description: 'Friends', capacity, allowInvites, role: 'admin', memberCount: -100, status: 'fake' });
  try {
    await env.clearFirestore();
    const first = await create('host', 'first');
    assert.deepEqual(await create('host', 'first'), first);
    const room = db.doc(`rooms/${first.id}`);
    assert.equal((await room.get()).data().memberCount, 1);
    assert.equal((await room.get()).data().status, 'open');
    const { code } = await operate(db, 'host', { action: 'invite', id: first.id });
    await assert.rejects(operate(db, 'outsider', { action: 'join', code: 'bad' }), { code: 'not-found' });
    await assert.rejects(operate(db, 'outsider', { action: 'join', code: 'f'.repeat(36) }), { code: 'not-found' });
    const joins = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => operate(db, `u${i}`, { action: 'join', code })));
    assert.equal(joins.filter(result => result.status === 'fulfilled').length, 2);
    assert.equal(joins.filter(result => result.status === 'rejected' && result.reason.code === 'resource-exhausted').length, 4);
    assert.equal((await room.get()).data().memberCount, 3);
    const overview = await operate(db, 'host', { action: 'overview', id: first.id });
    const member = overview.members.find(item => item.uid !== 'host').uid;
    await operate(db, member, { action: 'join', code });
    assert.equal((await room.get()).data().memberCount, 3);
    await assert.rejects(operate(db, member, { action: 'invite', id: first.id }), { code: 'permission-denied' });
    await assert.rejects(operate(db, member, { action: 'finalize', id: first.id, role: 'host' }), { code: 'permission-denied' });
    await assert.rejects(operate(db, 'outsider', { action: 'overview', id: first.id }), { code: 'permission-denied' });
    const second = await create(member, 'second');
    const secondCode = (await operate(db, member, { action: 'invite', id: second.id })).code;
    await Promise.all([operate(db, 'repeat', { action: 'join', code: secondCode }), operate(db, 'repeat', { action: 'join', code: secondCode })]);
    assert.equal((await db.doc(`rooms/${second.id}`).get()).data().memberCount, 2);
    assert.equal((await operate(db, member, { action: 'list' })).rooms.length, 2);
    assert.equal((await operate(db, 'outsider', { action: 'list' })).rooms.length, 0);
    await operate(db, 'host', { action: 'finalize', id: first.id });
    await operate(db, 'host', { action: 'finalize', id: first.id });
    await assert.rejects(operate(db, 'late', { action: 'join', code }), { code: 'failed-precondition' });
    await operate(db, member, { action: 'join', code }); // Existing membership remains usable.
    const disabled = await create('host', 'disabled', 3, false);
    await assert.rejects(operate(db, 'host', { action: 'invite', id: disabled.id }), { code: 'failed-precondition' });
    const disabledCode = (await db.doc(`rooms/${disabled.id}/private/invitation`).get()).data().code;
    await assert.rejects(operate(db, 'outsider', { action: 'join', code: disabledCode }), { code: 'failed-precondition' });
    const race = await create('host', 'race', 10);
    const raceCode = (await operate(db, 'host', { action: 'invite', id: race.id })).code;
    await Promise.allSettled([operate(db, 'host', { action: 'finalize', id: race.id }), operate(db, 'racer', { action: 'join', code: raceCode })]);
    assert.equal((await db.doc(`rooms/${race.id}`).get()).data().status, 'finalized');
    await assert.rejects(operate(db, 'later', { action: 'join', code: raceCode }), { code: 'failed-precondition' });
    for (const client of [env.authenticatedContext('host').firestore(), env.authenticatedContext(member).firestore(), env.authenticatedContext('outsider').firestore(), env.authenticatedContext('admin', { admin: true }).firestore(), env.unauthenticatedContext().firestore()]) {
      await assertFails(setDoc(doc(client, `rooms/${first.id}`), { hostUid: 'outsider', memberCount: 0, status: 'open' }));
      await assertFails(setDoc(doc(client, `rooms/${first.id}/members/outsider`), { role: 'host' }));
      await assertFails(setDoc(doc(client, 'roomDirectories/outsider/rooms/fake'), { name: 'Fake' }));
      await assertFails(getDoc(doc(client, `rooms/${first.id}/private/invitation`)));
      await assertFails(getDocs(collection(client, 'roomInvitations')));
    }
    const hostClient = env.authenticatedContext('host').firestore();
    await assertSucceeds(getDoc(doc(hostClient, `rooms/${first.id}`)));
    await assertSucceeds(getDocs(collection(hostClient, `rooms/${first.id}/members`)));
    await assertSucceeds(getDocs(collection(hostClient, 'roomDirectories/host/rooms')));
    await assertFails(getDoc(doc(hostClient, `rooms/${second.id}`)));
    await assertFails(getDocs(collection(hostClient, `roomDirectories/${member}/rooms`)));
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), `rooms/${first.id}`)));
    await assertFails(getDocs(collection(env.authenticatedContext('outsider').firestore(), `rooms/${first.id}/members`)));
    const batch = db.batch();
    for (let i = 0; i < 51; i++) batch.set(db.doc(`roomDirectories/paging/rooms/r${String(i).padStart(3, '0')}`), { name: 'Page', role: 'member' });
    await batch.commit();
    const page1 = await operate(db, 'paging', { action: 'list' });
    const page2 = await operate(db, 'paging', { action: 'list', cursor: page1.cursor });
    assert.equal(page1.rooms.length, 50);
    assert.equal(page2.rooms.length, 1);
    assert.equal(page2.cursor, null);
    assert.notEqual(page1.rooms[49].id, page2.rooms[0].id);
  } finally { await env.cleanup(); await deleteApp(app); }
});
