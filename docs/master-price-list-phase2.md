# Phase 2 — Master Price List implementation report

Implemented locally. No frontend/rules deployment, production credentials, production reads, or production data changes were performed.

## A. Master Price data model

`masterPrices/{canonicalKey}` stores `type`, `shape`, canonical text `height`, canonical text `width` (empty string for the intentional default), numeric `price`, `active`, `revision`, `createdAt`, `updatedAt`, and `updatedBy`.

The key is the existing canonical Size/Shape/Type SKU representation followed by an explicit Width component: `5_PR_CBD__default` or `5_PR_CBD__7`. This is a pricing document key, not a new Inventory SKU. Height/Width use Phase 1's `normalizeSize` and `isValidSize`; meaningful dimension precision is preserved. Existing supported compound Size values also retain their shared Phase 1 interpretation. Width is a positive scalar decimal; blank is valid and zero is invalid.

Transactions read the deterministic target before creating or moving a price. Concurrent equivalent additions cannot create two records. Revisions prevent an edit/delete dialog from overwriting a newer edit. Moving a combination deactivates the previous document and activates the new canonical document atomically. Previously inactive combinations can be intentionally added again, with their original creation timestamp and an incremented revision; audit events preserve earlier snapshots.

## B. Master Price page

Admin route: `/dashboard/master-prices`, with an Admin-only navigation entry. Add/Edit have immediate field-level errors and normalized duplicate messages. Dimension normalization on blur/save permits normal typing. Price must be positive and fit the existing Challan Price input's cents precision; this restriction does not apply to dimensions.

Search covers Type, Shape, normalized Height/Width, default status, and Price. Type/Shape/Height/Width filters derive unique canonical options. The page includes empty/loading/error states, confirmation before soft deletion, responsive scrolling tables, and theme-aware controls/dialogs. Background scrolling is locked while a modal is open.

## C. Import

Excel/CSV columns: Type, Shape, Height, Width, Price. The Width column exists but its cells may be blank. Preview separates Ready to import and Needs attention, with physical spreadsheet row numbers, field names, canonical dimensions, and reasons.

Existing normalized combinations and duplicates within the input are rejected, never overwritten. Import repeats validation and transactional target checks at commit time, including races against another Add. Imports commit in bounded chunks of 100 rows. Each committed chunk includes one summary audit event with added snapshots and rejected-row details. Interrupted imports can be retried: already committed identities become explicit existing-record rejections.

## D. Export / print

Master Price Excel export includes Type, Shape, Height, Width, Price for the filtered records. Dimensions are clean canonical text, blank Width remains blank, and Price remains numeric. Print uses an escaped standalone table, shows blank Width as Default, and excludes management controls.

Challan item Excel export and print include saved Width. Browser tests read downloaded workbooks and captured generated print HTML; a physical printer was not tested.

## E. Settings template

Settings → Import Templates includes Download Master Price Template. The workbook has the five required headers plus an Instructions sheet explaining optional Width, positive values, and duplicate rejection.

## F. Challan Width

Width exists on the Challan item only. It is normalized when saved, retained in Stage 2 return/sale items, carried into final-invoice snapshots, and shown in historical/detail tables and exports/prints. Height comes from the selected physical Inventory record's Size.

No Width field was added to Inventory or Purchase. No Inventory SKU, grouping, stock ownership, or Purchase pricing logic was changed by Phase 2.

## G. Exact lookup

| Selected dimensions | Matching master | Price |
| --- | --- | --- |
| CBD / PR / H5 / blank Width | H5 / blank | 5,000 |
| CBD / PR / H5 / W7 | H5 / W7 | 7,000 |
| CBD / PR / H5 / W8 | None | Blank |
| CBD / PR / H5.00 / W7.00 | H5 / W7 | 7,000 |

Type and Shape must also match. Entered Width never falls back to a Height-only price, a nearby Width, the preceding item's price, or automatic zero. Invalid Width has an immediate error and cannot drive a lookup or save. A valid manual Price is allowed when no master exists.

## H. Manual override

Open items track `master-auto`, `manual`, or a frozen `saved` price context. Editing Price marks it manual and changes only the draft. Subscription updates preserve manual values. Changing the actual selected Inventory/pricing combination resets the context and performs a fresh lookup. Equivalent decimal spelling alone does not discard a manual override.

## I. Real-time behavior

One shared authorized Firestore listener subscribes to active prices, cleans up on identity/permission changes, and produces a memoized canonical Map. Lookups do not scan the collection or query Firestore per keystroke. Active management pages and eligible open Challan drafts update from live snapshots.

Live edits update auto prices; live additions fill untouched missing prices; deletions clear auto prices. Manual prices remain protected. New drafts also reconcile changes to the selected Inventory's dimension attributes. Offline/cache status and listener failures show understandable messages distinct from an ordinary missing match. Local offline/reconnect behavior was tested.

## J. Historical safety

Saved Challans are independent transaction snapshots. No Master Price operation writes Inventory, Purchases, Challans, stock, or their historical references. Opening an existing Challan edit marks the saved transaction price frozen. Only an intentional SKU/Width/context change enables a fresh lookup. The full S1–S4 test retains Width and the original transaction Price, with physical Inventory IDs intact.

## K. Permissions

Admin manages the page and writes prices. Authorized Challan Staff can query/read active prices internally. Staff without Challan access and unauthenticated clients cannot read them. Staff cannot create, edit, deactivate, hard-delete prices, or forge Master Price Activity Log events. Staff have no management route/navigation/export controls.

Rules verify canonical document identity, canonical dimensions, positive finite Price, revision increments, and authentic update timestamps/UIDs. Hard deletion of Master Price records is denied. Existing Inventory/Purchase/Challan authorization remains in place.

## L. Activity Log

Tracked actions: `created` (Add), `edited`, `deleted` (deactivation), and `imported`. Price mutations and audit events commit in the same transaction. Edits retain full before/after snapshots and readable descriptions of old/new combinations/prices. Import events summarize each bounded batch instead of adding an event per row. The Master Price panel is included in Activity Log viewing, export, and print.

Manual Challan overrides never write a Master Price event; ordinary Challan activity continues separately.

## M. Weekly Report

A Master Price List section and module filter show Added, Edited, Deleted and Imported actions, descriptions, time, and actor. Import counts represent summary events/batches; each description includes actual added/rejected record counts. Existing Inventory, Purchase and Challan sections remain.

## N. Files changed for Phase 2

| File | Purpose |
| --- | --- |
| `src/utils/masterPrices.js` | Canonical identity composition using shared dimensions, validation, import preview, search, exact lookup and price-state reconciliation |
| `src/utils/masterPriceStore.js` | Transactional Add/Edit/deactivate/import, revision checks, atomic audit events |
| `src/utils/masterPriceFiles.js` | Excel export/template and escaped printable document |
| `src/hooks/useMasterPrices.jsx` | Shared authorized real-time subscription, error/offline status, indexed lookup |
| `src/modules/masterPrices/MasterPrices.jsx` | Admin management forms, table, filters, import preview/results, confirmations |
| `src/modules/masterPrices/masterPrices.css` | Light/dark, modal, table and responsive styling |
| `src/App.jsx` | Admin-protected route and shared provider |
| `src/layouts/DashboardLayout.jsx` | Admin-only navigation entry |
| `src/modules/challan/Challan.jsx` | Width, live auto/manual/saved price behavior, snapshot retention, Width display/export/print |
| `src/modules/challan/challan.css` | Width controls and item-grid layout |
| `src/modules/admin/AdminSettings.jsx` | Master Price import-template download |
| `src/modules/activityLog/ActivityLog.jsx` | Master events, readable import results, export/print inclusion |
| `src/modules/weeklyReport/WeeklyReport.jsx` | Master section, counts and filters |
| `firestore.rules` | Strict Master Price permissions and canonical-key/revision checks; prevent Staff-forged master audit events |
| `package.json` | Master Price unit/rules test commands |
| `tests/masterPrices.test.mjs` | Pure normalization, validation, lookup, manual/saved context, import, search, print tests |
| `tests/masterPriceRules.test.mjs` | Emulator permission, canonical-key, revision and concurrent-create tests |
| `tests/masterPrices.ui.spec.mjs` | Browser management, import/export/print, templates/reports, live/offline, race, history, stages, theme tests |
| `tests/playwright.config.mjs` | Includes the new browser suite |
| `tests/fixtures/firebase.js` | Emulator-only network toggles for offline/reconnect testing |
| `docs/master-price-list-phase2.md` | This implementation/verification report |

The workspace already contained Phase 1/1.5 and Dashboard changes. Those pre-existing changes were preserved; they are not newly introduced Master Price changes.

## O. Tests and results

All listed suites were run locally, with Firestore tests restricted to loopback demo emulator projects.

| Suite/check | Result |
| --- | --- |
| `tests/masterPrices.test.mjs` | 15 passed |
| `tests/dimensions.test.mjs` | 21 passed |
| `tests/purchaseValidation.test.mjs` | 9 passed |
| `tests/documentNumbers.test.mjs` | 3 passed |
| `tests/dashboardAnalytics.test.mjs` | 5 passed |
| `tests/masterPriceRules.test.mjs` | 4 passed |
| `tests/dimensionRules.test.mjs` | 5 passed |
| `tests/numberingRules.test.mjs` | 19 passed |
| `tests/identityRollout.test.mjs` | 10 passed |
| `tests/identityRolloutCli.test.mjs` | 6 passed |
| Existing `tests/ui.spec.mjs` | 21 passed |
| New `tests/masterPrices.ui.spec.mjs` | 7 passed across final targeted runs |
| Targeted ESLint on changed application modules | Passed |
| `npm run build` including Inventory contract verification | Passed; bundle-size warning remains |
| `git diff --check` | Passed |

The seven new browser scenarios cover:

1. Offline/reconnect messaging, manual priority, saved auto-price snapshots after Master edit/deactivation, and concurrent Add/import.
2. Live default deletion, manual price entered before a Master add, two-session Admin updates, light/dark and mobile layout.
3. Full Challan S1–S4 preservation of Width/Price/physical Inventory ID, including Excel and print output.
4. Master CRUD, combination edits, default/exact duplicate validation, normalized search/filters, Excel/print, Settings template, Activity Log and Weekly Report.
5. Valid/invalid/existing/in-file-duplicate import preview and committed summary events.
6. Staff management-route denial, concurrent normalized Add, and existing-record import rejection.
7. Two-session exact lookup, 7→8→blank transitions, manual overrides, live edit/add/delete, invalid Width correction, historical manual-price preservation and allowed saved edit behavior.

Earlier failures were corrected: UI test selectors, the test workbook reader, and a Vite test-module import. Visual inspection found and corrected a dark-theme header contrast issue. Final passing results above supersede those failed iterations.

## P. Unverified / production status

- Nothing deployed. Production data was not accessed or modified.
- **Production legacy collision audit not run.** Production credentials were intentionally not provided or requested.
- No production Inventory identity index was initialized in this phase. The Phase 1.5 rollout prerequisites in `docs/identity-index-rollout.md` still apply before production activation.
- Production session behavior, real production data volume/network conditions, and physical printer output were not tested. Real-time behavior, offline/reconnect and generated print documents were tested locally.
- The existing rule denying some Staff Stage 2 stock returns against older Admin-owned Inventory remains unchanged and is covered by its existing regression test. This phase does not broaden that permission.

## Q. Final confirmations

1. Width was **not** added to Inventory.
2. Width was **not** added to Purchase.
3. Inventory SKU/grouping was **not** redesigned.
4. Master Price is Admin-managed only.
5. Staff cannot modify Master Price under the new rules.
6. Authorized Challan Staff can use the active-price lookup.
7. Phase 1 normalization for 5 / 5.0 / 5.00 is reused.
8. Blank Width uses only a Height-only record.
9. Entered Width requires exact Type + Shape + Height + Width.
10. Missing Width-specific records never fall back to Height-only prices.
11. Auto-filled Price is editable.
12. Manual Challan Price never changes Master Price.
13. Live Master edits update untouched open auto prices.
14. Manual overrides survive Master subscription changes.
15. Historical Challans remain transaction snapshots after Master changes.
16. Add/Edit/Delete/Import are represented in Activity Log and Weekly Report.
17. Import, Excel export and generated print output were exercised locally.
18. Settings includes the Master Price import template.

No deployment command was executed. This is a locally implemented and verified feature, not a claim that production has been upgraded.
