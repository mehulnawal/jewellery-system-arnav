import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SHAPES, orderShapes, shapeName } from "../src/utils/shapes.js";
import { inventoryMatchesSearch } from "../src/utils/inventoryRules.js";
import {
  priceWeightedItem,
  stageTwoPriceItem,
  stageTwoPricedItems,
  invoiceFromStageTwo,
  sameStageTwoInvoiceSource,
} from "../src/utils/challanCalculations.js";
import { buildChallanPrint, printRupees } from "../src/utils/challanPrint.js";
const item = {
  sku: "3.2_Pear_CVD",
  inventoryId: "physical",
  shape: "Pan",
  type: "CVD",
  size: "3.2",
  weight: 6.23,
  pieces: 0,
  ...priceWeightedItem(6.23, 4851, 8),
};
const record = {
  stage: 1,
  number: "A35/1",
  date: "2026-10-21",
  party: "A <B>",
  items: [item],
};

test("one canonical shape list, legacy aliases deduplicate, future shapes before Round", () => {
  assert.deepEqual(DEFAULT_SHAPES, [
    "Pear",
    "Marquise",
    "Oval",
    "Emerald",
    "Princess",
    "Cushion",
    "Radiant",
    "Choki",
    "Tapper",
    "Bugget",
    "Trillion",
    "Round",
  ]);
  assert.deepEqual(
    orderShapes([
      ...DEFAULT_SHAPES,
      "Pan",
      "Emerlad",
      "Taper (Choki)",
      "Buget (Choki)",
      "Heart",
      "New Shape",
      "Pear",
    ]),
    [...DEFAULT_SHAPES.slice(0, -1), "New Shape", "Round"],
  );
  assert.equal(shapeName("Pan"), "Pear");
  assert.deepEqual(orderShapes(["Future Shape", "future shape", "Round"]), [
    "Future Shape",
    "Round",
  ]);
  assert(inventoryMatchesSearch(item, "pear"));
  assert.equal(item.shape, "Pan"); // Display/search normalization never rewrites stock.
});
test("only printed monetary amounts ceil; exact rupees, price and weights stay unchanged", () => {
  for (const [value, expected] of [
    [803.02, 804],
    [803.49, 804],
    [803.99, 804],
    [803, 803],
    [0, 0],
    [27803.99, 27804],
  ])
    assert.equal(printRupees(value), expected);
  const html = buildChallanPrint(record);
  assert(html.includes("4,851") === false); // Rate uses unchanged two-decimal text.
  assert(html.includes("4851.00"));
  assert(html.includes("6.230 ct"));
  assert(html.includes("27,804"));
});
test("Original/Duplicate share date, serial numbering, column totals and signature", () => {
  const html = buildChallanPrint({
    ...record,
    items: [
      item,
      {
        ...item,
        sku: "SECOND",
        weight: 5.92,
        ...priceWeightedItem(5.92, 4851, 8),
      },
    ],
  });
  assert.equal((html.match(/Customer Signature/g) || []).length, 2);
  assert.equal((html.match(/21 10 2026/g) || []).length, 2);
  assert.equal((html.match(/<td>1<\/td>/g) || []).length, 2);
  assert.equal((html.match(/<td>2<\/td>/g) || []).length, 2);
  assert(html.includes("<th>Total Amount</th>"));
  assert(html.includes("<th>Net Amount</th>"));
  assert(html.includes("54,225")); // 27,804 + 26,421 displayed row nets.
  assert(html.includes("12.150 ct"));
  assert(!html.includes("Type / CVD / HP"));
  assert(!html.includes("Original Amount"));
  assert(!html.includes("After Discount"));
  assert(!html.includes("Items:"));
  assert(html.includes("A &lt;B&gt;"));
});
const moved = {
  ...item,
  issuedPieces: 0,
  issuedWeight: 6.23,
  returnPieces: 0,
  returnWeight: 0,
  soldPieces: 0,
  soldWeight: 6.23,
};
test("Stage 2 negotiated rate changes final billing and preserves Stage 1 quote and movement", () => {
  const changed = stageTwoPriceItem(moved, "4500.25");
  assert.equal(changed.stage1QuotedRate, 4851);
  assert.equal(changed.amount, 4500.25);
  assert.equal(
    changed.netAmount,
    priceWeightedItem(6.23, 4500.25, 8).netAmount,
  );
  assert.equal(
    invoiceFromStageTwo([changed]).finalInvoiceAmount,
    changed.netAmount,
  );
  assert.equal(moved.amount, 4851);
  assert.equal(changed.returnWeight, 0);
  assert.equal(changed.soldWeight, 6.23);
  for (const bad of ["", "bad", -1, "1.234"])
    assert.throws(() => stageTwoPriceItem(moved, bad));
});
test("saved Stage 2 prices are used for print and billing; stale invoice review is detected", () => {
  const original = { ...record, stage: 2, stage2Return: { items: [moved] } };
  const next = { ...original, stage2Prices: { 0: 4000 } };
  assert.equal(stageTwoPricedItems(next)[0].amount, 4000);
  assert(
    !sameStageTwoInvoiceSource(
      stageTwoPricedItems(original),
      stageTwoPricedItems(next),
    ),
  );
  assert(buildChallanPrint(next).includes("4000.00"));
  assert.equal(next.items[0].amount, 4851);
});
