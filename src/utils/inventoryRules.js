// Keep Round last. New shapes deliberately sort just before it.
import { canonicalSkuText, sameSize, sizeMatchesSearch } from "./dimensions.js";
export { normalizeSize, isValidSize } from "./dimensions.js";
export const SHAPE_ORDER = [
  "Pan",
  "Marquise",
  "Oval",
  "Emerlad",
  "Princess",
  "Cushion",
  "Radiant",
  "Choki",
  "Taper (Choki)",
  "Buget (Choki)",
  "Trillion",
];
export const DEFAULT_SHAPES = [...SHAPE_ORDER, "Round"];

// Canonical headers shared by the Inventory importer and the downloadable blank template.
export const INVENTORY_IMPORT_HEADERS = [
  "Type",
  "Shape",
  "Size (mm)",
  "Weight (ct)",
  "BOX",
];
export const INVENTORY_IMPORT_FIELD_HEADERS = {
  type: INVENTORY_IMPORT_HEADERS[0],
  shape: INVENTORY_IMPORT_HEADERS[1],
  size: INVENTORY_IMPORT_HEADERS[2],
  weight: INVENTORY_IMPORT_HEADERS[3],
  box: INVENTORY_IMPORT_HEADERS[4],
};

export const formatDecimal = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(3) : "";
};

export const normalizeBox = (value) =>
  String(value ?? "")
    .trim()
    .toUpperCase();
export const isValidBox = (value) => value === "" || /^[A-Z]+\d+$/.test(value);

export const sizeSortValue = (value) =>
  Number(String(value ?? "").split("X")[0]) || 0;
export const orderShapes = (shapes) =>
  [...new Set(shapes.filter(Boolean))].sort((a, b) => {
    const rank = (shape) => {
      if (shape === "Round") return Number.MAX_SAFE_INTEGER;
      if (shape === "Emerald") return SHAPE_ORDER.indexOf("Emerlad");
      return SHAPE_ORDER.indexOf(shape) === -1
        ? SHAPE_ORDER.length
        : SHAPE_ORDER.indexOf(shape);
    };
    return rank(a) - rank(b) || a.localeCompare(b);
  });

export const INVENTORY_SHAPES = orderShapes([...DEFAULT_SHAPES, "Pear", "Heart"]);

export const parseSizeQuery = (query) => {
  const normalized = String(query ?? "")
    .trim()
    .toLowerCase();
  const match = normalized.match(/^(\d+(?:\.\d+)?(?:x\d+(?:\.\d+)?)?)mm$/i);
  return match
    ? { sizeOnly: true, value: match[1].replace("x", "X") }
    : { sizeOnly: false, value: normalized };
};

export const numericMatches = (value, query) => {
  const valueParts = String(value ?? "").split("X");
  const queryParts = String(query ?? "")
    .trim()
    .toUpperCase()
    .split("X");
  if (
    valueParts.length !== queryParts.length ||
    !queryParts.every((part) => /^\d+(?:\.\d*)?$/.test(part))
  )
    return false;
  return valueParts.every((part, index) => {
    const number = Number(part);
    const asked = queryParts[index];
    return (
      Number.isFinite(number) &&
      (number === Number(asked) ||
        String(number).includes(asked) ||
        formatDecimal(number).includes(asked))
    );
  });
};

const searchWords = (value) => String(value ?? "").toLowerCase().replace(/\b(emrald|emerlad)\b/g, "emerald");
export const inventoryMatchesSearch = (item, query, { dimensionOnlyNumeric = false, exactSizeNumeric = false } = {}) => {
  const parsed = parseSizeQuery(query);
  if (!parsed.value) return true;
  if (parsed.sizeOnly) return exactSizeNumeric ? sameSize(item.size, parsed.value) : sizeMatchesSearch(item.size, parsed.value);
  const tokens = parsed.value.split(/[\s_]+/).filter(Boolean);
  if (tokens.length > 1) return tokens.every((token) => inventoryMatchesSearch(item, token, { dimensionOnlyNumeric: true, exactSizeNumeric }));
  if (dimensionOnlyNumeric && /^\d+(?:\.\d*)?(?:x\d+(?:\.\d*)?)?$/.test(parsed.value)) return exactSizeNumeric ? sameSize(item.size, parsed.value.toUpperCase()) : sizeMatchesSearch(item.size, parsed.value.toUpperCase());
  if ([item.shape, item.type, item.sku].some((value) => searchWords(value).includes(searchWords(parsed.value)))) return true;
  return (
    // Challan has historically supported phrases spanning SKU/Shape/Size/Type.
    // Retain that text search alongside canonical numeric identity matching.
    [item.sku, item.shape, item.size, item.type, item.weight]
      .map((value) => String(value ?? "")).join(" ").toLowerCase().includes(parsed.value) ||
    [item.shape, item.type, item.sku, item.group, item.box].some((value) =>
      String(value ?? "")
        .toLowerCase()
        .includes(parsed.value),
    ) ||
    canonicalSkuText(item.sku).toLowerCase().includes(canonicalSkuText(parsed.value).toLowerCase()) ||
    sizeMatchesSearch(item.size, parsed.value) ||
    numericMatches(item.weight, parsed.value)
  );
};
