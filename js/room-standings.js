import { callRooms, auth } from './firebase.js';
import { escapeHTML as esc } from './design.js';
import { navigateTo } from './ui.js';
const labels = { race: 'Race', quali: 'Qualifying', sprint: 'Sprint', sprint_quali: 'Sprint qualifying' };
export async function renderRoomCompetition(container, id, season = '2026') {
  const uid = auth.currentUser?.uid;
  container.innerHTML = '<p role="status">Loading room standings…</p>';
  try {
    const data = await callRooms({ action: 'roomStandings', id, season });
    if (!container.isConnected || auth.currentUser?.uid !== uid) return;
    container.innerHTML = `<div class="card overview-card"><div class="card-body room-body"><h2>Room predictions</h2>
      <form id="room-season-form" class="room-actions"><label>Season <input class="form-input" name="season" type="number" min="2020" max="9999" value="${esc(season)}" required></label><button class="btn btn-secondary">Load season</button></form>
      ${data.races.length ? `<form id="room-predict-form" class="room-actions"><label>Race<select class="form-input" id="room-race">${data.races.map(r => `<option value="${esc(r.id)}">${esc(r.round)} · ${esc(r.name)}</option>`).join('')}</select></label><label>Session<select class="form-input" id="room-session"></select></label><button class="btn btn-primary">Build prediction</button></form>` : '<p>No races configured for this season.</p>'}
      <p>Your room predictions are separate from your global predictions. Drafts stay private; locked picks are shared with room members only after the deadline.</p></div></div>
      <div class="card overview-card"><div class="card-body room-body"><h2>Room standings</h2><label>Standings through race<select class="form-input" id="room-history"><option value="latest">Latest</option>${data.history.map((r, i) => `<option value="${i}">${esc(r.round)} · ${esc(r.name)}</option>`).join('')}</select></label><div id="room-ranking"></div><div id="room-race-scores"></div><button class="btn btn-secondary" id="room-refresh">Refresh official scores</button></div></div>
      <div class="card overview-card"><div class="card-body room-body"><h2>Your room progress</h2>${data.progress ? `<p>Level ${data.progress.level} · ${data.progress.xp} XP${data.progress.nextLevel == null ? '' : ` · next level at ${data.progress.nextLevel} XP`}</p><p>${data.progress.stats.currentStreak} weekend streak · ${data.progress.stats.scoredSessions} scored sessions</p><p>${data.progress.achievements.map(a => esc(a.name)).join(' · ') || 'No achievements earned yet.'}</p><details><summary>XP events</summary><ul>${Object.values(data.progress.awards).map(a => `<li>${esc(a.reason)}: ${a.xp} XP</li>`).join('') || '<li>No verified events yet.</li>'}</ul></details><p>Room XP is tracked separately from global XP and prediction points; joining more rooms does not multiply global rewards.</p>` : '<p>No room XP configuration is active yet.</p>'}</div></div>`;
    const draw = () => {
      const selected = container.querySelector('#room-history').value;
      const round = selected === 'latest' ? data.history.at(-1) : data.history[Number(selected)];
      const standings = selected === 'latest' ? data.standings : round.standings;
      container.querySelector('#room-ranking').innerHTML = `<div class="table-scroll"><table class="score-breakdown"><thead><tr><th>Pos</th><th>Player</th><th>Points</th><th>Change</th></tr></thead><tbody>${standings.map(s => `<tr><td>${s.position}</td><td>${esc(s.displayName)}${s.uid === uid ? ' (you)' : ''}</td><td>${s.totalPoints}</td><td>${s.change == null ? '—' : s.change > 0 ? `↑ ${s.change}` : s.change < 0 ? `↓ ${-s.change}` : '—'}</td></tr>`).join('')}</tbody></table></div>`;
      container.querySelector('#room-race-scores').innerHTML = round ? `<h3>${esc(round.name)} results</h3><p>${Object.entries(round.states).map(([s, status]) => `${labels[s]}: ${status === 'unsubmitted' ? 'confirmed' : esc(status)}`).join(' · ')}</p><div class="table-scroll"><table class="score-breakdown"><thead><tr><th>Player</th>${Object.keys(round.states).map(s => `<th>${labels[s]}</th>`).join('')}<th>Weekend</th></tr></thead><tbody>${standings.map(s => `<tr><td>${esc(s.displayName)}</td>${Object.keys(round.states).map(session => { const result = round.scores[s.uid]?.[session]; return `<td>${round.states[session] === 'cancelled' ? 'Void' : round.states[session] === 'pending' ? 'Pending' : result?.status === 'scored' ? result.totalPoints : 'No locked pick'}</td>`; }).join('')}<td>${s.racePoints}</td></tr>`).join('')}</tbody></table></div>` : '<p>No confirmed results yet. Missing results remain pending; cancelled sessions award no points.</p>';
    };
    draw();
    container.querySelector('#room-history').onchange = draw;
    container.querySelector('#room-refresh').onclick = () => renderRoomCompetition(container, id, season);
    container.querySelector('#room-season-form').onsubmit = event => { event.preventDefault(); renderRoomCompetition(container, id, new FormData(event.currentTarget).get('season')); };
    if (data.races.length) {
      const race = container.querySelector('#room-race'), session = container.querySelector('#room-session');
      const sessions = () => { session.innerHTML = data.races.find(r => r.id === race.value).sessions.map(s => `<option value="${s}">${labels[s]}</option>`).join(''); };
      sessions(); race.onchange = sessions;
      container.querySelector('#room-predict-form').onsubmit = event => { event.preventDefault(); navigateTo('predict', race.value, session.value, id); };
    }
  } catch {
    if (!container.isConnected) return;
    container.innerHTML = '<p role="alert">Could not load room standings. Check your connection and room access.</p><button class="btn btn-secondary">Retry</button>';
    container.querySelector('button').onclick = () => renderRoomCompetition(container, id, season);
  }
}
