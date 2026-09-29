import { isValidBox, isValidSize, normalizeBox } from "./inventoryRules.js";

const missing = (value) => value === undefined || value === null || String(value).trim() === "";
const decimal = (value) => !missing(value) && /^\d+(?:\.\d+)?$/.test(String(value)) && Number.isFinite(Number(value));
const whole = (value) => !missing(value) && /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value));
export const PURCHASE_WEIGHT_TOLERANCE = 0.0005;
export function purchaseNumberError(value) {
  if (!value || value === "PR-") return "Purchase Number is required.";
  if (!/^PR-A[0-9]+-[0-9]+$/.test(value) || /\s/.test(value))
    return "Purchase Number must follow the format PR-A{series}-{number}.";
  const number = value.split("-").at(-1);
  if (Number(number) < 1 || Number(number) > 100) return "Purchase number must be between 1 and 100.";
  if (number.length > 1 && number.startsWith("0")) return "The final Purchase number must not have leading zeros.";
  return "";
}
export const validPurchaseDate = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
export function purchaseDueDate(date, days) {
  if (!validPurchaseDate(date) || !whole(days)) return "";
  const due = new Date(Date.parse(`${date}T00:00:00Z`) + Number(days) * 86400000);
  return Number.isFinite(due.getTime()) && due.getUTCFullYear() <= 9999 ? due.toISOString().slice(0, 10) : "";
}
export function purchaseItemErrors(item, allowDimensions = false) {
  const errors = {};
  if (!item.type) errors.type = "Type is required.";
  else if (!["CVD", "HP"].includes(item.type)) errors.type = "Type must be CVD or HP.";
  if (missing(item.shape)) errors.shape = "Shape is required.";
  if (missing(item.size)) errors.size = "Size is required.";
  else if (String(item.size) !== String(item.size).trim() || !isValidSize(item.size, allowDimensions))
    errors.size = allowDimensions ? "Size must be positive, for example 4.3 or 4.3X2.0." : "Size must be a positive number, for example 4.3.";
  if (missing(item.weight)) errors.weight = "Weight is required.";
  else if (!decimal(item.weight) || !(Number(item.weight) > 0)) errors.weight = "Weight must be greater than 0. Use a valid decimal number.";
  if (missing(item.pieces)) errors.pieces = "Pieces is required.";
  else if (!whole(item.pieces)) errors.pieces = "Pieces must be a whole number of 0 or more.";
  if (!isValidBox(normalizeBox(item.box))) errors.box = "BOX must use letters followed by numbers, for example AB29. Leave it blank if not needed.";
  return errors;
}
export function validatePurchaseForm(form, { original = null, purchases = [], inventory = [], allowDimensions = false } = {}) {
  const errors = {};
  const set = (key, message) => { if (message) errors[key] = message; };
  if (!original || form.purchaseId !== original.purchaseId) {
    set("purchaseId", original ? "Purchase Number cannot be changed after creation." : purchaseNumberError(form.purchaseId));
    if (!errors.purchaseId && purchases.some((row) => row.id !== original?.id && row.purchaseId === form.purchaseId))
      errors.purchaseId = "This Purchase Number already exists.";
  }
  if (missing(form.date)) errors.date = "Date is required.";
  else if (!validPurchaseDate(form.date)) errors.date = "Enter a valid Purchase Date.";
  if (missing(form.vendorName)) errors.vendorName = "Vendor Name is required.";
  if (missing(form.totalWeight)) errors.totalWeight = "Total Purchase Weight is required.";
  else if (!decimal(form.totalWeight) || !(Number(form.totalWeight) > 0)) errors.totalWeight = "Total Purchase Weight must be greater than 0. Use a valid decimal number.";
  if (missing(form.amount)) errors.amount = "Amount is required.";
  else if (!decimal(form.amount) || !(Number(form.amount) > 0)) errors.amount = "Amount must be greater than 0. Use a valid decimal number.";
  const discountKey = form.discountChoice === "custom" ? "customDiscount" : "discountChoice";
  const discount = form.discountChoice === undefined ? form.discount : form.discountChoice === "custom" ? form.customDiscount : form.discountChoice;
  if (missing(discount)) errors[discountKey] = "Discount is required.";
  else if (!decimal(discount) || Number(discount) > 100) errors[discountKey] = "Discount must be a number between 0 and 100.";
  if (missing(form.paymentDueDays)) errors.paymentDueDays = "Payment Due Days is required.";
  else if (!whole(form.paymentDueDays)) errors.paymentDueDays = "Payment Due Days must be a whole number of 0 or more.";
  else if (!errors.date && !purchaseDueDate(form.date, form.paymentDueDays)) errors.paymentDueDays = "Payment Due Days is too large. Enter a smaller value.";

  const items = Array.isArray(form.items) ? form.items : [];
  if (!items.length) errors.items = "Add at least one Purchase item.";
  const owned = new Set((original?.items || []).map((item) => item.inventoryId));
  const skuCounts = new Map();
  const skuFor = (item) => `${String(item.size || "").trim()}_${String(item.shape || "").trim()}_${item.type}`;
  for (const item of items) skuCounts.set(skuFor(item), (skuCounts.get(skuFor(item)) || 0) + 1);
  let itemTotalWeight = 0, itemWeightsValid = items.length > 0;
  for (const item of items) {
    const rowErrors = purchaseItemErrors(item, allowDimensions);
    const sku = skuFor(item);
    if (!rowErrors.type && !rowErrors.shape && !rowErrors.size) {
      if (skuCounts.get(sku) > 1) rowErrors.size = "This Type, Shape and Size appears in another item row. Combine the quantities into one row.";
      else if (inventory.some((entry) => entry.sku === sku && !owned.has(entry.id))) rowErrors.size = "This Type, Shape and Size already exists in Inventory. Choose a different item.";
    }
    for (const [key, message] of Object.entries(rowErrors)) errors[`items.${item.id}.${key}`] = message;
    if (rowErrors.weight) itemWeightsValid = false;
    else itemTotalWeight += Number(item.weight);
  }
  const weightMismatch = !errors.totalWeight && itemWeightsValid && Math.abs(itemTotalWeight - Number(form.totalWeight)) > PURCHASE_WEIGHT_TOLERANCE;
  if (weightMismatch) errors.totalWeight = `Total Purchase Weight must match the item weight total. Current item total: ${itemTotalWeight.toFixed(3)} ct.`;
  return { errors, discount: errors[discountKey] ? null : Number(discount), itemTotalWeight, itemWeightsValid, weightMismatch,
    moneyValid: !errors.amount && !errors[discountKey],
    dueDate: errors.date || errors.paymentDueDays ? "" : purchaseDueDate(form.date, form.paymentDueDays),
  };
}
