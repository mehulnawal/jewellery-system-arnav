# Phase 1.5 — canonical Inventory identity rollout

**Prepared locally; not deployed. Production legacy collision audit not run.**
No production credentials were requested or used. No production initialization, stock mutation, record deletion, rename or reference migration was performed. Master Price List, Width and Challan pricing are outside this phase.

## Registry architecture

The only canonical numeric implementation remains `src/utils/dimensions.js`. `canonicalSku` constructs the existing `normalizedSize_shape_type` key. Type/Shape must be nonempty strings without edge whitespace, reserved `/` or `_` delimiters, or control characters. Invalid values are reported, not silently repaired. This prevents ambiguous component tuples and invalid Firestore document paths without redesigning the SKU format or adding a Type/Shape whitelist.

`inventoryIdentities/{canonicalSku}` is a logical reservation. Inventory physical document IDs, saved raw legacy Size/SKU, stock, Purchase/Challan links, and historical events are independent of that key.

An ordinary reservation is `{ sku: "5_PR_CBD", recordId: "legacy-physical-id" }`. The physical document may still contain Size `"5.00"` and SKU `"5.00_PR_CBD"`.

A collision is `{ sku: "5_PR_CBD", recordId: null, legacyRecordIds: ["a", "b"] }`. Null owner explicitly means collision, not available. No winner is selected. The app's existing collision indicator and physical rows remain visible and searchable.

## Initializer and recovery

`scripts/initializeInventoryIdentities.mjs` is an operator-only, one-time/retry-safe setup command. It defaults to a read-only plan. `--input` supports JSON exports and can never be combined with `--apply`. An export must contain the complete `inventory` array with physical `id` values; optional `purchases` and `challans` arrays improve reference reporting. Omitted reference collections are labelled "not scanned".

The apply path uses a fresh full database scan, not an imported export as a write source. It requires an explicit project, a reviewed SHA-256 identity fingerprint, and acknowledgment that guard rules are deployed and trusted identity writers are paused. Emulator access requires a loopback host and a `demo-` project. Non-emulator access is disabled unless a future authorized operator explicitly supplies both `--allow-live` and matching `--confirm-project`.

The fingerprint includes physical IDs, raw Size including its type, Shape, Type and current SKU, in deterministic document-ID order. It excludes weight, pieces, timestamps and history so stock-only transactions can continue without changing identity. The initializer never writes any business collection.

Apply proceeds as follows:

1. Scan every Inventory document. Reject invalid identities or a fingerprint different from the reviewed plan before writing reservations.
2. Set the single marker `inventoryIdentityMigrations/v1` to `ready: false`, `status: "initializing"`, recording the reviewed fingerprint, counts, schema version and start time. A retry against a different interrupted-plan fingerprint is rejected.
3. Write at most 100 reservations per transaction. Read existing entries first. Matching entries are preserved. An existing single owner may be promoted to a collision only if it is one of the actual colliding physical records. Existing collision member IDs and extra metadata are retained; collisions are never downgraded automatically. An unexpected owner stops the operation instead of being overwritten.
4. In a final transaction, re-read the marker, full Inventory collection and registry. Verify the fingerprint is unchanged, there are no invalid identities, and every valid current identity has a covering reservation.
5. Only after verification, atomically set `ready: true`, `status: "ready"`, completion time and verified fingerprint.

An interrupted operation retains `ready: false`. Rerun the same approved command against the unchanged source; committed reservations are reused and remaining ones are written. Two identical initializers can reconcile safely. There is no automatic lock expiry that might re-enable unsafe creation. If source identities change or registry ownership conflicts, keep the maintenance guard in place, save the audit, and obtain an explicit repair/resume plan. Never clear the marker, delete reservations or force `ready: true` as a workaround.

After readiness, another run verifies current coverage without changing the marker or reinitializing the index. If operational identities have since changed, the old fingerprint is rejected; a new read-only plan is needed to perform an optional verification. **No daily or per-record registration is required.**

## Invalid data and readiness

Invalid entries include document ID, raw Size, Type, Shape, current SKU, reasons, stock/pieces, direct Purchase/Challan references and separately labelled possible SKU-only references. Missing/invalid physical IDs in an export and duplicate IDs are also reported. Blank, malformed, zero, negative, nonfinite Size and invalid Type/Shape values cannot be silently reserved.

This version intentionally has no ignore/waiver option. All invalid identities must receive an explicitly reviewed correction plan outside this initializer, then pass a fresh audit. Until then readiness is not enabled. Collisions are different: fully recorded collision reservations permit readiness while continuing to block new equivalent creation.

Large snapshots must fit the final verification transaction's service limits. A timeout, failed read, oversized reservation or resource-limit error leaves initialization incomplete; no partial successful scan is treated as complete. Do not bypass final verification. Review scale before an actual rollout.

## Normal workflows after readiness

- New Inventory and Purchase-created Inventory reserve canonical keys automatically in the same transaction as the authorized Inventory write. Concurrent equivalent creates have only one owner.
- Purchase with an unused identity creates its new physical Inventory record and reservation. Purchase with an occupied identity is rejected by existing duplicate rules; it does not top up existing stock. Purchase with a collision is rejected, including when frontend Inventory data is absent/stale. No physical record receives stock, and failed transactions leave no Purchase or number claim behind. Assigning stock to one collision member requires explicit business resolution; this initializer does not guess.
- Existing allowed Purchase edits retain their linked physical Inventory IDs. Unchanged legacy identities keep their raw Inventory Size/SKU and existing collision reservations.
- Challan deduction and return use `sourceInventoryId`/`inventoryId` directly. Canonical equivalence never substitutes a physical selection. A historical Challan without physical stock identity still follows the existing refusal behavior on return.
- Staff/Admin permission windows are unchanged. In particular, the existing restriction on staff Stage 2 returns to older Admin-owned Inventory remains; this phase does not broaden stock-increase permissions.

## Security and operational guard

The marker is never writable by a browser client, including an application Admin. Initialization requires a trusted operator with appropriately controlled Firebase Admin SDK/IAM access. A Staff application account cannot perform setup.

Client reservation writes require normal Inventory/Purchase permission, readiness, canonical output and an accompanying Inventory create or actual identity change. That Inventory write must independently satisfy its existing ownership/time/role rules. Standalone reservation manipulation, collision reassignment and marker toggles are denied. Reservation releases must accompany removal or identity change of their real owner. No broad allow rule was added.

During `status: "initializing"`, guard rules block physical Inventory deletion. Existing readiness rules also block new identities and identity edits. Reads and otherwise permitted stock-only updates continue. Admin SDK writers bypass security rules, so all trusted imports/jobs that change identity or delete records must be paused by the operator.

Setup writes only the registry and one technical marker. It creates **zero Activity Log rows**, so Weekly Report history is not flooded. The marker's timestamps/counts are the concise setup record.

## Commands — local preparation

Safe read-only export audit (already exercised on synthetic local data):

```powershell
node scripts/initializeInventoryIdentities.mjs --input=tests/fixtures/dimension-audit.json --output=docs/identity-rollout-local-plan.json
```

For a later local emulator rehearsal, start the existing test emulator and use a demo project populated only with fixtures:

```powershell
firebase emulators:start --only firestore --project demo-inventory-rollout --config firebase.test.json
$env:FIRESTORE_EMULATOR_HOST = '127.0.0.1:8180'
node scripts/initializeInventoryIdentities.mjs --project=demo-inventory-rollout --output=local-plan.json
node scripts/initializeInventoryIdentities.mjs --project=demo-inventory-rollout --apply --expected-fingerprint=REVIEWED_SHA256 --ack-guard-rules-deployed --output=local-apply-audit.json
```

`REVIEWED_SHA256` means the exact fingerprint emitted by that project's dry run, not the checked-in synthetic report's fingerprint. The Java runtime must be available for the emulator. Emulator tests already invoke the same apply implementation against isolated demo projects.

## Future production sequence — NOT executed, requires explicit approval

There is an intentional controlled-maintenance interval. The safe order is **guard rules → reviewed live audit/backfill → ready verification → new frontend → reopen creation**, not an unguarded backfill while old writers remain active. These are the same prepared rules, not a weaker temporary ruleset. The Phase 1 instruction to avoid deploying before index preparation refers to releasing the new frontend to normal operation; guard installation is part of the approved maintenance rollout.

1. Approve the project/site, current audit and maintenance window. Retain a backup/export. Pause old clients' Inventory creation/identity changes/deletions, Purchase completion/imports and all trusted identity-changing jobs. Do not launch old frontend writers again during rollout.
2. Install the prepared guard rules (only on explicit deployment approval):

```powershell
firebase deploy --only firestore:rules --project APPROVED_PROJECT
```

3. In the approved operator environment, ensure `FIRESTORE_EMULATOR_HOST` is unset. Future operator credentials are an external prerequisite; none are requested for this task. Run a fresh read-only live plan and review invalid/collision/reference output:

```powershell
node scripts/initializeInventoryIdentities.mjs --project=APPROVED_PROJECT --allow-live --confirm-project=APPROVED_PROJECT --output=reviewed-live-plan.json
```

4. If invalid identities exist, stop for explicit resolution. Otherwise apply the reviewed plan, reserving collisions without merging:

```powershell
node scripts/initializeInventoryIdentities.mjs --project=APPROVED_PROJECT --allow-live --confirm-project=APPROVED_PROJECT --apply --expected-fingerprint=REVIEWED_SHA256 --ack-guard-rules-deployed --output=apply-audit.json
```

5. Require successful `ready` output and verify the marker. Repeat the same command while still in maintenance to obtain `already-ready-verified`; it should write zero reservations. No manual marker edit is permitted.
6. Build and deploy the frontend to the existing Netlify site only after separate deployment approval. The repository's `netlify.toml` specifies `dist`:

```powershell
npm run build
netlify deploy --prod --dir=dist --site=APPROVED_SITE_ID
```

The last command assumes the operator has the Netlify CLI and approved site access. Alternatively trigger the existing linked site's approved build/deploy action. Verify the correct frontend version and normal permitted workflows before reopening creation. If setup fails, keep the guard/new-creation pause; do not revert to permissive rules or force readiness.

## Next-step status

- Local/export audit and initializer tooling: prepared; demo-project initialization verified by tests.
- Production index initialization: pending actual audit, guard installation, operational freeze and explicit approval.
- Rules deployment: prepared, not executed; first action in a separately approved maintenance rollout.
- Frontend deployment: prepared code, not executed; requires index-ready verification first.
- Master Price List: not started; a separate phase after the foundation's rollout is accepted.

## Verification results — 2026-10-03

| Test/check | Result |
|---|---|
| `node --test tests/dimensions.test.mjs` | 21 passed; shared normalization and grouping retained |
| `tests/purchaseValidation.test.mjs`, `tests/documentNumbers.test.mjs`, `tests/dashboardAnalytics.test.mjs` | 17 passed |
| Emulator: `tests/identityRollout.test.mjs` | 10 passed |
| Emulator: `tests/dimensionRules.test.mjs` and `tests/numberingRules.test.mjs` | 24 passed |
| `node --test tests/identityRolloutCli.test.mjs` | 6 passed |
| `npx playwright test --config=tests/playwright.config.mjs --max-failures=0` with local emulator | All 21 passed in one run |
| `npm run build` / Inventory contract check | Passed; bundle-size warning remains |
| Targeted ESLint on Phase 1.5 utilities, scripts and Node tests | Passed |
| `git diff --check` | Passed |
| Read-only CLI against `tests/fixtures/dimension-audit.json` | Passed; saved `docs/identity-rollout-local-plan.json` |

Coverage of the requested cases:

| Requested case | Evidence |
|---|---|
| A: one legacy record | Single-owner stock-update/setup test |
| B: several distinct records | Three reservations, unchanged business/history snapshot |
| C: 5 vs 5.00 | Null-owner collision with both IDs |
| D: 5.3 vs 5.30 | Independent null-owner collision |
| E: 5.3 vs 5.03 | Separate reservations |
| F: mixed string/number Size | Numeric and string fixtures group equivalently |
| G: invalid Size/Type/Shape | Reasons/references reported, zero registry writes, readiness not enabled |
| H: interruption/retry | Fault after first batch, deletion/identity edits denied, remaining batch resumed |
| I: repeat initialization | Verified no-op; unchanged readiness marker and business snapshot |
| J: new Inventory after readiness | New Admin/Staff records reserve automatically |
| K: concurrent equivalent creation | Three simultaneous attempts, exactly one successful physical record |
| L: Purchase completion | Admin and purchase-only Staff: unused identity succeeds, occupied/collision fail without orphan number claims or stock changes |
| M: normal Challan | Staff deduction then return on exact normal record |
| N: each collision member | Separate Admin browser tests deduct/return on `collision-a` and `collision-b`; all other stock unchanged |
| O: Staff workflows | Normal saves/returns within existing permission window work; direct setup/claim tampering denied |
| P: Admin workflows | Backfill, creation, collision-safe selection and returns verified |

Additional tests cover concurrent initializers, reviewed-source drift, stock-only changes during setup, conflicting registry owners, preserving historical collision metadata, refusing export apply, refusing accidental live access before credential discovery, and requiring loopback/demo emulator targets.

The local plan contains synthetic records only: canonical `5_PR_CBD` is a collision between `a` (2 ct, Purchase `p`) and `b` (3 ct, Challan `c`); `distinct` owns `5.03_PR_CBD`. Emulator fixtures additionally exercise the `5.3_PR_CBD` collision. **Production legacy collision audit not run.** Production readiness and collision counts remain unverified.

## Phase 1.5 files

| File | Purpose |
|---|---|
| `src/utils/dimensions.js` | Reuse canonical decimals; validate unambiguous/path-safe Type/Shape identity components |
| `src/utils/dimensionAudit.js` | Detailed invalid-record reasons, stock/references and deterministic reservation plan |
| `scripts/lib/initializeInventoryIdentities.mjs` | Fingerprint, reconciliation, batch transactions, retry and final-ready verification |
| `scripts/initializeInventoryIdentities.mjs` | Read-only default CLI, export support and explicit apply/live safety gates |
| `firestore.rules` | Setup deletion guard, component validation and atomic-only client reservation changes |
| `tests/identityRollout.test.mjs` | Emulator recovery, collision, invalid-data, concurrency, stock/history and permission tests |
| `tests/identityRolloutCli.test.mjs` | Offline/export plan, command safety gates and metadata-preserving reconciliation tests |
| `tests/ui.spec.mjs` | Real Purchase completion and per-physical-record Challan deduction/return after setup |
| `package.json` | Setup and rollout-test commands |
| `docs/identity-rollout-local-plan.json` | Generated synthetic audit/reservation plan and fingerprint |
| `docs/identity-index-rollout.md` | This operational runbook and rollout constraints |
| `docs/dimension-normalization.md` | Link the Phase 1 prerequisite to this prepared rollout procedure |

Pre-existing unrelated working-tree changes were preserved. This phase did not alter Purchase completion or Challan pricing/stock-selection business logic.
