# Room prediction integration

Implemented locally for the existing `f1predict-1188e` Firebase app. No deployment, billing change, original Firebase project access, or live data migration was performed.

## User workflow

Open My Rooms → a room → select season, race and session → Build prediction. The existing P1–P22 builder handles tapping, drag ordering, validation, autosave and final locking. The URL is `#predict/<race>/<session>/<room>`; omitting the room retains the global workflow. Room saves are serialized and bound to the signed-in account. Tab changes flush pending drafts before switching context.

Room standings include current totals, each weekend's session scores, historical standings through a selected race, and position movement. Ties use competition ranks (1,1,3); UID sorting keeps tied rows stable. Historical rosters exclude users who joined after that weekend's last configured deadline. New current members appear with zero points. Historical totals reflect corrected official classifications, rather than preserving superseded classifications forever.

The existing scoring module is imported unchanged by the backend. This includes **all six cumulative bonuses in all four session types**, including qualifying: P1 20, top-three any 20, top-three exact 40, top-five any 30, top-five exact 60, perfect 500. Perfect standard/sprint weekends remain 2,110/4,220 points.

Global predictions, scores, leaderboard and global XP are untouched by room processing. The global Excel exporter remains in the global builder; it is not exposed as a misleading room export.

## Authority and privacy

- The existing authenticated `rooms` callable dispatches room prediction operations. Firebase's verified UID determines ownership; request fields cannot set UID, timestamps, results, scores, XP or privileges.
- Membership is checked before reads and again within save transactions. Room host status does not grant result-entry or scoring authority.
- Room predictions use `rooms/{roomId}/predictions/{hash(uid,race,session)}`. All direct browser reads/writes to predictions, score caches, revision counters, progress and XP history are denied—even for browser admins. The callable exposes only the owner's draft.
- Saving requires an active race, a supported session, no session lock/cancellation, no confirmed result, and trusted server time **strictly before** the configured deadline. A request exactly at the deadline is rejected. Transaction retries recheck server time. Missing deadlines fail closed.
- Drafts may contain 0–22 unique eligible drivers. Locking requires all 22. Once locked, no client can modify the prediction. Other locked picks are visible only inside the same room, after the deadline, to a member who has locked their own prediction. Cancelling a session hides the comparison view.
- Official classifications come from the existing admin-authorized `results` collection. The callable ignores any results or score fields in client requests; it recalculates from orders using `js/scoring.js`. Administrators remain responsible for authoritative classifications, as in the original workflow.

## Reconciliation and gamification

Scores are reconciled on room open/refresh, not by a new background fan-out trigger. A per-weekend fingerprint combines the race revision, official result revisions and locked-prediction revision. Unchanged weekends reuse their server-owned cache. Changed weekends read at most 400 predictions (100 members × four sessions), recompute totals and replace the cache transactionally. Repeated or concurrent requests never increment points twice.

Missing/malformed results remain pending; cancelled sessions award zero. Corrections, deletions and cancellations invalidate cached totals and recompute subsequent standings. Drafts and missed deadlines earn no points. There is a 60-weekend season bound. The endpoint's 120-second timeout and existing instance cap are limits, not a load-test guarantee.

The same gamification engine/configuration runs against server-locked **room** predictions. Room XP, levels, achievements and streaks are persisted separately in `rooms/{id}/progress/{season}_{uid}` with fingerprinted, transactionally created revision history. Reconciliation occurs for the viewing player on room open/refresh. Awards can reverse after cancellations/corrections. Joining multiple rooms does not multiply global XP. The UI labels room XP explicitly and lists the currently eligible award events. Only the active configuration season receives room XP.

## Required configuration before real use

For each race in the new project, authorized Race Control must configure:

- `season` (for example `"2026"`), `round`, `name`, and `weekendType` (`standard` or `sprint`).
- `gamificationDriverIds`: exactly 22 distinct driver IDs matching the existing builder's roster.
- `sessionDeadlines`: Firestore Timestamp values for each supported session. Use official session deadlines with explicit timezone conversion; no deadlines were fabricated or written to live data.
- `status: "active"` while accepting picks; existing `sessionLocks` and `cancelledSessions` remain authoritative.
- Official `results/{raceId}_{session}` documents retain `raceId`, `session`, a complete valid `order`, and `calculatedAt` at or after the deadline.
- Optional `gamificationConfig/current` uses the existing validated configuration. Missing/disabled configuration displays an XP empty state.

Existing race seed data does not automatically populate these deadlines. Sessions intentionally remain read-only until configured. No migration copies global picks into rooms. No new composite indexes are needed. Deployment requires approval for the updated callable, Firestore rules, and frontend; only the new Firebase project is an allowed live target.

## Validation

Final combined Firestore-emulator regression: **4/4 passed** (room predictions, two room membership tests, existing prediction/gamification security regression). An earlier combined run had a test-worker failure without diagnostics; the final rerun completed successfully.

- Pure scoring/gamification tests: **11/11 passed**, covering all distance tiers, each bonus and stacking across every session type, maximum totals, invalid orders, deadline edges, cancellation/missing results, ties, membership history and movement, XP/streak regressions.
- Room prediction integration passed in the official Firestore emulator: UID ownership, cross-room isolation, immutable locks, drafts, deadline equality, early-view denial, concurrent duplicate scoring/XP, official-result correction, cancellation, deletion, and denial of forged scores/progress. Global score/profile sentinel values and global prediction/XP collections remain unchanged.
- Full callable HTTP test: **1/1 passed** with Auth, Functions and Firestore emulators. Tests sign-in, room creation, authenticated locking, repeat-write rejection, own-prediction retrieval and early comparison denial. This caught and fixed a Firebase SDK CJS/ESM `HttpsError` class mismatch.
- Fixture-backed browser regression: **passed**. Covers existing authentication, calendar and global leaderboard plus room creation/invites, selection, autosave, session isolation, drag/drop, all 22 drivers, locking, room-to-global switching, and responsive overflow checks. Fixture tests do not verify live Firebase networking.
- JavaScript syntax and `git diff --check` passed. No build script exists in this static-module app.
- Local Functions emulation used Node 24; the configured production runtime is Node 22 and was not tested here. No live deployment or large-scale load test was performed.

Windows Functions discovery initially failed through the `.cmd` shim. The successful run used the SDK-generated manifest in ignored `.tools/functions.yaml`, generated by running `node node_modules/firebase-functions/lib/bin/firebase-functions.js .` with `FUNCTIONS_MANIFEST_OUTPUT_PATH` set, then setting `FIREBASE_FUNCTIONS_DISCOVERY_OUTPUT_PATH` to `.tools` for `emulators:exec`. This does not change deployed source or bypass authentication.

## Files changed in this phase

New: `functions/room-predictions.mjs`, `js/room-standings.js`, `tests/room-scoring.test.mjs`, `tests/room-predictions.test.mjs`, `docs/room-predictions.md`.

Updated: `functions/index.cjs`, `firestore.rules`, `js/app.js`, `js/predictions.js`, `js/rooms.js`, `styles/paddock.css`, `package.json`, `tests/fixtures/firebase.js`, `tests/ui-smoke.cjs`, `tests/rooms-callable.test.mjs`, `docs/rooms.md`.

All unrelated pre-existing working-tree changes were preserved.
