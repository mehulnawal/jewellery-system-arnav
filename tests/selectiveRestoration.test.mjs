import test from "node:test";
import assert from "node:assert/strict";
import {
  settlementForRecord,
  matchesSettlementFilter,
} from "../src/utils/challanCalculations.js";
import {
  recordSettlementPayment,
  correctSettlement,
  initializeSettlement,
  settlementStatus,
} from "../src/utils/settlementPayments.js";
import { canEditChallan } from "../src/utils/challanEditWindow.js";
import { hasModulePermission } from "../src/auth/accessPolicy.js";
import { buildChallanPrint } from "../src/utils/challanPrint.js";
const actor = { uid: "admin", role: "superadmin", accessId: "Admin" };
const legacy = () => ({
  stage: 4,
  number: "A1/1",
  date: "2026-10-26",
  finalInvoice: { finalInvoiceAmount: 5000, items: [] },
  finalSettlement: {
    amountPaid: 3000,
    settlementDiscountAmount: 350,
    remaining: 0,
    completedAtMs: 123,
  },
});
const receipt = (row, paid, id) => ({
  ...row,
  ...recordSettlementPayment(row, paid, "", id, Date.now(), actor),
});
test("stale historical zero is recalculated and filters share the authoritative balance", () => {
  const row = legacy();
  assert.equal(settlementForRecord(row).remaining, 1650);
  assert.equal(settlementStatus(row), "Partially Paid");
  assert.equal(matchesSettlementFilter(row, "outstanding"), true);
  assert.equal(matchesSettlementFilter(row, "settled"), false);
  assert.equal(
    settlementForRecord({ finalSettlement: { remaining: 500 } }).remaining,
    500,
  );
  assert.equal(
    settlementForRecord({ finalSettlement: { remaining: -1 } }).remaining,
    null,
  );
  assert.equal(
    settlementForRecord({
      finalInvoice: { finalInvoiceAmount: 5000 },
      finalSettlement: {
        amountPaid: 3000,
        settlementDiscountAmount: "",
        remaining: 0,
      },
    }).remaining,
    2000,
  );
});
test("legacy carry-forward is captured once, new receipts are real entries and preserve timestamp", () => {
  const source = legacy(),
    next = receipt(source, "1000", "r1");
  assert.equal(source.settlementPayments, undefined);
  assert.equal(next.settlementOpening.amountPaid, 3000);
  assert.equal(next.settlementPayments.length, 1);
  assert.equal(next.settlementPayments[0].amountPaid, 1000);
  assert.equal(next.finalSettlement.amountPaid, 4000);
  assert.equal(next.finalSettlement.remaining, 650);
  assert.equal(next.finalSettlement.completedAtMs, 123);
  const final = receipt(next, "650", "r2");
  assert.equal(final.settlementPayments.length, 2);
  assert.equal(final.paymentSummary.paidCents, 465000);
  assert.equal(settlementStatus(final), "Fully Paid");
  assert.equal(matchesSettlementFilter(final, "settled"), true);
  assert.throws(() => receipt(next, "651", "over"), /outstanding/);
  assert.throws(() => receipt(next, "1", "r1"), /already/);
  const compatibilityOnly = legacy();
  delete compatibilityOnly.finalInvoice;
  compatibilityOnly.finalSettlement.finalInvoiceAmount = 5000;
  assert.equal(
    receipt(compatibilityOnly, "1000", "legacy-only").finalSettlement.remaining,
    650,
  );
});
test("settlement corrections adjust cumulative totals without rewriting or fabricating receipts", () => {
  const first = receipt(legacy(), "1000", "r1");
  const corrected = {
    ...first,
    ...correctSettlement(first, "3900", "300", "c1", Date.now(), actor),
  };
  assert.deepEqual(corrected.settlementPayments, first.settlementPayments);
  assert.equal(corrected.settlementCorrections.length, 1);
  assert.equal(corrected.settlementCorrections[0].paidDeltaCents, -10000);
  assert.equal(settlementForRecord(corrected).remaining, 800);
  const next = receipt(corrected, "800", "r2");
  assert.equal(next.finalSettlement.amountPaid, 4700);
  assert.equal(next.finalSettlement.remaining, 0);
  assert.equal(next.settlementCorrections.length, 1);
  const legacyCorrection = {
    ...legacy(),
    ...correctSettlement(legacy(), "2500", "350", "lc1", Date.now(), actor),
  };
  assert.equal(legacyCorrection.settlementPayments.length, 0);
  assert.equal(settlementForRecord(legacyCorrection).remaining, 2150);
  assert.throws(() =>
    correctSettlement(next, "6000", "0", "bad", Date.now(), actor),
  );
});
test("metadata-only legacy save synchronizes stale compatibility fields without a fake receipt/correction", () => {
  const update = initializeSettlement(legacy());
  assert.equal(update.finalSettlement.remaining, 1650);
  assert.equal(update.paymentSummary.remaining, 1650);
  assert.equal(update.settlementOpening.amountPaid, 3000);
  assert.equal(update.settlementPayments.length, 0);
  assert.equal(update.settlementCorrections, undefined);
});
test("only Stage 4 gains Admin exception; Staff timed ownership policy remains", () => {
  const now = Date.now(),
    day = 86400000;
  for (const role of ["admin", "superadmin"]) {
    const user = { uid: "other", role, permissions: [] };
    assert.equal(
      canEditChallan({ ...legacy(), createdBy: "staff" }, user, now),
      true,
    );
    assert.equal(hasModulePermission(user, "challan-stage-4"), true);
    for (const stage of [2, 3])
      assert.equal(
        canEditChallan(
          { stage, createdAt: new Date(now - 5 * day) },
          user,
          now,
        ),
        false,
      );
    if (role === "admin")
      assert.equal(hasModulePermission(user, "challan-stage-1"), false);
  }
  const staff = {
    uid: "staff",
    role: "employee",
    permissions: ["challan-stage-4"],
  };
  const row = {
    stage: 4,
    createdBy: "staff",
    createdByRole: "employee",
    stageHistory: { stage4: { enteredAtMs: now - 59 * 60000 } },
  };
  assert.equal(canEditChallan(row, staff, now), true);
  assert.equal(canEditChallan(row, staff, now + 60000), false);
});
test("all eight print copies use Customer Signature, physical spacing, endings and normalized debt", () => {
  for (const stage of [1, 2, 3, 4]) {
    const html = buildChallanPrint({
      ...legacy(),
      stage,
      items: [],
      stage2Return: { items: [] },
      notes: "Long note\n".repeat(100),
    });
    assert.equal((html.match(/Customer Signature/g) || []).length, 2);
    assert.equal((html.match(/class="copy-ending"/g) || []).length, 2);
    assert(!html.includes("Client Signature"));
    assert(html.includes("width:70mm"));
    assert(html.includes("padding-top:22mm"));
    assert(html.includes("page-break-inside:avoid"));
    assert(html.includes("size:A4"));
    assert(html.includes("26 10 2026"));
    if (stage === 4) {
      assert.equal((html.match(/Outstanding Amount:/g) || []).length, 2);
      assert(html.includes("1,650"));
    }
  }
});
