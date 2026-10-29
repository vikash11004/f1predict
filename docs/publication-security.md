# Trusted atomic result publication

Official publication now runs through the existing Firebase callable, requiring `request.auth.token.admin === true`. The project guard permits only f1predict-1188e and the demo emulator. The browser supplies an order and the revision it originally loaded, never scores, totals, timestamps, or administrator identity.

The server validates the session and 22-driver roster, imports the unchanged scoring function, and commits the official result, session scores, session lock, profile totals and session wins in one Firestore transaction. Tied session wins and all existing bonuses are preserved. As in the prior global workflow, complete valid predictions are scored even if not manually locked; published sessions now reject subsequent prediction writes.

Identical re-publication is a no-op. Different concurrent orders conflict on the loaded revision. Concurrent different sessions also serialize through their shared score queries/profile writes. Totals are recomputed from score records rather than incremented from stale browser values. A failed commit changes nothing; a lost response can be retried safely with the same payload. There is no partial job to resume in this atomic implementation.

Firestore rules deny direct official-result, score and profile-total writes even to browser admins. Admin draft autosaves use resultDrafts, carry the base publication revision, and never alter published data. The existing editor restores only drafts matching its loaded revision. Error recovery provides retry and reload controls without exposing exception contents.

## Capacity and rollout limitations

This implementation explicitly supports at most 200 user profiles, 20,000 existing score records, and 450 queued writes per publication. It fails before writes above these limits. Large leagues need a paginated revisioned worker; this change is not an unlimited-scale implementation. Firestore transaction read size/time limits can reject a smaller workload too, safely without partial publication.

Existing score records are used when recomputing totals for other sessions. Historical data written by the old client should be audited separately; it is not silently migrated. Browser-based season reset operations that write results/scores/totals are intentionally blocked and need a separate trusted maintenance workflow. Race cancellation still requires a separate reconciliation workflow for legacy global scores. Broader calendar-validation and global prediction-privacy/deadline work in security-review.md remain outstanding.

Deploy the callable before deploying the frontend and restrictive rules, during a controlled release. Nothing has been deployed and no billing changes were made. Existing progression reconciliation receives committed result events; duplicate publication does not emit another result write.

## Verification

Actual runs: 2/2 publication/admin emulator tests passed; 11/11 scoring/gamification regressions passed; existing fixture-backed browser smoke suite passed; syntax checks and git diff --check passed. The new publication callable has not been exercised against a deployed Firebase project, and the browser smoke suite does not cover admin publication end-to-end.

tests/publication.test.mjs exercises missing admin claims, invalid orders, injected pre-commit failure and retry, duplicate/lost-response publication, competing corrections, multiple sessions, total/win integrity, direct-write denial, published-prediction freezing, and atomic capacity rejection. tests/admin-rules.test.mjs now expects direct admin publication to be denied. See the task response for actual run results.

Changed: functions/publication.mjs, functions/index.cjs, firestore.rules, js/results.js, js/predictions.js, tests/publication.test.mjs, tests/admin-rules.test.mjs, docs/publication-security.md, docs/security-review.md.
