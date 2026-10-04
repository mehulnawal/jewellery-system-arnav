# Settings, availability, Master Prices and sidebar corrective report

## A. System status root cause and evidence

The originally supplied Firebase rules had no matching systemState/business read rule. Firestore denied the authenticated listener with permission-denied. BusinessGate mounted around every dashboard page and deliberately blocked writes when this listener failed; this was never a Settings feature. The later snippet supplied by the user adds the required authenticated status read, but still omits masterPrices.

The normal local Firebase config reads .env and targets granthaexports-8681a. It does not connect to an emulator merely because Vite runs locally. The local firestore.rules already contains authenticated status reads and authorized Master Price reads. Changing this local file does not publish those rules to the configured project.

Evidence: emulator tests reproduced both denials by removing the corresponding read permissions, recorded project/resource/UID/role/error code, then restored the existing prepared rules. Both listeners recovered without reload. We did not inspect the current live rules release or live marker, and cannot claim that a later Console publish succeeded. No production deployment or data mutation was performed.

## B. Status architecture and initialization

- Loading: initial cached/unknown status remains write-blocked. An 8-second initial verification deadline transitions to a connection issue instead of loading forever.
- Ready: only a server-confirmed unlocked marker, or server-confirmed absence, permits writes. No warning.
- Offline: cached readable content remains visible. One compact global banner; business writes remain blocked.
- Maintenance: every confirmed locked marker protects the business views; Admin sees the existing secure recovery flow, Staff sees maintenance. A cached update cannot discard an already known lock.
- Error: permission/configuration errors and malformed markers are distinct from offline. Console diagnostics include project ID, resource/query, UID, role, code and message, never passwords or tokens.

Missing marker: server-confirmed absence deterministically means generation 0/unlocked, matching existing rules and backend defaults. There is no required client-created technical document. Cache-only absence never enables writes. Existing markers require a nonnegative safe-integer generation and boolean lock; running/incomplete cannot claim unlocked. Transaction wrappers validate the same marker before writes.

Phase 1.5 inventory identity readiness is separate from global availability. No identity readiness marker was forced, bypassed or manually fabricated. The existing reviewed initialization path remains. The backend reset still verifies empty business data and atomically initializes inventoryIdentityMigrations/v1 and both numbering readiness markers before releasing its lock.

## C–D. Settings and Danger Zone

/dashboard/admin-settings retains Access Management, Inventory SKU Format, numbering setup and Import Templates. Section selection is URL-backed (?section=templates etc.), so history and direct links work. Inventory, Purchase and Master Price template downloads remain available.

/dashboard/admin-settings/danger-zone is a dedicated Admin-only route under the existing PermissionRoute. Main Settings has only a compact entry link, not the destructive form. The dedicated page uses a normal surface and contained warning card with a small danger accent and red action. Current global status is passed into the existing reset component.

## E–G. Master Price root cause, warning ownership and recovery

The supplied rules omit the entire masterPrices match. Thus even Admin cannot query it; this is an authorization failure, not an empty price list. The production query is simply active == true, without ordering or a composite query. That query passes against the prepared local rules for Admin and authorized Challan Staff; unrelated Staff and anonymous reads/writes are denied. No composite-index failure was reproduced.

The previous listener also discarded its rows on error and never resubscribed after a terminal Firestore listener error. It now retains records, logs the real failure, retries with 5–60 second backoff, retries on browser online events, and responds to global Retry connection / global recovery. The provider lives beneath BusinessGate so these signals are shared. Timers/listeners are cleaned up on identity changes and unmount.

Global non-ready status owns the main warning. Master Prices suppresses its local large notice then, and shows cached/unavailable table state. When global status is ready but Master Prices independently fails, it shows a compact specific error plus Retry price list. Loading, confirmed empty, data, cached/stale, and error have distinct presentation. Add/Edit/Delete/Import and open-dialog submission are disabled while unsafe; readable rows, search, filters, export and print remain usable.

## H–I. Theme, interaction and sidebar polish

Dark theme now defines the previously missing raised/subtle surface, border and hover tokens. Settings hard-coded white surfaces use theme tokens. Buttons have theme-aware default/hover, keyboard focus, pressed and disabled treatments. Primary controls use accent fill; destructive controls retain red. Invalid inputs keep their danger border alongside the accent focus ring. Group selection and keyboard focus no longer share a removed outline.

Sidebar preserves one sidebar, existing group/link structure and permission filtering. Theme/Logout remain in the top bar. Widths remain 72px collapsed / 232px expanded using the shared width token. Expanded brand header is 68px high on one row; collapsed logo/toggle is an aligned 80px stack. Main rows are 44px, children 40px, icon boxes 20px, child indentation 8px, and group gaps 8px (5px collapsed). Inactive text contrast is stronger; the selected destination has a subtle green surface and thin indicator. Collapsed groups with an active descendant have a green tint and small context dot. Expanded group headers remain neutral. Chevron rotation is 120ms and respects reduced motion.

Collapsed items use centered 44x44 targets and small portal tooltips on hover/keyboard focus; Escape/blur/scroll dismiss them. Group click expands the same sidebar and opens that group. Header stays fixed; navigation scrolls independently at short heights. Screenshots are stored in docs/qa/status-settings/.

## J. Security

No Firestore rule was changed in this corrective task. Existing authenticated status reads, Admin-only management writes, authorized active-price Staff reads, backend-only reset state, generation fencing and maintenance guards remain. Backend source was not changed. Reset retains password reauthentication, first warning, exact DELETE ALL RECORDS phrase, one-use backend authorization, worker verification and empty-ready completion.

## K. Files changed in this task

| File | Purpose |
| --- | --- |
| src/utils/businessStatus.js | Shared marker validation, error classification and diagnostics. |
| src/components/ui/SystemStatusBanner.jsx | Compact global loading/offline/configuration banner. |
| src/layouts/BusinessGate.jsx | Validated status lifecycle, maintenance protection, retries and shared availability signals. |
| src/hooks/useBusinessAvailability.js | Fail-closed context default. |
| src/firebase/businessWrites.js | Validate transaction marker before writes. |
| src/hooks/useMasterPrices.jsx | Preserve cached rows, expose states/retry and recover terminated listeners. |
| src/App.jsx | Admin-only Danger Zone route; move pricing provider into protected shell. |
| src/layouts/DashboardLayout.jsx | Shared pricing/status wiring, subpage context, sidebar tooltips/accessibility. |
| src/layouts/dashboardLayout.css | Compact sidebar geometry, hierarchy, collapsed targets/tooltips, reduced-motion chevrons. |
| src/modules/admin/AdminSettings.jsx | URL-backed normal sections and compact Danger Zone link. |
| src/modules/admin/DangerZone.jsx | Dedicated Settings subpage. |
| src/modules/admin/BusinessReset.jsx | Connect availability, disable unavailable reset actions, avoid duplicate completion text. |
| src/modules/admin/businessReset.css | Contained professional destructive card. |
| src/modules/admin/adminSettings.css | Theme surfaces and distinct focus/selection styles. |
| src/modules/masterPrices/MasterPrices.jsx | Write disabling, local/global warning ownership, local retry and honest missing timestamp. |
| src/index.css | Shared dark tokens and scoped hover/focus/pressed/disabled/invalid treatments. |
| tests/businessStatus.test.mjs | Missing/invalid markers and error classification. |
| tests/masterPriceRules.test.mjs | Admin/Staff status reads, anonymous/control writes denied, maintenance protection. |
| tests/statusSettings.ui.spec.mjs | State/recovery/routes/templates/sidebar/theme regression coverage. |
| tests/masterPrices.ui.spec.mjs | Update expected permission-error copy. |
| tests/playwright.config.mjs | Include new corrective suite. |
| tests/reset.ui.spec.mjs | Exercise reset flow on dedicated route. |
| .gitignore | Ignore isolated reset test output. |
| tests/reset.playwright.config.mjs | Isolated reset test server/output to avoid other-suite conflicts. |
| docs/status-settings-corrective.md | Evidence, architecture, results and limitations. |
| docs/qa/status-settings/ | Local visual evidence. |

Pre-existing unrelated working-tree changes were preserved; git diff includes earlier work not authored in this task.

## L. Actual validation results

- 13/13 Node/emulator tests passed: 6 backend reset tests, 5 Master Price/status security rules tests, 2 marker/error-state unit tests.
- 10/10 existing Master Price browser tests passed: CRUD, normalized duplicate protection, import/export/print, Staff restrictions, two-session pricing, Challan stages/history, responsive forms and contrast checks.
- 9/9 corrective browser tests passed on the final implementation: missing/invalid markers, Admin/Staff direct routes, templates/history, combined permission denial + retry, independent Master error recovery, cached offline rows and disabled writes, dark/light hover and keyboard focus, startup-offline recovery, sidebar geometry/tooltips/short-height scrolling.
- 1/1 complete reset browser test passed against local Auth/Functions/Firestore emulators: wrong password, valid password, cancel, warning acknowledgement, exact typed phrase, backend worker completion, empty business records, and preserved Auth/settings.
- Total: 33 distinct passing tests (reruns are not counted twice).
- Final npm run build passed, including Inventory contract verification. Existing large-bundle warning remains.
- Targeted ESLint passed with zero errors/warnings. git diff --check passed (Git emitted only CRLF normalization notices).
- Visual inspection: dark/light Master Price screens, Settings/Danger card and final expanded dark/collapsed light sidebar screenshots inspected; browser assertions cover both sidebar themes, active destination/context separation, icon centering, 44/40px geometry, tooltip behavior, keyboard outlines and independent scrolling.
- Resolved test-environment issues: reused cached Java after PATH discovery; raised FUNCTIONS_DISCOVERY_TIMEOUT to 120 for the local reset test. Updated stale error-copy assertion and explicitly switched browser tests to keyboard modality before testing focus-visible. Windows command quoting failure was corrected. No application protections were relaxed to pass tests.

Reproduction uses firebase.test.json with demo-jewellery-ui and firebase.reset.test.json with demo-reset-local only. Test browser requests to production Firebase APIs are blocked; the reset test uses real Auth emulation, not production credentials.

## M. Unverified / release boundary

The current live Firestore release, live marker, live IAM/configuration and production index overrides were not inspected. The supplied rules explain the original denials, and the correction is verified locally. Production symptoms cannot be declared resolved until the prepared rules and frontend are released through a separately authorized process. The existing Phase 1.5 live readiness audit/backfill remains a release prerequisite where applicable. No production reset or deployment was attempted.

## Final YES/NO checklist (local implementation and verification)

| # | Requirement | Result |
| --- | --- | --- |
| 1 | System Status is global, not Settings content | YES |
| 2 | Healthy sessions show no status warning | YES |
| 3 | Offline/maintenance remain protected | YES |
| 4 | Compact global warning | YES |
| 5 | Separate Danger Zone page | YES |
| 6 | No full destructive card on main Settings | YES |
| 7 | Complete Delete All Records security flow intact | YES |
| 8 | Master Price root cause addressed | YES locally: prepared permissions and recovery verified; NO claim of live deployment/resolution |
| 9 | Shared failures avoid duplicate large warnings | YES |
| 10 | Loading/Empty/Data/Error (and cached/stale) distinct | YES |
| 11 | Master Price realtime recovery | YES |
| 12 | Dark-theme hover styling | YES |
| 13 | Light-theme hover styling | YES |
| 14 | Sidebar hover/active styling and final compact polish | YES |
| 15 | Button hover/focus/disabled states | YES |
| 16 | No security rule weakened | YES |
| 17 | Nothing deployed to production | YES |
