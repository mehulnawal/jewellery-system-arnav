# Master Price UI/form corrective report

## A. Current UI problems found

The form rendered errors for empty fields immediately, without touched/submitted state. Save was disabled by those errors, preventing submit-to-reveal validation. Required/optional indicators were missing. Excessive modal spacing, light surfaces inherited in dark mode, inconsistent controls and Challan-specific connection copy made the page confusing. Search, table and empty states lacked hierarchy.

## B. Form validation behavior

Add/Edit share one form. Opening resets touched/submitted state and focuses Type without errors. Changing or leaving a field marks it touched. Save reveals outstanding errors, blocks persistence and focuses the first invalid field. Visible errors and danger borders recompute on every change and clear without a second Save.

The existing `masterPriceErrors` remains the validation source. UI copy distinguishes required, malformed and non-positive inputs. The shared normalizer remains unchanged and canonicalizes valid dimensions on blur/save. Normalized duplicate detection recalculates immediately. Type/Shape remain flexible inputs with datalist suggestions, preserving the existing data model.

## C. Required / optional labels

Type, Shape, Height and Price show red stars and `aria-required`. Width says Optional and accepts blank. Empty required fields say “[Field] is required.” Malformed Height/Width say “Enter a valid [Field].” Non-positive values have a greater-than-zero message.

## D. Modal

580px maximum width, 22px padding, two-column Type/Shape and Height/Width, then full-width Price. The no-fallback helper is compact. Add/Edit both fit 1366×768 without internal scrolling. Narrow screens stack fields; scrolling remains available at genuinely small viewport heights.

## E. Buttons

Add/Save use primary emerald styling. Cancel and Import/Export/Print are themed secondary controls. Disabled controls use muted themed surfaces. Invalid Save stays reachable to expose field errors but cannot persist. During save, inputs and footer controls disable, the label becomes Saving..., and values remain visible. A browser test delayed the local Commit request to verify this state.

## F. Page UI

26px title, muted description, consistent 40px controls, wrapping action group and aligned discovery section. Search spans the row at medium widths; filters become two columns on small screens. The table has a records caption, compact headers, right-aligned currency, secondary timestamps and compact actions. Blank Width displays Default. Horizontal table overflow remains inside its container. Search/filter predicates and file callbacks are unchanged.

## G. Loading / empty / error states

Loading has its own status block. Confirmed empty data has an icon, heading and Add/Import guidance. No search matches has distinct guidance. Failed loading is not presented as an empty database. Cached rows are labelled Cached; a failed empty list says Connection unavailable.

## H. Connection messaging

Shared availability context suppresses the redundant local notice when a global connecting/offline banner describes the same outage. Independent Master Price failures retain a compact local alert. Save failures remain visible inside the form. Management copy no longer says to enter a Challan Price manually. Readable pages remain mounted during unverified system status while writes stay protected.

## I. Dark / light

Local Chrome screenshots inspected in both themes. Page checks cover 1440, 1024, 768 and 390px; paired Add/Edit checks cover 1366×768. Sampled enabled controls, headers and error text passed 4.5:1 contrast checks. Page-scoped dark surface/hover aliases prevent inherited white controls.

## J. Accessibility

Tab order: Type, Shape, Height, Width, Price, Cancel, Save. Tab/Shift+Tab wrap inside Add/Edit; Escape closes unless saving; focus returns to the opener. Native buttons support keyboard activation. Inputs have error associations and first-invalid focus. Focus rings, table column scopes and status/alert roles are present. No screen-reader audit was performed.

## K. Files changed in this corrective pass

| File | Exact purpose |
|---|---|
| `src/modules/masterPrices/MasterPrices.jsx` | Touched/submitted form presentation, error copy, labels, focus/keyboard handling, processing and page states. |
| `src/modules/masterPrices/masterPrices.css` | Page/table/form typography, spacing, themes, hover, disabled/error states and responsiveness. |
| `src/hooks/useBusinessAvailability.js` | Shared availability state for contextual warnings. |
| `src/layouts/BusinessGate.jsx` | Preserve readable pages, compact warnings, retry/recovery and genuine reset protection. |
| `src/firebase/businessWrites.js` | Fail closed on writes until availability is verified. |
| `src/layouts/DashboardLayout.jsx`, `dashboardLayout.css` | Earlier requested shell correction; compact single sidebar, active styling and top-bar utilities. |
| `tests/masterPrices.ui.spec.mjs` | Form, theme, processing and Master Price regression coverage. |
| `tests/ui.spec.mjs` | Availability, Dashboard/sidebar and existing module regression checks. |
| `docs/qa/master-price-corrective/` | Local browser screenshots. |

The working tree includes earlier feature work. This table describes the corrective pass, not every pre-existing dirty file. Pricing services, canonical normalization, schema and permission rules were not changed for this UI pass.

## L. Tests / actual results

- **10 Master Price browser scenarios passed** across the main and targeted runs: offline/history/import races; live deletion/manual priority/Admin sync; Challan S1-S4 Width/Price and output; CRUD/duplicates/search/filters/Excel/print/templates/reports; import validation; Staff management denial/concurrent creation; two-session exact lookup/history; responsive contrast/empty/error; clean-open/touched correction/keyboard/duplicates; laptop Add/Edit themes and delayed-save processing.
- **25 application browser scenarios passed** across the main and corrected targeted runs: Inventory/Purchase/Challan normalization and workflows, physical legacy selection, imports, numbering, Staff permissions, sidebar, picker, all-page read-only availability, Dashboard visuals and automatic offline/reset recovery.
- **26 Node/emulator tests passed:** 5 Dashboard analytics, 15 Master Price rules-of-business tests, 6 reset/maintenance/retry/fresh-state tests.
- **30 normalization/security tests passed:** concurrent identities, invalid aliases, canonical dimensions and Master Price access protection.
- **1 isolated reset browser test passed:** real emulator password reauthentication, cancellation, typed confirmation, backend worker, live empty UI and preserved Auth accounts.
- Targeted ESLint, build, Inventory contract check and `git diff --check` passed. Build retains the existing large-bundle warning.
- Test harness corrections: direct service calls wait for availability; responsive assertions wait for shell transitions; aged stock uses the authoritative Firestore timestamp. No analytics/protection was weakened to satisfy tests.

## M. Unverified

Production access/deployment was intentionally excluded. Production legacy collision audit not run. No physical printer, Safari/Firefox, device hardware or assistive-technology audit. Excel downloads and print HTML were tested locally. Production network/rules and production data were not verified.

## Final yes/no confirmations

| # | Confirmation | Result |
|---|---|---|
| 1 | Add opens without immediate errors | Yes |
| 2-5 | Type/Shape/Height/Price have required stars | Yes |
| 6 | Width clearly Optional | Yes |
| 7 | Errors after touch or submit | Yes |
| 8-9 | Error text and borders clear immediately | Yes |
| 10 | Duplicate error updates live | Yes |
| 11 | Laptop modal fits without unnecessary scroll | Yes, 1366×768 |
| 12-14 | Proper Cancel, primary Save and themed disabled controls | Yes |
| 15 | Compact helper | Yes |
| 16-18 | Polished discovery, table and empty state | Yes |
| 19 | Loading/Empty/Error distinct | Yes |
| 20 | Same-outage connection notices deduplicated | Yes |
| 21-22 | Dark/light verified | Yes, local Chrome |
| 23 | Add/Edit consistent | Yes |
| 24-27 | Business logic, Width lookup, normalization and permissions unchanged | Yes |
| 28 | Import/Export/Print work | Yes locally; no physical printer |
| 29 | Activity Log/Weekly Report work | Yes, browser regression |
| 30 | Nothing deployed to production | Yes |
