import { doc, serverTimestamp } from "firebase/firestore";
import { runTransaction } from "../firebase/businessWrites.js";
import { normalizeSize } from "./dimensions.js";
import { prepareNumberClaim } from "./numberRegistry.js";
import {
  fromMillis,
  normalizeWeight,
  strictWeight,
  weightMillis,
  wholePieces,
} from "./challanCalculations.js";

export function stageOneInventoryDeduction(item, stock) {
  if (
    stock.sku !== item.sku ||
    stock.shape !== item.shape ||
    stock.type !== item.type ||
    normalizeSize(stock.size) !== normalizeSize(item.size)
  )
    throw new Error(
      "Inventory identity changed for SKU " +
        item.sku +
        ". Review this Challan again.",
    );
  const requestedWeight = strictWeight(item.weight, "Issued Weight");
  const requestedPieces = wholePieces(item.pieces, "Issued Pieces");
  const availableWeight = normalizeWeight(stock.weight || 0);
  const availablePieces = wholePieces(
    stock.pieces ?? stock.quantity ?? stock.qty ?? 0,
    "Inventory Pieces",
  );
  if (requestedWeight <= 0)
    throw new Error("Issued Weight must be greater than zero.");
  if (requestedWeight > availableWeight)
    throw new Error(
      "SKU " +
        item.sku +
        " has " +
        availableWeight.toFixed(3) +
        " ct available; requested " +
        requestedWeight.toFixed(3) +
        " ct.",
    );
  if (requestedPieces > availablePieces)
    throw new Error(
      "SKU " +
        item.sku +
        " has " +
        availablePieces +
        " Pieces available; requested " +
        requestedPieces +
        ".",
    );
  return {
    weight: fromMillis(
      weightMillis(stock.weight || 0) - weightMillis(requestedWeight),
    ),
    pieces: availablePieces - requestedPieces,
  };
}
// Manual creation and bulk import share this complete Stage 1 transaction.
export async function createStageOneChallan(db, record) {
  return runTransaction(db, async (tx) => {
    const now = Date.now();
    const claimNumber = await prepareNumberClaim(
      tx,
      db,
      "challan",
      record.number,
      record.id,
    );
    if (
      new Set(record.items.map((item) => item.inventoryId)).size !==
      record.items.length
    )
      throw new Error(
        "Each Challan line must use a different physical Inventory item.",
      );
    const snapshots = await Promise.all(
      record.items.map((item) => {
        if (!item.inventoryId)
          throw new Error("Select an Inventory item for " + item.sku + ".");
        return tx.get(doc(db, "inventory", item.inventoryId));
      }),
    );
    const issuedItems = [];
    for (const [index, item] of record.items.entries()) {
      const inventoryRef = doc(db, "inventory", item.inventoryId);
      const snapshot = snapshots[index];
      if (!snapshot.exists())
        throw new Error(
          "Inventory item " + item.sku + " is no longer available.",
        );
      const deduction = stageOneInventoryDeduction(item, snapshot.data());
      tx.update(inventoryRef, { ...deduction, updatedAt: serverTimestamp() });
      issuedItems.push({ ...item, sourceInventoryId: item.inventoryId });
    }
    const savedRecord = {
      ...record,
      items: issuedItems,
      createdAt: serverTimestamp(),
      createdAtMs: now,
      stageHistory: { stage1: { enteredAtMs: now } },
    };
    claimNumber();
    tx.set(doc(db, "challans", record.id), savedRecord);
    return { ...savedRecord, createdAt: now };
  });
}
