import { auth, callRooms } from './firebase.js';
import { navigateTo } from './ui.js';
import { escapeHTML as esc, pageHeading } from './design.js';
import { renderRoomCompetition } from './room-standings.js';
import { mountCommercePreview } from './room-commerce.js';

const errorText = error => ({
  'functions/unauthenticated': 'Sign in again to use rooms.',
  'functions/permission-denied': 'You do not have permission to access this room or perform this action.',
  'functions/not-found': 'Invalid invitation. Check the code with your host.',
  'functions/resource-exhausted': 'This room is full. Ask your host for another room.',
  'functions/failed-precondition': 'Invitations are closed or membership has been finalized.',
  'functions/invalid-argument': 'Check the room details and invitation code.',
}[error.code] || 'Rooms are unavailable. Check your connection and try again.');
let renderVersion = 0;
const card = body => `<div class="card overview-card"><div class="card-body room-body">${body}</div></div>`;
const field = (name, label, attributes = '') => `<div class="form-group"><label class="form-label" for="room-${name}">${label}</label><input class="form-input" id="room-${name}" name="${name}" ${attributes}></div>`;

export async function renderRooms(id) {
  const version = ++renderVersion;
  const uid = auth.currentUser?.uid;
  const page = document.getElementById('rooms-page');
  const active = () => version === renderVersion && auth.currentUser?.uid === uid && location.hash.startsWith('#rooms');
  page.innerHTML = pageHeading('PRIVATE PADDOCK', 'My Rooms', 'Your people. Your race weekends.') + '<p role="status">Loading rooms…</p>';
  const run = async (button, action) => {
    button.disabled = true;
    const status = page.querySelector('#room-status');
    if (status) status.textContent = 'Working…';
    try { await action(); }
    catch (error) { if (active() && status) status.textContent = errorText(error); }
    finally { button.disabled = false; }
  };
  try {
    if (id) {
      const room = await callRooms({ action: 'overview', id });
      if (!active()) return;
      const host = room.hostUid === uid;
      page.innerHTML = pageHeading('PRIVATE PADDOCK', esc(room.name), esc(room.description)) +
        '<nav class="room-actions" aria-label="Room navigation"><a class="btn btn-secondary" href="#rooms">My Rooms</a><a class="btn btn-secondary" href="#races">Race calendar</a><a class="btn btn-secondary" href="#leaderboard">Global standings</a></nav>' +
        card(`<h2>Room overview</h2><p>${room.memberCount} / ${room.capacity} members · ${room.status === 'finalized' ? 'Membership finalized' : 'Roster open'}</p><p>Invitations: ${room.allowInvites ? 'enabled, shared by host' : 'disabled'}</p><p>Choose a race and session below to make your room prediction.</p>
          ${host && room.status === 'open' ? `<div class="room-actions">${room.allowInvites ? '<button class="btn btn-secondary" id="room-invite">Share invitation</button>' : ''}<button class="btn btn-primary" id="room-finalize">Finalize membership</button></div><div id="room-confirm" hidden><p>Finalizing permanently closes this roster to new members.</p><button class="btn btn-primary" id="room-confirm-finalize">Confirm finalization</button><button class="btn btn-secondary" id="room-cancel-finalize">Cancel</button></div>` : ''}
          <div id="room-invitation"></div><p id="room-status" role="status" aria-live="polite"></p>`) +
        card(`<h2>Members</h2><ul class="room-members">${room.members.map(member => `<li><span>${esc(member.displayName)}${member.uid === uid ? ' (you)' : ''}</span><span>${member.role === 'host' ? 'Host' : 'Member'}</span></li>`).join('')}</ul>`);
      page.querySelector('#room-invite')?.addEventListener('click', event => run(event.currentTarget, async () => {
        const { code } = await callRooms({ action: 'invite', id });
        if (!active()) return;
        const url = new URL(location.href); url.hash = 'rooms'; url.searchParams.set('roomInvite', code);
        page.querySelector('#room-invitation').innerHTML = field('code', 'Invitation code (copy to share)', `readonly value="${esc(code)}"`) + field('link', 'Invitation link (copy to share)', `readonly value="${esc(url.href)}"`);
        page.querySelector('#room-status').textContent = 'Anyone with this invitation can join while the roster is open and has space.';
      }));
      page.querySelector('#room-finalize')?.addEventListener('click', () => { page.querySelector('#room-confirm').hidden = false; });
      page.querySelector('#room-cancel-finalize')?.addEventListener('click', () => { page.querySelector('#room-confirm').hidden = true; });
      page.querySelector('#room-confirm-finalize')?.addEventListener('click', event => run(event.currentTarget, async () => {
        await callRooms({ action: 'finalize', id });
        if (active()) await renderRooms(id);
      }));
      const competition = document.createElement('div');
      competition.className = 'room-competition';
      page.append(competition);
      void renderRoomCompetition(competition, id);
      const chat = document.createElement('div');
      chat.innerHTML = card('<h2>Room chat</h2><div id="room-chat-list" aria-live="polite">Loading messages…</div><button class="btn btn-secondary" id="room-chat-more" hidden>Older messages</button><form id="room-chat-form"><label class="form-label" for="room-chat-text">Message</label><textarea class="form-input" id="room-chat-text" maxlength="500" required></textarea><button class="btn btn-primary" type="submit">Send</button></form><p id="room-chat-status" role="status"></p>');
      page.append(chat);
      let cursor = null;
      const loadChat = async (append = false) => {
        try {
          const result = await callRooms({ action: 'chatList', id, ...(append ? { cursor } : {}) });
          if (!active()) return;
          const list = chat.querySelector('#room-chat-list');
          if (!append) list.innerHTML = '';
          list.insertAdjacentHTML('beforeend', result.messages.map(m => `<p><strong>${esc(m.senderName)}</strong> <small>${esc(m.createdAt)}</small><br>${esc(m.text)}</p>`).join(''));
          if (!result.messages.length && !append) list.textContent = 'No messages yet.';
          cursor = result.cursor; chat.querySelector('#room-chat-more').hidden = !cursor;
        } catch { if (active()) chat.querySelector('#room-chat-status').textContent = 'Could not load messages. Try again.'; }
      };
      chat.querySelector('#room-chat-more').onclick = () => loadChat(true);
      let requestId = crypto.randomUUID();
      chat.querySelector('#room-chat-form').onsubmit = async event => {
        event.preventDefault();
        const button = event.currentTarget.querySelector('button'); button.disabled = true;
        try {
          await callRooms({ action: 'chatSend', id, requestId, text: chat.querySelector('#room-chat-text').value });
          requestId = crypto.randomUUID(); chat.querySelector('#room-chat-text').value = '';
          chat.querySelector('#room-chat-status').textContent = 'Message sent.'; await loadChat();
        } catch { chat.querySelector('#room-chat-status').textContent = 'Message could not be sent. Try again.'; }
        finally { button.disabled = false; }
      };
      void loadChat();
      return;
    }
    const result = await callRooms({ action: 'list' });
    if (!active()) return;
    const pending = new URLSearchParams(location.search).get('roomInvite') || '';
    page.innerHTML = pageHeading('PRIVATE PADDOCK', 'My Rooms', 'Create a private room or join your friends with an invitation.') +
      '<p id="room-status" role="status" aria-live="polite"></p><div id="room-list" class="room-grid"></div><button class="btn btn-secondary" id="rooms-more" hidden>Load more rooms</button>' +
      `<div class="room-grid">${card(`<h2>Create Room</h2><form id="room-create">${field('name', 'Room name', 'required maxlength="60"')}${field('description', 'Description', 'maxlength="500"')}${field('capacity', 'Capacity (including you)', 'type="number" min="2" max="100" value="10" required')}<label><input name="allowInvites" type="checkbox" checked> Allow invitation joins</label><p>Only you, as host, can share invitations and finalize the roster.</p><button class="btn btn-primary" type="submit">Create Room</button></form>`)}
      ${card(`<h2>Join a room</h2><form id="room-join">${field('invitation', 'Invitation code or link', `required value="${esc(pending)}"`)}<button class="btn btn-primary" type="submit">Join Room</button></form>`)}</div>`;
    mountCommercePreview(page);
    const append = rooms => {
      page.querySelector('#room-list').insertAdjacentHTML('beforeend', rooms.map(room => card(`<h2>${esc(room.name)}</h2><p>${room.role === 'host' ? 'Host' : 'Member'}</p><a class="btn btn-secondary" href="#rooms/${esc(room.id)}">Open room</a>`)).join(''));
    };
    append(result.rooms);
    if (!result.rooms.length) page.querySelector('#room-list').innerHTML = '<p class="empty-state">No rooms yet. Create one or use an invitation below.</p>';
    let cursor = result.cursor;
    const more = page.querySelector('#rooms-more'); more.hidden = !cursor;
    more.onclick = () => run(more, async () => {
      const next = await callRooms({ action: 'list', cursor });
      if (!active()) return;
      append(next.rooms); cursor = next.cursor; more.hidden = !cursor;
      page.querySelector('#room-status').textContent = '';
    });
    // Keep the request ID across retry clicks if the first response was lost.
    const requestId = crypto.randomUUID();
    page.querySelector('#room-create').onsubmit = event => {
      event.preventDefault();
      const form = event.currentTarget;
      run(form.querySelector('button'), async () => {
        const data = new FormData(form);
        const result = await callRooms({ action: 'create', requestId, name: data.get('name'), description: data.get('description'), capacity: Number(data.get('capacity')), allowInvites: data.has('allowInvites') });
        if (active()) navigateTo('rooms', result.id);
      });
    };
    page.querySelector('#room-join').onsubmit = event => {
      event.preventDefault();
      const form = event.currentTarget;
      run(form.querySelector('button'), async () => {
        let code = new FormData(form).get('invitation').trim();
        try { code = new URL(code).searchParams.get('roomInvite') || code; } catch { /* Plain code. */ }
        const result = await callRooms({ action: 'join', code });
        if (active()) {
          const url = new URL(location.href); url.searchParams.delete('roomInvite'); history.replaceState(null, '', url);
          navigateTo('rooms', result.id);
        }
      });
    };
  } catch (error) {
    if (active()) page.innerHTML = pageHeading('PRIVATE PADDOCK', 'My Rooms', 'Private rooms') + card(`<p role="alert">${esc(errorText(error))}</p><button class="btn btn-primary" id="rooms-retry">Try again</button><a class="btn btn-secondary" href="#rooms">My Rooms</a>`);
    page.querySelector('#rooms-retry')?.addEventListener('click', () => renderRooms(id));
  }
}
