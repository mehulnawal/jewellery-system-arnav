# Local implementation status

The paid Cloud Function dependency was removed. Purchase and Challan saves use
the Spark-compatible Firestore rules and number registry. An Admin can perform
one-time registration of existing numbers from Settings without a terminal or
Google Cloud account setup. See `manual-numbering-rollout.md` for the owner's
two actions: publish the new rules and click the Settings button.

Purchase Create/Edit validation remains live. Invalid fields show their own
red border and error, and clear as soon as corrected. The fixed PR- prefix,
dynamic series, debounced duplicate check, item validation, weight mismatch,
discount calculations, due date, edit locks and permission model remain.

Rules enforce authorization, basic Purchase schema and numeric ranges, and
atomic unique number claims. Firestore rules cannot independently sum a
variable-length Purchase item list. This is a material limitation of the
free-only design; the normal UI and save service still reject a mismatch.

Existing records and IDs are not migrated. The Admin Settings button writes
only auxiliary registry documents and a readiness marker. Codex made no
changes to the user's live Firebase project.
