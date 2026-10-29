import { createRequire } from 'node:module';
import { Timestamp } from 'firebase-admin/firestore';
import { calculateSessionScore, calculateSessionWins } from '../js/scoring.js';
const { HttpsError } = createRequire(import.meta.url)('firebase-functions/v2/https');
const fail = (code, message) => { throw new HttpsError(code, message); };
const rows = snap => snap.docs.map(d => ({...d.data(), id:d.id}));

// Publication is all-or-nothing. A failed/lost response is safe to retry with
// the same expected revision; identical content is a no-op after a commit.
export async function publishResults(db, actor, input) {
  if (!actor?.uid || actor.token?.admin !== true) fail('permission-denied','Administrator claim required.');
  const { raceId, session, order, expectedRevision } = input || {};
  if (!/^[\w-]{1,128}$/.test(raceId || '') || !['quali','race','sprint','sprint_quali'].includes(session) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) fail('invalid-argument','Invalid publication request.');
  return db.runTransaction(async tx => {
    const ref = db.doc(`results/${raceId}_${session}`);
    const [raceSnap, previous, driverSnap, predictionSnap, scoreSnap, userSnap] = await Promise.all([
      tx.get(db.doc(`races/${raceId}`)),tx.get(ref),tx.get(db.collection('drivers')),
      tx.get(db.collection('predictions').where('raceId','==',raceId)),
      tx.get(db.collection('scores').limit(20001)),tx.get(db.collection('users').limit(201))
    ]);
    const race = raceSnap.data();
    if (!race || !['active','locked','completed'].includes(race.status) || (session.startsWith('sprint') && race.weekendType !== 'sprint') || race.cancelledSessions?.[session]) fail('failed-precondition','Race/session is not publishable.');
    const roster = race.gamificationDriverIds || driverSnap.docs.map(d=>d.id);
    if (roster.length !== 22 || new Set(roster).size !== 22 || !Array.isArray(order) || order.length !== 22 || new Set(order).size !== 22 || order.some(id=>!roster.includes(id))) fail('invalid-argument','Official order must contain the 22 eligible drivers exactly once.');
    const old = previous.data();
    if (old?.publicationRevision && JSON.stringify(old.order) === JSON.stringify(order)) return { revision:old.publicationRevision, unchanged:true };
    if ((old?.publicationRevision || 0) !== expectedRevision) fail('aborted','Results changed. Reload the official classification before publishing.');
    // Fail before any writes rather than partially publish above the atomic limit.
    if (userSnap.size > 200 || scoreSnap.size > 20000) fail('resource-exhausted','Publication exceeds the atomic capacity; a paginated publication worker is required. No changes were made.');
    const users = rows(userSnap), timestamp = Timestamp.now();
    const previousScores = rows(scoreSnap);
    const replacements = rows(predictionSnap).filter(p=>p.session===session && p.id===`${p.userId}_${raceId}_${session}` && Array.isArray(p.order) && p.order.length===22 && new Set(p.order).size===22 && p.order.every(id=>roster.includes(id)) && users.some(u=>u.id===p.userId)).map(p=>({userId:p.userId,raceId,session,...calculateSessionScore(p.order,order,session),calculatedAt:timestamp}));
    const combined = previousScores.filter(s=>s.raceId!==raceId || s.session!==session).concat(replacements);
    const obsolete = previousScores.filter(s=>s.raceId===raceId && s.session===session && !replacements.some(r=>`${r.userId}_${raceId}_${session}`===s.id));
    if (2 + obsolete.length + replacements.length + users.length > 450) fail('resource-exhausted','Publication exceeds the atomic write budget. No changes were made.');
    const sessions = (race.weekendType === 'sprint' ? ['sprint_quali','sprint','quali','race'] : ['quali','race']).filter(s=>!race.cancelledSessions?.[s]);
    const otherResults = await Promise.all(sessions.filter(s=>s!==session).map(s=>tx.get(db.doc(`results/${raceId}_${s}`))));
    const wins = calculateSessionWins(combined);
    const revision = expectedRevision+1;
    tx.set(ref,{raceId,session,order,calculatedAt:timestamp,publicationRevision:revision,publishedBy:actor.uid});
    // Read/write the race to serialize publication against calendar edits.
    tx.update(raceSnap.ref,{[`sessionLocks.${session}`]:true,...(otherResults.every(r=>r.data()?.calculatedAt) ? {status:'completed'} : {})});
    for (const oldScore of previousScores.filter(s=>s.raceId===raceId && s.session===session && !replacements.some(r=>`${r.userId}_${raceId}_${session}`===s.id))) tx.delete(db.doc(`scores/${oldScore.id}`));
    for (const score of replacements) tx.set(db.doc(`scores/${score.userId}_${raceId}_${session}`),score);
    for (const user of users) {
      const personal = combined.filter(s=>s.userId===user.id);
      const latest = personal.slice().sort((a,b)=>(b.calculatedAt?.toMillis?.()||0)-(a.calculatedAt?.toMillis?.()||0))[0];
      tx.update(db.doc(`users/${user.id}`),{seasonPoints:personal.reduce((sum,s)=>sum+s.totalPoints,0),wins:wins[user.id]||0,lastEventScore:latest?.totalPoints||0});
    }
    return {revision,players:replacements.length};
  });
}
