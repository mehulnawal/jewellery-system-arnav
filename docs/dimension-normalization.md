# Phase 1: canonical Size identity

Phase 1.5 now provides the retry-safe backfill tooling and approved-rollout procedure in [identity-index-rollout.md](identity-index-rollout.md). The production index and deployments remain untouched.

## Scope and rule

`src/utils/dimensions.js` is the application source of truth. Size is canonical decimal text, not a rounded floating-point value. `5.00` becomes `5`, `5.30` becomes `5.3`, and `5.250` becomes `5.25`. Meaningful digits are preserved, including string precision beyond JavaScript Number precision. Existing numeric Firestore values are supported; precision already lost before storage cannot be recovered.

The existing optional uppercase `X` dimension format uses the same rule for each component. This does not introduce Width. Empty, zero, negative, malformed, nonfinite and unsupported typed values remain invalid under existing positive-Size validation.

Currency, prices, discounts, weight, payments, dates, IDs and numbering keep their existing rules. Master Price List and Challan pricing changes are outside this phase.

## Original cause

The old `normalizeSize` only trimmed a string. Inventory and Purchase interpolated that text into SKUs and used literal Size/SKU comparisons for duplicate checks and imports. Mixed numeric/string historical values compounded those differences. Separately, display and numeric search converted values through Number/three-decimal formatting, so display/search and identity did not share a rule.

## Runtime behavior

- Inventory forms normalize on valid blur and save, retaining real-time field validation. Import previews and committed new records use canonical Size and SKU.
- Purchase validation, item creation/editing, imports and completion use the same identity. Purchase search includes normalized item Size/SKU.
- Inventory, Check Inventory and Challan search share the same Size-aware matcher, preserving text/SKU and weight search. Challan selects a physical record ID; equivalent legacy stock records are not silently substituted or merged.
- Inventory's current parent grouping is Shape/Type, with named Group filters; there is no data-derived Size dropdown. Dashboard Size grouping already calls the shared utility. Collision groups use canonical identity while retaining every physical record.
- Size cells in tables, previews, exports, prints, history and Weekly Report are canonical. Historical SKU text remains unchanged.
- Normalization is local and deterministic. Snapshot-driven lists and memoized collision reports recompute when the current records change; there are no normalization writes from subscriptions or render-time database scans.

## Duplicate protection and deployment prerequisite

New Inventory identities reserve `inventoryIdentities/{canonicalSku}` in the same Firestore transaction as the stock write. Firestore rules require canonical Size/SKU and agreement with the reservation. Concurrent equivalent writers cannot create two owners. Inventory creation/import, identity-changing edits and Purchase-created Inventory use this protection.

Existing physical records retain their IDs and raw historical SKU/Size when an edit does not change their canonical identity. Their individual stock remains editable under existing permissions and time windows. A collision reservation has no single owner and rejects a new equivalent record.

**This is not deployed. Do not deploy the new client/rules without the identity-index rollout.** Creation of new identities fails closed until `inventoryIdentityMigrations/v1.ready` is true. Setting that flag on an unaudited database is unsafe.

A separately reviewed rollout must prevent concurrent identity creation during indexing, audit the complete Inventory collection, initialize one reservation per canonical identity, reserve collisions with `recordId: null` and all legacy IDs, resolve invalid identity rows that cannot be indexed, and only then mark the index ready. This is additive metadata work; renaming, deleting or combining stock is not required. No production initialization or migration was performed in this task.

## Read-only audit

Production legacy-collision audit: **NOT RUN — production credentials were intentionally not provided, per user instruction.** No production records were read or changed. Preliminary credential discovery did not obtain any records.

Reproduce the local audit with:

```powershell
node scripts/auditDimensions.mjs --input=tests/fixtures/dimension-audit.json --output=docs/dimension-audit-local.json
```

The checked-in report contains synthetic data only: three records, two canonical identities, one collision, no invalid Sizes. The collision is `5_PR_CBD`:

| ID | Raw Size | Current SKU | Canonical Size | Stock | References |
|---|---|---|---|---|---|
| a | number 5 | 5_PR_CBD | 5 | 2 ct / 2 pieces | Purchase p |
| b | string 5.00 | 5.00_PR_CBD | 5 | 3 ct / 3 pieces | Challan c |

`distinct` / `5.03_PR_CBD` is not a collision. Browser fixtures independently exercise the same collision using IDs `legacy-a` and `legacy-b`, preserving separate stock ownership and selecting `legacy-b` explicitly. Rule tests also use IDs `a` and `b` in their isolated demo project.

The audit contains document IDs, raw/canonical values, stock, direct references and separately labelled candidate SKU-only Challan references. `indexPlan` is a report, not an executed migration. The script has no apply mode.

Any future consolidation of actual legacy physical duplicates needs a separate reference/stock/history review and explicit authorization. This phase never chooses an owner for a collision, deletes a record or combines physical stock.

## Verification

Verified locally on 2026-10-03:

| Check | Result |
|---|---|
| `node --test tests/dimensions.test.mjs` | 21 passed |
| `tests/purchaseValidation.test.mjs` | 9 passed |
| `tests/documentNumbers.test.mjs` | 3 passed |
| `tests/dashboardAnalytics.test.mjs` | 5 passed |
| Firestore emulator: `tests/dimensionRules.test.mjs` + `tests/numberingRules.test.mjs` | 24 passed |
| Playwright: `tests/ui.spec.mjs` | All 16 scenarios passed across a 14-pass run and the two corrected-test reruns |
| `npm run build` (including Inventory contract verification) | Passed; existing bundle-size warning remains |
| ESLint on dimension utilities, Inventory rules helper, audit script and dimension test files | Passed |
| `git diff --check` | Passed |
| Read-only local audit command above | Passed; one synthetic collision reported |

The browser tests verify Inventory add/edit/SKU/live errors and duplicates; Inventory table/search; Check Inventory filters and live snapshot changes; both import previews and commits; Purchase creation, Inventory completion, allowed staff editing and search; legacy collision visibility; and Challan selection by physical record ID. Existing staff/admin permissions, document numbering, Purchase validation and Challan price calculations were also exercised. Earlier browser runs exposed brittle label/position selectors and an assertion that incorrectly assumed exact-only Size search; these test expectations were corrected without changing those application workflows.

Unit coverage includes every requested equivalence pair and mixed string/number representation; `5.3` versus `5.03`, `5.25` versus `5.2`, `5` versus `5.1`, and `5.125` versus `5.13` remain distinct. It also verifies high-precision decimal text, invalid inputs, existing optional compound dimensions, text/SKU phrase search, canonical grouping and fresh values after a record changes. Firestore tests verify concurrent duplicate prevention, direct-write rejection, reserved legacy collisions, unchanged individual stock, meaningful precision and the uninitialized-index guard.

No production audit, rules deployment, identity-index initialization or destructive migration was performed. Production collision counts are unknown.

## Files involved in Phase 1

| Path | Purpose |
|---|---|
| `src/utils/dimensions.js` | Shared canonical decimal Size, validity, equivalence, SKU/identity and Size-search helpers |
| `src/utils/inventoryIdentity.js` | Atomic canonical identity reservations and safe legacy edits |
| `src/utils/dimensionAudit.js` | Read-only collision and reference report/index plan |
| `src/utils/inventoryRules.js` | Re-export shared Size rule and integrate canonical search while preserving text/weight search |
| `src/utils/purchase.js` | Canonical items/SKUs, Inventory matching and transaction reservations |
| `src/utils/purchaseValidation.js` | Canonical duplicate checks in live validation |
| `src/modules/inventory/Inventory.jsx` | Add/edit, import, duplicate checks, collision visibility and canonical Size output; activity snapshots use actual saved legacy values |
| `src/modules/checkInventory/CheckInventory.jsx` | Canonical Size cards, export and print; shared search |
| `src/modules/purchase/PurchaseForm.jsx` | Canonical legacy initial Size and valid-blur handling without interrupting typing |
| `src/modules/purchase/Purchase.jsx` | Import duplicate/preview handling, Size/SKU search, canonical export/print/view |
| `src/modules/challan/Challan.jsx` | Shared Inventory search, canonical selected Size, readonly Size and output |
| `src/modules/history/HistoryDetails.jsx` | Canonical historical Size display |
| `src/modules/weeklyReport/WeeklyReport.jsx` | Canonical report Size without mutating historical events |
| `firestore.rules` | Validate canonical Inventory identities and atomic claim ownership; preserve ordinary legacy stock updates and existing permission windows |
| `scripts/auditDimensions.mjs` | Read-only JSON/emulator audit entry point; no apply mode |
| `tests/dimensions.test.mjs` | Canonical equivalence, precision, invalid values, search, validation, audit and grouping tests |
| `tests/dimensionRules.test.mjs` | Emulator concurrency, canonical writes, legacy collision and edit protection tests |
| `tests/ui.spec.mjs` | Browser coverage, local identity-index fixtures and resilient selectors |
| `tests/fixtures/dimension-audit.json` | Reproducible synthetic collision/reference data |
| `package.json` | Dimension test and audit commands |
| `docs/dimension-audit-local.json` | Generated synthetic read-only report |
| `docs/dimension-normalization.md` | Rule, verification, scope and deployment/migration notes |

The workspace already contained unrelated Dashboard, routing and layout work. That application work was preserved. Its existing Size grouping uses the shared normalizer and is covered by the additional grouping test; this phase did not create a new Dashboard or change Challan pricing.
