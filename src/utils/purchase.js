import {
  collection,
  doc,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { db } from "../firebase/config";
import {
  isValidBox,
  isValidSize,
  normalizeBox,
  normalizeSize,
  sizeSortValue,
} from "./inventoryRules";

export const PURCHASE_HEADERS = [
  "Import Ref",
  "Date",
  "Vendor Name",
  "Broker Name",
  "Total Purchase Weight (ct)",
  "Amount",
  "Discount",
  "Payment Due Days",
];
export const PURCHASE_ITEM_HEADERS = [
  "Import Ref",
  "Type",
  "Shape",
  "Size (mm)",
  "Weight (ct)",
  "Pieces",
  "BOX",
];
export const purchaseSku = ({ size, shape, type }) =>
  size && shape && type ? `${size}_${shape}_${type}` : "--";
export const inventoryGroup = (size) => {
  void sizeSortValue(size);
  return "Uncategorized";
};
export const asNumber = (value) => Number(value || 0);
export const money = (value) => Number(asNumber(value).toFixed(2));
export const datePlusDays = (date, days) => {
  if (!date) return "";
  const result = new Date(`${date}T00:00:00`);
  result.setDate(result.getDate() + Number(days || 0));
  return Number.isNaN(result.getTime())
    ? ""
    : result.toISOString().slice(0, 10);
};
export const pricingFor = (amount, discount) => {
  const gross = money(amount),
    percent = Number(discount || 0),
    discountAmount = money((gross * percent) / 100);
  return {
    amount: gross,
    discount: percent,
    discountAmount,
    netPayable: money(gross - discountAmount),
  };
};
export const nextPurchaseCounter = (current = {}) => {
  const storedSeries = Number(current.series || 0);
  const series = Math.max(35, storedSeries);
  const number = storedSeries < 35 ? 0 : Number(current.number || 0);
  return number >= 100
    ? { series: series + 1, number: 1 }
    : { series, number: number + 1 };
};
export const purchaseIdFromCounter = ({ series, number }) =>
  `PR-A${series}-${number}`;
export const normalizePurchaseItem = (raw) => ({
  id: raw.id || crypto.randomUUID(),
  type: String(raw.type || "")
    .trim()
    .toUpperCase(),
  shape: String(raw.shape || "")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase()),
  size: normalizeSize(raw.size),
  weight: asNumber(raw.weight),
  pieces: asNumber(raw.pieces),
  box: normalizeBox(raw.box),
});
export const validatePurchaseItem = (raw, allowDimensions) => {
  const item = normalizePurchaseItem(raw),
    errors = [];
  if (!["CVD", "HP"].includes(item.type))
    errors.push("Type must be CVD or HP.");
  if (!item.shape) errors.push("Shape is required.");
  if (!isValidSize(item.size, allowDimensions))
    errors.push("Size must be a positive valid size.");
  if (!(item.weight > 0)) errors.push("Weight must be greater than 0.");
  if (raw.pieces === "" || raw.pieces === null || raw.pieces === undefined)
    errors.push("Pieces is required.");
  else if (!Number.isInteger(item.pieces) || item.pieces < 0)
    errors.push("Pieces must be a whole number of 0 or more.");
  if (!isValidBox(item.box))
    errors.push("BOX must use letters then numbers, e.g. AB29.");
  return { item, errors };
};
export const purchaseLockedByChallan = (purchase, inventory, challans) => {
  const inventoryIds = new Set(
    inventory
      .filter((row) => row.sourcePurchaseId === purchase.id)
      .map((row) => row.id),
  );
  return challans.some((challan) =>
    (challan.items || []).some((item) =>
      inventoryIds.has(item.sourceInventoryId || item.inventoryId),
    ),
  );
};
const counterRef = doc(db, "counters", "purchase");
const linkedInventoryQuery = (purchaseId) =>
  query(
    collection(db, "inventory"),
    where("sourcePurchaseId", "==", purchaseId),
  );
const challanUsesInventory = (challans, inventoryDocs) => {
  const inventoryIds = new Set(inventoryDocs.map((entry) => entry.id));
  return challans.some((challan) =>
    (challan.data().items || []).some((item) =>
      inventoryIds.has(item.sourceInventoryId || item.inventoryId),
    ),
  );
};

const assertPurchaseIsUnlocked = (purchaseId, inventoryDocs, challans) => {
  if (challanUsesInventory(challans, inventoryDocs))
    throw new Error(
      "This Purchase cannot be changed because stock from this Purchase has already been used in a Challan.",
    );
};

export async function savePurchase({
  purchase,
  items,
  user,
  existingInventory = [],
  edit = false,
}) {
  const normalized = items.map(normalizePurchaseItem);
  const purchaseRef = purchase.id
    ? doc(db, "purchases", purchase.id)
    : doc(db, "purchases", crypto.randomUUID());
  const now = Date.now();
  return runTransaction(db, async (tx) => {
    let purchaseId = purchase.purchaseId;
    const previous = edit ? await tx.get(purchaseRef) : null;
    if (edit && !previous?.exists())
      throw new Error("This Purchase is no longer available.");
    const linkedInventory = edit
      ? await tx.get(linkedInventoryQuery(purchaseRef.id))
      : null;
    const challans = edit ? await tx.get(collection(db, "challans")) : null;
    if (edit)
      assertPurchaseIsUnlocked(
        purchaseRef.id,
        linkedInventory.docs,
        challans.docs,
      );
    if (!edit) {
      const counter = await tx.get(counterRef),
        current = counter.exists() ? counter.data() : { series: 1, number: 0 };
      const next = nextPurchaseCounter(current);
      purchaseId = purchaseIdFromCounter(next);
      tx.set(counterRef, next, { merge: true });
    }
    const inventoryRefs = normalized.map((item) =>
      doc(db, "inventory", `${purchaseRef.id}_${item.id}`),
    );
    const allowedExisting = new Set(
      (previous?.data()?.items || []).map((item) => item.inventoryId),
    );
    for (const item of normalized) {
      const duplicate = existingInventory.find(
        (entry) =>
          entry.sku === purchaseSku(item) && !allowedExisting.has(entry.id),
      );
      if (duplicate)
        throw new Error(
          `SKU ${purchaseSku(item)} already exists in Inventory.`,
        );
    }
    const recordItems = normalized.map((item, index) => ({
      ...item,
      sku: purchaseSku(item),
      inventoryId: inventoryRefs[index].id,
    }));
    const payload = {
      ...purchase,
      purchaseId,
      id: purchaseRef.id,
      items: recordItems,
      itemCount: recordItems.length,
      updatedAt: serverTimestamp(),
      updatedAtMs: now,
    };
    if (!edit)
      Object.assign(payload, {
        createdBy: user?.uid || "",
        createdByRole: user?.role || "employee",
        createdAt: serverTimestamp(),
        createdAtMs: now,
      });
    tx.set(purchaseRef, payload, { merge: edit });
    if (edit)
      linkedInventory.docs.forEach((old) => {
        if (
          !recordItems.some(
            (item) => item.id === old.data().sourcePurchaseItemId,
          )
        )
          tx.delete(old.ref);
      });
    const existingInventoryByItemId = new Map(
      (linkedInventory?.docs || []).map((entry) => [
        entry.data().sourcePurchaseItemId,
        entry.data(),
      ]),
    );
    recordItems.forEach((item) =>
      tx.set(
        doc(db, "inventory", item.inventoryId),
        {
          shape: item.shape,
          type: item.type,
          size: item.size,
          weight: item.weight,
          pieces: item.pieces,
          box: item.box,
          sku: item.sku,
          group: inventoryGroup(item.size),
          origin: "Purchase",
          sourcePurchaseId: purchaseRef.id,
          sourcePurchaseItemId: item.id,
          createdBy: edit
            ? existingInventoryByItemId.get(item.id)?.createdBy ||
              user?.uid ||
              ""
            : user?.uid || "",
          createdAt: edit
            ? existingInventoryByItemId.get(item.id)?.createdAt ||
              serverTimestamp()
            : serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: edit },
      ),
    );
    const activityRef = doc(db, "activityLog", crypto.randomUUID());
    tx.set(activityRef, {
      panel: "purchase",
      action: edit ? "edited" : "created",
      recordId: purchaseRef.id,
      purchaseId,
      partyName: payload.vendorName,
      amount: payload.amount,
      weight: payload.totalWeight,
      snapshot: {
        purchaseId,
        partyName: payload.vendorName,
        amount: payload.amount,
        weight: payload.totalWeight,
      },
      actor: {
        uid: user?.uid || "",
        accessId: user?.accessId || user?.email || "Unavailable",
        role: user?.role || "employee",
        name: user?.name || "",
      },
      accessIdSnapshot: user?.accessId || user?.email || "Unavailable",
      eventAtMs: now,
      createdAt: serverTimestamp(),
    });
    return { ...payload, id: purchaseRef.id };
  });
}

export async function deletePurchase({ purchaseId, user }) {
  const purchaseRef = doc(db, "purchases", purchaseId);
  return runTransaction(db, async (tx) => {
    const purchase = await tx.get(purchaseRef);
    if (!purchase.exists())
      throw new Error("This Purchase is no longer available.");
    const linkedInventory = await tx.get(linkedInventoryQuery(purchaseId));
    const challans = await tx.get(collection(db, "challans"));
    assertPurchaseIsUnlocked(purchaseId, linkedInventory.docs, challans.docs);
    linkedInventory.docs.forEach((entry) => tx.delete(entry.ref));
    tx.delete(purchaseRef);
    const record = purchase.data();
    tx.set(doc(db, "activityLog", crypto.randomUUID()), {
      panel: "purchase",
      action: "deleted",
      recordId: purchaseId,
      purchaseId: record.purchaseId,
      partyName: record.vendorName,
      amount: record.amount,
      weight: record.totalWeight,
      snapshot: {
        purchaseId: record.purchaseId,
        partyName: record.vendorName,
        amount: record.amount,
        weight: record.totalWeight,
      },
      actor: {
        uid: user?.uid || "",
        accessId: user?.accessId || user?.email || "Unavailable",
        role: user?.role || "employee",
        name: user?.name || "",
      },
      accessIdSnapshot: user?.accessId || user?.email || "Unavailable",
      eventAtMs: Date.now(),
      createdAt: serverTimestamp(),
    });
  });
}
