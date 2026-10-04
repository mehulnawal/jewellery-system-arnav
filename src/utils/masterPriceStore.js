import { runTransaction } from "../firebase/businessWrites.js";
import { collection, doc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase/config";
import { auditActor } from "./activityLog";
import {
  canonicalMasterPrice,
  duplicatePriceMessage,
  masterPriceErrors,
  masterPriceKey,
  masterPriceLabel,
} from "./masterPrices.js";

function audit(tx, user, action, snapshot, before) {
  const now = new Date(),
    day = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 10);
  const actor = auditActor(user);
  tx.set(doc(collection(db, "activityLog")), {
    panel: "master price list",
    action,
    recordId: masterPriceKey(snapshot),
    snapshot,
    before: before || null,
    actor,
    accessIdSnapshot: actor.accessId,
    eventAtMs: now.getTime(),
    eventDate: day,
    createdAt: serverTimestamp(),
  });
}
const snapshotFor = (row) => ({
  ...canonicalMasterPrice(row),
  description: `${masterPriceLabel(row)} / ₹${Number(row.price).toLocaleString("en-IN")}`,
});
// Deterministic document IDs plus transactional reads protect both Add and Import.
// Moving a combination archives its old document, without touching business stock.
export async function saveMasterPrice(row, user, previous = null) {
  if (user?.role !== "superadmin")
    throw new Error("Only Admin can manage Master Prices.");
  const errors = masterPriceErrors(row);
  if (Object.keys(errors).length)
    throw new Error(Object.values(errors).join(" "));
  const data = canonicalMasterPrice(row),
    key = masterPriceKey(data),
    ref = doc(db, "masterPrices", key);
  await runTransaction(db, async (tx) => {
    const target = await tx.get(ref);
    const oldRef = previous ? doc(db, "masterPrices", previous.id) : null;
    const old = previous
      ? previous.id === key
        ? target
        : await tx.get(oldRef)
      : null;
    if (
      previous &&
      (!old.exists() ||
        !old.data().active ||
        old.data().revision !== previous.revision)
    )
      throw new Error(
        "This Master Price changed. Close the form and reopen the latest record.",
      );
    if (target.exists() && target.data().active && previous?.id !== key)
      throw new Error(duplicatePriceMessage(data));
    if (oldRef && previous.id !== key)
      tx.update(oldRef, {
        active: false,
        revision: old.data().revision + 1,
        updatedAt: serverTimestamp(),
        updatedBy: user.uid,
      });
    tx.set(ref, {
      ...data,
      active: true,
      revision: (target.data()?.revision || 0) + 1,
      createdAt: target.data()?.createdAt || serverTimestamp(),
      updatedAt: serverTimestamp(),
      updatedBy: user.uid,
    });
    const snapshot = snapshotFor(data),
      before = old?.exists() ? snapshotFor(old.data()) : null;
    if (before)
      snapshot.description = `${before.description} → ${snapshot.description}`;
    audit(tx, user, previous ? "edited" : "created", snapshot, before);
  });
  return key;
}
export async function deleteMasterPrice(row, user) {
  if (user?.role !== "superadmin")
    throw new Error("Only Admin can manage Master Prices.");
  await runTransaction(db, async (tx) => {
    const ref = doc(db, "masterPrices", row.id),
      current = await tx.get(ref);
    if (
      !current.exists() ||
      !current.data().active ||
      current.data().revision !== row.revision
    )
      throw new Error(
        "This Master Price changed. Review the latest record before deleting.",
      );
    tx.update(ref, {
      active: false,
      revision: row.revision + 1,
      updatedAt: serverTimestamp(),
      updatedBy: user.uid,
    });
    audit(tx, user, "deleted", snapshotFor(current.data()));
  });
}
export async function importMasterPrices(rows, user) {
  if (user?.role !== "superadmin")
    throw new Error("Only Admin can import Master Prices.");
  // Bounded atomic chunks: each successful chunk includes one summary event.
  // A retry detects records already committed instead of overwriting them.
  const results = [];
  for (let offset = 0; offset < rows.length; offset += 100) {
    const chunk = rows.slice(offset, offset + 100);
    const committed = await runTransaction(db, async (tx) => {
      const entries = chunk.map((row) => ({
        row,
        key: masterPriceKey(row),
        errors: { ...row.errors, ...masterPriceErrors(row) },
      }));
      const targets = new Map();
      for (const entry of entries)
        if (entry.key && !targets.has(entry.key))
          targets.set(
            entry.key,
            await tx.get(doc(db, "masterPrices", entry.key)),
          );
      const used = new Set(),
        outcomes = [];
      for (const { row, key, errors } of entries) {
        const existing = targets.get(key);
        if (key && (used.has(key) || existing?.data()?.active))
          errors.combination = duplicatePriceMessage(row);
        used.add(key);
        outcomes.push({
          rowNumber: row.rowNumber,
          errors,
          added: !Object.keys(errors).length,
        });
        if (!Object.keys(errors).length)
          tx.set(doc(db, "masterPrices", key), {
            ...canonicalMasterPrice(row),
            active: true,
            revision: (existing?.data()?.revision || 0) + 1,
            createdAt: existing?.data()?.createdAt || serverTimestamp(),
            updatedAt: serverTimestamp(),
            updatedBy: user.uid,
          });
      }
      const added = outcomes.filter((row) => row.added).length;
      audit(tx, user, "imported", {
        description: `Imported ${chunk.length} Master Price rows: ${added} added, ${chunk.length - added} rejected.`,
        added,
        rejected: chunk.length - added,
        rows: outcomes,
        records: entries
          .filter((_, index) => outcomes[index].added)
          .map(({ row }) => canonicalMasterPrice(row)),
      });
      return outcomes;
    });
    results.push(...committed);
  }
  return results;
}
