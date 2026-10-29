# Paid room creation: technical proposal and readiness assessment

Date: 29 October 2026. Status: design only; live transactions NOT approved.

## Decision and scope

Propose a one-time host-paid room service for a named season, priced by maximum membership including the host. Joining remains free. Payment must never buy prediction points, XP, wins, prizes, redeemable assets or better scoring. No pooled entry fees, host collections, wallets, cashouts, participant payouts or subscriptions are proposed. This is a proposed product boundary, not a legal clearance.

Existing rooms remain usable under their existing terms. Existing scoring, prediction deadlines, room isolation, global standings and gamification remain independent of purchases. New paid creation is a future server-controlled policy; it must not retrospectively charge existing hosts. Actual prices, service duration, refund terms, tax treatment and provider remain undecided.

This phase changes documentation only. It creates no checkout, provider account, credentials, payment records, Firebase rules, deployment or billing configuration.

## Repository fit

Inspected `js/rooms.js`, `functions/rooms.cjs`, `docs/rooms.md` and `docs/beta-runbook.md`. Current creation validates names, description and capacities 2–100. It uses a UID/request-ID-derived room ID and atomically writes the room, host membership, directory and invitation. Concurrent joins serialize against the room count. These mechanisms should be retained.

There is no verified payment/entitlement layer in the current create operation. An eventual paid policy must gate every creation entry point on the server; merely adding checkout in the browser leaves a bypass. Extract and reuse the existing atomic room-write routine after checking a server-owned purchase entitlement. Preserve a distinct server-authorized free/grandfathered path. Never accept a browser `paid`, `free`, `admin` or capacity-entitlement claim.

The beta runbook still lists global privacy/deadline/cancellation risks, unverified deployed authentication/backend flows and a 200-profile publication ceiling. Paid rooms cannot solve those blockers. The current staging project shares data with production; it is unsuitable for live payment rollout or destructive payment tests.

## Pricing and review design

Proposed capacity bands: 2–10, 11–25, 26–50 and 51–100 members, including the host. The chosen exact capacity remains the room limit; show the applicable band explicitly. Reject 0, 1, fractional and >100 capacities. Do not silently raise limits beyond the supported backend. All amounts remain unset until business/tax approval; do not show invented commercial prices.

Use a versioned server price catalogue with band, currency INR, amount in integer paise, service period, effective dates, tax configuration and policy version. For a server-issued quote:

`taxable subtotal = capacity-band service price − authorized discount`

`total payable = taxable subtotal + applicable tax + any separately approved, disclosed charge`

Prefer absorbing provider fees in the service price; no hidden checkout surcharge. Tax-inclusive pricing must show its included-tax split without adding tax twice. Rounding and place-of-supply treatment require accountant-approved rules. Disable checkout if required price/tax configuration is missing. Quotes expire after a proposed 15 minutes of server time; a changed/expired quote requires fresh review, never silent repricing.

Review shows room name, description, exact capacity including host, invitation settings, named season/service end, base price, discount (if any), tax type/rate/amount, total INR, merchant identity, refund terms and support contact. State that unused seats do not reduce the price, there is no auto-renewal, and performance awards have no financial value. Capacity changes after purchase are out of initial scope. Service expiry should stop new paid-period activity while preserving authorized historical reads; exact retention and renewal terms need approval.

## Interface specification

Reuse `pageHeading`, existing `card overview-card`/`card-body room-body`, `form-group`, `form-input` and `btn btn-primary` patterns from `js/rooms.js`. Keep the graphite, warm-white and red Paddock identity, typography, navigation and spacing. Extend My Rooms with review/status cards; add Purchase History under account navigation. Do not add a separate storefront theme. Provider-hosted checkout may have limited branding controls; use supported logo/accent options without collecting payment details ourselves.

On mobile stack details and totals in reading order; do not hide the total behind a sticky button. Preserve form state on back/reload and sign-in. Announce status with `role=status`, associate errors with fields, restore focus after checkout, support keyboard navigation and do not convey state with color alone.

| State | User-facing behavior | Evidence/action |
| --- | --- | --- |
| Draft/review | Edit details; review price and terms | No provider charge; quote from server |
| Checkout opening | Disable duplicate submit; preserve draft | Idempotent server order creation |
| Pending/unknown | “Payment confirmation pending. Please check status before retrying.” | Poll bounded authenticated status endpoint; closing popup or losing network is not failure |
| Captured, provisioning | “Payment confirmed. Your room is being prepared.” | Trusted backend confirms captured payment; room creation not yet committed |
| Ready | “Room created”; show capacity, season, receipt and Open Room | Verified payment and atomic room entitlement consumption both committed |
| Failed | Explain safe error and offer retry | Confirmed failed attempt; reconcile order before offering new payment |
| Checkout dismissed | “Checkout closed. We’re checking payment status.” | A UI cancellation cannot declare a bank transaction cancelled |
| Confirmed cancelled/expired | Return to draft/review | Backend/provider confirms no outstanding payable attempt; late capture still handled |
| Provisioning needs recovery | “Payment received; room setup needs attention.” | Retry fulfillment or contact support; never ask to pay again |
| Refund pending/refunded/failed | Separate amount and progress | Refunded only after trusted provider confirmation |

Purchase History is owner-only, cursor-paginated (20 records), newest first with stable ID tie-break. Show purchase date, room reference, capacity, service period, price/tax snapshot, total, payment/fulfillment/refund states, receipt and support reference. Other room members see no billing information. Pending and failed attempts are labeled accurately; no fabricated success/demo receipts in real history. Receipt download verifies owner UID on the server.

## Trusted backend and storage

Proposed operations: `quoteRoom`, `beginRoomCheckout`, `getPurchase`, `listPurchases`, `verifyCheckoutReturn`, `requestRefund`; separate provider webhook ingress and reconciliation/fulfillment workers. Firebase Auth supplies the stable purchaser UID. Require verified account and recent authentication for sensitive billing changes. App Check and rate limits supplement authorization rather than replace it.

| Collection | Authority and purpose |
| --- | --- |
| `roomPriceCatalog/{version}` | Server-maintained prices and tax/policy versions; expose only active public pricing |
| `roomQuotes/{id}` | Owner-bound immutable room snapshot, amount, expiry and payload hash |
| `roomPurchases/{id}` | Owner UID, environment, quote, provider order/payment IDs, independent payment and fulfillment state, room ID, verified timestamps |
| `paymentEvents/{provider_environment_eventId}` | Durable deduplicated inbox, verification outcome and processing status; backend only |
| `paymentBindings/{provider_environment_paymentId}` | Unique binding to one purchase, preventing reuse for another room |
| `refundRequests/{id}` | Reason, approved amount, provider reference, reserved/refunded totals and state |
| `paymentAudit/{id}` | Append-only application audit of actor, transition, amount, correlation and policy version |

No client writes to financial records, audit, entitlements or payment state, even from an admin browser. Prefer owner-checked callable reads so sensitive provider payloads never reach clients. Rules deny all direct access unless an explicitly sanitized owner-readable projection is introduced. Test cross-user lists, guessed IDs and receipt URLs. Finance permissions are separate verified claims/roles from race administration; privileged IAM access needs least privilege, MFA and access logs. Admin SDK bypasses rules: enforce invariants in backend code and IAM too.

### End-to-end protocol

1. Server validates room input and price configuration; stores an immutable UID-bound quote. Client sends quote ID and request ID, never authoritative price or host identity.
2. `beginRoomCheckout` transaction creates/returns a purchase keyed by UID + request ID, rejecting the same key with a different payload. Freeze the quote and room snapshot. Only one active checkout initiation may proceed per purchase.
3. Create the provider order outside Firestore transactions. Use provider-supported idempotency; otherwise persist an intent/reference and reconcile ambiguous API timeouts before creating another order. A merchant receipt string is not assumed to enforce uniqueness. Do not execute external payment calls inside a transaction that Firestore can retry.
4. Browser opens hosted checkout with server-returned order information. Return URLs and JavaScript callbacks are untrusted hints. The server validates callback evidence using its stored order ID, then retrieves provider state. Never turn a client callback into a paid record.
5. Webhook ingress validates the signature over raw bytes, with constant-time comparison and managed secret rotation. Validate merchant account/environment, stored order binding, payment ID, exact amount/currency and captured status. Store a durable event before acknowledging; temporary storage failures get retryable responses. Duplicate delivery returns success without duplicate effects. Invalid signatures cause no financial writes.
6. Only authenticated provider evidence can mark captured. Authorization alone is insufficient. A captured payment uniquely binds to one purchase. Older failure/authorization events cannot overwrite capture; refunds and disputes are separate state dimensions. Reconciliation fetches current provider state when events disagree or arrive late.
7. A Firestore transaction checks the verified purchase, unconsumed entitlement and deterministic room ID, then creates room + host membership + directory + invitation and marks fulfillment ready atomically. Generate invitation randomness once outside the retry callback and retain existing join-capacity serialization. Retries return the same room. Provider and Firestore cannot share one atomic transaction: this durable recovery process provides idempotent effects, not a claim of exactly-once network delivery.
8. A bounded worker scans indexed pending purchases/events with cursors, leases, exponential backoff and a dead-letter/review queue. Reconcile aged unknown payments and captured/unfulfilled orders. Browser polling has backoff and a maximum duration; the user can return later. Do not scan every user/room on each webhook.

Razorpay is a candidate adapter, not an approved provider. Its documentation explicitly requires raw-body signature checking and handling duplicate/out-of-order webhooks. Use separate test secrets and provider accounts/modes; provider-specific verification and capture semantics must be pinned and tested. [Razorpay webhook documentation](https://razorpay.com/docs/webhooks/validate-test/).

For an expired quote with a legitimately captured existing order, honor the stored purchase terms if fulfillment remains possible; otherwise queue a refund/review. Never retain money merely because local expiry occurred. If two attempts capture, fulfill one room and refund the extra confirmed payment. A cancellation/refund race must use a shared purchase state: stop uncommitted fulfillment when refund is approved, or apply the approved service policy to the existing room. Do not delete predictions or scoring history to undo a financial event.

## Refund, dispute and audit requirements

Proposed baseline, subject to legal/provider approval: full refund for duplicate capture or service not provisioned; explicit policy for host cancellation before use; case review for material service failure after use. Do not promise non-refundable service regardless of consumer rights. Refund to the original payment method through the provider; no internal wallet credits. Cancellation of an F1 session is distinct from failure to supply the room service and requires disclosed terms.

Reserve the requested refundable amount transactionally before calling the provider, ensuring cumulative pending/settled refunds never exceed captured funds. Use unique refund request keys and reconcile unknown API responses before retry. Track partial refunds and chargebacks separately. Do not mark refunded on refund request acceptance. Show provider-estimated timelines only after agreement, and retain a support case if a refund fails. Require a separate finance authority and dual approval for unusual/manual adjustments; prohibit arbitrary “mark paid” controls.

Audit includes actor/service identity, purchase/provider/event references, amount/currency, previous/new states, verified times, price/policy version, refund reason, approvals, reconciliation attempts and support reference. Keep financial adjustments append-only, with controlled retention and tamper-evident exports; Firestore alone is not immutable against privileged operators. Redact tokens, secrets, raw card/UPI credentials and unnecessary personal data from logs. Retention periods must be set by applicable law/provider contracts, not invented here. Backup and restore drills must reconcile with provider truth before resuming workers to avoid replayed refunds/entitlements.

## Infrastructure and provider prerequisites

- Trusted HTTPS backend, raw-body webhook handling, durable inbox/queue, scheduled reconciliation, secrets management, least-privilege service accounts, monitoring, backups and incident/refund ownership. Static Hosting alone is insufficient.
- Existing Functions code is Node 22/us-central1; assess payment-data location before using that region. Changing a function region does not migrate Firestore or its backups.
- Firebase Functions deployment requires Blaze. No upgrade is authorized; local emulator design/testing can precede an approved deployment. Free quotas are not a guarantee of zero cost. [Firebase Functions setup](https://firebase.google.com/docs/functions/get-started).
- Select an appropriately authorized payment aggregator after written acceptance of this exact business model. Complete merchant/entity/bank KYC and agree settlement, fees/taxes, refunds, chargebacks, supported payment methods, webhook retry windows, sandbox behavior, PCI responsibilities and data-processing locations. Test mode is not merchant approval.
- Use provider-hosted payment collection; never store card numbers, CVV or UPI PINs. Persist only necessary transaction references and accounting metadata. Restrict public checkout keys to the intended mode; keep API/webhook secrets out of static builds.
- Require isolated Firebase development/staging/production and provider test/live credentials before live enablement, even though the current application preview shares f1predict-1188e. The original Firebase project remains excluded.
- Server feature gates default off: purchasing enabled, provider mode, approved project allowlist and catalogue version. An emergency stop blocks new purchases but keeps verification, reconciliation, refunds and history functioning.

## Indian legal and regulatory review

This is a preliminary source-based product review, not an opinion authorizing launch. Obtain Indian counsel's written assessment of the actual paid-room terms, rewards and user flows, plus tax advice, immediately before enabling payments. Check current Gazette notifications, Authority determinations, state laws and court orders; this research does not establish the absence of litigation or later restrictions.

**Gaming classification.** The 2025 Act defines online money games irrespective of skill/chance, and prohibits their offering, related advertising and payment facilitation. It separately permits social-game subscription/one-time access fees where they are not stakes or wagers. A capacity service fee with non-redeemable scores is a possible social-game model, not an automatic exemption. No prize pools, vouchers/merchandise linked to paid competition, tradable XP or host-collected stakes should be introduced under this proposal. Do not assume F1 prediction is a recognized e-sport. [MeitY Act, sections 2 and 5–7](https://www.meity.gov.in/static/uploads/2025/10/8a7f103cefc68ed8aaa2ebc9a2ed7c13.pdf).

**Current rules.** MeitY's official announcement states the 2026 Rules take effect on 1 May 2026. Classification considers fees/stakes, expected winnings, revenue structure and monetization of rewards. Registration applies to e-sports and notified social-game categories, rather than automatically every social game. Counsel must assess any applicable determination/registration, user-safety and grievance obligations, including age controls. [Official 2026 Rules summary, Gazette reference CG-DL-E-22042026-271974](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2254606).

**Payments and location.** RBI's payment-system data guidance imposes India-storage requirements on covered payment-system participants, with responsibility assigned to authorized operators. Determine what transaction metadata and service providers fall within the selected aggregator's obligations before retaining payment data in the existing overseas backend. Do not assume hosted checkout removes every merchant obligation. [RBI payment-data storage FAQ](https://systemhealth.rbi.org.in/Scripts/FAQDisplay.aspx_Id%3D130%281%29.html).

**Consumer protection.** Provide merchant details, total price, service scope, cancellation/refund terms and an accessible grievance process. Government guidance describes complaint acknowledgement within 48 hours and redress within one month under e-commerce rules; counsel must map applicable duties to the operating entity and gaming grievance framework. Avoid deceptive urgency, hidden fees and misleading success states. [Government parliamentary explanation](https://sansad.in/getFile/annex/253/AU2798.pdf?source=pqars).

**Privacy.** MeitY publishes the DPDP Rules 2025 and a separate enforcement timeline. Review applicable phased commencement at launch, notices, lawful processing, children's data/parental consent, processor contracts, security/breach response, deletion versus accounting retention and international transfers. Do not assume all provisions commenced simultaneously or collect identity documents without a defined need. [MeitY rules and timeline](https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa?pageTitle=Digital-Personal-Data-Protection-Rules-2025%3B).

**Tax.** Obtain a CA-approved classification for the actual service, GST registration/place of supply/rate, invoices, credit notes, refunds and record retention. Online money-gaming tax provisions cannot simply be applied to an access service; taxation does not legalize a prohibited game. Do not implement a guessed GST percentage. Government records describe the distinct online-money-gaming tax changes; confirm the current treatment of this model separately. [GST Council record](https://www.gstcouncil.gov.in/node/4974).

Also review F1 branding/data licensing and truthful marketing before commercial use. Payment-provider acceptance and legal classification are separate release gates.

## Validation and incremental delivery

1. Approve commercial scope, capacity bands, term/refund model and independent legal/provider feasibility. Resolve existing beta security/data-integrity blockers first.
2. On separate approval, implement disabled UI states and a local payment adapter using emulator fixtures. Label simulations explicitly; never create live entitlements from test events. Preserve all existing UI/scoring regressions.
3. Implement server pricing, entitlement gate, rules, inbox, fulfillment and refund state machines locally. Test deterministic IDs, retry recovery and operational tools before provider integration.
4. Following infrastructure approval, use an isolated provider sandbox and staging project for hosted checkout, signed webhooks, actual capture/refund test states and recovery drills.
5. Require an explicit live-transaction approval after legal/tax/provider sign-off, production security review and successful evidence-based release gates. No automatic promotion from sandbox to live.

Required tests include every capacity-band boundary and integer-paise/tax rounding; expired/changed quotes; price/UID/role tampering; old free-create bypass; cross-account history/receipts; raw-body signature mutation; wrong project/mode/account/order/currency/amount; authorization without capture; webhook replay and disorder; callback/webhook races; concurrent multi-tab orders; timeout after provider acceptance; duplicate captures; transaction failure before/after room creation; cancellation racing capture/refund; partial/duplicate refunds; chargebacks; provider outage; restore/reconciliation; pagination; accessible responsive checkout return; and unchanged scoring/XP/room membership workflows.

## Readiness verdict

Ready for design review; NOT ready for live payments. Existing room transactions/components are reusable. Payment implementation and provider testing are absent; legal/tax/provider approval, data-location analysis, isolated infrastructure, paid-backend approval, refund operations and unresolved beta security issues remain blockers.

No payment tests were run because no payment code was added. Earlier beta test results are documented in beta-runbook.md and are not payment-readiness evidence. Only this proposal file was added in this phase. Implementation of live transactions awaits explicit approval.
