import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { doc,setDoc,updateDoc } from 'firebase/firestore';
import { initializeApp,deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { publishResults } from '../functions/publication.mjs';
test('publication is authorized, atomic, revisioned and retry safe',async()=>{
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST);
  const env=await initializeTestEnvironment({projectId:'demo-f1predict',firestore:{rules:readFileSync('firestore.rules','utf8')}});
  const app=initializeApp({projectId:'demo-f1predict'},'publication-test'),db=getFirestore(app);
  const actor={uid:'admin',token:{admin:true}},order=Array.from({length:22},(_,i)=>`d${i}`);
  const input={raceId:'r',session:'race',order,expectedRevision:0};
  try {
    await env.clearFirestore();
    await db.doc('races/r').set({name:'Test',round:1,weekendType:'standard',status:'active',gamificationDriverIds:order});
    for(const uid of ['a','b']) {
      await db.doc(`users/${uid}`).set({displayName:uid,seasonPoints:0,wins:0,lastEventScore:0});
      await db.doc(`predictions/${uid}_r_race`).set({userId:uid,raceId:'r',session:'race',order});
      await db.doc(`predictions/${uid}_r_quali`).set({userId:uid,raceId:'r',session:'quali',order});
    }
    await assert.rejects(publishResults(db,{uid:'fake',token:{},admin:true},input),{code:'permission-denied'});
    await assert.rejects(publishResults(db,actor,{...input,order:Array(22).fill('d0')}),{code:'invalid-argument'});
    // Inject failure after queuing all writes but before the transaction commits.
    const failing={doc:db.doc.bind(db),collection:db.collection.bind(db),runTransaction:fn=>db.runTransaction(async tx=>{await fn(tx);throw Error('simulated commit failure');})};
    await assert.rejects(publishResults(failing,actor,input),/simulated/);
    assert.equal((await db.doc('results/r_race').get()).exists,false);
    assert.equal((await db.doc('users/a').get()).data().seasonPoints,0);
    const both=await Promise.all([publishResults(db,actor,input),publishResults(db,actor,input)]);
    assert.equal(both.filter(r=>r.unchanged).length,1);
    assert.equal((await db.doc('users/a').get()).data().seasonPoints,1110);
    assert.equal((await db.doc('users/a').get()).data().wins,1);
    await publishResults(db,actor,input); // lost-response retry
    assert.equal((await db.doc('users/a').get()).data().seasonPoints,1110);
    const changes=await Promise.allSettled([
      publishResults(db,actor,{...input,expectedRevision:1,order:[...order].reverse()}),
      publishResults(db,actor,{...input,expectedRevision:1,order:[order[1],order[0],...order.slice(2)]})
    ]);
    assert.equal(changes.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(changes.find(r=>r.status==='rejected').reason.code,'aborted');
    await publishResults(db,actor,{...input,session:'quali'});
    const scores=(await db.collection('scores').where('userId','==','a').get()).docs;
    assert.equal((await db.doc('users/a').get()).data().seasonPoints,scores.reduce((s,d)=>s+d.data().totalPoints,0));
    assert.equal((await db.doc('races/r').get()).data().status,'completed');
    for(const uid of ['a','admin']) {
      const client=env.authenticatedContext(uid,{admin:uid==='admin'}).firestore();
      await assertFails(setDoc(doc(client,'results/r_race'),{order}));
      await assertFails(setDoc(doc(client,'scores/a_r_race'),{totalPoints:99999}));
      await assertFails(updateDoc(doc(client,'users/a'),{seasonPoints:99999}));
    }
    const user=env.authenticatedContext('a').firestore();
    await assertFails(updateDoc(doc(user,'predictions/a_r_race'),{order:[...order].reverse()}));
    const batch=db.batch();for(let i=0;i<199;i++)batch.set(db.doc(`users/extra${i}`),{displayName:'X'});await batch.commit();
    await assert.rejects(publishResults(db,actor,{...input,expectedRevision:2,order}),{code:'resource-exhausted'});
    assert.equal((await db.doc('results/r_race').get()).data().publicationRevision,2);
  } finally {await env.cleanup();await deleteApp(app);}
});
