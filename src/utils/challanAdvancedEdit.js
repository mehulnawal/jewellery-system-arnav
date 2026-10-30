import { doc, serverTimestamp } from "firebase/firestore";
import { runTransaction } from "../firebase/businessWrites.js";
import { prepareNumberClaim } from "./numberRegistry.js";
import { canEditChallan } from "./challanEditWindow.js";
import { normalizeSize } from "./dimensions.js";
import { stageOneEditSnapshot } from "./challanEditSnapshot.js";
import {
  challanStockRestoration,
  fromCents,
  fromMillis,
  invoiceFromStageTwo,
  moneyCents,
  movementFor,
  priceWeightedItem,
  stageOneTotals,
  stageTwoPricedItems,
  strictWeight,
  weightMillis,
  wholePieces,
} from "./challanCalculations.js";

const stable = (value) => {
  if (value?.toMillis) return value.toMillis();
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stable(value[key])]),
    );
  return value;
};
const equal = (a, b) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));

export const advancedEditSnapshot = (record) =>
  stable({
    base: stageOneEditSnapshot(record),
    stage2Return: record.stage2Return ?? null,
    stage2Prices: record.stage2Prices ?? null,
    finalInvoice: record.finalInvoice ?? null,
    finalSettlement: record.finalSettlement ?? null,
    settlementPayments: record.settlementPayments ?? null,
    stockEdit: record.stockEdit ?? null,
  });

export function advancedEditRows(record) {
  const priced = stageTwoPricedItems(record);
  return record.items.map((item, index) => ({
    ...item,
    inventoryId: item.sourceInventoryId || item.inventoryId || "",
    amount: priced[index]?.amount ?? item.amount,
    discount: priced[index]?.discount ?? item.discount ?? 0,
    returnPieces: record.stage2Return?.items?.[index]?.returnPieces ?? 0,
    returnWeight: record.stage2Return?.items?.[index]?.returnWeight ?? 0,
  }));
}
const rowInputs = (row) => ({
  inventoryId: row.inventoryId || row.sourceInventoryId || "",
  sku: row.sku,
  shape: row.shape,
  size: normalizeSize(row.size),
  type: row.type,
  width: normalizeSize(row.width),
  weight: Number(row.weight),
  pieces: Number(row.pieces || 0),
  amount: Number(row.amount),
  discount: Number(row.discount || 0),
  returnPieces: Number(row.returnPieces || 0),
  returnWeight: Number(row.returnWeight || 0),
});

export function advancedEditPreview(record, items) {
  const original = advancedEditRows(record);
  const rows = items.map((item, index) => {
    try {
      const movement = movementFor(item, item.returnPieces, item.returnWeight);
      const pricing = priceWeightedItem(
        movement.soldWeight || 1,
        item.amount,
        item.discount,
      );
      if (!movement.soldWeight)
        Object.assign(pricing, {
          grossAmount: 0,
          discountAmount: 0,
          netAmount: 0,
        });
      if (
        Number(record.stage) === 3 &&
        original[index] &&
        equal(rowInputs(original[index]), rowInputs(item))
      )
        pricing.netAmount =
          record.finalInvoice?.items?.[index]?.finalAmount ?? pricing.netAmount;
      return pricing;
    } catch {
      return null;
    }
  });
  const complete = rows.every(Boolean);
  return {
    rows,
    grossAmount: complete
      ? fromCents(
          rows.reduce((sum, row) => sum + moneyCents(row.grossAmount), 0n),
        )
      : null,
    netAmount: complete
      ? fromCents(
          rows.reduce((sum, row) => sum + moneyCents(row.netAmount), 0n),
        )
      : null,
  };
}

// Rebuild the current stage from editable business inputs. Stage-entry times and
// receipts are deliberately outside this update, so an edit cannot reset a timer.
export function advancedEditUpdate(record, form) {
  const stage = Number(record.stage);
  if (![1, 2, 3].includes(stage))
    throw new Error("This Challan is no longer in an editable goods stage.");
  const draft = form.items.filter((row) => String(row.sku || "").trim());
  const original = advancedEditRows(record);
  const metadata = {
    number: form.number,
    party: form.party.trim(),
    date: form.date,
    notes: form.notes || "",
    angadiaService: form.angadiaService === true,
  };
  const changed = !equal(original.map(rowInputs), draft.map(rowInputs));
  if (!changed) return { update: metadata, financialChange: false };
  if (record.finalSettlement || record.settlementPayments?.length)
    throw new Error(
      "Payments have already been recorded. Reopen the latest Challan.",
    );
  if (!draft.length) throw new Error("Add at least one Inventory SKU.");
  const ids = draft.map((row) => row.inventoryId);
  if (ids.some((id) => !id))
    throw new Error("Select an Inventory item for every SKU.");
  if (new Set(ids).size !== ids.length)
    throw new Error(
      "Each Challan line must use a different physical Inventory item.",
    );
  const items = draft.map((row) => ({
    id: row.id || row.inventoryId,
    inventoryId: row.inventoryId,
    sourceInventoryId: row.inventoryId,
    sku: row.sku,
    shape: row.shape,
    size: normalizeSize(row.size),
    type: row.type,
    width: normalizeSize(row.width),
    weight: strictWeight(row.weight, "Issued Weight"),
    pieces: wholePieces(row.pieces === "" ? 0 : row.pieces, "Issued Pieces"),
    ...priceWeightedItem(row.weight, row.amount, row.discount),
  }));
  const returned =
    stage === 1
      ? []
      : items.map((item, index) => ({
          ...item,
          ...movementFor(
            item,
            draft[index].returnPieces,
            draft[index].returnWeight,
          ),
        }));
  const totals = stageOneTotals(items);
  const update = {
    ...metadata,
    items,
    amount: totals.amount,
    discountAmount: totals.discountAmount,
    netAmount: totals.netAmount,
    discount: totals.amount
      ? Number(((totals.discountAmount * 100) / totals.amount).toFixed(2))
      : 0,
    ...(stage > 1
      ? {
          stage2Prices: {},
          stage2Return: { ...record.stage2Return, items: returned },
        }
      : {}),
  };
  if (stage === 3) {
    const partialAmounts = returned.map((row, index) => {
      // Retain a manually agreed amount when that line's inputs are untouched.
      if (
        original[index] &&
        equal(rowInputs(original[index]), rowInputs(draft[index]))
      )
        return (
          record.finalInvoice?.items?.[index]?.finalAmount ?? row.netAmount
        );
      return row.soldWeight === 0
        ? 0
        : priceWeightedItem(row.soldWeight, row.amount, row.discount).netAmount;
    });
    update.finalInvoice = {
      ...record.finalInvoice,
      ...invoiceFromStageTwo(returned, partialAmounts),
    };
  }
  return { update, financialChange: true };
}

export function advancedStockChanges(
  before,
  after,
  stocks,
  challanId = before.id,
) {
  const old = challanStockRestoration(before).items;
  const next = challanStockRestoration(after).items;
  if (new Set(old.map((row) => row.inventoryId)).size !== old.length)
    throw new Error(
      "This historical Challan has duplicate Inventory links. Reconcile those links before changing goods.",
    );
  return [...new Set([...old, ...next].map((row) => row.inventoryId))].map(
    (inventoryId) => {
      const oldIndex = old.findIndex((row) => row.inventoryId === inventoryId);
      const newIndex = next.findIndex((row) => row.inventoryId === inventoryId);
      const stock = stocks.get(inventoryId);
      if (!stock)
        throw new Error("Linked Inventory is missing. No changes were saved.");
      const previous = old[oldIndex],
        replacement = next[newIndex];
      // The per-Challan deduction stays on the stock document itself. A later
      // edit cannot replay an old return and restore the same stock twice.
      const reservation = stock.challanReservations?.[challanId];
      if (
        (before.stockEdit || reservation) &&
        ((reservation?.weightMillis ?? 0) !==
          Number(weightMillis(previous?.weight ?? 0)) ||
          (reservation?.pieces ?? 0) !== (previous?.pieces ?? 0))
      )
        throw new Error(
          "Inventory reservation changed. Reopen this Challan before saving.",
        );
      if (previous && stock.sku !== previous.sku)
        throw new Error(
          "The original Inventory SKU changed. Reopen this Challan.",
        );
      if (replacement) {
        const row = after.items[newIndex];
        if (
          stock.sku !== row.sku ||
          stock.shape !== row.shape ||
          stock.type !== row.type ||
          normalizeSize(stock.size) !== normalizeSize(row.size)
        )
          throw new Error(
            "Selected SKU no longer matches Inventory. Select it again.",
          );
      }
      const deltaWeight =
        weightMillis(previous?.weight ?? 0) -
        weightMillis(replacement?.weight ?? 0);
      const deltaPieces = (previous?.pieces ?? 0) - (replacement?.pieces ?? 0);
      const weight = fromMillis(weightMillis(stock.weight ?? 0) + deltaWeight);
      const pieces =
        wholePieces(stock.pieces ?? stock.quantity ?? stock.qty ?? 0) +
        deltaPieces;
      if (weight < 0 || pieces < 0)
        throw new Error(
          `Not enough stock for ${stock.sku}. No changes were saved.`,
        );
      if (!Number.isSafeInteger(pieces))
        throw new Error("Inventory Pieces are too large.");
      return {
        inventoryId,
        oldIndex,
        newIndex,
        weight,
        pieces,
        changed: deltaWeight !== 0n || deltaPieces !== 0 || !reservation,
        reservations: {
          ...(stock.challanReservations || {}),
          [challanId]: {
            weightMillis: Number(weightMillis(replacement?.weight ?? 0)),
            pieces: replacement?.pieces ?? 0,
          },
        },
      };
    },
  );
}

export async function saveAdvancedChallanEdit(db, previous, form, user, now) {
  const reviewed = advancedEditSnapshot(previous);
  const editId = crypto.randomUUID();
  return runTransaction(db, async (tx) => {
    const ref = doc(db, "challans", previous.id);
    const snapshot = await tx.get(ref);
    if (!snapshot.exists())
      throw new Error("This Challan is no longer available.");
    const current = snapshot.data();
    if (!equal(reviewed, advancedEditSnapshot(current)))
      throw new Error(
        "This Challan changed while you were editing. Reopen it and try again.",
      );
    if (!canEditChallan(current, user, typeof now === "function" ? now() : now))
      throw new Error("This Challan is no longer editable.");
    const { update, financialChange } = advancedEditUpdate(current, form);
    const claimNumber =
      update.number !== current.number
        ? await prepareNumberClaim(
            tx,
            db,
            "challan",
            update.number,
            previous.id,
            current.number,
          )
        : () => {};
    let changes = [];
    if (financialChange) {
      const after = { ...current, ...update };
      const ids = [
        ...new Set(
          [
            ...challanStockRestoration(current).items,
            ...challanStockRestoration(after).items,
          ].map((row) => row.inventoryId),
        ),
      ];
      const snapshots = await Promise.all(
        ids.map((id) => tx.get(doc(db, "inventory", id))),
      );
      const stocks = new Map(
        snapshots
          .filter((stock) => stock.exists())
          .map((stock) => [stock.id, stock.data()]),
      );
      changes = advancedStockChanges(current, after, stocks, previous.id);
      update.stockEdit = {
        id: editId,
        actorUid: user.uid,
        at: serverTimestamp(),
        inventoryIds: update.items.map((item) => item.inventoryId),
      };
    }
    // All reads (including number reservations) finish before the first write.
    claimNumber();
    for (const change of changes) {
      if (!change.changed) continue;
      tx.update(doc(db, "inventory", change.inventoryId), {
        weight: change.weight,
        pieces: change.pieces,
        challanReservations: change.reservations,
        updatedAt: serverTimestamp(),
        challanEdit: {
          id: editId,
          challanId: previous.id,
          oldIndex: change.oldIndex,
          newIndex: change.newIndex,
        },
      });
    }
    tx.update(ref, { ...update, updatedAt: serverTimestamp() });
    return { ...current, ...update, id: previous.id };
  });
}
