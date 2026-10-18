import { discoverInventory } from "./inventoryDiscovery.js";
import { pieceValue } from "./pieces.js";
import { normalizeSize } from "./dimensions.js";
import { priceContext, refreshItemPrice, widthError } from "./masterPrices.js";
import {
  normalizeWeight,
  priceWeightedItem,
  stageOneTotals,
  weightMillis,
  wholePieces,
} from "./challanCalculations.js";

export const CHALLAN_IMPORT_HEADERS = [
  "Challan Ref",
  "Party",
  "Date",
  "Notes",
  "Inventory SKU",
  "Width",
  "Weight",
  "Pieces",
  "Price",
  "Discount %",
];
export const CHALLAN_IMPORT_SHEET = "Challans";
export const CHALLAN_IMPORT_FILENAME = "challan-import-template.xlsx";

export const canImportChallan = (page, editingId, canCreateStageOne) =>
  page === "create" && !editingId && canCreateStageOne;

const cellText = (value) => String(value ?? "").trim();
const issue = (rowNumber, message) => ({ rowNumber, message });
const availableRows = (inventory) => discoverInventory(inventory).matches;
const dateText = (value) => {
  if (value instanceof Date && !Number.isNaN(value.getTime()))
    return value.toISOString().slice(0, 10);
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    const date = new Date(Date.UTC(1899, 11, 30) + value * 86400000);
    return date.toISOString().slice(0, 10);
  }
  return cellText(value);
};
const validDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00Z");
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
};

function importedItem(raw, rowNumber, bySku, inventory, prices) {
  const sku = raw["Inventory SKU"];
  const matches = bySku.get(sku) || [];
  const selected = matches.length === 1 ? matches[0] : null;
  const identityErrors = [];
  if (sku && matches.length === 0) {
    const physicalMatches = inventory.filter((row) => row.sku === sku);
    identityErrors.push(
      physicalMatches.length
        ? "SKU " +
            sku +
            " exists but no eligible physical Inventory record is available for Challan issue."
        : "SKU " + sku + " does not exist in Inventory.",
    );
  }
  if (matches.length > 1)
    identityErrors.push(
      "SKU " + sku + " resolves to multiple physical Inventory records.",
    );
  let item = {
    importRowNumber: rowNumber,
    importIdentityError: identityErrors.join(" "),
    inventoryId: selected?.id || "",
    sku,
    width: raw.Width,
    shape: selected?.shape || "",
    size: selected ? normalizeSize(selected.size) : "",
    type: selected?.type || "",
    weight: raw.Weight,
    pieces: raw.Pieces,
    amount: "",
    discount: raw["Discount %"],
    priceSource: "master-auto",
  };
  if (selected) item = refreshItemPrice(item, prices);
  if (raw.Price !== "")
    item = {
      ...item,
      amount: raw.Price,
      priceSource: "manual",
      priceContext: priceContext(item),
      masterPriceId: "",
    };
  return item;
}

export function validateImportedStageOneRows(items, inventory) {
  if (!items.some((item) => item.importRowNumber)) return [];
  const eligible = new Set(availableRows(inventory).map((row) => row.id));
  const physical = new Map(inventory.map((row) => [row.id, row]));
  const selectedCounts = new Map();
  for (const item of items)
    if (item.inventoryId)
      selectedCounts.set(
        item.inventoryId,
        (selectedCounts.get(item.inventoryId) || 0) + 1,
      );
  const issues = [];
  for (const item of items) {
    if (!item.importRowNumber) continue;
    const rowNumber = item.importRowNumber;
    const sku = cellText(item.sku);
    if (item.importIdentityError)
      issues.push(issue(rowNumber, item.importIdentityError));
    if (!sku) issues.push(issue(rowNumber, "Inventory SKU is required."));
    const stock = physical.get(item.inventoryId);
    if (!stock || stock.sku !== sku)
      issues.push(
        issue(
          rowNumber,
          sku
            ? "SKU " +
                sku +
                " does not resolve uniquely to an available physical Inventory record."
            : "No Inventory item is selected.",
        ),
      );
    else if (!eligible.has(item.inventoryId))
      issues.push(
        issue(rowNumber, "SKU " + sku + " is unavailable for Challan issue."),
      );
    if (item.inventoryId && selectedCounts.get(item.inventoryId) > 1)
      issues.push(
        issue(
          rowNumber,
          "SKU " +
            sku +
            " selects the same physical Inventory item more than once in this Challan.",
        ),
      );
    const dimensionError = widthError(item.width);
    if (dimensionError)
      issues.push(issue(rowNumber, "SKU " + sku + ": " + dimensionError));
    let weight = null;
    try {
      weight = weightMillis(item.weight, "Weight");
      if (weight <= 0n) throw new Error("Weight must be greater than zero.");
      if (stock && weight > weightMillis(stock.weight ?? 0, "Available Weight"))
        issues.push(
          issue(
            rowNumber,
            "SKU " +
              sku +
              " has " +
              normalizeWeight(stock.weight ?? 0).toFixed(3) +
              " ct available; requested " +
              normalizeWeight(item.weight).toFixed(3) +
              " ct.",
          ),
        );
    } catch (error) {
      issues.push(issue(rowNumber, "SKU " + sku + ": " + error.message));
    }
    try {
      const pieces = wholePieces(
        item.pieces === "" ? 0 : item.pieces,
        "Pieces",
      );
      if (stock) {
        const available = wholePieces(
          stock.pieces ?? stock.quantity ?? stock.qty ?? 0,
          "Available Pieces",
        );
        if (pieces > available)
          issues.push(
            issue(
              rowNumber,
              "SKU " +
                sku +
                " has " +
                available +
                " Pieces available; requested " +
                pieces +
                ".",
            ),
          );
      }
    } catch (error) {
      issues.push(issue(rowNumber, "SKU " + sku + ": " + error.message));
    }
    if (item.amount === "")
      issues.push(
        issue(
          rowNumber,
          "SKU " +
            sku +
            ": Price is required; enter a per-carat rate or provide an exact Master Price.",
        ),
      );
    else {
      try {
        priceWeightedItem(
          weight !== null && weight > 0n ? item.weight : 1,
          item.amount,
          0,
        );
      } catch (error) {
        issues.push(issue(rowNumber, "SKU " + sku + ": " + error.message));
      }
    }
    try {
      priceWeightedItem(1, 0, item.discount);
    } catch (error) {
      issues.push(issue(rowNumber, "SKU " + sku + ": " + error.message));
    }
  }
  return issues;
}

export function parseChallanImport(matrix, inventory, prices) {
  const header = Array.isArray(matrix?.[0]) ? matrix[0].map(cellText) : [];
  if (JSON.stringify(header) !== JSON.stringify(CHALLAN_IMPORT_HEADERS))
    throw new Error(
      "Row 1: Headers must be exactly: " +
        CHALLAN_IMPORT_HEADERS.join(" | ") +
        ". Extra Stage 2/3/4 columns are not allowed.",
    );
  const bySku = new Map();
  for (const stock of availableRows(inventory)) {
    const matches = bySku.get(stock.sku) || [];
    matches.push(stock);
    bySku.set(stock.sku, matches);
  }
  const groups = [];
  const byRef = new Map();
  for (let index = 1; index < matrix.length; index++) {
    const values = Array.isArray(matrix[index]) ? matrix[index] : [];
    if (values.every((value) => cellText(value) === "")) continue;
    const rowNumber = index + 1;
    const raw = Object.fromEntries(
      CHALLAN_IMPORT_HEADERS.map((name, column) => [
        name,
        name === "Date" ? dateText(values[column]) : cellText(values[column]),
      ]),
    );
    const ref = raw["Challan Ref"];
    const key = ref || "__missing-row-" + rowNumber;
    let group = byRef.get(key);
    if (!group) {
      group = {
        ref,
        party: raw.Party,
        date: raw.Date,
        notes: raw.Notes,
        items: [],
        reasons: [],
        rowNumbers: [],
        status: "INVALID",
      };
      byRef.set(key, group);
      groups.push(group);
    } else {
      for (const [field, property] of [
        ["Party", "party"],
        ["Date", "date"],
        ["Notes", "notes"],
      ])
        if (raw[field] !== group[property])
          group.reasons.push(
            issue(
              rowNumber,
              "Conflicting " +
                field +
                " values within Challan Ref " +
                ref +
                ".",
            ),
          );
    }
    group.rowNumbers.push(rowNumber);
    if (!ref) group.reasons.push(issue(rowNumber, "Challan Ref is required."));
    if (
      values
        .slice(CHALLAN_IMPORT_HEADERS.length)
        .some((value) => cellText(value) !== "")
    )
      group.reasons.push(issue(rowNumber, "Unexpected extra column value."));
    group.items.push(importedItem(raw, rowNumber, bySku, inventory, prices));
  }
  if (!groups.length) throw new Error("Row 2: Add at least one Challan item.");
  const remaining = new Map(
    availableRows(inventory).map((row) => [
      row.id,
      {
        weight: weightMillis(row.weight ?? 0),
        pieces: pieceValue(row.pieces ?? row.quantity ?? row.qty ?? 0),
      },
    ]),
  );
  for (const group of groups) {
    if (!group.party)
      group.reasons.push(issue(group.rowNumbers[0], "Party is required."));
    if (!validDate(group.date))
      group.reasons.push(
        issue(group.rowNumbers[0], "Date must be a valid YYYY-MM-DD date."),
      );
    group.reasons.push(...validateImportedStageOneRows(group.items, inventory));
    if (group.reasons.length) continue;
    const requested = new Map();
    for (const item of group.items) {
      const current = requested.get(item.inventoryId) || {
        weight: 0n,
        pieces: 0,
        rowNumber: item.importRowNumber,
      };
      current.weight += weightMillis(item.weight);
      current.pieces += wholePieces(item.pieces === "" ? 0 : item.pieces);
      requested.set(item.inventoryId, current);
    }
    for (const [id, demand] of requested) {
      const stock = remaining.get(id);
      const sku = group.items.find((item) => item.inventoryId === id).sku;
      if (demand.weight > stock.weight)
        group.reasons.push(
          issue(
            demand.rowNumber,
            "Batch stock conflict for SKU " +
              sku +
              ": requested " +
              (Number(demand.weight) / 1000).toFixed(3) +
              " ct; remaining " +
              (Number(stock.weight) / 1000).toFixed(3) +
              " ct.",
          ),
        );
      if (demand.pieces > stock.pieces)
        group.reasons.push(
          issue(
            demand.rowNumber,
            "Batch stock conflict for SKU " +
              sku +
              ": requested " +
              demand.pieces +
              " Pieces; remaining " +
              stock.pieces +
              ".",
          ),
        );
    }
    if (group.reasons.length) continue;
    for (const [id, demand] of requested) {
      const stock = remaining.get(id);
      stock.weight -= demand.weight;
      stock.pieces -= demand.pieces;
    }
    group.status = "VALID";
    group.totals = stageOneTotals(group.items);
  }
  return {
    groups,
    validCount: groups.filter((group) => group.status === "VALID").length,
    invalidCount: groups.filter((group) => group.status === "INVALID").length,
  };
}

export function nextBulkChallanNumber(used) {
  for (let index = 0; index < 1000000; index++) {
    const number =
      "A" + (Math.floor(index / 100) + 1) + "/" + ((index % 100) + 1);
    if (!used.has(number)) return number;
  }
  throw new Error("No Challan numbers remain in the automatic series.");
}

export function prepareImportedStageOneRecord(group, number, user, id) {
  if (group.status !== "VALID")
    throw new Error("Only a Valid Challan can be imported.");
  const items = group.items.map((item) => {
    const clean = { ...item };
    delete clean.importRowNumber;
    delete clean.importIdentityError;
    const weight = normalizeWeight(item.weight, "Weight");
    return {
      ...clean,
      width: normalizeSize(item.width),
      weight,
      pieces: wholePieces(item.pieces === "" ? 0 : item.pieces, "Pieces"),
      ...priceWeightedItem(weight, item.amount, item.discount),
    };
  });
  const totals = stageOneTotals(items);
  return {
    id,
    number,
    party: group.party,
    date: group.date,
    notes: group.notes,
    items,
    amount: totals.amount,
    discountAmount: totals.discountAmount,
    netAmount: totals.netAmount,
    discount: totals.amount
      ? Number(((totals.discountAmount * 100) / totals.amount).toFixed(2))
      : 0,
    stage: 1,
    createdBy: user?.uid || "",
    createdByRole: user?.role || "staff",
  };
}
