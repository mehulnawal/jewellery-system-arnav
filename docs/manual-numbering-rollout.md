# Free-plan Challan and Purchase setup

The app uses Firebase Authentication, Firestore, and Firestore Security Rules.
It has no Cloud Functions deployment and works on the Firebase Spark plan,
subject to Firestore's normal free quotas.

## What the owner does once

1. Publish the complete, current `firestore.rules` file in Firebase Console >
   Firestore Database > Rules. Replace the previous rules, then click Publish.
2. Run the updated frontend on localhost with `npm run dev`, or deploy its build.
3. Sign in as Admin. Open the standalone Settings page and click
   **Register existing numbers**. Wait for the success message.
4. Create a Challan or Purchase. Staff can use their assigned permissions after
   the Admin completes step 3.

Do not deploy the old `approvePurchase` function or use `gcloud` for this version.
The one-time button reads existing Challans and Purchases and writes only
`challanNumbers`, `purchaseNumbers`, and `numberingMigrations/manual-v1`.
It does not change or delete source records, Inventory, counters, or activity.
If no source records exist, the button still marks numbering ready. If setup
stops partway, click the button again. Pre-existing duplicate numbers are
reserved so new documents cannot reuse them; the original records remain.

Existing records keep their stored IDs and relations. New Challans require
`A{series}/{1..100}` and new Purchases require `PR-A{series}-{1..100}`.
`35` in examples is not fixed. The Purchase form fixes `PR-` and users enter
the rest. Admin can rename Challan numbers; Staff cannot. Purchase numbers
are read-only after creation. Registry claims and source documents commit in
one Firestore transaction to prevent two new records sharing a number.

## Security and validation limit on Spark

Firestore rules enforce Admin/Staff permissions, number format, atomic number
claims, required top-level Purchase fields and numeric ranges. The browser
validates each Purchase field and item, totals, calculations, and duplicate
availability in real time, then checks them again on save.

Firestore Security Rules cannot loop through an arbitrary Purchase item list
to independently sum its weights or recalculate every monetary field. Without
a trusted backend, a modified client could submit inconsistent item totals
despite the normal form rejecting them. The security guarantee for arbitrary
item totals requested earlier therefore cannot be fully met on this free-only
architecture. Access and number uniqueness are still enforced in Firestore.

The owner has not authorized Codex to publish rules or edit live Firestore.
These steps must be performed by the owner. The local tests use a separate
Firestore emulator project and do not touch production data.
