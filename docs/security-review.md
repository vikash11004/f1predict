# Administration review — partial hardening

Update: the browser-publication risk described below has been addressed by the bounded atomic backend in [publication-security.md](publication-security.md). Read that document for current behavior and explicit scaling/maintenance limitations; the bullets below record the earlier audit findings.

No deployment or billing changes were made. This review does not certify production readiness.

Implemented: race name/round/type/status validation in rules; result path/session/length/uniqueness validation; server timestamp required on publication; published orders cannot silently change via draft autosave. Added an explicit admin UI guard and eligible-driver validation before publication. Error diagnostics now log a code rather than the complete result-publication exception. Fixed sprint_quali trigger routing, which previously derived the wrong race ID.

Authorization currently uses Firebase custom claims in rules and a token-derived UI cache. `ADMIN_UID` is null, not a hardcoded privileged UID; its remaining uses are legacy filtering. Client user.role/isAdmin fields must never authorize operations.

## Unresolved risks / work remaining

- Global scoring remains browser-calculated. Admin clients can write arbitrary scores and profile totals. Move publication and scoring to trusted backend operations before public rollout.
- Concurrent global publication can race when applying deltas. The result write precedes the score batch, so failed batches leave partial publication. A transactional, revisioned, resumable backend job is still needed. Retrying is not a proven recovery mechanism under concurrency.
- The current admin result editor autosaves into the official results document. New rules reject autosaves that retain an old calculatedAt timestamp; a separate draft collection/workflow is needed for seamless correction editing.
- Calendar validation does not yet validate dates, deadlines, lock maps, cancellations, season consistency or all allowed fields. Race deletion remains privileged but unrestricted.
- Result rules validate uniqueness and cardinality but do not yet verify all driver IDs against a trusted roster. Browser validation is not a security boundary.
- Global prediction rules still expose predictions to all signed-in users and do not enforce calendar deadlines. Room predictions use stricter backend checks.
- Existing global leaderboard/export queries are unbounded; pagination remains outstanding. Existing profile documents are readable to authenticated users, so private fields must not be stored there.
- Full publication failure/recovery and concurrent scoring tests remain outstanding. Existing room reconciliation tests do not prove global publication safe.

Changed files: firestore.rules, functions/index.cjs, js/results.js, tests/admin-rules.test.mjs, docs/security-review.md.

Pure scoring/gamification regression: 11/11 passed. New administrator-rule integration test covers unauthorized writes, invalid race/result data, published-order draft mutation denial and valid republication. See task response for emulator result.
