# Controlled beta — NO GO pending release gates

## Actual checks on October 29, 2026

- Staging build passed. Preview release manifest returned HTTP 200.
- Unit suite: 11 passed, 0 failed (scoring and gamification).
- Firestore emulator integration/security suite: 6 passed, 0 failed (administration, publication, rooms, room predictions and gamification rules). Permission-denied logs are expected negative assertions.
- Playwright fixture regression passed: authentication UI, calendar, standings, predictions, room/invitation states, navigation, responsive overflow and offline behavior. It replaces Firebase; it does not establish real provider/backend correctness.
- `git diff --check` passed, with line-ending warnings only.
- Deployed OAuth/email flows, live callable availability, trigger integration, hosted GitHub Actions and recovery drills were not verified in this pass. Local runtime was Node 24; CI is configured for Node 22.

Files changed in this beta pass: `.gitignore`, `package.json`, `js/firebase.js`, `js/environment.js`, `scripts/build.mjs`, `firebase.staging.json`, `.github/workflows/beta-checks.yml`, and this runbook. Existing dirty changes from earlier phases were preserved. No visual components or scoring formulas were changed.

Staging preview: https://f1predict-1188e--beta-s9drg3lu.web.app . Static release d046f601b6418041, expires November 5, 2026. Only a preview-channel deployment was performed. No Functions, rules, production channel or billing configuration was deployed.

## Environments and commands

- `npm run build:development`: emulator-only localhost build, using demo-f1predict.
- `npm run build`: staging static build in dist/staging.
- `npm run build:production`: production artifact only; never deploys.
- Staging and production both target f1predict-1188e at the user's request. They are NOT data-isolated. Use emulator fixtures for destructive tests. The original project is not a deployment target.
- `npm run test:unit`, `npm run test:integration`, `npm run test:e2e`; `npm test` runs them sequentially. Java 21 and installed Playwright Chromium are prerequisites.
- `npm run test:rooms:callable` verifies Auth/Functions integration locally. Windows may need SDK manifest discovery as documented in room-predictions.md.

GitHub Actions runs on pull requests or manual dispatch using a single Ubuntu job, Node 22, Java 21, a 20-minute timeout and cancellation of superseded runs. No deploy secrets, schedules, paid runners or artifact uploads are configured. Account free-minute availability has not been verified; disable Actions if no allowance remains. Workflow is local until pushed; no hosted CI result is claimed.

## Release gates

- Verify email registration, verification, reset, sign-in/out and session persistence on the preview. Verify Google popup, redirect, provider-conflict handling and authorized preview domain using a real Google account. These deployed checks have NOT been completed.
- Backend deployment is not performed. Cloud Functions deployment requires Blaze. Do not upgrade or enable APIs/billing without approval. A static page alone cannot provide room callables or trusted publication.
- Resolve global prediction privacy and deadline enforcement, global cancellation/reversal consistency, and remaining authentication defects identified in earlier audits. Confirm no client-write bypass to official scores.
- Atomic publication currently has a 200-profile limit and read/write budgets. Restrict beta enrollment below that ceiling; large-scale readiness is not established.
- Complete outstanding social features and their permission tests before advertising them. Current chat implementation is partial.
- Restore-test backups; run actual Node 22 callable tests and deployed staging workflows. Do not certify absence of critical issues based on fixture tests.

## Race-weekend rehearsal

Use demo-f1predict only. Run the integration and callable suites: they seed races, submit room picks, lock them, publish/correct classifications, retry duplicate processing, cancel sessions, and assert score/XP isolation. Before release, additionally rehearse one complete standard and sprint weekend through the deployed UI with test accounts, including deadline equality, two simultaneous admins, failed publication retry and account recovery. This manual rehearsal remains outstanding.

## Backup and recovery procedure

Before any schema/rules/backend release, record the source commit, lockfile, Firebase project ID, deployed function/rule revisions and Hosting release ID. Obtain an approved database/Auth backup using available project facilities. Do not enable paid scheduled backup/export services automatically. No live backup was created here.

Store backups outside Hosting artifacts and Git with restricted access; they contain personal data. Include subcollections (room members, predictions, progression histories) and Auth identity/provider mappings, not merely top-level documents. Preserve stable UIDs. Restore into an isolated emulator or future staging project, validate record counts and score/XP fingerprints, and rehearse login/provider linkage before any live restore. Do not restore stale totals independently of source predictions/results.

For failed atomic publication, retry the same order and original revision. Conflict errors require reloading current results. Failed transactions commit nothing. For wider incidents, stop admissions and admin publication, preserve logs and the last good snapshot, identify the affected revision, and restore only after explicit approval.

## Rollback and monitoring

Keep the previous static build and release ID. Roll back the preview by redeploying the previously validated artifact to the beta channel. Production rollback requires approval; do not clone preview to live. Backend/rules rollback must preserve server-only score writes and compatibility with stored data. Hosting rollback does not roll back Firestore or Auth.

Use existing Firebase console usage panels and Functions logs after approved backend deployment. Review reads/writes, authentication failures, callable errors and publication latency after each race weekend. Log operation name, error code, revision and duration only; never tokens, credentials, invitations, prediction bodies or emails. No external monitoring service or paid logging integration was enabled. Alerting and backup automation remain unconfigured.
