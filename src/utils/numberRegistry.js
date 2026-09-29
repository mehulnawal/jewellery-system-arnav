import { doc } from "firebase/firestore";
import {
  documentNumberError,
  isValidDocumentNumber,
  numberLabel,
  numberRegistryCollection,
  numberRegistryKey,
} from "./documentNumbers.js";

export const numberRegistryRef = (db, kind, value) =>
  doc(db, numberRegistryCollection(kind), numberRegistryKey(kind, value));

// Read before any transaction writes. The caller commits the returned mutation
// together with its record, so retries and concurrent submissions stay atomic.
export async function prepareNumberClaim(tx, db, kind, value, recordId, oldValue) {
  const error = documentNumberError(kind, value);
  if (error) throw new Error(error);
  const readiness = await tx.get(doc(db, "numberingMigrations", "manual-v1"));
  if (readiness.data()?.ready !== true)
    throw new Error("Number setup is incomplete. An administrator needs to open Settings and select Register existing numbers once.");
  const usesNewLetter = kind === "challan" ? !value.startsWith("A") : !value.startsWith("PR-A");
  if (usesNewLetter) {
    const letters = await tx.get(doc(db, "numberingMigrations", "letters-v1"));
    if (letters.data()?.ready !== true)
      throw new Error("Letter-series number setup is incomplete. An administrator needs to open Settings and select Register existing numbers once.");
  }
  const ref = numberRegistryRef(db, kind, value);
  const existing = await tx.get(ref);
  if (existing.exists() && existing.data().recordId !== recordId) {
    const conflict = new Error(kind === "purchase" ? "This Purchase Number already exists." : `${numberLabel(kind)} ${value} already exists.`);
    conflict.field = kind === "purchase" ? "purchaseId" : "number";
    throw conflict;
  }
  const release = oldValue && oldValue !== value
    ? await prepareNumberRelease(tx, db, kind, oldValue, recordId)
    : () => {};
  return () => {
    if (!existing.exists()) tx.set(ref, { number: value, recordId });
    release();
  };
}

export async function prepareNumberRelease(tx, db, kind, value, recordId) {
  if (!isValidDocumentNumber(kind, value)) return () => {};
  const ref = numberRegistryRef(db, kind, value);
  const existing = await tx.get(ref);
  return () => {
    if (existing.exists() && existing.data().recordId === recordId) tx.delete(ref);
  };
}
