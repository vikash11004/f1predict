import { environment } from './environment.js';
import { callRooms } from './firebase.js';

// These are design-preview bands only. A future payable quote must be server-owned.
export function mountCommercePreview(page) {
  const panel = document.createElement('section');
  panel.className = 'card overview-card';
  panel.innerHTML = `<div class="card-body room-body"><details><summary>Future room access pricing</summary>
    <p>Paid room creation is not available. Existing room creation remains free.</p>
    <p id="commerce-band" role="status"></p>
    <dl><dt>Room service price</dt><dd>Not configured</dd><dt>Applicable taxes</dt><dd>Not configured</dd><dt>Total payable</dt><dd>Unavailable — no checkout</dd></dl>
    <p>A future fee would cover host room access only. No cash prizes, wagering, cashouts or redeemable XP.</p>
    <button class="btn btn-secondary" disabled>Checkout unavailable</button>
    <h3>Purchase history</h3><p>Purchasing has not launched. No purchases can be made in this version.</p>
    <div id="commerce-sandbox"></div></details></div>`;
  page.append(panel);
  const capacity = page.querySelector('#room-capacity');
  const refresh = () => {
    const value = Number(capacity.value);
    const max = [10, 25, 50, 100].find(n => n >= value);
    panel.querySelector('#commerce-band').textContent = Number.isInteger(value) && value >= 2 && value <= 100
      ? `Review: ${value} members including you · proposed capacity band up to ${max}.`
      : 'Choose a capacity from 2 to 100.';
  };
  capacity.addEventListener('input', refresh); refresh();
  if (environment !== 'development' || !['localhost', '127.0.0.1'].includes(location.hostname)) return;
  const sandbox = panel.querySelector('#commerce-sandbox');
  sandbox.innerHTML = `<h3>Local payment simulation</h3><p>Test fixtures only. No money is collected, no payment is verified, and no room is created.</p>
    <label class="form-label" for="commerce-scenario">Test outcome</label><select class="form-input" id="commerce-scenario"><option value="pending">Pending</option><option value="success">Simulated success</option><option value="failure">Failure</option><option value="cancelled">Cancellation</option></select>
    <button type="button" class="btn btn-secondary" id="commerce-test">Run simulation</button>
    <button type="button" class="btn btn-secondary" id="commerce-history">Load test history</button>
    <p id="commerce-state" role="status"></p><ul id="commerce-history-list"></ul>`;
  let requestId = crypto.randomUUID();
  let payload = '';
  const status = sandbox.querySelector('#commerce-state');
  sandbox.querySelector('#commerce-test').onclick = async event => {
    const button = event.currentTarget; button.disabled = true;
    const scenario = sandbox.querySelector('select').value;
    const next = JSON.stringify([Number(capacity.value), scenario]);
    if (next !== payload) { requestId = crypto.randomUUID(); payload = next; }
    status.textContent = 'Running local simulation…';
    try {
      const result = await callRooms({ action: 'commerceTestAttempt', requestId, capacity: Number(capacity.value), scenario });
      if (result.simulation !== true || result.paymentVerified !== false || result.roomCreated !== false) throw Error('Invalid simulation response');
      status.textContent = `Simulation: ${result.scenario}. No payment verified; no room created. Repeating this attempt reuses the same test record.`;
    } catch { status.textContent = 'Simulation unavailable. Start local emulators, then retry. No payment was initiated.'; }
    finally { button.disabled = false; }
  };
  let cursor = null;
  sandbox.querySelector('#commerce-history').onclick = async event => {
    const button = event.currentTarget; button.disabled = true;
    try {
      const result = await callRooms({ action: 'commerceTestHistory', cursor });
      if (result.simulation !== true) throw Error('Invalid history');
      const list = sandbox.querySelector('#commerce-history-list');
      if (!cursor) list.replaceChildren();
      for (const purchase of result.purchases) {
        const li = document.createElement('li');
        li.textContent = `Test only · ${purchase.capacity} members · ${purchase.scenario} · no actual payment`;
        list.append(li);
      }
      status.textContent = result.purchases.length ? 'Local test records only.' : 'No local test records yet.';
      cursor = result.cursor; button.textContent = cursor ? 'More test records' : 'Refresh test history';
    } catch { status.textContent = 'Test history unavailable. Try again with local emulators running.'; }
    finally { button.disabled = false; }
  };
}
