import test from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
test('administrative claims and race/result validation', async () => {
  const env = await initializeTestEnvironment({projectId:'demo-f1predict',firestore:{rules:readFileSync('firestore.rules','utf8')}});
  try {
    await env.clearFirestore();
    const admin=env.authenticatedContext('admin',{admin:true}).firestore();
    const user=env.authenticatedContext('user').firestore();
    const race={name:'Test',round:1,weekendType:'standard',status:'active'};
    await assertFails(setDoc(doc(user,'races/r'),race));
    await assertFails(setDoc(doc(admin,'races/r'),{...race,round:-1}));
    await assertSucceeds(setDoc(doc(admin,'races/r'),race));
    const result={raceId:'r',session:'race',order:Array.from({length:22},(_,i)=>`d${i}`),calculatedAt:serverTimestamp()};
    await assertFails(setDoc(doc(user,'results/r_race'),result));
    await assertFails(setDoc(doc(admin,'results/r_race'),{...result,order:Array(22).fill('d0')}));
    await assertFails(setDoc(doc(admin,'results/r_sprint'),{...result,session:'sprint'}));
    await assertFails(setDoc(doc(admin,'results/r_race'),result));
    await assertFails(updateDoc(doc(admin,'results/r_race'),{order:[...result.order].reverse()}));
    await assertFails(setDoc(doc(admin,'results/r_race'),result));
  } finally { await env.cleanup(); }
});
