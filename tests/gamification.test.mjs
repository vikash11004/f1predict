import test from 'node:test';
import assert from 'node:assert/strict';
import { calculate, DEFAULT_CONFIG, levelFor, validateConfig } from '../functions/engine.mjs';
const ts = n => ({ toMillis: () => n });
const order = Array.from({ length: 22 }, (_, i) => `d${i}`);
function input(count = 1) {
  const data = { uid: 'u', config: structuredClone(DEFAULT_CONFIG), races: [], predictions: [], results: [] };
  for (let i = 1; i <= count; i++) {
    const id = `r${i}`;
    data.races.push({ id, name: id, round: i, weekendType: 'standard', gamificationDriverIds: order, sessionDeadlines: { quali: ts(1000), race: ts(2000) } });
    for (const session of ['quali', 'race']) {
      data.predictions.push({ id: `u_${id}_${session}`, userId: 'u', raceId: id, session, order, lockedAt: ts(500), verified: true });
      data.results.push({ id: `${id}_${session}`, raceId: id, session, order, calculatedAt: ts(3000) });
    }
  }
  return data;
}
test('awards use unchanged scoring; XP remains separate', () => {
  const s = calculate(input());
  assert.equal(s.stats.predictionPoints, 2110);
  assert.equal(s.stats.perfects, 2);
  assert.equal(s.xp, 525);
  assert.equal(s.level, 4);
  assert.equal(s.stats.currentStreak, 1);
  assert.equal(Object.keys(s.awards).length, 10);
});
test('level boundaries and cap', () => {
  for (const [xp, level] of [[0,1],[99,1],[100,2],[249,2],[250,3],[4000,7],[9000,7]]) assert.equal(levelFor(xp, DEFAULT_CONFIG.thresholds).level, level);
  assert.equal(levelFor(9000, DEFAULT_CONFIG.thresholds).nextLevel, null);
});
test('repeat and out-of-order processing produce identical awards', () => {
  const data = input(3), first = calculate(data);
  assert.deepEqual(calculate(data), first);
  data.predictions.reverse(); data.results.reverse(); data.races.reverse();
  assert.deepEqual(calculate(data), first);
  assert.equal(first.stats.bestStreak, 3);
});
test('missed prediction breaks streak; fully cancelled weekend is neutral', () => {
  const data = input(3);
  data.predictions = data.predictions.filter(p => p.raceId !== 'r2');
  assert.equal(calculate(data).stats.currentStreak, 1);
  data.races[1].cancelledSessions = { quali: true, race: true };
  assert.equal(calculate(data).stats.currentStreak, 2);
});
test('missing results pause streak and withhold weekend XP', () => {
  const data = input(3);
  data.results = data.results.filter(r => r.raceId !== 'r2');
  const s = calculate(data);
  assert.equal(s.stats.currentStreak, 1);
  assert.equal(s.awards['weekend:r2'], undefined);
  assert.ok(s.awards['prediction:r2_race']);
});
test('cancellation and corrections revoke dependent awards', () => {
  const data = input();
  data.results[0].order = [...order].reverse();
  assert.equal(calculate(data).awards['perfect:r1_quali'], undefined);
  data.races[0].cancelledSessions = { quali: true, race: true };
  assert.equal(calculate(data).xp, 0);
});
test('invalid orders, late locks, missing evidence and unknown sessions cannot earn XP', () => {
  for (const mutate of [p => p.order = Array(22).fill('d1'), p => p.lockedAt = ts(9999), p => p.verified = false, p => p.session = 'practice', p => p.userId = 'attacker']) {
    const data = input(); data.predictions.forEach(mutate);
    assert.equal(calculate(data).xp, 0);
  }
  const data = input(); delete data.races[0].sessionDeadlines;
  assert.equal(calculate(data).xp, 0);
});
test('configuration rejects unsafe thresholds and unsupported achievement metrics', () => {
  const c = structuredClone(DEFAULT_CONFIG); c.thresholds = [0, 50, 40];
  assert.throws(() => validateConfig(c));
  c.thresholds = [0,100]; c.achievements[0].metric = 'clientRole';
  assert.throws(() => validateConfig(c));
});
