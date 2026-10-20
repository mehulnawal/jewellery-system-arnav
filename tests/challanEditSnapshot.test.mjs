import test from "node:test";
import assert from "node:assert/strict";
import {
  stageOneEditSnapshot,
  sameStageOneEditSnapshot,
} from "../src/utils/challanEditSnapshot.js";
import { priceWeightedItem } from "../src/utils/challanCalculations.js";

const stale = (original, latest) =>
  !sameStageOneEditSnapshot(stageOneEditSnapshot(original), latest);
const item = (overrides = {}) => ({
  id: "row-1",
  inventoryId: "stock-1",
  sourceInventoryId: "stock-1",
  sku: "5_Round_Ruby",
  shape: "Round",
  size: "5",
  type: "Ruby",
  width: null,
  weight: 1,
  pieces: 2,
  ...priceWeightedItem(1, 100, 5),
  priceSource: "saved",
  ...overrides,
});
const record = (overrides = {}) => ({
  id: "challan-1",
  stage: 1,
  number: "A35/1",
  party: "Alpha",
  date: "2026-10-20",
  notes: null,
  items: [item()],
  amount: 100,
  discountAmount: 5,
  netAmount: 95,
  ...overrides,
});
const changedItem = (original, changes) => ({
  ...original,
  items: [{ ...original.items[0], ...changes }],
});

test("normal Stage 1 edit compares original server state, not edited form", () => {
  const original = record();
  const editedForm = changedItem(original, { amount: 120, discount: 8 });
  assert.equal(stale(original, original), false);
  assert.equal(stale(original, editedForm), true);
});
test("Price-only local edit does not create a stale conflict", () => {
  const original = record();
  const form = changedItem(original, { amount: 120 });
  assert.equal(stale(original, original), false);
  assert.notDeepEqual(
    stageOneEditSnapshot(form),
    stageOneEditSnapshot(original),
  );
});
test("Discount-only local edit does not create a stale conflict", () => {
  const original = record();
  const form = changedItem(original, { discount: 10 });
  assert.equal(stale(original, original), false);
  assert.notDeepEqual(
    stageOneEditSnapshot(form),
    stageOneEditSnapshot(original),
  );
});
test("Weight-only local edit does not create a stale conflict", () => {
  const original = record();
  const form = changedItem(original, { weight: 1.1 });
  assert.equal(stale(original, original), false);
  assert.notDeepEqual(
    stageOneEditSnapshot(form),
    stageOneEditSnapshot(original),
  );
});
test("numeric, weight, money and Size representations compare equally", () => {
  const original = record();
  const latest = changedItem(original, {
    weight: "1.000",
    pieces: "2",
    size: 5,
    amount: "100.00",
    discount: "5.0",
  });
  assert.equal(stale(original, latest), false);
});
test("optional null, blank and undefined compare equally", () => {
  const original = record();
  const latest = changedItem(
    { ...original, notes: "", items: [item({ width: "" })] },
    { width: undefined },
  );
  assert.equal(stale(original, latest), false);
});
test("legacy record lacking financial snapshots remains comparable", () => {
  const legacy = record({
    items: [
      {
        ...item({
          pricingVersion: undefined,
          grossAmount: undefined,
          discountAmount: undefined,
          netAmount: undefined,
        }),
        amount: 100,
        discount: 5,
      },
    ],
  });
  const latest = changedItem(legacy, {
    grossAmount: 100,
    discountAmount: 5,
    netAmount: 95,
  });
  assert.equal(stale(legacy, latest), false);
});
test("real concurrent Weight change blocks", () => {
  const original = record();
  assert.equal(stale(original, changedItem(original, { weight: 1.1 })), true);
});
test("real concurrent Price change blocks", () => {
  const original = record();
  assert.equal(stale(original, changedItem(original, { amount: 120 })), true);
});
test("real concurrent Discount, Pieces, Party and item identity changes block", () => {
  const original = record();
  for (const latest of [
    changedItem(original, { discount: 7 }),
    changedItem(original, { pieces: 3 }),
    changedItem(original, { inventoryId: "stock-2" }),
    { ...original, party: "Beta" },
    { ...original, items: [...original.items, item({ id: "row-2" })] },
  ])
    assert.equal(stale(original, latest), true);
});
test("Stage 1 to Stage 2 advance blocks", () => {
  const original = record();
  assert.equal(stale(original, { ...original, stage: 2 }), true);
});
test("metadata and equivalent calculated values do not block", () => {
  const original = record();
  const latest = changedItem(
    { ...original, updatedAt: 123, loadedAt: 456 },
    {
      grossAmount: "100.00",
      netAmount: "95.00",
      discountAmount: "5.00",
      priceContext: "new display context",
      priceSource: "manual",
      uiSelected: true,
    },
  );
  assert.equal(stale(original, latest), false);
});
