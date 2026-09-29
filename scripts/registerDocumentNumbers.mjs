import { initializeApp, applicationDefault, deleteApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { isValidDocumentNumber, numberRegistryCollection, numberRegistryKey } from "../src/utils/documentNumbers.js";

const args = process.argv.slice(2);
const projectId = args.find((arg) => arg.startsWith("--project="))?.slice(10);
if (!projectId) throw new Error("Pass --project=YOUR_PROJECT_ID. Default is a read-only audit; add --apply to populate the number registry.");
const apply = args.includes("--apply");
const app = initializeApp({ projectId, ...(process.env.FIRESTORE_EMULATOR_HOST ? {} : { credential: applicationDefault() }) });
const db = getFirestore(app);
const marker = db.doc("numberingMigrations/manual-v1");
const lettersMarker = db.doc("numberingMigrations/letters-v1");

try {
  // Deploy the new rules first. This marker blocks new numbers and renames
  // while the trusted script scans; other record edits remain available.
  if (apply) await marker.set({ ready: false, startedAt: FieldValue.serverTimestamp() });
  for (const kind of ["challan", "purchase"]) {
    const source = kind === "challan" ? "challans" : "purchases";
    const field = kind === "challan" ? "number" : "purchaseId";
    const records = await db.collection(source).get();
    const groups = new Map();
    const legacy = [];
    for (const record of records.docs) {
      const number = record.get(field);
      if (!isValidDocumentNumber(kind, number)) {
        legacy.push(record.id);
        continue; // Retain older formats unchanged; new inputs cannot collide.
      }
      const ids = groups.get(number) || [];
      ids.push(record.id);
      groups.set(number, ids);
    }
    const registry = db.collection(numberRegistryCollection(kind));
    const existing = await registry.get();
    const desired = new Map([...groups].map(([number, ids]) => [numberRegistryKey(kind, number), {
      number,
      recordId: ids.length === 1 ? ids[0] : null,
      ...(ids.length > 1 ? { legacyRecordIds: ids } : {}),
    }]));
    const duplicates = [...groups].filter(([, ids]) => ids.length > 1);
    console.log(`${source}: ${records.size} records; ${groups.size} indexed numbers; ${legacy.length} legacy formats; ${duplicates.length} pre-existing duplicate groups.`);
    if (legacy.length) console.log("Unchanged legacy record IDs:", legacy.join(", "));
    for (const [number, ids] of duplicates)
      console.log(`Reserved duplicate ${number}: ${ids.join(", ")}. Existing records are unchanged; this number cannot be assigned again.`);
    if (apply) {
      // Only auxiliary registry documents are written. Original records,
      // counters, document IDs, inventory links and activity are untouched.
      const operations = [
        ...[...desired].map(([key, data]) => ({ ref: registry.doc(key), data })),
        ...existing.docs.filter((entry) => !desired.has(entry.id)).map((entry) => ({ ref: entry.ref })),
      ];
      for (let offset = 0; offset < operations.length; offset += 400) {
        const batch = db.batch();
        for (const operation of operations.slice(offset, offset + 400)) {
          if (operation.data) batch.set(operation.ref, operation.data);
          else batch.delete(operation.ref);
        }
        await batch.commit();
      }
    }
  }
  if (apply) {
    const ready = db.batch();
    ready.set(marker, { ready: true, completedAt: FieldValue.serverTimestamp() });
    ready.set(lettersMarker, { ready: true, completedAt: FieldValue.serverTimestamp() });
    await ready.commit();
  }
  console.log(apply ? "Number registry is ready. Original records were not modified." : "Read-only audit complete. No writes performed.");
} finally {
  await deleteApp(app);
}
