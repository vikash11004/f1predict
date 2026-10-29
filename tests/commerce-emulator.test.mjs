import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import commerce from '../functions/room-commerce.cjs';
test('local simulation idempotency, isolation, pagination and forbidden financial writes', async () => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST);
  const runtime = {GCLOUD_PROJECT:'demo-f1predict',FUNCTIONS_EMULATOR:'true',FIRESTORE_EMULATOR_HOST:process.env.FIRESTORE_EMULATOR_HOST};
  const env = await initializeTestEnvironment({projectId:'demo-f1predict',firestore:{rules:readFileSync('firestore.rules','utf8')}});
  const app = initializeApp({projectId:'demo-f1predict'},'commerce-tests');
  const db = getFirestore(app);
  const run = (uid,input) => commerce.commerceOperation(db,uid,input,runtime);
  try {
    await env.clearFirestore();
    const input = {action:'commerceTestAttempt',requestId:'one',capacity:10,scenario:'success'};
    const results = await Promise.all(Array.from({length:5},()=>run('owner',input)));
    assert.equal(new Set(results.map(r=>r.id)).size,1);
    assert.equal(results[0].paymentVerified,false); assert.equal(results[0].roomCreated,false);
    await assert.rejects(run('owner',{...input,capacity:25}),{code:'already-exists'});
    for (let i=0;i<22;i++) await run('owner',{...input,requestId:`test-${i}`,scenario:['pending','failure','cancelled'][i%3]});
    const first = await run('owner',{action:'commerceTestHistory'});
    const second = await run('owner',{action:'commerceTestHistory',cursor:first.cursor});
    assert.equal(first.purchases.length,20); assert.equal(second.purchases.length,3); assert.equal(second.cursor,null);
    assert.equal(new Set([...first.purchases,...second.purchases].map(p=>p.id)).size,23);
    assert.equal((await run('stranger',{action:'commerceTestHistory',uid:'owner'})).purchases.length,0);
    assert.equal((await db.collection('rooms').get()).size,0);
    for (const context of [env.authenticatedContext('owner'),env.authenticatedContext('admin',{admin:true}),env.unauthenticatedContext()]) {
      for (const path of [`commerceSimulations/owner/purchases/${results[0].id}`,'roomPurchases/fake','paymentEvents/fake','paymentBindings/fake','refundRequests/fake','paymentAudit/fake','roomPriceCatalog/fake','roomQuotes/fake']) {
        await assertFails(getDoc(doc(context.firestore(),path)));
        await assertFails(setDoc(doc(context.firestore(),path),{paid:true,totalPaise:1}));
      }
    }
  } finally {await env.cleanup(); await deleteApp(app);}
});
