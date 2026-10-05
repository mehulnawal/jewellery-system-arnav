import {
  normalizeSize,
  isValidSize,
  canonicalSku,
  inventoryIdentityErrors,
  sizeMatchesSearch,
} from "./dimensions.js";

export const MASTER_PRICE_HEADERS = [
  "Type",
  "Shape",
  "Height",
  "Width",
  "Price",
];
export const widthError = (value) =>
  value == null || (typeof value === "string" && value.trim() === "") || isValidSize(value)
    ? ""
    : "Width must be a positive decimal number.";
export function masterPriceErrors(row) {
  const errors = {};
  for (const field of ["type", "shape"]) {
    const label = field === "type" ? "Type" : "Shape";
    if (!row[field]?.trim?.()) errors[field] = `${label} is required.`;
    else if (
      inventoryIdentityErrors({
        size: "1",
        type: row.type || "Type",
        shape: row.shape || "Shape",
      }).some((message) => message.startsWith(label))
    )
      errors[field] =
        `${label} contains a reserved character or whitespace at its edges.`;
  }
  if (!isValidSize(row.height, true))
    errors.height = "Height must be a positive decimal dimension.";
  if (widthError(row.width)) errors.width = widthError(row.width);
  if (
    row.price === "" ||
    row.price == null ||
    !/^\d+(?:\.\d+)?$/.test(String(row.price)) ||
    !Number.isFinite(Number(row.price)) ||
    Number(row.price) <= 0
  )
    errors.price = "Price must be greater than 0.";
  // Challan's existing Price input uses a 0.01 financial step. Reject finer
  // monetary precision here instead of auto-filling a price that cannot save.
  // This money validation never limits Height/Width precision.
  else if (!/^\d+(?:\.\d{1,2}0*)?$/.test(String(row.price)))
    errors.price = "Price supports at most 2 decimal places.";
  if (!Object.keys(errors).length && !masterPriceKey(row))
    errors.height = "Master Price identity is too long.";
  return errors;
}
// Numeric canonicalization lives exclusively in dimensions.js. The explicit
// width sentinel distinguishes a height-only price from every numeric width.
export function masterPriceKey({ type, shape, height, size, width }) {
  const sku = canonicalSku({ type, shape, size: height ?? size });
  if (sku === "--" || widthError(width)) return "";
  const key = `${sku}__${normalizeSize(width) || "default"}`;
  return new TextEncoder().encode(key).length <= 1500 ? key : "";
}
export const canonicalMasterPrice = (row) => ({
  type: row.type,
  shape: row.shape,
  height: normalizeSize(row.height),
  width: normalizeSize(row.width),
  price: Number(row.price),
});
export const masterPriceLabel = (row) =>
  `${row.type} / ${row.shape} / Height ${normalizeSize(row.height)} / ${normalizeSize(row.width) ? `Width ${normalizeSize(row.width)}` : "Default"}`;
export const duplicatePriceMessage = (row) =>
  normalizeSize(row.width)
    ? `A Master Price already exists for ${masterPriceLabel(row)}.`
    : `A default Master Price already exists for ${row.type} / ${row.shape} / Height ${normalizeSize(row.height)}.`;
export function masterPriceMap(rows) {
  const map = new Map();
  for (const row of rows) {
    if (row.active === false) continue;
    const key = masterPriceLookupKey(row);
    if (key) map.set(key, map.has(key) ? null : row); // Never choose a legacy collision arbitrarily.
  }
  return map;
}
// Keep Firestore document IDs unchanged, while matching Inventory and Master
// Price Type/Shape regardless of how an older entry was capitalized.
export const masterPriceLookupKey = (row) => masterPriceKey({
  ...row,
  type: String(row.type ?? "").trim().toLowerCase(),
  shape: String(row.shape ?? "").trim().toLowerCase(),
});
export const priceContext = (item) =>
  `${item.inventoryId || ""}|${item.sku || ""}|${masterPriceKey(item) || `invalid:${item.width}`}`;
export function refreshItemPrice(item, prices) {
  const context = priceContext(item);
  if (
    item.priceContext === context &&
    ["manual", "saved"].includes(item.priceSource)
  )
    return item;
  const master =
    item.inventoryId && item.sku ? prices.get(masterPriceLookupKey(item)) : null;
  const amount = master ? String(master.price) : "";
  if (
    item.priceContext === context &&
    item.priceSource === "master-auto" &&
    item.amount === amount &&
    item.masterPriceId === (master?.id || "")
  )
    return item;
  return {
    ...item,
    priceContext: context,
    priceSource: "master-auto",
    amount,
    masterPriceId: master?.id || "",
  };
}
export const savedPriceItem = (item) => ({
  ...item,
  width: normalizeSize(item.width),
  priceContext: priceContext(item),
  priceSource: "saved",
});
export function matchesMasterSearch(row, search) {
  const query = search.trim().toLowerCase();
  return (
    !query ||
    [row.type, row.shape, row.price, row.width === "" ? "default" : ""].some(
      (value) => String(value).toLowerCase().includes(query),
    ) ||
    sizeMatchesSearch(row.height, query) ||
    sizeMatchesSearch(row.width, query) ||
    masterPriceLabel(row).toLowerCase().includes(query)
  );
}
export function previewMasterImport(rows, existing) {
  const used = new Set(
    existing.filter((row) => row.active !== false).map(masterPriceKey),
  );
  return rows.map((raw, index) => {
    const row = Object.fromEntries(
      MASTER_PRICE_HEADERS.map((header) => [
        header.toLowerCase(),
        raw[header] ?? "",
      ]),
    );
    row.type = String(row.type).trim();
    row.shape = String(row.shape).trim();
    const errors = masterPriceErrors(row),
      key = masterPriceKey(row);
    if (key && used.has(key)) errors.combination = duplicatePriceMessage(row);
    if (key) used.add(key);
    return {
      ...row,
      height: normalizeSize(row.height),
      width: normalizeSize(row.width),
      rowNumber: index + 2,
      errors,
    };
  });
}
