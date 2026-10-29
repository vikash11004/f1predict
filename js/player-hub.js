import { escapeHTML, icon } from './design.js';
import { auth, queryCollection } from './firebase.js';

const card = (title, body) => `<section class="card overview-card"><div class="card-header"><h2 class="text-label">${title}</h2></div><div class="card-body" data-hub-section="${title}">${body}</div></section>`;
const empty = (title, detail) => `<h3 class="result-title">${title}</h3><p class="card-detail">${detail}</p>`;
const number = value => Number.isFinite(value) ? value : '—';

// Gamification is read-only here; only the trusted backend can award XP.
export async function renderPlayerHub(container, user, profile, races) {
  const name = escapeHTML(profile?.displayName || user.displayName || 'Driver');
  const completed = races.filter(r => r.status === 'completed').length;
  const progress = races.length ? Math.round(completed / races.length * 100) : 0;
  container.innerHTML = `
    <div class="section-label"><span>YOUR PADDOCK</span></div>
    <div class="player-hub-grid">
      ${card('Driver profile', `<h3 class="leader-name">${name}</h3><p class="card-detail player-email">${escapeHTML(user.email || 'Email unavailable')}</p><p class="card-detail">${user.emailVerified ? 'Email verified' : 'Email verification pending'}</p><button class="btn btn-secondary btn-sm" data-edit-profile>Edit profile &amp; account</button>`)}
      ${card('XP & level', empty('Your next chapter.', 'No verified XP record yet. Championship points remain separate.') + '<p class="card-detail">Level — · XP —</p>')}
      ${card('Achievements', empty('Room for your milestones.', 'Verified achievements will appear here.'))}
      ${card('Prediction streak', empty('Every weekend counts.', 'Your streak will appear after eligible weekends are verified.'))}
      ${card('Weekend awards', empty('Make the whole weekend count.', 'Complete all eligible sessions to earn a weekend award.'))}
      ${card('Verified season records', empty('Your record book.', 'Verified performance records will appear here.'))}
      ${card('Season progress', races.length ? `<p class="leader-points">${completed}<small> / ${races.length} weekends</small></p><progress class="season-progress" value="${completed}" max="${races.length}" aria-label="Completed race weekends">${progress}%</progress><p class="card-detail">${progress}% of scheduled weekends marked completed. This is calendar progress, not your participation.</p>` : empty('The calendar is getting ready.', 'Season progress will appear once races are scheduled.'))}
      ${card('Personal statistics', `<div class="mini-standing"><span>Season points</span><strong>${number(profile?.seasonPoints)}</strong></div><div class="mini-standing"><span>Recorded session wins</span><strong>${number(profile?.wins)}</strong></div><div data-score-stats><p class="card-detail">Loading your session performance…</p></div>`)}
    </div>
    <div class="section-label"><span>YOUR RECENT PERFORMANCE</span><a href="#results">All results ${icon('arrow')}</a></div>
    <div class="card"><div class="card-body" data-recent-performance>Loading your scored sessions…</div></div>
    <div class="section-label"><span>XP HISTORY</span></div>
    <div class="card"><div class="card-body" data-xp-history>No verified XP activity yet.</div></div>
    <nav class="player-shortcuts" aria-label="Paddock shortcuts"><a class="btn btn-secondary" href="#races">Calendar &amp; predictions</a><a class="btn btn-secondary" href="#results">Results</a><a class="btn btn-secondary" href="#leaderboard">Standings</a><button class="btn btn-secondary" data-open-chat>Paddock chat</button></nav>`;
  container.querySelector('[data-edit-profile]').onclick = () => document.getElementById('btn-profile')?.click();
  container.querySelector('[data-open-chat]').onclick = () => {
    if (document.getElementById('chat-popup')?.classList.contains('hidden')) document.getElementById('chat-fab')?.click();
    document.getElementById('chat-input')?.focus();
  };
  loadGamification(container, user);
  const recent = container.querySelector('[data-recent-performance]');
  const stats = container.querySelector('[data-score-stats]');
  try {
    const records = await queryCollection('scores', [['userId', '==', user.uid]]);
    if (!container.isConnected || auth.currentUser?.uid !== user.uid) return;
    const raceMap = new Map(races.map(r => [r.id, r]));
    const order = ['sprint_quali', 'sprint', 'quali', 'race'];
    const scores = records.filter(s => Number.isFinite(s.totalPoints) && raceMap.has(s.raceId) && !raceMap.get(s.raceId).cancelledSessions?.[s.session]);
    scores.sort((a, b) => raceMap.get(b.raceId).round - raceMap.get(a.raceId).round || order.indexOf(b.session) - order.indexOf(a.session));
    stats.innerHTML = `<div class="mini-standing"><span>Scored sessions</span><strong>${scores.length}</strong></div><div class="mini-standing"><span>Best session points</span><strong>${scores.length ? Math.max(...scores.map(s => s.totalPoints)) : '—'}</strong></div>`;
    recent.innerHTML = scores.length ? scores.slice(0, 4).map(s => `<a class="performance-row" href="#results/${encodeURIComponent(s.raceId)}/${encodeURIComponent(s.session)}"><span>${escapeHTML(raceMap.get(s.raceId).name)}<small>${escapeHTML(s.session.replaceAll('_', ' '))}</small></span><strong>${s.totalPoints} PTS ${icon('arrow')}</strong></a>`).join('') : empty('Your race story starts here.', 'No scored sessions yet. Make a prediction and return after official results are confirmed.');
  } catch {
    stats.textContent = 'Session statistics are unavailable right now.';
    recent.textContent = 'Could not load your recent performance. Return to Overview to retry.';
  }
}

async function loadGamification(container, user) {
  const section = title => container.querySelector(`[data-hub-section="${title}"]`);
  try {
    const summaries = await queryCollection('gamification', [['uid', '==', user.uid]]);
    if (!container.isConnected || auth.currentUser?.uid !== user.uid) return;
    const state = summaries.find(s => s.season === '2026');
    if (!state) return;
    const progress = state.nextLevel === null ? 100 : Math.min(100, Math.max(0, Math.floor((state.xp - state.levelStart) / (state.nextLevel - state.levelStart) * 100)));
    section('XP & level').innerHTML = `<h3 class="leader-name">Level ${number(state.level)}</h3><p class="leader-points">${number(state.xp)} <small>XP</small></p><progress class="season-progress" max="100" value="${progress}" aria-label="Progress to next level">${progress}%</progress><p class="card-detail">${state.nextLevel === null ? 'Highest configured level reached.' : `${state.nextLevel - state.xp} XP to the next level.`} Separate from championship points.</p>`;
    section('Achievements').innerHTML = state.achievements.length ? state.achievements.map(a => `<p class="mini-standing">${icon('trophy')} ${escapeHTML(a.name)}</p>`).join('') : empty('Your first milestone awaits.', 'No achievements earned yet.');
    section('Prediction streak').innerHTML = `<p class="leader-points">${number(state.stats.currentStreak)} <small>weekends</small></p><p class="card-detail">Best streak: ${number(state.stats.bestStreak)}. Cancelled weekends are skipped; unresolved results pause the streak.</p>`;
    section('Weekend awards').innerHTML = state.weekendAwards.length ? state.weekendAwards.map(a => `<p class="mini-standing">${escapeHTML(a.name)} ${icon('flag')}</p>`).join('') : empty('Your next weekend awaits.', 'No complete verified weekends yet.');
    section('Verified season records').innerHTML = `<p class="card-detail">${number(state.stats.predictions)} eligible predictions · ${number(state.stats.scoredSessions)} scored sessions</p><p class="card-detail">Best session: ${number(state.stats.bestScore)} points · ${number(state.stats.perfects)} perfect predictions</p><p class="card-detail">${number(state.skippedSessions)} sessions lack eligible prediction evidence. Historical picks are not automatically credited.</p>`;
    const history = await queryCollection(`gamification/${state.id}/history`, [], { orderByField: 'revision', orderDirection: 'desc', limitCount: 10 });
    if (!container.isConnected || auth.currentUser?.uid !== user.uid) return;
    container.querySelector('[data-xp-history]').innerHTML = history.length ? history.map(h => `<details><summary class="performance-row">${h.delta >= 0 ? '+' : ''}${number(h.delta)} XP · revision ${number(h.revision)}</summary>${h.changes.map(c => `<p class="card-detail">${c.delta >= 0 ? '+' : ''}${number(c.delta)} XP — ${escapeHTML(c.reason)}</p>`).join('') || '<p class="card-detail">Records recalculated; XP unchanged.</p>'}</details>`).join('') : 'No XP changes yet.';
  } catch {
    container.querySelector('[data-xp-history]').textContent = 'Gamification is unavailable right now. Return to Overview to retry.';
  }
}
