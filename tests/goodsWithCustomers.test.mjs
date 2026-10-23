import test from "node:test";
import assert from "node:assert/strict";
import { dayKey } from "../src/utils/dashboardAnalytics.js";
import {
  buildGoodsWithCustomers as build,
  stageOneIssueDate,
  formatCustomerGoodsWeight,
} from "../src/utils/goodsWithCustomers.js";

const record = (id, weight, extra = {}) => ({
  id,
  number: `CH-${id}`,
  party: "Customer A",
  stage: 1,
  date: "2026-10-20",
  items: [{ sku: "ABC", inventoryId: "i1", weight }],
  ...extra,
});

test("local issue dates remain visible after IST midnight when UTC is still yesterday", () => {
  const now = new Date("2026-10-24T00:30:00+05:30").getTime();
  // Run with TZ=Asia/Kolkata to exercise the reported business-day boundary.
  if (new Date(now).getTimezoneOffset() !== -330) return;
  const today = dayKey(now);
  assert.equal(today, "2026-10-24");
  assert.equal(new Date(now).toISOString().slice(0, 10), "2026-10-23");
  assert.equal(
    build([record(1, 7, { date: today })], { from: today }).rows[0].carat,
    7,
  );
  assert.equal(
    build([record(1, 7, { date: "2026-10-23" })], { from: today }).rows.length,
    0,
  );
  assert.equal(
    build([record(1, 7, { date: "2026-10-23" })], { from: "2026-10-23" })
      .rows[0].carat,
    7,
  );
});
test("exact totals preserve all issues, customers, Challans and duplicate lines", () => {
  const result = build([
    record(1, 7),
    record(2, 3, { party: "Customer B" }),
    record(3, 4),
  ]);
  assert.equal(result.rows[0].carat, 14);
  assert.equal(result.rows[0].details.length, 3);
  assert.equal(result.rows[0].details[1].number, "CH-2");
  assert.equal(result.rows[0].details[1].customer, "Customer B");
  const duplicates = record(1, 0.1);
  duplicates.items.push({
    sku: "ABC",
    sourceInventoryId: "i1",
    weight: "0.200",
  });
  assert.equal(build([duplicates]).rows[0].carat, 0.3);
  assert.equal(build([duplicates]).rows[0].details.length, 2);
});
test("only explicit current Stage 1 is included", () => {
  assert.equal(
    build(
      [1, "1", 2, 3, 4, undefined, null, "bad", 0].map((stage, i) =>
        record(i, 1, { stage }),
      ),
    ).rows[0].carat,
    2,
  );
});
test("snapshot replacements reflect create, import, edit, delete and transition", () => {
  let records = [record(1, 7)];
  const total = () => build(records).rows[0]?.carat ?? 0;
  assert.equal(total(), 7);
  records = [...records, record(2, 3), record(3, 4)];
  assert.equal(total(), 14);
  records = [...records, record(4, 2), record(5, 1.5)];
  assert.equal(total(), 17.5);
  records[1] = record(2, 5);
  assert.equal(total(), 19.5);
  records = records.filter((r) => r.id !== 3);
  assert.equal(total(), 15.5);
  records[0] = { ...records[0], stage: 2 };
  assert.equal(total(), 8.5);
});
test("inclusive business dates filter totals and details together; unknown dates are explicit", () => {
  const records = [
    record(1, 7),
    record(2, 3, { date: "2026-10-21" }),
    record(3, 4, { date: "2026-10-23" }),
    record(4, 1, { date: "" }),
  ];
  const result = build(records, {
    from: "2026-10-20",
    to: "2026-10-21",
    search: "abc",
  });
  assert.equal(result.rows[0].carat, 10);
  assert.equal(result.rows[0].details.length, 2);
  assert.equal(result.undatedRecords, 1);
  assert.equal(build(records, { from: "2026-10-23" }).rows[0].carat, 4);
  assert.equal(build(records, { to: "2026-10-20" }).rows[0].carat, 7);
  assert.equal(build(records, { search: "pear" }).rows.length, 0);
});
test("date precedence and invalid legacy dates", () => {
  const stamp = new Date("2026-10-21T12:00:00").getTime();
  assert.equal(
    stageOneIssueDate({ date: "2026-10-20", createdAtMs: stamp }),
    "2026-10-20",
  );
  assert.equal(
    stageOneIssueDate({ stageHistory: { stage1: { enteredAtMs: stamp } } }),
    "2026-10-21",
  );
  assert.equal(
    stageOneIssueDate({ createdAt: { toMillis: () => stamp } }),
    "2026-10-21",
  );
  for (const date of ["2026-99-99", "2026-02-30", "nonsense", ""])
    assert.equal(stageOneIssueDate({ date }), "");
});
test("physical identity collisions remain separate and legacy SKU-only rows remain visible", () => {
  const records = [
    record(1, 2),
    record(2, 3, { items: [{ sku: "ABC", inventoryId: "i2", weight: 3 }] }),
    record(3, 1, { items: [{ sku: "ABC", weight: 1 }] }),
  ];
  assert.equal(build(records).rows.length, 3);
});
test("malformed weights/SKUs are omitted with notice, zero remains, shared rounding", () => {
  const items = [
    null,
    {},
    { sku: "ABC", weight: -1 },
    { sku: "ABC", weight: "bad" },
    { sku: "ABC", weight: 0 },
    { sku: "XYZ", weight: "1.2345" },
  ];
  const result = build([record(1, 1, { items })]);
  assert.equal(result.excludedItems, 4);
  assert.equal(result.rows.find((r) => r.sku === "ABC").carat, 0);
  assert.equal(result.rows.find((r) => r.sku === "XYZ").carat, 1.235);
  assert.equal(formatCustomerGoodsWeight(0), "0.000 ct");
});
test("100 Challans, deterministic ties, all sort options", () => {
  const records = Array.from({ length: 100 }, (_, i) =>
    record(i, "0.123", {
      items: [{ sku: i % 2 ? "XYZ" : "ABC", weight: "0.123" }],
    }),
  );
  assert.deepEqual(
    build(records).rows.map((r) => [r.sku, r.carat, r.details.length]),
    [
      ["ABC", 6.15, 50],
      ["XYZ", 6.15, 50],
    ],
  );
  assert.deepEqual(
    build(records, { sort: "sku-desc" }).rows.map((r) => r.sku),
    ["XYZ", "ABC"],
  );
  records.push(record(101, 9, { items: [{ sku: "ABC", weight: 9 }] }));
  assert.equal(build(records, { sort: "carat-asc" }).rows[0].sku, "XYZ");
  assert.equal(build(records, { sort: "sku-asc" }).rows[0].sku, "ABC");
});
