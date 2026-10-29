# Disabled payment preparation — 29 October 2026

Implemented the safe local preparation stage of [the proposal](paid-rooms-proposal.md). This is not certification of Indian legal compliance or approval to accept payments.

## Implemented

- My Rooms has a collapsible capacity-review panel using the existing cards, fields and buttons. Bands cover 2–10, 11–25, 26–50 and 51–100 members including the host. Commercial price, tax and total remain explicitly unconfigured. Checkout is disabled; current free room creation is unchanged.
- Development builds on localhost show an explicitly labeled local simulation for pending, simulated success, failure and cancellation, with retry and test-history controls. All outcomes say no payment was verified and no room was created.
- Backend simulation requires demo-f1predict, Functions emulator mode and a configured Firestore emulator. It stores only local test records. Stable UID/request IDs provide transactional duplicate prevention; changed payloads with the same ID are rejected. History is UID-scoped, bounded to 20 records and paginated by stable document ID (not chronological financial history).
- Non-simulation checkout, verification and refund operations fail closed. There is no live provider adapter, credential, webhook, payment-success authority, financial entitlement or paid-room fulfillment path.
- Existing default-deny Firestore rules protect simulation and proposed financial collections, including against direct admin-client writes. No rules change was necessary.

The fixture amount in local test records is arbitrary formatting data, not an offered price or tax calculation. Simulation scenario selection is deliberately available only in emulators; it must never become a live verification mechanism. Runtime/project guards come from server environment, not the callable payload. Functions SDK authentication supplies the UID; the new integration tests exercise the service directly, not a deployed callable.

## Actual verification

- 14/14 unit tests passed: commerce validation/gates plus existing scoring and XP tests.
- 3/3 Firestore emulator tests passed: commerce idempotency/privacy/pagination/forbidden financial writes plus existing room validation, capacity/concurrency and isolation.
- Playwright fixture regression passed, including all four simulation scenarios, retry after simulated network failure, duplicate attempt history, disabled checkout, capacity review, existing workflows and responsive widths 320/768/1024.
- Staging build, changed-module syntax checks and git diff whitespace check passed. Line-ending warnings remain.
- No real payment, provider sandbox, signed webhook, bank refund, deployed authentication or legal compliance test was performed.

## Files changed in this stage

Added `functions/room-commerce.cjs`, `js/room-commerce.js`, `tests/commerce.test.mjs`, `tests/commerce-emulator.test.mjs`, and this document.

Updated `functions/index.cjs`, `js/rooms.js`, `package.json`, `tests/ui-smoke.cjs`, and `tests/fixtures/firebase.js`. Existing unrelated working-tree changes were preserved. No scoring formulas, Firebase targets or visual styles were changed. Build output is ignored; nothing was deployed.

## Live release remains blocked

The host-access-only scope excludes stakes, prizes, cashouts and redeemable XP. This follows the proposed social-game boundary, but classification of the actual service must be reviewed by Indian counsel. The [2025 Act](https://www.meity.gov.in/static/uploads/2025/10/8a7f103cefc68ed8aaa2ebc9a2ed7c13.pdf) distinguishes non-wagering access fees from prohibited money games. The [official 2026 Rules summary](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2254606) describes revenue-model classification and applicable registration/user-protection requirements. These sources were rechecked for this stage; they do not constitute a project-specific clearance.

Before further provider implementation, obtain business/service terms, current legal classification, CA-approved GST treatment, provider acceptance, merchant KYC, refund/grievance contacts and applicable age/privacy safeguards. Resolve the existing beta security blockers. Approve isolated payment staging and suitable payment-data location. Approve backend infrastructure costs separately: the existing Firebase Functions deployment requires Blaze; no billing upgrade was made.

Still required after those gates: real server catalogue/quotes, merchant checkout, cryptographic webhook/provider verification, durable reconciliation, paid creation bypass prevention, atomic entitlement fulfillment, actual owner purchase history/receipts, refunds/disputes, financial audit retention, backup/recovery and their full tests. Do not turn the simulation into production by relaxing its guards. A separately reviewed live implementation and explicit activation approval are required.
