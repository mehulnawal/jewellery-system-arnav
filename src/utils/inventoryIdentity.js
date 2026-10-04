import { runTransaction } from "../firebase/businessWrites.js";
import { doc } from "firebase/firestore";
import { canonicalSku, normalizeSize } from "./dimensions.js";

// Read all claims before any writes. Firestore retries concurrent claimants;
// rules require the claim and the Inventory write to agree atomically.
export async function prepareInventoryClaims(tx, db, rows) {
  if (!rows.length) return () => {};
  const ready = await tx.get(doc(db, "inventoryIdentityMigrations", "v1"));
  if (!ready.exists() || ready.data().ready !== true)
    throw new Error("Inventory identity index is not ready. An administrator must review the legacy Size audit and initialize the index before saving Inventory identities.");
  const keys = rows.map(canonicalSku);
  if (new Set(keys).size !== keys.length) throw new Error("Duplicate Type, Shape and Size in this save.");
  const writes = [];
  for (let i = 0; i < rows.length; i++) {
    const key = keys[i], row = rows[i];
    if (key === "--" || key.includes("/")) throw new Error("Invalid Inventory Size identity.");
    const ref = doc(db, "inventoryIdentities", key), claim = await tx.get(ref);
    if (claim.exists()) {
      const owner = claim.data().recordId;
      if (!owner) throw new Error(`Legacy canonical collision for ${key}. Review the audit; records have not been merged.`);
      if (owner !== row.id) {
        const source = await tx.get(doc(db, "inventory", owner));
        if (source.exists() && canonicalSku(source.data()) === key)
          throw new Error(`SKU ${key} already exists in Inventory.`);
      }
    }
    writes.push(() => tx.set(ref, { recordId: row.id, sku: key }));
  }
  return () => writes.forEach((write) => write());
}

export async function saveInventoryIdentity(db, ref, payload, edit = false) {
  const canonical = { ...payload, size: normalizeSize(payload.size), sku: canonicalSku(payload) };
  await runTransaction(db, async (tx) => {
    const previous = await tx.get(ref);
    if (edit && !previous.exists()) throw new Error("This Inventory item is no longer available.");
    // Legacy collisions may still edit stock/nonidentity fields independently.
    const sameIdentity = previous.exists() && canonicalSku(previous.data()) === canonical.sku;
    const release = previous.exists() && !sameIdentity
      ? await prepareInventoryRelease(tx, db, { ...previous.data(), id: ref.id }) : () => {};
    const claim = sameIdentity ? () => {} : await prepareInventoryClaims(tx, db, [{ ...canonical, id: ref.id }]);
    release();
    claim();
    tx.set(ref, sameIdentity ? { ...canonical, size: previous.data().size, sku: previous.data().sku } : canonical, { merge: edit });
  });
  return ref;
}

export async function prepareInventoryRelease(tx, db, row) {
  const key = canonicalSku(row);
  if (key === "--" || key.includes("/")) return () => {};
  const ref = doc(db, "inventoryIdentities", key), claim = await tx.get(ref);
  // Collision reservations are retained for a separately reviewed migration.
  return claim.exists() && claim.data().recordId === row.id ? () => tx.delete(ref) : () => {};
}
