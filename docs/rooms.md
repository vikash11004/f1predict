# Private prediction rooms

Room predictions are now integrated; see [room-predictions.md](room-predictions.md) for current behavior, security, configuration and tests. The notes below describe the earlier rooms-only phase. Its previously blocked callable test now passes using SDK manifest discovery.

Implemented locally for `f1predict-1188e`. No live project, billing, deployment, or original application was modified. Local tests use `demo-f1predict` only.

## Behavior

- My Rooms lists the signed-in user's memberships, 50 per page.
- Create Room accepts a name (1–60 characters), description (up to 500), capacity (2–100 including host), and invitation-join setting.
- Users can belong to multiple rooms. Only members can view the room and roster.
- Only the host can retrieve/share invitations and finalize membership. Finalization permanently closes the roster; it does not remove existing members. Existing members can reuse invitations without being added twice.
- Invitation links survive sign-in. Joining requires an explicit click. Codes have 144 bits of randomness; the lookup stores a SHA-256 digest. Codes are bearer invitations: anyone receiving one can join while enabled, open, and not full. Analytics is suppressed on invitation landing URLs.
- The room navigation links back to My Rooms, the existing race calendar, and global standings. Room-specific predictions, scoring, removal/leaving, invitation rotation, and editing room settings after creation are not included in this phase.
- Member names are snapshots from the existing user profile at join time.

## Security and storage

The `rooms` Firebase callable obtains the UID from Firebase's verified authentication context. Client-supplied roles, counts, status, and host identity are ignored. The callable refuses unrelated project IDs. Client Firestore writes to all room records are denied, including browser-admin writes.

`rooms/{id}` contains server-owned metadata and count; `members/{uid}` holds the bounded roster. `private/invitation` and `roomInvitations/{digest}` are inaccessible to all browser clients. `roomDirectories/{uid}/rooms/{roomId}` supports isolated, paginated membership lookup. No custom composite index is required.

Creation atomically creates the room, host membership, directory, and invitation. UID-bound request IDs make creation retries idempotent. Joins transactionally read the room and membership before adding the member, directory, and incrementing the count. Finalization updates the same room document, serializing against joins. A join that commits before finalization is retained; a join after finalization is rejected. No official prediction or XP fields are written.

Room operations read bounded documents; rosters are capped at 100 and membership lists use cursors. The function is capped at 10 instances. Large-scale load, abuse-rate controls, App Check rollout, and operating costs have not been validated; this is not a claim of unlimited production capacity.

## Configuration and release

The browser uses Functions in `us-central1` from the same Firebase app as Auth and Firestore. CSP allows only the new project's callable origin plus local emulator ports. Use localhost with `?emulators=1` for emulator use; Firebase config switches to `demo-f1predict` and Functions port 5001.

Real users need the callable and Firestore rules deployed to **f1predict-1188e**, followed by the static frontend. Firebase requires the Blaze plan to deploy Cloud Functions: https://firebase.google.com/docs/functions/get-started . No upgrade or deployment was performed. Production callable authentication, CORS, and the deployed Node 22 runtime still require validation before release. Avoid deploying the entire pre-existing dirty workspace without reviewing its other changes.

## Tests

Final combined Firestore-emulator run: **3/3 passed** (two rooms tests plus the existing prediction/gamification rules regression). Expected permission-denied logs are assertions of rejected unauthorized writes.

- `npm run test:rooms`: service and Firestore-emulator security tests cover create validation, request retry, invalid invitations, concurrent capacity enforcement, duplicate joins, multiple memberships, finalization races, disabled invitations, unauthorized host actions, member isolation, forbidden direct writes, and pagination.
- `npm run test:ui`: fixture-backed browser checks cover existing auth/calendar/standings/prediction builder plus room creation, invitation sharing, invalid/full states, finalization, invitation persistence through login, and horizontal-overflow checks at 320, 390, 768, and 1024 pixels. Passed. These are not live Firebase browser tests.
- `npm run test:gamification`: 8/8 passed; includes use of unchanged official scoring.
- `npm run test:rooms:callable`: added real Auth/Functions-emulator HTTP verification, but the local Functions emulator exited during SDK discovery before running this test. CLI log reports an npm/cmd timeout and local Node 24 differing from configured Node 22. This check remains unverified. Module loading and syntax checks passed.
- No build script exists; this app serves static JavaScript modules.

## Files changed for rooms

New: `functions/rooms.cjs`, `js/rooms.js`, `tests/rooms.test.mjs`, `tests/rooms-callable.test.mjs`, `docs/rooms.md`.

Updated: `functions/index.cjs`, `firestore.rules`, `js/firebase.js`, `js/app.js`, `js/auth.js`, `index.html`, `styles/paddock.css`, `package.json`, `tests/fixtures/firebase.js`, `tests/ui-smoke.cjs`.

Other working-tree changes predate this rooms phase and were preserved.
