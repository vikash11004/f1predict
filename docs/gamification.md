# Gamification: local testing

Nothing is deployed. Live automatic triggers require Firebase Blaze; do not deploy or change billing as part of local testing.

## Start locally (PowerShell)

Install dependencies with `npm ci` and Java 21+. If the normal npm command is broken, use `node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js"` in place of npm.

```
npm run test:gamification
npm run test:rules
npm run emulators
```

When using the portable Java downloaded during development, prepend `.tools/java/<runtime-folder>/bin` to PATH first. This directory is ignored by Git.
On this Windows environment Java also needs `$env:JAVA_TOOL_OPTIONS = '-Djava.net.preferIPv4Stack=true -Djdk.net.unixdomain.tmpdir=C:\Vikash\Projects-Working\f1predict\.tools'` to start the emulator loopback socket. Adjust that directory if the checkout moves.

In another terminal:

```
$env:FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
npm run seed:gamification
```

Serve this repository locally and open `http://localhost:<port>/?emulators=1`. The query parameter switches both Authentication and Firestore to `demo-f1predict`; analytics is disabled. It only works on localhost/127.0.0.1. Leaving it off uses the existing real Firebase configuration. No service-account key is needed for emulator testing. Email/password accounts can be created locally; email action links appear in emulator logs.

The seed script writes explicitly labelled demo drivers and a demo weekend only to the emulator. It does not fabricate achievements or XP. Make and lock predictions to produce real local test events. To test result awards, use the Admin SDK against the emulator to publish a complete result with a Firestore `calculatedAt` timestamp after the configured session deadline. Shorten deadlines before making predictions for a quick test; do not backdate prediction locks.

## Rules and definitions

`gamificationConfig/current` is server-managed. Defaults are in `functions/engine.mjs`: 20 XP per verified locked prediction; 30 for a scored eligible session; 100 for a perfect prediction; 50 for a complete scored weekend. Achievement XP is additional. Levels start at 1 with thresholds 0, 100, 250, 500, 1000, 2000, 4000. These are initial configurable product rules, not official scoring changes.

Definitions include achievement ID, name, metric, target, and XP. Configuration is validated before any write. Changing configuration reconciles the active season retroactively and records deltas; increment `version` to explain rule revisions. `enabled:false` pauses processing and preserves earned state. Defaults are not silently applied in production: missing config means no awards.

Race administrators must configure `season` (legacy races default to 2026), `gamificationDriverIds` (22 unique roster IDs), and `sessionDeadlines` (Firestore timestamps keyed by quali, race, sprint_quali, sprint). No inferred deadline is used. Only predictions with canonical UID-based IDs, valid unique rosters, and server timestamps at or before those deadlines qualify. A server-only evidence record binds the order and timestamp when the lock event is observed. Existing historical predictions without this evidence do not receive XP. Scored awards require complete official results with `calculatedAt` after the deadline. Never use user profile fields or stored score totals as award evidence.

Standard weekends have qualifying and race sessions; sprint weekends have all four sessions. Cancelled sessions contribute no awards or records. A weekend award requires every non-cancelled session to be predicted and scored. Fully cancelled weekends do not break streaks; missing results pause chronological streak processing; a settled missed weekend breaks the streak. Later settled weekends may earn weekend awards while a preceding unresolved weekend pauses their streak contribution. Seasons have independent XP, levels, records, achievements, and histories.

## Persistence and security

Firestore triggers process prediction locks/deletes, results, race changes, configuration changes, and new profiles. `gamification/{season}_{uid}` holds the derived state and deterministic award IDs. Reconciliation reads the current source data in a transaction; equal state writes nothing. Concurrent deliveries serialize on the summary document. Changed awards create a numbered immutable history revision in the same transaction, including negative corrections. Corrections can revoke achievements, XP, records, streaks, and levels. Championship points and scoring code are never written by this backend.

Browser writes to gamification, history, config, and prediction evidence are denied even for admin claims. Users can read their own state/history; admins can read all. Profile self-edits are restricted to displayName. New profiles cannot inject XP or admin fields. Prediction locking requires request.time, so clients cannot backdate a lock.

## Cost and scale

Prediction events reconcile only their owner. Result and race events query only users who predicted that race. Configuration changes page all users in groups of 50, sequentially, because changing rules is intentionally a global operation. Each user's transaction reads races/results, that user's predictions/evidence, config and profile/state. Source reads grow with season size and users; they do not turn every player event into a full-player scan. History UI reads only the newest ten revisions. Transactions write two documents only when derived state changes. For a large league, result fanout should move to Cloud Tasks or a sharded work queue before production; the trigger boundary is isolated for that change. Transaction/event behaviour in the emulator does not prove production throughput.

All trigger writes use Admin SDK credentials in the backend. Do not ship keys in browser code. Future deployment must review billing, credentials, region, data retention, historical eligibility, rule rollout and trigger scaling. No billing upgrade is needed for these local tests.
