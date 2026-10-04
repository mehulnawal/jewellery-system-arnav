# Dashboard, availability and sidebar corrective report

## A. Why Dashboard disappeared

`BusinessGate` wrapped the route outlet and returned only a loading/error paragraph whenever the `systemState/business` listener was unverified or failed. That replaced the entire Dashboard and every business page, even when their own collection listeners could read. The error branch conflated status-document access failures, temporary connectivity and actual reset maintenance. Terminal listener errors also lacked a retry path.

The code failure was reproduced locally by denying only the system-status read while permitting module reads. The production reason for the failed status request (deployed rules/network/access) was not inspected and is not claimed as verified.

## B. Availability fix

- Loading/unverified: render module content with a compact connecting banner; block writes.
- Server-confirmed normal/missing marker: normal rendering and permitted writes. Missing marker means generation 0, unlocked; canonical creation readiness still follows its existing separate protection.
- Cached/offline/access error: retain readable module content, display compact warning, block writes.
- Confirmed running/incomplete reset: Admin recovery/reset panel or Staff maintenance screen; business writes stay locked.
- Unknown locked status: readable content plus warning, no automatic write unlock or mutation of the marker.
- Reconnection: metadata updates recover automatically. Terminal errors resubscribe with bounded backoff, browser online event and a manual Retry button. Listeners/timers are cleaned up.

Generation changes remount business content to clear stale reset-era forms. Actual reset protection is not bypassed and Firestore rules were not weakened. A stale, incomplete destructive reset remains protected until safely recovered; it is not unlocked by a timeout.

## C. Dashboard restoration

Preserved the existing analytics builder and subscriptions. All sections remain: heading/Analysis Period, Live Operational State, Inventory Performance, Inventory Aging, Attention Required, Clear First, Party Performance, Challan Performance/S1-S4, Purchase Due Overview, Largest Purchases, Risk & Opportunity and permission-filtered Quick Actions.

## D. Dashboard UI

Quick Actions now sit beside the top controls area. Attention precedes Clear First. Cards size naturally rather than stretching equally. Empty Inventory/Party/Largest/Risk sections are compact; empty tables are omitted. Clear First remains Top 5 with concise reason tags and full tooltip text. Zero aging bars have zero width; occupied buckets emphasize weight. Metrics, headings, links and spacing share a consistent scale. The operational strip says Operational snapshot when live availability is unverified.

## E. Sidebar old problems

Old rail/flyout/mobile styles and a newer navigation stylesheet competed. A light-only hover token produced white active/group blocks in dark mode. Branding was repeated in the top bar. Group controls looked like destination buttons, and sizing rules were inconsistent.

## F. Final structure

One shell stylesheet and one sidebar: 232px expanded, 72px collapsed. Dashboard is direct; Operations/Reports/Admin are permission-filtered groups. Group headers are subtle and transparent; the active child has a green-tinted row/edge. Clicking a collapsed group expands the same sidebar and opens it. The current route group opens when expanded. Preferences persist; the header stays fixed while navigation scrolls internally. No secondary flyout exists. At small widths the same expanded sidebar overlays content and can be collapsed with the header control.

## G. Brand / top bar

Grantha Exports and logo live in the expanded sidebar. The top bar contains page context and compact Theme/Logout controls on the right. Collapsed mode retains the logo and nearby expand control.

## H. Permissions

Existing route/module permission predicates are preserved. Admin-only pages remain hidden from Staff and protected on direct navigation. Empty groups are hidden. This repository has account administration in Settings rather than a separate Admin Management route; no duplicate or invented route was added.

## I. Files changed

| File | Purpose |
|---|---|
| `src/layouts/BusinessGate.jsx` | Read/write/maintenance state separation, compact banner and recovery. |
| `src/hooks/useBusinessAvailability.js` | Shared status context for Dashboard/Master Price presentation. |
| `src/firebase/businessWrites.js` | Client writes fail closed while status is unverified; existing transactional reset fencing remains. |
| `src/layouts/DashboardLayout.jsx` | Single branding/page context; preserve group/state/permission behavior. |
| `src/layouts/dashboardLayout.css` | Consolidated shell/sidebar sizing, navigation, top bar and banner. |
| `src/layouts/navigation.css` | Removed superseded duplicate navigation stylesheet. |
| `src/modules/dashboard/BusinessDashboard.jsx` | Section order, top actions, compact empty states, reason tags and live/snapshot display. |
| `src/modules/dashboard/businessDashboard.css` | Natural card heights, density, type scale, zero bars and responsive spacing. |
| `src/modules/masterPrices/MasterPrices.jsx` | Avoid duplicate same-outage warnings; detailed form changes documented separately. |
| `tests/ui.spec.mjs` | Availability, permissions, Dashboard, sidebar and regression checks. |
| `docs/qa/dashboard-corrective/` | Expanded/collapsed dark/light and responsive/populated screenshots. |

`dashboardAnalytics.js` formulas were not changed in this corrective pass. Other dirty repository files include earlier feature work.

## J. Tests

25 application browser scenarios passed across the main and final targeted runs. These cover normal Dashboard rendering; status read denial on all nine page routes; six write entry points blocked while unavailable; retry; offline automatic recovery; running/incomplete reset; completion; unknown/missing markers; all Dashboard sections and live populated data; Analysis Period; compact cards; zero bars; sidebar dimensions, active child, persistence, grouped expansion, permissions, scrolling and responsive themes. Existing Inventory/Purchase/Challan imports, numbering, normalized identity and physical record selection checks also passed.

Five analytics unit tests passed. Six reset/emulator tests passed, including maintenance security, interrupted retry, empty-ready initialization and fresh Inventory/Purchase/Challan creation. Master Price browser and normalization/security suites passed as documented in `master-price-corrective.md`. Build, Inventory contract, targeted ESLint and whitespace checks passed. The existing large build-bundle warning remains.

The isolated reset browser test also passed with actual local Auth reauthentication, both confirmation stages, backend worker completion, live empty pages and preserved authentication accounts.

## K. Screenshot / visual verification

Inspected local Chrome rendered Dashboard expanded/collapsed in dark/light, populated and empty sections. Screenshots are in `docs/qa/dashboard-corrective/`. Responsive assertions cover 1440, 1024, 768 and 390px, with short-height navigation scrolling. Assertions wait for shell transitions rather than sampling mid-animation. The aged-stock test fixture was corrected to update the authoritative timestamp; analytics were not changed.

## L. Unverified

Production rules, credentials, connectivity and real business data were intentionally not accessed. No deployment occurred. Production legacy collision audit not run. Safari/Firefox, physical mobile devices and assistive technology were not audited. A live production availability failure still requires its actual connection/access issue to be resolved before writes can safely resume; this fix preserves readable pages in the meantime.

## Final yes/no

All are **Yes in local code/browser verification**: (1) real Dashboard renders; (2) unknown availability no longer replaces it; (3) genuine reset protected; (4) Quick Actions at top; (5) empty cards compact; (6) analytics preserved; (7) compact sidebar width; (8) white navigation blocks removed; (9) Dashboard direct link; (10) logical groups; (11) active child clear; (12) collapsed group click expands same sidebar; (13) no second flyout; (14) no redundant branding; (15) Theme/Logout top-right; (16) permissions preserved; (17) dark theme checked; (18) light theme checked; (19) nothing deployed to production.
