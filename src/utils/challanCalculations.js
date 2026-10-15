// Challan amounts use integer paise and weights use integer thousandths.
const decimal = (value, label) => {
  if (typeof value === "number" && !Number.isFinite(value))
    throw new Error(label + " must be a finite number.");
  const text = String(value ?? "").trim();
  if (!/^\d+(?:\.\d+)?$/.test(text))
    throw new Error(label + " must be a valid nonnegative number.");
  const [whole, fraction = ""] = text.split(".");
  return {
    whole,
    fraction,
    numerator: BigInt(whole + fraction),
    scale: 10n ** BigInt(fraction.length),
  };
};
const safeNumber = (units, divisor, label) => {
  if (
    units > BigInt(Number.MAX_SAFE_INTEGER) ||
    units < -BigInt(Number.MAX_SAFE_INTEGER)
  )
    throw new Error(label + " is too large.");
  return Number(units) / divisor;
};
const roundedUnits = (parts, places) => {
  const scale = 10n ** BigInt(places);
  return (parts.numerator * scale * 2n + parts.scale) / (parts.scale * 2n);
};
export const moneyCents = (
  value,
  label = "Amount",
  { strict = false, blankZero = false } = {},
) => {
  if (blankZero && (value === "" || value === null || value === undefined))
    return 0n;
  const parts = decimal(value, label);
  if (strict && parts.fraction.length > 2)
    throw new Error(label + " must have at most 2 decimal places.");
  return roundedUnits(parts, 2);
};
export const fromCents = (cents) => safeNumber(cents, 100, "Amount");
export const normalizeMoney = (value, label = "Amount") =>
  fromCents(moneyCents(value, label));
export const strictMoney = (value, label = "Amount") =>
  fromCents(moneyCents(value, label, { strict: true }));
export const weightMillis = (
  value,
  label = "Weight",
  { strict = false } = {},
) => {
  const parts = decimal(value, label);
  if (strict && parts.fraction.length > 3)
    throw new Error(label + " must have at most 3 decimal places.");
  return roundedUnits(parts, 3);
};
export const fromMillis = (millis) => safeNumber(millis, 1000, "Weight");
export const normalizeWeight = (value, label = "Weight") =>
  fromMillis(weightMillis(value, label));
export const strictWeight = (value, label = "Weight") =>
  fromMillis(weightMillis(value, label, { strict: true }));
export const wholePieces = (value, label = "Pieces") => {
  const parts = decimal(value, label);
  if (parts.fraction.length || !Number.isSafeInteger(Number(parts.whole)))
    throw new Error(label + " must be a whole number.");
  return Number(parts.whole);
};
const roundRatio = (numerator, denominator) => {
  if (denominator <= 0n)
    throw new Error("Issued Weight must be greater than zero.");
  return (numerator * 2n + denominator) / (denominator * 2n);
};
const percentParts = (value) => {
  const parts = decimal(
    value === "" || value == null ? 0 : value,
    "Discount %",
  );
  if (parts.numerator > 100n * parts.scale)
    throw new Error("Discount % must be between 0 and 100.");
  return parts;
};
const discountCents = (grossCents, percent) =>
  roundRatio(grossCents * percent.numerator, 100n * percent.scale);
export function priceItem(amount, discount = 0) {
  const gross = moneyCents(amount, "Amount", { strict: true });
  const percent = percentParts(discount);
  const deduction = discountCents(gross, percent);
  return {
    amount: fromCents(gross),
    discount: Number(discount),
    discountAmount: fromCents(deduction),
    netAmount: fromCents(gross - deduction),
  };
}
export function stageOneTotals(items) {
  let pieces = 0,
    weight = 0n,
    amount = 0n,
    discountAmount = 0n,
    netAmount = 0n;
  const selected = items.filter((row) => String(row.sku || "").trim());
  for (const item of selected) {
    const rowPieces = wholePieces(
      item.pieces === "" ? 0 : item.pieces,
      "Pieces",
    );
    const rowWeight = weightMillis(item.weight, "Weight");
    if (rowWeight <= 0n)
      throw new Error("Issued Weight must be greater than zero.");
    pieces += rowPieces;
    weight += rowWeight;
    const priced = priceItem(item.amount, item.discount);
    amount += moneyCents(priced.amount);
    discountAmount += moneyCents(priced.discountAmount);
    netAmount += moneyCents(priced.netAmount);
  }
  if (!Number.isSafeInteger(pieces))
    throw new Error("Total Pieces is too large.");
  return {
    itemCount: selected.length,
    pieces,
    weight: fromMillis(weight),
    amount: fromCents(amount),
    discountAmount: fromCents(discountAmount),
    netAmount: fromCents(netAmount),
  };
}
export function unchangedAdvancedStageOne(previousItems, nextItems) {
  return (
    Array.isArray(previousItems) &&
    previousItems.length === nextItems.length &&
    previousItems.every((item, index) => {
      const next = nextItems[index];
      return (
        (item.sourceInventoryId || item.inventoryId) === next.inventoryId &&
        item.sku === next.sku &&
        Number(item.weight) === next.weight &&
        Number(item.pieces) === next.pieces &&
        Number(item.amount) === next.amount &&
        Number(item.discount || 0) === next.discount &&
        (item.discountAmount == null ||
          Number(item.discountAmount) === next.discountAmount) &&
        (item.netAmount == null || Number(item.netAmount) === next.netAmount)
      );
    })
  );
}
// Compare only the ordered source values used for Stage 2 movement and pricing.
// Firestore map field order and derived/display metadata are not source changes.
export function sameStageOneReturnSource(reviewItems, liveItems) {
  if (
    !Array.isArray(reviewItems) ||
    !Array.isArray(liveItems) ||
    reviewItems.length !== liveItems.length
  )
    return false;
  try {
    return reviewItems.every((review, index) => {
      const live = liveItems[index];
      const reviewDiscount = percentParts(review.discount);
      const liveDiscount = percentParts(live.discount);
      return (
        String(review.sourceInventoryId || review.inventoryId || "") ===
          String(live.sourceInventoryId || live.inventoryId || "") &&
        String(review.sku || "") === String(live.sku || "") &&
        wholePieces(review.pieces) === wholePieces(live.pieces) &&
        weightMillis(review.weight) === weightMillis(live.weight) &&
        moneyCents(review.amount, "Amount", { strict: true }) ===
          moneyCents(live.amount, "Amount", { strict: true }) &&
        reviewDiscount.numerator * liveDiscount.scale ===
          liveDiscount.numerator * reviewDiscount.scale
      );
    });
  } catch {
    return false;
  }
}
export const updateReturnRows = (rows, id, key, value) =>
  rows.map((row) => (row.id === id ? { ...row, [key]: value } : row));
export function movementFor(item, returnPieces, returnWeight) {
  const issuedPieces = wholePieces(item.pieces, "Issued Pieces");
  const issuedMillis = weightMillis(item.weight, "Issued Weight");
  const returnedPieces = wholePieces(returnPieces, "Return Pieces");
  const returnedMillis = weightMillis(returnWeight, "Return Weight", {
    strict: true,
  });
  if (returnedPieces > issuedPieces || returnedMillis > issuedMillis)
    throw new Error("Return cannot exceed Issued quantity.");
  const soldPieces = issuedPieces - returnedPieces;
  const soldMillis = issuedMillis - returnedMillis;
  if (issuedMillis <= 0n)
    throw new Error("Issued Weight must be greater than zero.");
  // Manual Inventory can carry Weight with zero Pieces. In that case Pieces
  // remain zero while Weight moves independently through return and sale.
  if (
    issuedPieces > 0 &&
    ((returnedPieces === 0) !== (returnedMillis === 0n) ||
      (soldPieces === 0) !== (soldMillis === 0n))
  )
    throw new Error(
      "Return and Sold Pieces and Weight must both be zero or both be positive.",
    );
  return {
    issuedPieces,
    issuedWeight: fromMillis(issuedMillis),
    returnPieces: returnedPieces,
    returnWeight: fromMillis(returnedMillis),
    soldPieces,
    soldWeight: fromMillis(soldMillis),
  };
}
export function stageTwoTotals(items, returns) {
  if (items.length !== returns.length)
    throw new Error("Return rows do not match issued items.");
  const movements = items.map((item, index) =>
    movementFor(item, returns[index].returnPieces, returns[index].returnWeight),
  );
  const result = {
    issuedPieces: 0,
    issuedWeight: 0n,
    returnPieces: 0,
    returnWeight: 0n,
    soldPieces: 0,
    soldWeight: 0n,
  };
  for (const row of movements) {
    result.issuedPieces += row.issuedPieces;
    result.issuedWeight += weightMillis(row.issuedWeight);
    result.returnPieces += row.returnPieces;
    result.returnWeight += weightMillis(row.returnWeight);
    result.soldPieces += row.soldPieces;
    result.soldWeight += weightMillis(row.soldWeight);
  }
  if (
    !Number.isSafeInteger(result.issuedPieces) ||
    !Number.isSafeInteger(result.returnPieces) ||
    !Number.isSafeInteger(result.soldPieces)
  )
    throw new Error("Movement Pieces total is too large.");
  return {
    issuedPieces: result.issuedPieces,
    issuedWeight: fromMillis(result.issuedWeight),
    returnPieces: result.returnPieces,
    returnWeight: fromMillis(result.returnWeight),
    soldPieces: result.soldPieces,
    soldWeight: fromMillis(result.soldWeight),
  };
}
const verifiedSavedMovement = (item) => {
  const movement = movementFor(
    { pieces: item.issuedPieces, weight: item.issuedWeight },
    item.returnPieces,
    fromMillis(weightMillis(item.returnWeight, "Return Weight")),
  );
  if (
    (item.soldPieces !== undefined &&
      wholePieces(item.soldPieces, "Sold Pieces") !== movement.soldPieces) ||
    (item.soldWeight !== undefined &&
      weightMillis(item.soldWeight, "Sold Weight") !==
        weightMillis(movement.soldWeight))
  )
    throw new Error("Saved sold history disagrees with Issued minus Return.");
  return movement;
};
export function invoiceReviewRows(items) {
  if (!Array.isArray(items) || !items.length)
    throw new Error("This Stage 2 Challan has no return/sale item history.");
  return items.map((item) => {
    const movement = verifiedSavedMovement(item);
    const pricing = priceItem(item.amount, item.discount);
    const billingMode =
      movement.soldWeight === 0
        ? "full-return"
        : movement.returnWeight === 0
          ? "full-sold"
          : "partial-return";
    return {
      ...item,
      ...movement,
      amount: pricing.amount,
      discount: pricing.discount,
      billingMode,
      stage1DiscountPercent: pricing.discount,
      stage1DiscountAmount: pricing.discountAmount,
      stage1NetAmount: pricing.netAmount,
    };
  });
}
export function invoiceFromStageTwo(items, partialFinalAmounts = []) {
  const reviewed = invoiceReviewRows(items);
  let originalTotal = 0n,
    discountTotal = 0n,
    finalTotal = 0n;
  const invoiceItems = reviewed.map((item, index) => {
    const net = moneyCents(item.stage1NetAmount);
    let finalCents = item.billingMode === "full-return" ? 0n : net;
    if (item.billingMode === "partial-return") {
      finalCents = moneyCents(
        partialFinalAmounts[index],
        "Final Billed Amount",
        { strict: true },
      );
      if (finalCents > net)
        throw new Error(
          "Final Billed Amount cannot exceed the Stage 1 Net Amount.",
        );
    }
    originalTotal += moneyCents(item.amount);
    discountTotal += moneyCents(item.stage1DiscountAmount);
    finalTotal += finalCents;
    return {
      ...item,
      grossAmount: item.amount,
      finalAmount: fromCents(finalCents),
    };
  });
  return {
    items: invoiceItems,
    calculationVersion: "manual-partial-v1",
    grossAmount: fromCents(originalTotal),
    stage1DiscountAmount: fromCents(discountTotal),
    stage1NetAmount: fromCents(originalTotal - discountTotal),
    finalInvoiceAmount: fromCents(finalTotal),
  };
}
export function sameStageTwoInvoiceSource(reviewItems, liveItems) {
  if (
    !Array.isArray(reviewItems) ||
    !Array.isArray(liveItems) ||
    reviewItems.length !== liveItems.length
  )
    return false;
  try {
    return reviewItems.every((review, index) => {
      const live = liveItems[index];
      const a = invoiceReviewRows([review])[0];
      const b = invoiceReviewRows([live])[0];
      const aDiscount = percentParts(review.discount);
      const bDiscount = percentParts(live.discount);
      return (
        String(review.sourceInventoryId || review.inventoryId || "") ===
          String(live.sourceInventoryId || live.inventoryId || "") &&
        String(review.sku || "") === String(live.sku || "") &&
        a.issuedPieces === b.issuedPieces &&
        weightMillis(a.issuedWeight) === weightMillis(b.issuedWeight) &&
        a.returnPieces === b.returnPieces &&
        weightMillis(a.returnWeight) === weightMillis(b.returnWeight) &&
        moneyCents(review.amount, "Amount", { strict: true }) ===
          moneyCents(live.amount, "Amount", { strict: true }) &&
        aDiscount.numerator * bDiscount.scale ===
          bDiscount.numerator * aDiscount.scale
      );
    });
  } catch {
    return false;
  }
}
export function challanStockRestoration(record) {
  const stage = Number(record?.stage);
  if (
    ![1, 2, 3, 4].includes(stage) ||
    !Array.isArray(record.items) ||
    !record.items.length
  )
    throw new Error(
      "Challan stock history is incomplete; deletion was cancelled.",
    );
  const returned = record.stage2Return?.items;
  if (
    stage > 1 &&
    (!Array.isArray(returned) || returned.length !== record.items.length)
  )
    throw new Error(
      "Challan return history is incomplete; deletion was cancelled.",
    );
  const items = record.items.map((issued, index) => {
    const inventoryId = issued.sourceInventoryId || issued.inventoryId;
    if (!inventoryId || typeof inventoryId !== "string")
      throw new Error(
        "Linked Inventory identity is missing; deletion was cancelled.",
      );
    const issuedPieces = wholePieces(issued.pieces ?? 0, "Issued Pieces");
    const issuedWeight = weightMillis(issued.weight, "Issued Weight");
    if (issuedWeight <= 0n)
      throw new Error("Issued Weight is invalid; deletion was cancelled.");
    let pieces = issuedPieces,
      weight = issuedWeight;
    if (stage > 1) {
      const row = returned[index];
      if (
        (row.sourceInventoryId || row.inventoryId) !== inventoryId ||
        row.sku !== issued.sku ||
        wholePieces(row.issuedPieces, "Issued Pieces") !== issuedPieces ||
        weightMillis(row.issuedWeight, "Issued Weight") !== issuedWeight
      )
        throw new Error(
          "Challan issue and return history disagree; deletion was cancelled.",
        );
      const movement = verifiedSavedMovement(row);
      pieces = movement.soldPieces;
      weight = weightMillis(movement.soldWeight);
    }
    return {
      inventoryId,
      sku: issued.sku || "",
      pieces,
      weight: fromMillis(weight),
    };
  });
  const totalPieces = items.reduce((sum, item) => sum + item.pieces, 0);
  if (!Number.isSafeInteger(totalPieces))
    throw new Error("Restored Pieces are too large.");
  return {
    items,
    totalPieces,
    totalWeight: fromMillis(
      items.reduce((sum, item) => sum + weightMillis(item.weight), 0n),
    ),
  };
}
export function settlementFor(invoiceAmount, paid, discount = "") {
  const invoice = moneyCents(invoiceAmount, "Final Invoice", { strict: true });
  const payment = moneyCents(paid, "Amount Paid", { strict: true });
  const deduction = moneyCents(discount, "Settlement Discount", {
    strict: true,
    blankZero: true,
  });
  return {
    finalInvoiceAmount: fromCents(invoice),
    amountPaid: fromCents(payment),
    settlementDiscountAmount: fromCents(deduction),
    remaining: fromCents(invoice - payment - deduction),
    actualReceivedAmount: fromCents(payment),
  };
}
