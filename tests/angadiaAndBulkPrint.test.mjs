import test from "node:test";
import assert from "node:assert/strict";
import {
  buildChallanPrint,
  buildChallanListPrint,
  angadiaServiceText,
} from "../src/utils/challanPrint.js";
import {
  stageOneEditSnapshot,
  sameStageOneEditSnapshot,
} from "../src/utils/challanEditSnapshot.js";

const record = (stage, flag) => ({
  stage,
  number: "B40/" + stage,
  party: "Test Party",
  date: "2026-10-26",
  items: [],
  angadiaService: flag,
  stage2Return: { items: [] },
  ...(stage === 4
    ? {
        finalInvoice: { finalInvoiceAmount: 15000, items: [] },
        finalSettlement: {
          amountPaid: 10000,
          settlementDiscountAmount: 0,
          remaining: 0,
        },
      }
    : {}),
});
test("Angadia defaults to No and appears on both print copies in every stage", () => {
  assert.equal(angadiaServiceText({}), "No");
  for (const stage of [1, 2, 3, 4])
    for (const flag of [false, true]) {
      const html = buildChallanPrint(record(stage, flag));
      assert.equal(
        (
          html.match(
            new RegExp(`Angadia Service:</strong> ${flag ? "Yes" : "No"}`, "g"),
          ) || []
        ).length,
        2,
      );
      assert.equal((html.match(/Customer Signature/g) || []).length, 2);
    }
});
test("mixed-stage and Stage 4 bulk prints include real outstanding, zero for paid and unavailable for unknown", () => {
  const partial = record(4, true);
  const paid = {
    ...record(4, false),
    number: "B40/5",
    finalSettlement: { amountPaid: 15000, settlementDiscountAmount: 0 },
  };
  for (const records of [
    [partial, paid],
    [record(1, false), record(2, true), record(3, false), partial, paid],
  ]) {
    const html = buildChallanListPrint(records);
    assert(html.includes("<th>Outstanding Amount</th>"));
    assert(html.includes("<th>Angadia Service</th>"));
    assert(html.includes("<td>Yes</td><td>&#8377;5,000</td>"));
    assert(html.includes("<td>No</td><td>&#8377;0</td>"));
    if (records.length > 2) assert(html.includes("<td>No</td><td>—</td>"));
  }
  assert(
    buildChallanListPrint([
      {
        ...record(4, false),
        finalInvoice: undefined,
        finalSettlement: undefined,
      },
    ]).includes("Unavailable"),
  );
  assert(buildChallanListPrint([]).includes('colspan="8"'));
  assert(
    buildChallanListPrint([
      { ...partial, party: '<script>alert("x")</script>' },
    ]).includes("&lt;script&gt;"),
  );
});
test("a concurrent Angadia change is detected before an older edit overwrites it", () => {
  const original = record(1, false);
  assert.equal(
    sameStageOneEditSnapshot(stageOneEditSnapshot(original), {
      ...original,
      angadiaService: true,
    }),
    false,
  );
  assert.equal(
    sameStageOneEditSnapshot(
      stageOneEditSnapshot({ ...original, angadiaService: undefined }),
      original,
    ),
    true,
  );
});
