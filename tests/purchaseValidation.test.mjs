import { test } from "node:test";
import assert from "node:assert/strict";
import { purchaseNumberError, validatePurchaseForm } from "../src/utils/purchaseValidation.js";
import { purchaseSaveError } from "../src/utils/purchaseErrors.js";

const form = () => ({ purchaseId: "PR-A125-100", date: "2026-09-29", vendorName: "Vendor", totalWeight: "2.5", amount: "100", discountChoice: "6", paymentDueDays: "2", items: [{ id: "row", type: "HP", shape: "Round", size: "2", weight: "2.5", pieces: "1", box: "" }] });
test("valid fields and optional broker/box; due date crosses a month", () => {
  const checked = validatePurchaseForm(form());
  assert.deepEqual(checked.errors, {});
  assert.equal(checked.dueDate, "2026-10-01");
  assert.equal(checked.discount, 6);
});
test("number format, range, leading zeros, duplicates and corrected number", () => {
  for (const number of ["", "PR-", "PR-B1-0", "PR-Z1-101", "PR-B1-01", "PR-A-1", "PR-Z1/1", " PR-B1-1", "PR-Z1-1\n", "PR-b1-1", "PR-AB1-1"]) assert.ok(purchaseNumberError(number), number);
  for (const number of ["PR-A1-1", "PR-B12-25", "PR-Z125-100"]) assert.equal(purchaseNumberError(number), "");
  const f = form(), options = { purchases: [{ id: "taken", purchaseId: f.purchaseId }] };
  assert.equal(validatePurchaseForm(f, options).errors.purchaseId, "This Purchase Number already exists.");
  assert.equal(validatePurchaseForm({ ...f, purchaseId: "PR-A1-2" }, options).errors.purchaseId, undefined);
});
test("each required field reports its own error and clears on correction", () => {
  for (const key of ["purchaseId", "date", "vendorName", "totalWeight", "amount", "discountChoice", "paymentDueDays"]) {
    assert.ok(validatePurchaseForm({ ...form(), [key]: "" }).errors[key], key);
    assert.equal(validatePurchaseForm(form()).errors[key], undefined);
  }
});
test("invalid numeric formats never coerce to valid input", () => {
  for (const key of ["totalWeight", "amount"]) for (const value of ["-1", "0", "NaN", "Infinity", "1e2", "1.2.3", " 1", ".", "1,"]) assert.ok(validatePurchaseForm({ ...form(), [key]: value }).errors[key], `${key}: ${value}`);
  for (const value of ["-1", "1.5", "1e2", "Infinity", " "]) assert.ok(validatePurchaseForm({ ...form(), paymentDueDays: value }).errors.paymentDueDays);
  for (const value of ["", "-1", "101", "foo"]) {
    const checked = validatePurchaseForm({ ...form(), discountChoice: "custom", customDiscount: value });
    assert.ok(checked.errors.customDiscount);
    assert.equal(checked.discount, null);
    assert.equal(checked.moneyValid, false);
  }
  assert.equal(validatePurchaseForm({ ...form(), discountChoice: "custom", customDiscount: "12.5" }).discount, 12.5);
});
test("every item field is independent, invalid values clear, BOX remains optional", () => {
  for (const [key, bad] of [["type", ""], ["type", "invalid"], ["shape", ""], ["size", "0"], ["size", "-1"], ["weight", "0"], ["weight", "-1"], ["pieces", ""], ["pieces", "1.5"], ["pieces", "-1"], ["box", "A?"]]) {
    const f = form(); f.items[0][key] = bad;
    assert.ok(validatePurchaseForm(f).errors[`items.row.${key}`], `${key}:${bad}`);
    assert.equal(validatePurchaseForm(form()).errors[`items.row.${key}`], undefined);
  }
  const f = form(); f.items[0].size = "4.3X2.0";
  assert.ok(validatePurchaseForm(f).errors["items.row.size"]);
  assert.equal(validatePurchaseForm(f, { allowDimensions: true }).errors["items.row.size"], undefined);
});
test("weight relationship updates on changes, row addition/removal and tolerance", () => {
  const f = form(); f.totalWeight = "3";
  assert.match(validatePurchaseForm(f).errors.totalWeight, /2.500 ct/);
  f.items.push({ ...f.items[0], id: "second", size: "3", weight: "0.5" });
  assert.equal(validatePurchaseForm(f).errors.totalWeight, undefined);
  f.items.pop(); assert.ok(validatePurchaseForm(f).errors.totalWeight);
  f.totalWeight = "2.5004"; assert.equal(validatePurchaseForm(f).errors.totalWeight, undefined);
  f.totalWeight = "2.5006"; assert.ok(validatePurchaseForm(f).errors.totalWeight);
  f.items[0].weight = "bad"; assert.equal(validatePurchaseForm(f).itemWeightsValid, false);
});
test("invalid date/days hides due date and corrections recalculate immediately", () => {
  for (const date of ["", "2026-02-30", "bad"]) assert.equal(validatePurchaseForm({ ...form(), date }).dueDate, "");
  assert.equal(validatePurchaseForm({ ...form(), paymentDueDays: "-1" }).dueDate, "");
  assert.equal(validatePurchaseForm({ ...form(), date: "2024-02-28", paymentDueDays: "1" }).dueDate, "2024-02-29");
});
test("legacy edit number and own stock retained; conflicting SKU owns size error", () => {
  const f = form(), original = { ...f, id: "existing", purchaseId: "PR-OLD", items: [{ ...f.items[0], inventoryId: "owned" }] };
  const options = { original, inventory: [{ id: "owned", sku: "2_Round_HP" }] };
  assert.deepEqual(validatePurchaseForm({ ...f, purchaseId: "PR-OLD" }, options).errors, {});
  assert.ok(validatePurchaseForm(f, options).errors.purchaseId);
  assert.ok(validatePurchaseForm(f, { inventory: options.inventory }).errors["items.row.size"]);
});
test("save errors distinguish number setup, permission and session failures", () => {
  assert.match(purchaseSaveError(new Error("Number setup is incomplete. An administrator needs to open Settings and select Register existing numbers once.")), /Register existing numbers/);
  assert.match(purchaseSaveError(new Error("Letter-series number setup is incomplete. An administrator needs to open Settings and select Register existing numbers once.")), /Register existing numbers/);
  assert.match(purchaseSaveError({ code: "permission-denied" }), /permission to create/);
  assert.match(purchaseSaveError({ code: "unauthenticated" }), /sign in again/);
});
