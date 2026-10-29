import { calculateSessionScore } from '../js/scoring.js';

export const DEFAULT_CONFIG = {
  season: '2026', version: 1, enabled: true,
  thresholds: [0, 100, 250, 500, 1000, 2000, 4000],
  xp: { prediction: 20, scored: 30, perfect: 100, weekend: 50 },
  achievements: [
    { id: 'first_pick', name: 'On the grid', metric: 'predictions', target: 1, xp: 25 },
    { id: 'weekend', name: 'Weekend regular', metric: 'weekends', target: 1, xp: 50 },
    { id: 'streak3', name: 'Three in a row', metric: 'bestStreak', target: 3, xp: 75 },
    { id: 'perfect', name: 'Perfect instinct', metric: 'perfects', target: 1, xp: 100 }
  ]
};
const metrics = ['predictions', 'scoredSessions', 'weekends', 'bestStreak', 'perfects', 'bestScore'];
export function validateConfig(c) {
  const integer = n => Number.isSafeInteger(n) && n >= 0 && n <= 1000000;
  if (!c || !/^\d{4}$/.test(c.season) || !integer(c.version) || typeof c.enabled !== 'boolean' ||
      !Array.isArray(c.thresholds) || !c.thresholds.length || c.thresholds.length > 100 || c.thresholds[0] !== 0 ||
      c.thresholds.some((n, i) => !integer(n) || (i && n <= c.thresholds[i - 1])) ||
      !['prediction', 'scored', 'perfect', 'weekend'].every(k => integer(c.xp?.[k])) ||
      !Array.isArray(c.achievements) || c.achievements.length > 50 ||
      new Set(c.achievements.map(a => a.id)).size !== c.achievements.length ||
      c.achievements.some(a => !/^[a-z0-9_]{1,40}$/.test(a.id) || typeof a.name !== 'string' || a.name.length > 80 || !metrics.includes(a.metric) || !integer(a.target) || a.target < 1 || !integer(a.xp))) {
    throw new Error('Invalid gamification configuration');
  }
  return c;
}
export const millis = value => value?.toMillis instanceof Function ? value.toMillis() : 0;
export function levelFor(xp, thresholds) {
  let index = 0;
  while (index + 1 < thresholds.length && xp >= thresholds[index + 1]) index++;
  return { level: index + 1, levelStart: thresholds[index], nextLevel: thresholds[index + 1] ?? null };
}
function validOrder(order, roster) {
  return Array.isArray(order) && order.length === 22 && new Set(order).size === 22 && order.every(id => roster.has(id));
}

// Pure reconciliation: no client scores, XP or profile claims are consumed.
export function calculate({ uid, config, races, predictions, results }) {
  validateConfig(config);
  const awards = {}, earned = [], weekendAwards = [], skipped = [];
  const stats = { predictions: 0, scoredSessions: 0, weekends: 0, perfects: 0, bestScore: null, predictionPoints: 0, currentStreak: 0, bestStreak: 0 };
  const add = (id, xp, reason) => { awards[id] = { xp, reason }; };
  const sorted = races.filter(r => String(r.season || '2026') === config.season).sort((a, b) => a.round - b.round || a.id.localeCompare(b.id));
  let streakBlocked = false;
  for (const race of sorted) {
    const sessions = race.weekendType === 'standard' ? ['quali', 'race'] : race.weekendType === 'sprint' ? ['sprint_quali', 'sprint', 'quali', 'race'] : [];
    const active = sessions.filter(s => !race.cancelledSessions?.[s]);
    let weekendEligible = active.length > 0;
    let settled = active.length > 0;
    for (const session of active) {
      const key = `${race.id}_${session}`;
      const roster = new Set(race.gamificationDriverIds || []);
      const result = results.find(r => r.id === key && r.raceId === race.id && r.session === session);
      const deadline = millis(race.sessionDeadlines?.[session]);
      const validResult = roster.size === 22 && validOrder(result?.order, roster) && millis(result?.calculatedAt) >= deadline && deadline > 0;
      const pred = predictions.find(p => p.id === `${uid}_${key}` && p.userId === uid && p.raceId === race.id && p.session === session);
      // Eligibility is recorded by the trusted prediction trigger, not backfilled
      // from legacy client timestamps. The hash also binds the locked order.
      const locked = millis(pred?.lockedAt);
      const eligible = deadline > 0 && locked > 0 && locked <= deadline && validOrder(pred?.order, roster) && pred?.verified === true;
      if (!eligible) { weekendEligible = false; skipped.push(key); }
      else {
        stats.predictions++;
        add(`prediction:${key}`, config.xp.prediction, `${race.name} · ${session}: verified prediction`);
      }
      if (!validResult) settled = false;
      if (eligible && validResult) {
        const score = calculateSessionScore(pred.order, result.order, session);
        stats.scoredSessions++;
        stats.predictionPoints += score.totalPoints;
        stats.bestScore = Math.max(stats.bestScore ?? 0, score.totalPoints);
        add(`result:${key}`, config.xp.scored, `${race.name} · ${session}: official result confirmed`);
        if (pred.order.every((d, i) => d === result.order[i])) {
          stats.perfects++;
          add(`perfect:${key}`, config.xp.perfect, `${race.name} · ${session}: perfect prediction`);
        }
      }
    }
    if (settled && weekendEligible) {
      stats.weekends++;
      weekendAwards.push({ raceId: race.id, name: race.name });
      add(`weekend:${race.id}`, config.xp.weekend, `${race.name}: all non-cancelled sessions predicted and scored`);
    }
    // Fully cancelled weekends are neutral; an unresolved earlier weekend
    // pauses the chronological streak until its results arrive.
    if (active.length && !settled) streakBlocked = true;
    if (settled && !streakBlocked) {
      stats.currentStreak = weekendEligible ? stats.currentStreak + 1 : 0;
      stats.bestStreak = Math.max(stats.bestStreak, stats.currentStreak);
    }
  }
  for (const a of config.achievements) {
    if (stats[a.metric] !== null && stats[a.metric] >= a.target) {
      earned.push({ id: a.id, name: a.name });
      add(`achievement:${a.id}`, a.xp, `Achievement: ${a.name}`);
    }
  }
  const xp = Object.values(awards).reduce((sum, a) => sum + a.xp, 0);
  return { season: config.season, configVersion: config.version, xp, ...levelFor(xp, config.thresholds), stats, awards, achievements: earned, weekendAwards, skippedSessions: skipped.length };
}
