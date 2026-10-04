// Size identity is decimal text, not floating point. Remove insignificant zeros
// without rounding meaningful digits (including digits beyond Number precision).
// Invalid values remain invalid; callers retain their existing field errors.
const decimal = /^\d+(?:\.\d+)?$/;
const canonicalPart = (part) => {
  const [whole, fraction = ""] = part.split(".");
  const tail = fraction.replace(/0+$/, "");
  return whole.replace(/^0+(?=\d)/, "") + (tail ? `.${tail}` : "");
};
const textValue = (value) => {
  if (typeof value !== "number") return String(value ?? "").trim();
  if (!Number.isFinite(value)) return String(value);
  // Expand exponent notation only for actual legacy numbers, not form strings.
  const text = String(value);
  if (!/e/i.test(text) || value < 0) return text;
  const [mantissa, exponent] = text.toLowerCase().split("e");
  const [whole, fraction = ""] = mantissa.split(".");
  const digits = whole + fraction, point = whole.length + Number(exponent);
  return point <= 0 ? `0.${"0".repeat(-point)}${digits}`
    : point >= digits.length ? digits + "0".repeat(point - digits.length)
      : `${digits.slice(0, point)}.${digits.slice(point)}`;
};
export function normalizeSize(value) {
  // Only strings and finite numbers are legitimate persisted dimension types.
  // Arrays such as [5] must not become valid Size 5 through String coercion.
  if (value != null && !["string", "number"].includes(typeof value)) return "Invalid Size";
  const text = textValue(value), parts = text.split("X");
  return parts.length <= 2 && parts.every((part) => decimal.test(part))
    ? parts.map(canonicalPart).join("X") : text;
}
export function isValidSize(value, allowDimensions = false) {
  const parts = normalizeSize(value).split("X");
  return parts.length <= (allowDimensions ? 2 : 1)
    && parts.every((part) => decimal.test(part) && /[1-9]/.test(part));
}
export const sameSize = (left, right) => isValidSize(left, true)
  && isValidSize(right, true) && normalizeSize(left) === normalizeSize(right);
// Underscores delimit the existing SKU components. Reject ambiguous/path-unsafe
// components rather than silently repairing or assigning an owner.
export function inventoryIdentityErrors({ size, shape, type }) {
  const errors = [];
  if (!isValidSize(size, true)) errors.push("Size must contain positive finite decimal components in the supported format.");
  for (const [name, value] of [["Shape", shape], ["Type", type]]) {
    if (typeof value !== "string" || !value.trim()) errors.push(`${name} must be a nonempty string.`);
    // eslint-disable-next-line no-control-regex -- Reject control characters in physical identity components intentionally.
    else if (value !== value.trim() || /[/_\x00-\x1f\x7f]/.test(value)) errors.push(`${name} contains whitespace at its edges, a reserved delimiter or a control character.`);
  }
  if (!errors.length && new TextEncoder().encode(`${normalizeSize(size)}_${shape}_${type}`).length > 1500)
    errors.push("Canonical identity exceeds Firestore's document ID byte limit.");
  return errors;
}
export const canonicalSku = (row) => inventoryIdentityErrors(row).length
  ? "--" : `${normalizeSize(row.size)}_${row.shape}_${row.type}`;
export function canonicalSkuText(value) {
  const text = String(value ?? ""), split = text.indexOf("_");
  const size = text.slice(0, split).toUpperCase();
  return split > 0 && isValidSize(size, true)
    ? normalizeSize(size) + text.slice(split) : text;
}
// Keep document IDs and original SKUs: collisions must never choose/merge stock.
export const canonicalInventoryIdentity = (row) =>
  row.size !== undefined && row.shape && row.type ? canonicalSku(row) : canonicalSkuText(row.sku);
export const sizeMatchesSearch = (value, query) => {
  const asked = String(query ?? "").trim().toUpperCase();
  const size = normalizeSize(value);
  if (sameSize(value, asked)) return true;
  // Preserve existing partial-size search (21.4mm finds 21.45).
  return /^\d+(?:\.\d*)?(?:X\d+(?:\.\d*)?)?$/.test(asked)
    && isValidSize(value, true) && size.includes(normalizeSize(asked));
};
