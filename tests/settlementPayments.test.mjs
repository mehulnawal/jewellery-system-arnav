import test from "node:test";
import assert from "node:assert/strict";
import {
  paymentProgress,
  settlementOutstanding,
  settlementStatus,
  recordSettlementPayment as record,
} from "../src/utils/settlementPayments.js";
import { buildDashboardAnalytics } from "../src/utils/dashboardAnalytics.js";
const actor = { uid: "admin", accessId: "Admin", role: "superadmin" };
const invoice = (amount = 15000) => ({
  id: "one",
  stage: 3,
  finalInvoice: { finalInvoiceAmount: amount },
  items: [],
});
const save = (source, paid, discount, id = "payment1") => ({
  ...source,
  ...record(source, paid, discount, id, Date.now(), actor),
});
test("Stage 4 status distinguishes outstanding, paid and historical missing balances", () => {
  const partial = save(invoice(), "10000", "");
  assert.equal(settlementOutstanding(partial), 5000);
  assert.equal(settlementStatus(partial), "Partially Paid");
  assert.equal(settlementStatus(save(partial, "5000", "", "p2")), "Fully Paid");
  assert.equal(settlementStatus({ stage: 4 }), "Settlement");
  assert.equal(
    settlementOutstanding({
      finalInvoice: { finalInvoiceAmount: 15000 },
      finalSettlement: { amountPaid: 10000, settlementDiscountAmount: 0 },
    }),
    5000,
  );
});

test("15000 invoice saves 10000 as part payment; reopening carries 5000 outstanding; final 5000 completes", () => {
  const original = invoice();
  const first = save(original, "10000", "");
  assert.equal(first.stage, 4);
  assert.equal(first.paymentSummary.remaining, 5000);
  assert.equal(first.finalSettlement.remaining, 5000);
  assert.equal(first.settlementPayments.length, 1);
  assert.equal(original.settlementPayments, undefined);
  const reopened = paymentProgress(first);
  assert.equal(reopened.previousPaid, 10000);
  assert.equal(reopened.remaining, 5000);
  const completed = save(first, "5000", "", "payment2");
  assert.equal(completed.stage, 4);
  assert.equal(completed.finalSettlement.amountPaid, 15000);
  assert.equal(completed.finalSettlement.remaining, 0);
  assert.equal(completed.settlementPayments.length, 2);
  assert.equal(
    completed.finalSettlement.completedAtMs,
    first.finalSettlement.completedAtMs,
  );
});
test("discount is explicit, cumulative, and never substitutes for missing payments", () => {
  const first = save(invoice(), "10000", "1000");
  assert.equal(first.paymentSummary.remaining, 4000);
  const completed = save(first, "4000", "", "payment2");
  assert.equal(completed.finalSettlement.amountPaid, 14000);
  assert.equal(completed.finalSettlement.settlementDiscountAmount, 1000);
  assert.equal(save(invoice(100), "0", "100").stage, 4);
});
test("money uses exact cents and no upward rounding in actual payment balances", () => {
  let current = save(invoice("0.30"), "0.10", "");
  assert.equal(current.paymentSummary.remaining, 0.2);
  current = save(current, "0.20", "", "p2");
  assert.equal(current.finalSettlement.amountPaid, 0.3);
  assert.equal(current.paymentSummary.paidCents, 30);
  assert.equal(save(invoice(0), "0", "").stage, 4);
});
test("invalid payments, overpayments, repeated IDs and completed Challans cannot double count", () => {
  for (const paid of ["-1", "bad", "0.001", "15001", "0"])
    assert.throws(() => save(invoice(), paid, ""));
  const first = save(invoice(), "10000", "");
  assert.throws(() => save(first, "10000", "", "p2"), /outstanding/);
  assert.throws(() => save(first, "1", "", "payment1"), /already recorded/);
  const complete = save(first, "5000", "", "p2");
  assert.throws(() => save(complete, "1", "", "p3"), /no longer/);
  assert.throws(
    () =>
      save(
        {
          ...invoice(),
          stage: 4,
          finalSettlement: { amountPaid: 15000, remaining: 0 },
        },
        "1",
        "",
        "p3",
      ),
    /no longer/,
  );
});
test("stale second payment recalculates against latest balance and Dashboard uses outstanding", () => {
  const first = save(invoice(), "10000", "");
  const second = save(first, "3000", "", "p2");
  assert.equal(second.paymentSummary.remaining, 2000);
  assert.throws(() => save(second, "5000", "", "p3"));
  const analytics = buildDashboardAnalytics({
    challans: [first],
    inventory: [],
    purchases: [],
  });
  assert.equal(analytics.stage[2].count, 0);
  assert.equal(analytics.stage[3].count, 1);
});
