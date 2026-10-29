const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const fixture = fs.readFileSync(
  path.join(__dirname, 'fixtures/firebase.js'),
  'utf8',
);
const screenshotDir = process.env.F1_SCREENSHOT_DIR || '/tmp/f1-ui-smoke';
fs.mkdirSync(screenshotDir, { recursive: true });
async function run() {
  const root = path.resolve(__dirname, '..');
  const contentTypes = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.svg': 'image/svg+xml',
    '.woff2': 'font/woff2',
  };
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    const target = path.resolve(
      root,
      '.' + (pathname === '/' ? '/index.html' : pathname),
    );
    if (!target.startsWith(root + path.sep)) {
      response.writeHead(403).end();
      return;
    }
    fs.readFile(target, (error, body) => {
      response.writeHead(error ? 404 : 200, {
        'Content-Type':
          contentTypes[path.extname(target)] || 'application/octet-stream',
      });
      response.end(error ? 'Not found' : body);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseURL = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({
      executablePath:
        process.env.CHROMIUM_PATH ||
        (fs.existsSync('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe')
          ? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
          : fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
      env: { ...process.env, XDG_CACHE_HOME: '/tmp/f1-browser-cache' },
    });
    const errors = [];
    async function open(width, height, signedIn = false, mock = true) {
      const context = await browser.newContext({
        viewport: { width, height },
        reducedMotion: 'reduce',
      });
      await context.addInitScript(
        ({ signedIn }) => {
          window.__signedIn = signedIn;
          window.__writes = [];
          window.__authActions = [];
        },
        { signedIn },
      );
      await context.route('**/*', (route) => {
        const u = new URL(route.request().url());
        if (mock && u.pathname === '/js/firebase.js')
          return route.fulfill({
            contentType: 'application/javascript',
            body: fixture,
          });
        if (u.hostname !== '127.0.0.1') return route.abort();
        return route.continue();
      });
      const page = await context.newPage();
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(baseURL, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      return page;
    }
    async function screenshot(page, name) {
      await page.mouse.move(0, 0);
      await page
        .locator('.toast-close')
        .evaluateAll((buttons) => buttons.forEach((button) => button.click()));
      await page.waitForFunction(
        () => document.querySelectorAll('.toast').length === 0,
      );
      await page.screenshot({
        path: path.join(screenshotDir, name + '.png'),
        fullPage: true,
      });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
        'Horizontal overflow on ' + name,
      );
    }
    const page = await open(1440, 1000);
    await page.locator('#auth-submit:enabled').waitFor();
    await screenshot(page, 'auth-ready');
    await page.locator('#auth-submit').click();
    assert.match(await page.locator('#email-error').innerText(), /required/);
    await page.locator('#auth-email').fill('bad-email');
    await page.locator('#auth-submit').click();
    assert.match(await page.locator('#email-error').innerText(), /valid/);
    await page.locator('#auth-toggle').click();
    assert.equal(await page.locator('#name-group').isVisible(), true);
    assert.match(await page.locator('#auth-title').innerText(), /Your season/);
    await page.locator('#auth-password').fill('example-password');
    await page.locator('#password-toggle').click();
    assert.equal(
      await page.locator('#auth-password').getAttribute('type'),
      'text',
    );
    await page.locator('#password-toggle').click();
    await page.locator('#auth-toggle').click();
    await page.locator('#auth-email').fill('alex@example.test');
    await page.locator('#auth-reset').click();
    await page.locator('.toast-success').waitFor();
    assert.deepEqual(await page.evaluate(() => window.__authActions), ['password-reset']);
    await page.locator('#auth-submit').click();
    await page.locator('#card-next-race').waitFor();
    await screenshot(page, 'dashboard-desktop');
    await page.locator('[data-recent-performance] .result-title').waitFor();
    assert.match(await page.locator('#player-hub').innerText(), /No verified XP record yet/);
    assert.match(await page.locator('[data-recent-performance]').innerText(), /No scored sessions yet/);
    assert.equal(await page.locator('.season-progress').getAttribute('max'), '5');
    await page.locator('[data-edit-profile]').click();
    await page.locator('#profile-display-name').waitFor();
    await page.locator('#close-profile').click();
    await page.evaluate(async () => {
      const db = await import('/js/firebase.js');
      await db.setDocument('gamification', '2026_u1', { uid: 'u1', season: '2026', xp: 125, level: 2, levelStart: 100, nextLevel: 250, achievements: [{ id: 'first', name: 'On the grid' }], weekendAwards: [{ name: 'Test weekend' }], stats: { currentStreak: 1, bestStreak: 1, predictions: 2, scoredSessions: 2, bestScore: 440, perfects: 0 }, skippedSessions: 0 });
      await db.setDocument('gamification/2026_u1/history', '1', { revision: 1, delta: 125, changes: [{ delta: 125, reason: 'Verified test awards' }] });
      const { renderDashboard } = await import('/js/dashboard.js');
      await renderDashboard();
    });
    await page.getByText('Level 2', { exact: true }).waitFor();
    assert.match(await page.locator('[data-hub-section="Achievements"]').innerText(), /On the grid/);
    assert.match(await page.locator('[data-xp-history]').innerText(), /125 XP/);
    assert.match(await page.locator('#cd-days').innerText(), /^\d{2}$/);
    await page.locator('[data-page=races]').click();
    await page.locator('.race-calendar-row').first().waitFor();
    assert.equal(await page.locator('.race-calendar-row').count(), 5);
    await page.locator('[data-filter=active]').click();
    assert.equal(await page.locator('.race-calendar-row').count(), 1);
    await page.locator('[data-filter=all]').click();
    assert.equal(
      await page.locator('[data-filter=all]').getAttribute('aria-pressed'),
      'true',
    );
    assert.equal(await page.locator('.filter-btn.active').count(), 1);
    await screenshot(page, 'calendar-desktop');
    await page.locator('.race-calendar-row').first().focus();
    await page.keyboard.press('Enter');
    await page.locator('.side-panel.open').waitFor();
    await page
      .locator('#side-panel-overlay')
      .click({ position: { x: 50, y: 100 } });
    await page.locator('[data-page=leaderboard]').click();
    await page.locator('.podium-card').first().waitFor();
    assert.equal(await page.locator('.leaderboard-row').count(), 4);
    await screenshot(page, 'standings-desktop');
    await page.evaluate(() => (location.hash = '#predict/r3/quali'));
    await page.locator('#driver-pool .driver-card').first().waitFor();
    assert.equal(await page.locator('#driver-pool .driver-card').count(), 22);
    await page.locator('#driver-pool .driver-card').first().click();
    await page.waitForTimeout(1000);
    assert.match(await page.locator('#filled-count').innerText(), /1\/22/);
    await screenshot(page, 'prediction-desktop');
    await page.locator('#btn-signout').click();
    await page.locator('#auth-submit:enabled').waitFor();
    await page.locator('#google-auth').click();
    await page.locator('#card-next-race').waitFor();
    assert.ok(await page.evaluate(() => window.__authActions.includes('google-sign-in')));
    await page.locator('#btn-signout').click();
    await page.locator('#auth-submit:enabled').waitFor();
    const mobile = await open(390, 844, true);
    await mobile.locator('#card-next-race').waitFor();
    await screenshot(mobile, 'dashboard-mobile');
    await mobile.locator('#mobile-menu-btn').click();
    assert.equal(
      await mobile.locator('#mobile-menu-btn').getAttribute('aria-expanded'),
      'true',
    );
    await mobile.locator('[data-page=races]').click();
    assert.equal(
      await mobile.locator('#mobile-menu-btn').getAttribute('aria-expanded'),
      'false',
    );
    await mobile.locator('.race-calendar-row').first().waitFor();
    await screenshot(mobile, 'calendar-mobile');
    await mobile.locator('#mobile-menu-btn').click();
    await mobile.locator('[data-page=leaderboard]').click();
    await mobile.locator('.podium-card').first().waitFor();
    await screenshot(mobile, 'standings-mobile');
    await mobile.evaluate(() => (location.hash = '#predict/r3/quali'));
    await mobile.locator('#driver-pool .driver-card').first().waitFor();
    await screenshot(mobile, 'prediction-mobile');
    await mobile.evaluate(() => (location.hash = '#rooms'));
    await mobile.locator('#room-create').waitFor();
    await mobile.locator('#room-join input').fill('bad');
    await mobile.locator('#room-join button').click();
    await mobile.getByText('Invalid invitation. Check the code with your host.', { exact: true }).waitFor();
    await mobile.locator('#room-join input').fill('full');
    await mobile.locator('#room-join button').click();
    await mobile.getByText('This room is full. Ask your host for another room.', { exact: true }).waitFor();
    await mobile.locator('#room-name').fill('Friends <script>');
    await mobile.locator('#room-description').fill('Our weekend');
    await screenshot(mobile, 'rooms-mobile');
    await mobile.locator('#room-create button').click();
    await mobile.locator('#room-invite').waitFor();
    await mobile.locator('#room-invite').click();
    await mobile.locator('#room-code').waitFor();
    assert.equal(await mobile.locator('#room-code').inputValue(), 'a'.repeat(36));
    await screenshot(mobile, 'room-overview-mobile');
    await mobile.locator('#room-finalize').click();
    await mobile.locator('#room-confirm-finalize').click();
    await mobile.getByText('1 / 10 members · Membership finalized', { exact: true }).waitFor();
    assert.equal(await mobile.locator('#room-invite').count(), 0);
    await mobile.locator('#room-predict-form').waitFor();
    await mobile.locator('#room-predict-form button').click();
    await mobile.locator('#driver-pool .driver-card').first().waitFor();
    assert.ok(mobile.url().endsWith('#predict/r3/quali/test-room'));
    await mobile.locator('#driver-pool .driver-card').first().click();
    await mobile.waitForFunction(() => window.__roomWrites?.some(w => w.order.length === 1));
    await mobile.locator('.session-tab[data-session=race]').click();
    await mobile.locator('#driver-pool .driver-card').first().waitFor();
    assert.equal(await mobile.locator('#order-list .filled').count(),0);
    await mobile.locator('.session-tab[data-session=quali]').click();
    await mobile.waitForFunction(() => document.querySelectorAll('#order-list .filled').length === 1);
    for (let i=1; i<22; i++) await mobile.locator('#driver-pool .driver-card').first().click();
    // Exercise the same HTML drag/drop handlers used in the global builder.
    const beforeDrag = await mobile.locator('#order-list .filled').first().getAttribute('data-driver-id');
    await mobile.evaluate(() => {
      const slots = document.querySelectorAll('#order-list .filled');
      const transfer = new DataTransfer();
      slots[0].dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:transfer}));
      slots[1].dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:transfer}));
    });
    assert.notEqual(await mobile.locator('#order-list .filled').first().getAttribute('data-driver-id'),beforeDrag);
    await screenshot(mobile,'room-prediction-mobile');
    await mobile.locator('#btn-confirm').click();
    await mobile.locator('#modal-confirm').click();
    await mobile.waitForFunction(() => window.__roomWrites?.some(w=>w.lock));
    await mobile.waitForFunction(() => document.querySelector('#confirm-bar')?.classList.contains('hidden'));
    assert.equal(await mobile.locator('#btn-view-others').count(),0);
    const savedRoomOrder = await mobile.evaluate(() => window.__roomWrites.findLast(w=>w.lock).order);
    assert.equal(new Set(savedRoomOrder).size,22);
    await mobile.evaluate(() => location.hash='#predict/r3/quali');
    await mobile.locator('#driver-pool .driver-card').first().waitFor();
    assert.equal(await mobile.locator('#order-list .filled').count(),0);
    await mobile.evaluate(() => location.hash='#leaderboard');
    await mobile.locator('.podium-card').first().waitFor();
    assert.equal(await mobile.locator('.leaderboard-row').count(),4);
    await mobile.locator('#btn-signout').click();
    await mobile.locator('#auth-submit:enabled').waitFor();
    await screenshot(mobile, 'auth-mobile');
    await mobile.evaluate(() => history.replaceState(null, '', '?roomInvite=' + 'a'.repeat(36) + '#auth'));
    await mobile.locator('#auth-email').fill('alex@example.test');
    await mobile.locator('#auth-password').fill('example-password');
    await mobile.locator('#auth-submit').click();
    await mobile.locator('#room-join').waitFor();
    assert.equal(await mobile.locator('#room-join input').inputValue(), 'a'.repeat(36));
    const blocked = await open(390, 844, false, false);
    await blocked.locator('#retry-connection').waitFor();
    assert.equal(await blocked.locator('#auth-submit').isDisabled(), true);
    await screenshot(blocked, 'offline-mobile');
    for (const width of [320, 768, 1024]) {
      const responsive = await open(width, 900, true);
      await responsive.locator('#card-next-race').waitFor();
      await screenshot(responsive, 'overview-' + width);
      await responsive.evaluate(() => (location.hash = '#rooms'));
      await responsive.locator('#room-create').waitFor();
      await responsive.locator('summary').filter({hasText: 'Future room access pricing'}).click();
      assert.equal(await responsive.getByRole('button', {name: 'Checkout unavailable'}).isDisabled(), true);
      await responsive.locator('#room-capacity').fill('26');
      assert.match(await responsive.locator('#commerce-band').textContent(), /up to 50/);
      for (const scenario of ['pending', 'success', 'failure', 'cancelled']) {
        await responsive.locator('#commerce-scenario').selectOption(scenario);
        await responsive.locator('#commerce-test').click();
        await responsive.waitForFunction(() => document.querySelector('#commerce-state').textContent.startsWith('Simulation:'));
        assert.match(await responsive.locator('#commerce-state').textContent(), /No payment verified; no room created/);
      }
      await responsive.locator('#commerce-test').click();
      await responsive.locator('#commerce-history').click();
      await responsive.waitForFunction(() => document.querySelectorAll('#commerce-history-list li').length === 4);
      await responsive.evaluate(() => window.__commerceFailure = true);
      await responsive.locator('#commerce-test').click();
      await responsive.waitForFunction(() => document.querySelector('#commerce-state').textContent.includes('Simulation unavailable'));
      await responsive.evaluate(() => window.__commerceFailure = false);
      await responsive.locator('#commerce-test').click();
      await responsive.waitForFunction(() => document.querySelector('#commerce-state').textContent.startsWith('Simulation:'));
      await screenshot(responsive, 'rooms-' + width);
    }
    assert.deepEqual(errors, []);
    console.log(
      'PASS: Auth validation, sign-in/out, overview, calendar, standings, driver selection, mobile menu, room creation/invitations/finalization, full and invalid states, invitation preserved through login, no horizontal overflow, and offline state. Firebase isolated with browser-only fixtures; no live writes.',
    );
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
run().catch((e) => {
  console.error(e);
  process.exit(1);
});
