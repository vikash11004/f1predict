import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';
// Use the same CJS HttpsError class as the callable wrapper (SDK dual exports).
const { HttpsError } = createRequire(import.meta.url)('firebase-functions/v2/https');
import { calculateSessionScore } from '../js/scoring.js';
import { calculate, validateConfig, millis } from './engine.mjs';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const rows = snapshot => snapshot.docs.map(d => ({ ...d.data(), id: d.id }));
const fail = (code, message) => { throw new HttpsError(code, message); };
const validId = id => typeof id === 'string' && /^[\w-]{1,128}$/.test(id);
export const sessionsFor = race => race.weekendType === 'sprint' ? ['sprint_quali', 'sprint', 'quali', 'race'] : race.weekendType === 'standard' ? ['quali', 'race'] : [];
export const predictionId = (uid, raceId, session) => digest([uid, raceId, session]);
const validOrder = (order, roster, complete = true) => Array.isArray(order) && (complete ? order.length === 22 : order.length <= 22) && new Set(order).size === order.length && order.every(id => roster.includes(id));
export function isOpen(race, session, now) {
  return sessionsFor(race).includes(session) && race.status === 'active' && !race.sessionLocks?.[session] && !race.cancelledSessions?.[session] && millis(race.sessionDeadlines?.[session]) > now;
}
function rosterFor(race) {
  const roster = race.gamificationDriverIds;
  if (!Array.isArray(roster) || roster.length !== 22 || new Set(roster).size !== 22 || roster.some(id => typeof id !== 'string')) fail('failed-precondition', 'Race Control must configure the 22-driver roster.');
  return roster;
}
export function scoreSession(race, session, prediction, result) {
  const roster = race.gamificationDriverIds || [];
  const deadline = millis(race.sessionDeadlines?.[session]);
  if (race.cancelledSessions?.[session]) return { status: 'cancelled', totalPoints: 0 };
  if (!deadline || roster.length !== 22 || new Set(roster).size !== 22 || !validOrder(result?.order, roster) || millis(result?.calculatedAt) < deadline || result?.raceId !== race.id || result?.session !== session) return { status: 'pending', totalPoints: 0 };
  if (!prediction?.lockedAt || millis(prediction.lockedAt) >= deadline || !validOrder(prediction.order, roster)) return { status: 'unsubmitted', totalPoints: 0 };
  return { status: 'scored', ...calculateSessionScore(prediction.order, result.order, session) };
}

// Rebuild one bounded weekend only when its authoritative inputs change.
async function roundScores(db, roomId, raceId) {
  const root = db.doc(`rooms/${roomId}`);
  return db.runTransaction(async tx => {
    const raceSnap = await tx.get(db.doc(`races/${raceId}`));
    const race = { ...raceSnap.data(), id: raceId };
    const sessions = sessionsFor(race);
    const [revision, previous, ...results] = await Promise.all([
      tx.get(root.collection('rounds').doc(raceId)), tx.get(root.collection('roundScores').doc(raceId)),
      ...sessions.map(s => tx.get(db.doc(`results/${raceId}_${s}`)))
    ]);
    const fingerprint = digest([raceSnap.updateTime, revision.data()?.revision || 0, results.map(r => r.updateTime || null)]);
    if (previous.data()?.fingerprint === fingerprint) return previous.data();
    const predictions = rows(await tx.get(root.collection('predictions').where('raceId', '==', raceId).limit(401)));
    if (predictions.length > 400) fail('failed-precondition', 'Room prediction limit exceeded.');
    const scores = {}, states = {};
    for (const [i, session] of sessions.entries()) {
      const result = results[i].data();
      states[session] = scoreSession(race, session, null, result).status;
      for (const p of predictions.filter(p => p.session === session)) {
        const score = scoreSession(race, session, p, result);
        scores[p.userId] ||= {};
        // Keep cached summaries small; detailed breakdowns are computed for the owner.
        scores[p.userId][session] = { status: score.status, totalPoints: score.totalPoints };
      }
    }
    const output = { raceId, round: race.round, name: race.name, season: String(race.season || '2026'), cutoff: Math.max(0, ...sessions.map(s => millis(race.sessionDeadlines?.[s]))), states, scores, fingerprint };
    tx.set(root.collection('roundScores').doc(raceId), output);
    return output;
  });
}

export function standingsHistory(rounds, members) {
  const totals = Object.fromEntries(members.map(m => [m.uid, 0]));
  let previous = {};
  return rounds.map(round => {
    const points = {};
    for (const m of members) {
      points[m.uid] = Object.values(round.scores[m.uid] || {}).reduce((sum, s) => sum + s.totalPoints, 0);
      totals[m.uid] += points[m.uid];
    }
    const eligible = members.filter(m => !round.cutoff || !m.joinedAt || Date.parse(m.joinedAt) <= round.cutoff);
    const sorted = eligible.map(m => ({ uid: m.uid, displayName: m.displayName, totalPoints: totals[m.uid], racePoints: points[m.uid] })).sort((a, b) => b.totalPoints - a.totalPoints || a.uid.localeCompare(b.uid));
    let rank = 0;
    const standings = sorted.map((m, i) => {
      if (!i || sorted[i - 1].totalPoints !== m.totalPoints) rank = i + 1;
      return { ...m, position: rank, change: previous[m.uid] == null ? null : previous[m.uid] - rank };
    });
    previous = Object.fromEntries(standings.map(m => [m.uid, m.position]));
    return { ...round, standings };
  });
}

async function progress(db, root, uid, season) {
  return db.runTransaction(async tx => {
    const configSnap = await tx.get(db.doc('gamificationConfig/current'));
    if (!configSnap.exists || !configSnap.data().enabled) return null;
    const config = validateConfig(configSnap.data());
    if (config.season !== season) return null;
    const ref = root.collection('progress').doc(`${config.season}_${uid}`);
    const [oldSnap, races, results, predictions] = await Promise.all([
      tx.get(ref), tx.get(db.collection('races')), tx.get(db.collection('results')),
      tx.get(root.collection('predictions').where('userId', '==', uid))
    ]);
    const state = calculate({ uid, config, races: rows(races), results: rows(results), predictions: rows(predictions).filter(p => p.lockedAt).map(p => ({ ...p, id: `${uid}_${p.raceId}_${p.session}`, verified: true })) });
    const fingerprint = digest(state), old = oldSnap.data();
    if (old?.fingerprint !== fingerprint) {
      const revision = (old?.revision || 0) + 1;
      const changes = [...new Set([...Object.keys(old?.awards || {}), ...Object.keys(state.awards)])].flatMap(event => {
        const before = old?.awards?.[event], after = state.awards[event];
        return JSON.stringify(before) === JSON.stringify(after) ? [] : [{ event, delta: (after?.xp || 0) - (before?.xp || 0), reason: after?.reason || `Reversed: ${before.reason}` }];
      });
      tx.set(ref, { ...state, uid, fingerprint, revision });
      tx.create(ref.collection('history').doc(String(revision).padStart(10, '0')), { revision, delta: state.xp - (old?.xp || 0), changes, updatedAt: Timestamp.now() });
    }
    return state;
  });
}

export async function roomPredictionOperation(db, uid, input, clock = Date.now) {
  if (!uid) fail('unauthenticated', 'Sign in to predict.');
  if (!input || !validId(input.id)) fail('invalid-argument', 'Invalid room.');
  const root = db.doc(`rooms/${input.id}`);
  if (!(await root.collection('members').doc(uid).get()).exists) fail('permission-denied', 'Room membership required.');
  if (input.action === 'roomStandings') {
    const season = input.season || '2026';
    if (!/^\d{4}$/.test(season)) fail('invalid-argument', 'Invalid season.');
    const races = rows(await db.collection('races').get()).filter(r => String(r.season || '2026') === season).sort((a, b) => a.round - b.round || a.id.localeCompare(b.id));
    if (races.length > 60) fail('failed-precondition', 'Season exceeds 60 weekends.');
    const members = rows(await root.collection('members').limit(100).get());
    const rounds = [];
    for (const race of races) rounds.push(await roundScores(db, input.id, race.id));
    const history = standingsHistory(rounds.filter(r => Object.values(r.states).some(s => s !== 'pending')), members);
    const latest = history.at(-1)?.standings || [];
    const current = members.map(m => latest.find(s => s.uid === m.uid) || { uid: m.uid, displayName: m.displayName, totalPoints: 0, racePoints: 0, change: null }).sort((a,b) => b.totalPoints - a.totalPoints || a.uid.localeCompare(b.uid));
    let position = 0;
    const standings = current.map((s,i) => { if (!i || current[i-1].totalPoints !== s.totalPoints) position = i+1; return {...s,position}; });
    return { races: races.map(r => ({ id: r.id, name: r.name, round: r.round, sessions: sessionsFor(r) })), history, standings, progress: await progress(db, root, uid, season) };
  }
  const { raceId, session, action } = input;
  if (!validId(raceId) || !['quali', 'race', 'sprint', 'sprint_quali'].includes(session)) fail('invalid-argument', 'Invalid race or session.');
  const ref = root.collection('predictions').doc(predictionId(uid, raceId, session));
  if (action === 'roomSave') {
    return db.runTransaction(async tx => {
      const [raceSnap, member, existing, result] = await Promise.all([tx.get(db.doc(`races/${raceId}`)), tx.get(root.collection('members').doc(uid)), tx.get(ref), tx.get(db.doc(`results/${raceId}_${session}`))]);
      if (!member.exists) fail('permission-denied', 'Room membership required.');
      const race = raceSnap.data();
      if (!race) fail('not-found', 'Race not found.');
      const now = clock();
      if (!isOpen(race, session, now) || result.data()?.calculatedAt) fail('failed-precondition', 'This session is closed or its deadline has passed.');
      if (existing.data()?.lockedAt) fail('failed-precondition', 'This prediction is locked.');
      if (typeof input.lock !== 'boolean' || !validOrder(input.order, rosterFor(race), input.lock)) fail('invalid-argument', 'Use each eligible driver once; locking requires all 22.');
      const timestamp = Timestamp.fromMillis(now);
      tx.set(ref, { userId: uid, roomId: input.id, raceId, session, order: input.order, updatedAt: timestamp, ...(input.lock ? { lockedAt: timestamp } : {}) });
      if (input.lock) tx.set(root.collection('rounds').doc(raceId), { revision: FieldValue.increment(1) }, { merge: true });
      return { saved: true, locked: input.lock };
    });
  }
  const raceSnap = await db.doc(`races/${raceId}`).get();
  if (!raceSnap.exists) fail('not-found', 'Race not found.');
  const race = { ...raceSnap.data(), id: raceId };
  if (!sessionsFor(race).includes(session)) fail('invalid-argument', 'Session is not part of this weekend.');
  const prediction = (await ref.get()).data() || null;
  if (action === 'roomOthers') {
    const deadline = millis(race.sessionDeadlines?.[session]);
    if (!prediction?.lockedAt || !deadline || clock() < deadline || race.cancelledSessions?.[session]) fail('permission-denied', 'Other predictions are available after the deadline, once yours is locked.');
    return { predictions: rows(await root.collection('predictions').where('raceId', '==', raceId).limit(400).get()).filter(p => p.session === session && p.lockedAt && p.userId !== uid) };
  }
  if (action !== 'roomPrediction') fail('invalid-argument', 'Unknown prediction operation.');
  const result = (await db.doc(`results/${raceId}_${session}`).get()).data();
  const score = scoreSession(race, session, prediction, result);
  return { prediction, score: score.status === 'scored' ? score : null, result: score.status === 'scored' ? result.order : null, readOnly: !!prediction?.lockedAt || !isOpen(race, session, clock()) || !!result?.calculatedAt, deadline: millis(race.sessionDeadlines?.[session]), status: score.status };
}
