import { createHash } from "node:crypto";
import { auditDimensions } from "../../src/utils/dimensionAudit.js";

const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const records = (snapshot) => snapshot.docs.map((entry) => ({ ...entry.data(), id: entry.id }));
// Exclude stock/history: setup never writes them, and stock-only transactions
// may continue while identity creation, identity edits and deletion are guarded.
export const identityFingerprint = (inventory) => createHash("sha256").update(JSON.stringify(
  inventory.map((row) => [row.id, row.size ?? null, row.shape ?? null, row.type ?? null, row.sku ?? null])
    .sort((a, b) => compare(a[0], b[0]))
)).digest("hex");

export function reconcileReservation(existing, desired) {
  if (!existing) return desired;
  if (existing.sku !== desired.sku) throw new Error(`Registry mismatch at ${desired.sku}; explicit review required.`);
  if (existing.recordId === null) {
    const ids = existing.legacyRecordIds;
    const expected = desired.recordId === null ? desired.legacyRecordIds : [desired.recordId];
    if (!Array.isArray(ids) || !ids.length || !ids.every((id) => typeof id === "string" && id.length))
      throw new Error(`Malformed collision reservation ${desired.sku}; explicit review required.`);
    // Never downgrade a collision or remove any historical member on a retry.
    return { ...existing, legacyRecordIds: [...new Set([...ids, ...expected])].sort() };
  }
  if (existing.recordId === desired.recordId) return existing;
  if (desired.recordId === null && desired.legacyRecordIds.includes(existing.recordId))
    return { ...existing, ...desired }; // Safe promotion; no physical owner wins.
  throw new Error(`Conflicting registry owner for ${desired.sku}; explicit review required.`);
}
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export async function readIdentityPlan(db) {
  const inventory = records(await db.collection("inventory").get());
  return { ...auditDimensions({ inventory }), fingerprint: identityFingerprint(inventory) };
}

// Admin SDK only. Deploy setup guard rules and pause trusted identity writers
// before applying a reviewed fingerprint. Never writes any business collection.
export async function initializeInventoryIdentities(db, {
  expectedFingerprint, guardRulesAcknowledged = false, batchSize = 100,
  afterBatch = async () => {}, // Local recovery-test fault injection.
} = {}) {
  if (!guardRulesAcknowledged) throw new Error("Setup guard rules and paused trusted identity writers must be acknowledged.");
  if (!expectedFingerprint) throw new Error("A reviewed dry-run fingerprint is required.");
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) throw new Error("Batch size must be 1 through 100.");
  const marker = db.doc("inventoryIdentityMigrations/v1");
  const plan = await readIdentityPlan(db);
  if (plan.invalid.length) throw new Error(`Invalid legacy identities: ${plan.invalid.length}. Review the audit; readiness was not enabled.`);
  if (plan.fingerprint !== expectedFingerprint) throw new Error("Inventory identities changed since dry run. Review a fresh audit.");
  const alreadyReady = await db.runTransaction(async (tx) => {
    const state = await tx.get(marker);
    if (state.data()?.ready === true) return true;
    if (state.data()?.fingerprint && state.data().fingerprint !== plan.fingerprint)
      throw new Error("Interrupted setup source changed. Keep writes paused and review the previous plan; no automatic reset is allowed.");
    tx.set(marker, { ready: false, status: "initializing", fingerprint: plan.fingerprint, inventoryCount: plan.inventoryCount,
      canonicalIdentityCount: plan.canonicalIdentityCount, collisionCount: plan.collisions.length, invalidCount: 0,
      startedAt: state.data()?.startedAt || new Date(), schemaVersion: 1 }, { merge: true });
    return false;
  });
  let batches = 0, reservationsWritten = 0;
  if (!alreadyReady) {
    for (let offset = 0; offset < plan.indexPlan.length; offset += batchSize) {
      const rows = plan.indexPlan.slice(offset, offset + batchSize);
      const written = await db.runTransaction(async (tx) => {
        const state = await tx.get(marker);
        if (state.data()?.fingerprint !== plan.fingerprint) throw new Error("Setup marker changed; stopped safely.");
        if (state.data()?.ready === true) return 0;
        const refs = rows.map((row) => db.doc(`inventoryIdentities/${row.sku}`));
        const snapshots = await tx.getAll(...refs);
        const values = rows.map((row, index) => reconcileReservation(snapshots[index].data(), row));
        let count = 0;
        values.forEach((value, index) => {
          if (!equal(value, snapshots[index].data())) { tx.set(refs[index], value); count++; }
        });
        return count;
      });
      reservationsWritten += written;
      await afterBatch(++batches);
    }
  }
  // Verify all current identities and all reservations before atomically enabling
  // creation. Guard rules prevent client identity writes; source drift fails closed.
  await db.runTransaction(async (tx) => {
    const state = await tx.get(marker);
    const inventory = records(await tx.get(db.collection("inventory")));
    const current = auditDimensions({ inventory });
    if (current.invalid.length || identityFingerprint(inventory) !== plan.fingerprint)
      throw new Error("Inventory identities changed during initialization. Readiness remains disabled; review and retry.");
    const registry = new Map(records(await tx.get(db.collection("inventoryIdentities"))).map(({ id, ...row }) => [id, row]));
    for (const desired of current.indexPlan) {
      const existing = registry.get(desired.sku);
      if (!existing || !equal(existing, reconcileReservation(existing, desired)))
        throw new Error(`Reservation verification failed for ${desired.sku}; readiness was not enabled.`);
    }
    if (state.data()?.ready === true) return;
    if (state.data()?.fingerprint !== plan.fingerprint) throw new Error("Setup marker changed; readiness was not enabled.");
    tx.set(marker, { ready: true, status: "ready", completedAt: new Date(), verifiedFingerprint: plan.fingerprint }, { merge: true });
  });
  return { status: alreadyReady ? "already-ready-verified" : "ready", fingerprint: plan.fingerprint,
    inventoryCount: plan.inventoryCount, canonicalIdentityCount: plan.canonicalIdentityCount,
    collisionCount: plan.collisions.length, reservationsWritten, batches };
}
