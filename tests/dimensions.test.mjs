import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSize, isValidSize, sameSize, canonicalSku, canonicalInventoryIdentity } from "../src/utils/dimensions.js";
import { inventoryMatchesSearch, formatDecimal } from "../src/utils/inventoryRules.js";
import { purchaseItemErrors, validatePurchaseForm } from "../src/utils/purchaseValidation.js";
import { auditDimensions } from "../src/utils/dimensionAudit.js";
import { buildDashboardAnalytics } from "../src/utils/dashboardAnalytics.js";

for (const [a, b] of [[5,"5.0"],[5,"5.00"],["5.0","5.000"],["5.3","5.30"],["5.30","5.300"],["5.25","5.2500"],["0.3","0.30"],["5",5],["5.00",5.0]]) {
  test(`canonical equivalence ${JSON.stringify(a)} / ${JSON.stringify(b)}`, () => {
    assert(sameSize(a,b)); assert.equal(normalizeSize(a),normalizeSize(b));
  });
}
for (const [a,b] of [["5.3","5.03"],["5.25","5.2"],["5","5.1"],["5.125","5.13"],["5.123456789012345678901","5.123456789012345678902"]])
  test(`distinct precision ${a} / ${b}`, () => assert(!sameSize(a,b)));
test("preserve precision; expand mixed legacy numbers; dimensions follow existing toggle", () => {
  assert.equal(normalizeSize("0005.123456789012345678900"),"5.1234567890123456789");
  assert.equal(normalizeSize(1e-7),"0.0000001");
  assert.equal(normalizeSize("5.00X2.300"),"5X2.3");
  assert(isValidSize("5.00X2.00",true)); assert(!isValidSize("5X2",false)); assert(!isValidSize("5x2",true));
});
test("invalid input is never silently made valid", () => {
  for (const value of ["abc","5..3","--","",null,undefined,NaN,Infinity,-5,"-5","0","0.00","5.","1e2",{},[5],true,"0X5","5X0"])
    assert(!isValidSize(value,true), String(value));
  assert.equal(normalizeSize("5..3"),"5..3");
});
test("canonical SKU and legacy identity; preserve existing shape/type format", () => {
  for (const size of [5,"5.0","5.00"]) assert.equal(canonicalSku({size,shape:"PR",type:"CBD"}),"5_PR_CBD");
  assert.equal(canonicalInventoryIdentity({size:"5.00",shape:"PR",type:"CBD",sku:"5.00_PR_CBD"}),"5_PR_CBD");
});
test("Inventory / Check Inventory / Challan search retains text and SKU search", () => {
  for(const size of [5,"5.00"]) for(const query of ["5","5.00","5.000mm","5.00_PR_CBD","5_PR_CBD","PR","CBD"])
    assert(inventoryMatchesSearch({size,sku:`${size}_PR_CBD`,shape:"PR",type:"CBD"},query),query);
  assert(inventoryMatchesSearch({size:"21.450"},"21.4mm"));
  assert(!inventoryMatchesSearch({size:"5.03"},"5.3mm"));
  assert(inventoryMatchesSearch({size:"5X2",sku:"5X2_PR_CBD"},"5.00x2.00_pr_cbd"));
  assert(inventoryMatchesSearch({size:"5.00",shape:"PR",type:"CBD",sku:"5.00_PR_CBD"},"PR 5.00 CBD"));
  assert.equal(formatDecimal(5),"5.000");
});
const item=(size,id="line")=>({id,type:"CVD",shape:"Round",size,weight:1,pieces:1,box:""});
test("Purchase live validation clears Size error and canonical duplicates are detected", () => {
  assert(purchaseItemErrors(item("5..3")).size);
  assert.equal(purchaseItemErrors(item("5.00")).size,undefined);
  const form={items:[item("5"),item("5.00","other")]};
  assert.match(validatePurchaseForm(form).errors["items.line.size"],/another item row/);
  assert.match(validatePurchaseForm({items:[item("5")]},{inventory:[{...item("5.00"),id:"legacy",sku:"5.00_Round_CVD"}]}).errors["items.line.size"],/already exists/);
  assert.equal(validatePurchaseForm({items:[item("5.03")]},{inventory:[item("5.3")]}).errors["items.line.size"],undefined);
});
test("audit reports all physical collisions and references without mutation", () => {
  const data={inventory:[{id:"a",size:5,shape:"PR",type:"CBD",sku:"5_PR_CBD",weight:2},{id:"b",size:"5.00",shape:"PR",type:"CBD",sku:"5.00_PR_CBD",weight:3}],purchases:[{id:"p",items:[{inventoryId:"a"}]}],challans:[{id:"c",items:[{sourceInventoryId:"b"}]}]};
  const before=JSON.stringify(data), report=auditDimensions(data);
  assert.equal(report.collisions.length,1); assert.equal(report.collisions[0].canonicalSku,"5_PR_CBD");
  assert.deepEqual(report.collisions[0].records.map(row=>row.id),["a","b"]);
  assert.deepEqual(report.collisions[0].records[0].purchaseReferences,["p"]);
  assert.deepEqual(report.collisions[0].records[1].challanReferences,["c"]);
  assert.equal(report.indexPlan[0].recordId,null); assert.equal(JSON.stringify(data),before);
  data.inventory[1].size="5.3";
  assert.equal(auditDimensions(data).collisions.length,0);
});

test("Size grouping shares identity across mixed types and reacts to current values", () => {
  const now = new Date("2026-10-02T12:00:00").getTime();
  const rows = [5, "5.00"].map((size, index) => ({ id: `stock${index}`, shape: "PR", type: "CBD", size, weight: index + 2, createdAtMs: now }));
  const challans = [{ stage: 3, party: "Test", stage2Return: { transitionedAtMs: now, items: [{ inventoryId: "stock0", shape: "PR", type: "CBD", size: "5.000", issuedWeight: 3, soldWeight: 2, returnWeight: 1 }] } }];
  const analyze = () => buildDashboardAnalytics({ inventory: rows, challans, now, from: "2026-10-01", to: "2026-10-03" });
  const grouped = analyze();
  assert.equal(grouped.performance.length, 1);
  assert.equal(grouped.performance[0].key, "PR | 5 | CBD");
  assert.equal(grouped.performance[0].count, 2);
  assert.equal(grouped.currentStock, 5);
  rows[1].size = "5.30";
  assert.equal(analyze().performance[0].count, 1);
  assert.equal(analyze().currentStock, 5);
  assert.equal(rows.length, 2);
});
