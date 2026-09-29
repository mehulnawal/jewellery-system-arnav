import { collection, doc, getDocFromServer, getDocsFromServer, serverTimestamp, writeBatch } from "firebase/firestore";
import { isValidDocumentNumber, numberRegistryCollection, numberRegistryKey } from "./documentNumbers.js";

const markerPath = ["numberingMigrations", "manual-v1"];

// Called only by an Admin clicking the Settings button. Existing business
// records are read, never modified. Registry writes fit Spark's Firestore plan.
export async function registerExistingNumbers(db) {
  const marker = doc(db, ...markerPath);
  if ((await getDocFromServer(marker)).data()?.ready === true)
    return { ready: true, alreadyReady: true, challans: 0, purchases: 0, conflicts: 0 };

  const counts = { ready: true, alreadyReady: false, challans: 0, purchases: 0, conflicts: 0 };
  for (const [kind, source, field] of [
    ["challan", "challans", "number"],
    ["purchase", "purchases", "purchaseId"],
  ]) {
    const sourceRows = await getDocsFromServer(collection(db, source));
    const groups = new Map();
    for (const row of sourceRows.docs) {
      const value = row.data()[field];
      if (!isValidDocumentNumber(kind, value)) continue;
      groups.set(value, [...(groups.get(value) || []), row.id]);
    }
    counts[source] = groups.size;
    const existing = await getDocsFromServer(collection(db, numberRegistryCollection(kind)));
    const known = new Map(existing.docs.map((row) => [row.id, row.data()]));
    const operations = [];
    for (const [number, recordIds] of groups) {
      const key = numberRegistryKey(kind, number);
      const data = { number, recordId: recordIds.length === 1 ? recordIds[0] : null,
        ...(recordIds.length > 1 ? { legacyRecordIds: recordIds } : {}) };
      if (recordIds.length > 1) counts.conflicts += 1;
      const old = known.get(key);
      // Do not overwrite a claim with a different live owner. A partial setup
      // can be safely retried once the conflict is resolved.
      if (old && (old.number !== number || (old.recordId !== data.recordId && old.recordId !== null)))
        throw new Error(`Number ${number} has a conflicting reservation. Ask an administrator to review it.`);
      operations.push({ ref: doc(db, numberRegistryCollection(kind), key), data });
    }
    for (let offset = 0; offset < operations.length; offset += 400) {
      const batch = writeBatch(db);
      for (const operation of operations.slice(offset, offset + 400)) batch.set(operation.ref, operation.data);
      await batch.commit();
    }
  }
  const batch = writeBatch(db);
  batch.set(marker, { ready: true, completedAt: serverTimestamp() });
  await batch.commit();
  return counts;
}
