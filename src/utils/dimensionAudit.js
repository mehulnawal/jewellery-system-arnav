import { canonicalInventoryIdentity, canonicalSku, normalizeSize, inventoryIdentityErrors } from "./dimensions.js";

// Pure and read-only: callers supply a snapshot/export, never database writes.
export function auditDimensions({ inventory = [], purchases, challans }) {
  const groups = new Map(), invalid = [], ids = new Set();
  const items = (row) => Array.isArray(row.items) ? row.items : [];
  for (const row of inventory) {
    const reasons = inventoryIdentityErrors(row);
    if (typeof row.id !== "string" || !row.id || row.id.includes("/")) reasons.push("Missing or invalid physical document ID.");
    else if (ids.has(row.id)) reasons.push("Duplicate physical document ID in input export.");
    ids.add(row.id);
    const key = canonicalSku(row);
    const entry = {
      id: row.id ?? null, currentSku: row.sku ?? null, canonicalSku: key === "--" ? null : key,
      type: row.type ?? null, shape: row.shape ?? null, rawSize: row.size ?? null, canonicalSize: normalizeSize(row.size),
      weight: row.weight ?? null, pieces: row.pieces ?? null,
      sourcePurchaseId: row.sourcePurchaseId ?? null,
      purchaseReferences: purchases ? purchases.filter((purchase) => purchase.id === row.sourcePurchaseId || items(purchase).some((item) => item.inventoryId === row.id)).map((purchase) => purchase.id) : "not scanned",
      challanReferences: challans ? challans.filter((challan) => items(challan).some((item) => (item.sourceInventoryId || item.inventoryId) === row.id)).map((challan) => challan.id) : "not scanned",
      // SKU-only historical references are candidates, not proof of stock ownership.
      possibleSkuOnlyChallanReferences: challans ? challans.filter((challan) => items(challan).some((item) => !item.sourceInventoryId && !item.inventoryId && (key !== "--" ? canonicalInventoryIdentity(item) === key : Boolean(row.sku) && item.sku === row.sku))).map((challan) => challan.id) : "not scanned",
    };
    if (reasons.length) { invalid.push({ ...entry, reasons }); continue; }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  const ordered = [...groups].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  return { inventoryCount: inventory.length, canonicalIdentityCount: groups.size, invalid,
    collisions: [...groups].filter(([, rows]) => rows.length > 1).map(([canonicalSku, records]) => ({ canonicalSku, records })),
    // A future approved index initialization can reserve collisions with null owner.
    indexPlan: ordered.map(([sku, rows]) => ({ sku, recordId: rows.length === 1 ? rows[0].id : null, ...(rows.length > 1 ? { legacyRecordIds: rows.map((row) => row.id).sort() } : {}) })),
  };
}
