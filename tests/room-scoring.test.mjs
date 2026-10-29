import test from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';
import { getPointsForDiff, calculateSessionScore, calculateWeekendTotal, getMaxPoints, BONUS_CONDITIONS } from '../js/scoring.js';
import { isOpen, scoreSession, standingsHistory } from '../functions/room-predictions.mjs';
const order = Array.from({ length: 22 }, (_, i) => `d${i}`);
const race = { id: 'r', status: 'active', weekendType: 'sprint', gamificationDriverIds: order, sessionDeadlines: Object.fromEntries(['race', 'quali', 'sprint', 'sprint_quali'].map(s => [s, Timestamp.fromMillis(1000)])) };

test('every accuracy tier, all session types, and all six stacked bonuses preserve existing rules', () => {
  for (const session of ['race', 'sprint', 'quali', 'sprint_quali']) {
    const table = ['race', 'sprint'].includes(session) ? [20, 15, 10, 7, 5, 3] : [15, 10, 7, 5, 3, 1];
    for (let diff = 0; diff <= 22; diff++) assert.equal(getPointsForDiff(diff, session), table[diff] || 0);
    const perfect = calculateSessionScore(order, order, session);
    assert.equal(perfect.accuracyPoints, 22 * table[0]);
    assert.equal(perfect.bonusPoints, 670);
    assert.deepEqual(perfect.bonuses.map(b => [b.id, b.points, b.earned]), [['p1_correct', 20, true], ['top3_any', 20, true], ['top3_exact', 40, true], ['top5_any', 30, true], ['top5_exact', 60, true], ['perfect', 500, true]]);
    const variants = [
      [order, [true,true,true,true,true,true]],
      [[order[1], order[0], ...order.slice(2)], [false,true,false,true,false,false]],
      [[order[0], order[2], order[1], ...order.slice(3)], [true,true,false,true,false,false]],
      [[...order.slice(0,3), order[4], order[3], ...order.slice(5)], [true,true,true,true,false,false]],
      [[...order.slice(0,5), order[6], order[5], ...order.slice(7)], [true,true,true,true,true,false]],
      [[...order.slice(5), ...order.slice(0,5)], [false,false,false,false,false,false]]
    ];
    for (const [predicted, expected] of variants) {
      const score = calculateSessionScore(predicted, order, session);
      assert.deepEqual(score.bonuses.map(b => b.earned), expected);
      assert.equal(score.bonusPoints, expected.reduce((sum, earned, i) => sum + (earned ? BONUS_CONDITIONS[i].points : 0), 0));
      assert.equal(score.accuracyPoints, predicted.reduce((sum, d, i) => sum + (table[Math.abs(i - order.indexOf(d))] || 0), 0));
    }
    assert.equal(calculateSessionScore([], order, session).totalPoints, 0);
  }
  const scores = ['quali', 'race', 'sprint_quali', 'sprint'].map(s => calculateSessionScore(order, order, s));
  assert.equal(calculateWeekendTotal(scores.slice(0, 2)), 2110);
  assert.equal(calculateWeekendTotal(scores), 4220);
  assert.deepEqual(getMaxPoints('standard'), { maxBase: 770, maxWithBonuses: 1110, maxPerfect: 2110 });
  assert.deepEqual(getMaxPoints('sprint'), { maxBase: 1540, maxWithBonuses: 2220, maxPerfect: 4220 });
});

test('deadline is exclusive; cancellation, invalid orders and missing results cannot score', () => {
  assert.equal(isOpen(race, 'race', 999), true);
  assert.equal(isOpen(race, 'race', 1000), false);
  assert.equal(isOpen(race, 'race', 1001), false);
  for (const variant of [{ ...race, sessionDeadlines: {} }, { ...race, status: 'locked' }, { ...race, sessionLocks: { race: true } }, { ...race, cancelledSessions: { race: true } }]) assert.equal(isOpen(variant, 'race', 999), false);
  const pred = { order, lockedAt: Timestamp.fromMillis(999) };
  const result = { raceId: 'r', session: 'race', order, calculatedAt: Timestamp.fromMillis(1000) };
  assert.equal(scoreSession(race, 'race', pred, result).totalPoints, 1110);
  assert.equal(scoreSession(race, 'race', { ...pred, lockedAt: Timestamp.fromMillis(1000) }, result).totalPoints, 0);
  assert.equal(scoreSession(race, 'race', pred, null).status, 'pending');
  assert.equal(scoreSession(race, 'race', pred, { ...result, order: Array(22).fill('d0') }).status, 'pending');
  assert.equal(scoreSession(race, 'race', { ...pred, order: Array(22).fill('d0') }, result).status, 'unsubmitted');
  assert.equal(scoreSession({ ...race, cancelledSessions: { race: true } }, 'race', pred, result).status, 'cancelled');
});

test('historical standings use competition ranks, deterministic ties and position changes', () => {
  const members = [{ uid: 'a', displayName: 'A' }, { uid: 'b', displayName: 'B' }, { uid: 'c', displayName: 'C' }];
  const history = standingsHistory([{ scores: { a: { race: { totalPoints: 10 } }, b: { race: { totalPoints: 10 } } } }, { scores: { c: { race: { totalPoints: 20 } } } }], members);
  assert.deepEqual(history[0].standings.map(s => s.position), [1,1,3]);
  assert.deepEqual(history[1].standings.map(s => [s.uid,s.position,s.change]), [['c',1,2],['a',2,-1],['b',2,-1]]);
  const joinedLater = standingsHistory([{cutoff:1000,scores:{}},{cutoff:3000,scores:{}}],[{uid:'new',displayName:'New',joinedAt:new Date(2000).toISOString()}]);
  assert.equal(joinedLater[0].standings.length,0);
  assert.equal(joinedLater[1].standings[0].change,null);
});
