import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

test('callable verifies Firebase tokens and serves authenticated room workflows', async () => {
  assert.ok(process.env.FIREBASE_AUTH_EMULATOR_HOST && process.env.FIRESTORE_EMULATOR_HOST, 'Auth, Firestore and Functions emulators required');
  const endpoint = 'http://127.0.0.1:5001/demo-f1predict/us-central1/rooms';
  const call = async (data, token) => {
    const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ data }) });
    return response.json();
  };
  assert.equal((await call({ action: 'list' })).error.status, 'UNAUTHENTICATED');
  assert.equal((await call({ action: 'list' }, 'forged')).error.status, 'UNAUTHENTICATED');
  const account = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `rooms-${Date.now()}@example.test`, password: 'testing-only-123', returnSecureToken: true }) }).then(response => response.json());
  assert.ok(account.idToken);
  const created = await call({ action: 'create', requestId: 'http-test', name: 'Callable room', description: '', capacity: 2, allowInvites: true }, account.idToken);
  assert.ok(created.result?.id, JSON.stringify(created));
  const overview = await call({ action: 'overview', id: created.result.id }, account.idToken);
  assert.equal(overview.result.hostUid, account.localId);
  assert.equal(overview.result.memberCount, 1);
  assert.ok((await call({ action: 'invite', id: created.result.id }, account.idToken)).result.code);
  assert.ok((await call({ action: 'finalize', id: created.result.id }, account.idToken)).result.id);
  const app = initializeApp({ projectId:'demo-f1predict' },'callable-room-predictions');
  try {
    const db = getFirestore(app), order = Array.from({length:22},(_,i)=>`d${i}`);
    await db.doc('races/http-race').set({ name:'HTTP Race',round:1,status:'active',weekendType:'standard',gamificationDriverIds:order,sessionDeadlines:{race:Timestamp.fromMillis(Date.now()+60000)} });
    const input = { id:created.result.id,raceId:'http-race',session:'race' };
    assert.equal((await call({ ...input, action:'roomSave',order,lock:true },account.idToken)).result?.locked,true);
    assert.equal((await call({ ...input, action:'roomSave',order:[...order].reverse(),lock:false },account.idToken)).error?.status,'FAILED_PRECONDITION');
    assert.equal((await call({ ...input, action:'roomPrediction' },account.idToken)).result?.prediction?.order.length,22);
    assert.equal((await call({ ...input, action:'roomOthers' },account.idToken)).error?.status,'PERMISSION_DENIED');
  } finally { await deleteApp(app); }
});
