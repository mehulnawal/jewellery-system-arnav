import {
  moneyCents,
  fromCents,
  settlementForRecord,
} from "./challanCalculations.js";

const cents = (value, label, blankZero = false) =>
  moneyCents(value, label, { strict: true, blankZero });
export function settlementOutstanding(record) {
  return settlementForRecord(record)?.remaining ?? null;
}
export function settlementStatus(record) {
  const outstanding = settlementOutstanding(record);
  return outstanding === null
    ? "Settlement"
    : outstanding > 0
      ? "Partially Paid"
      : "Fully Paid";
}
export function paymentProgress(record, payment = "0", discount = "") {
  const invoice = cents(
    record.finalInvoice?.finalInvoiceAmount ??
      record.finalSettlement?.finalInvoiceAmount,
    "Final Invoice",
  );
  const history = record.settlementPayments ?? [];
  if (!Array.isArray(history))
    throw new Error(
      "Payment history is invalid. Please contact an administrator.",
    );
  const normalized = settlementForRecord(record, { strict: true });
  const paid = BigInt(normalized?.paidCents ?? 0);
  const deducted = BigInt(normalized?.discountCents ?? 0);
  const currentPayment = cents(payment, "Amount Paid", true);
  const currentDiscount = cents(discount, "Discount Amount", true);
  const remaining =
    invoice - paid - deducted - currentPayment - currentDiscount;
  if (remaining < 0n)
    throw new Error(
      "Payment plus discount cannot exceed the outstanding amount.",
    );
  return {
    finalInvoiceAmount: fromCents(invoice),
    previousPaid: fromCents(paid),
    previousDiscount: fromCents(deducted),
    outstandingBefore: fromCents(invoice - paid - deducted),
    currentPayment: fromCents(currentPayment),
    currentDiscount: fromCents(currentDiscount),
    amountPaid: fromCents(paid + currentPayment),
    settlementDiscountAmount: fromCents(deducted + currentDiscount),
    actualReceivedAmount: fromCents(paid + currentPayment),
    remaining: fromCents(remaining),
    invoiceCents: Number(invoice),
    paidCents: Number(paid + currentPayment),
    discountCents: Number(deducted + currentDiscount),
    remainingCents: Number(remaining),
  };
}

export function recordSettlementPayment(
  record,
  payment,
  discount,
  id,
  eventAtMs,
  actor,
) {
  if (!id || !actor?.uid || !Number.isSafeInteger(eventAtMs))
    throw new Error("Payment identity is missing.");
  if (
    ![3, 4].includes(Number(record.stage)) ||
    (Number(record.stage) === 4 && paymentProgress(record).remaining <= 0)
  )
    throw new Error("This Challan is no longer awaiting payment.");
  const history = record.settlementPayments ?? [];
  if (history.some((entry) => entry.id === id))
    throw new Error("This payment was already recorded.");
  const progress = paymentProgress(record, payment, discount);
  if (
    progress.currentPayment + progress.currentDiscount <= 0 &&
    progress.outstandingBefore > 0
  )
    throw new Error("Enter a payment or discount amount greater than zero.");
  const { currentPayment, currentDiscount } = progress;
  const summary = Object.fromEntries(
    [
      "finalInvoiceAmount",
      "amountPaid",
      "settlementDiscountAmount",
      "actualReceivedAmount",
      "remaining",
      "invoiceCents",
      "paidCents",
      "discountCents",
      "remainingCents",
    ].map((key) => [key, progress[key]]),
  );
  const entry = {
    id,
    eventAtMs,
    actor,
    amountPaid: currentPayment,
    discountAmount: currentDiscount,
    paidCents: Number(cents(payment, "Amount Paid", true)),
    discountCents: Number(cents(discount, "Discount Amount", true)),
  };
  return {
    stage: 4,
    settlementPayments: [...history, entry],
    paymentSummary: summary,
    ...openingState(record),
    finalSettlement: {
      ...summary,
      completedAtMs: record.finalSettlement?.completedAtMs ?? eventAtMs,
    },
  };
}

// A carry-forward is not a fabricated receipt. Capture legacy cumulative totals once.
function openingState(record) {
  if (record.settlementOpening || Array.isArray(record.settlementPayments))
    return {};
  const normalized = settlementForRecord(record, { strict: true });
  return {
    settlementOpening: {
      amountPaid: normalized?.amountPaid ?? 0,
      settlementDiscountAmount: normalized?.settlementDiscountAmount ?? 0,
      paidCents: normalized?.paidCents ?? 0,
      discountCents: normalized?.discountCents ?? 0,
    },
  };
}
export function initializeSettlement(record) {
  const normalized = settlementForRecord(record, { strict: true });
  if (!normalized || normalized.paidCents == null)
    throw new Error("Historical payment totals are unavailable.");
  const summary = Object.fromEntries(
    [
      "finalInvoiceAmount",
      "amountPaid",
      "settlementDiscountAmount",
      "actualReceivedAmount",
      "remaining",
      "invoiceCents",
      "paidCents",
      "discountCents",
      "remainingCents",
    ].map((key) => [key, normalized[key]]),
  );
  return {
    ...openingState(record),
    settlementPayments: record.settlementPayments || [],
    paymentSummary: summary,
    finalSettlement: {
      ...summary,
      ...(record.finalSettlement?.completedAtMs != null
        ? { completedAtMs: record.finalSettlement.completedAtMs }
        : {}),
    },
  };
}
export function correctSettlement(
  record,
  paid,
  discount,
  id,
  eventAtMs,
  actor,
) {
  if (
    Number(record.stage) !== 4 ||
    !actor?.uid ||
    !id ||
    !Number.isSafeInteger(eventAtMs)
  )
    throw new Error("This settlement is unavailable for correction.");
  if (record.settlementCorrections?.some((entry) => entry.id === id))
    throw new Error("This correction was already recorded.");
  const before = settlementForRecord(record, { strict: true });
  if (!before || before.paidCents == null)
    throw new Error("Historical payment totals are unavailable.");
  const next = {
    ...before,
    ...settlementForRecord(
      {
        finalInvoice: record.finalInvoice,
        finalSettlement: {
          finalInvoiceAmount: before.finalInvoiceAmount,
          amountPaid: paid,
          settlementDiscountAmount: discount === "" ? 0 : discount,
        },
      },
      { strict: true },
    ),
  };
  if (
    next.paidCents === before.paidCents &&
    next.discountCents === before.discountCents
  )
    throw new Error("No settlement amounts changed.");
  const correction = {
    id,
    eventAtMs,
    actor,
    paidDeltaCents: next.paidCents - before.paidCents,
    discountDeltaCents: next.discountCents - before.discountCents,
  };
  const completedAtMs = record.finalSettlement?.completedAtMs;
  const summary = Object.fromEntries(
    [
      "finalInvoiceAmount",
      "amountPaid",
      "settlementDiscountAmount",
      "actualReceivedAmount",
      "remaining",
      "invoiceCents",
      "paidCents",
      "discountCents",
      "remainingCents",
    ].map((key) => [key, next[key]]),
  );
  return {
    ...openingState(record),
    settlementPayments: record.settlementPayments || [],
    settlementCorrections: [
      ...(record.settlementCorrections || []),
      correction,
    ],
    paymentSummary: summary,
    finalSettlement: {
      ...summary,
      ...(completedAtMs != null ? { completedAtMs } : {}),
    },
  };
}
