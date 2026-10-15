import test from "node:test";
import assert from "node:assert/strict";
import {
  priceItem,
  normalizeWeight,
  strictWeight,
  wholePieces,
  stageOneTotals,
  movementFor,
  stageTwoTotals,
  invoiceFromStageTwo,
  settlementFor,
  updateReturnRows,
  unchangedAdvancedStageOne,
  sameStageOneReturnSource,
  sameStageTwoInvoiceSource,
  invoiceReviewRows,
  challanStockRestoration,
} from "../src/utils/challanCalculations.js";

test("money discounts and cent boundaries use integer paise", () => {
  for (const [rate, discount, net] of [
    [0, 0, 1000],
    [6, 60, 940],
    [7, 70, 930],
    [8, 80, 920],
    [12.5, 125, 875],
    [100, 1000, 0],
  ]) {
    const result = priceItem("1000", String(rate));
    assert.equal(result.discountAmount, discount);
    assert.equal(result.netAmount, net);
  }
  assert.equal(priceItem("0.05", "10").discountAmount, 0.01);
  assert.equal(priceItem("0.04", "10").discountAmount, 0);
  assert.equal(priceItem("90000000000.99", "7").netAmount, 83700000000.92);
  for (const discount of ["101", "-1", "bad"])
    assert.throws(() => priceItem("1000", discount));
  for (const amount of ["bad", "-1", "1.001", "", "Infinity"])
    assert.throws(() => priceItem(amount, 0));
});

test("Weight normalizes at the fourth digit and never rounds to two digits", () => {
  for (const [input, expected] of [
    ["9", 9],
    ["9.4", 9.4],
    ["9.45", 9.45],
    ["9.456", 9.456],
    ["9.4564", 9.456],
    ["9.4565", 9.457],
    ["9.4569", 9.457],
    ["5.123", 5.123],
    ["0.001", 0.001],
  ])
    assert.equal(normalizeWeight(input), expected);
  assert.throws(() => strictWeight("9.4565"), /3 decimal/);
  assert.equal(strictWeight("9.456"), 9.456);
  assert.equal(
    movementFor({ pieces: 1, weight: "9.4565" }, 0, 0).issuedWeight,
    9.457,
  );
});

test("Pieces stay whole; movement conserves both quantities", () => {
  for (const bad of ["1.5", "-1", "", "bad"])
    assert.throws(() => wholePieces(bad));
  const item = { pieces: 10, weight: 5 };
  assert.deepEqual(movementFor(item, "0", "0"), {
    issuedPieces: 10,
    issuedWeight: 5,
    returnPieces: 0,
    returnWeight: 0,
    soldPieces: 10,
    soldWeight: 5,
  });
  assert.deepEqual(movementFor(item, "5", "2.375"), {
    issuedPieces: 10,
    issuedWeight: 5,
    returnPieces: 5,
    returnWeight: 2.375,
    soldPieces: 5,
    soldWeight: 2.625,
  });
  assert.deepEqual(movementFor(item, "10", "5"), {
    issuedPieces: 10,
    issuedWeight: 5,
    returnPieces: 10,
    returnWeight: 5,
    soldPieces: 0,
    soldWeight: 0,
  });
  for (const [pieces, weight] of [
    ["11", "5"],
    ["1", "5.001"],
    ["0", "0.001"],
    ["10", "0"],
    ["5", "0"],
    ["5", "5"],
    ["1.5", "1"],
    ["1", "1.0004"],
  ])
    assert.throws(() => movementFor(item, pieces, weight));
});

const invoiceRow = (
  amount,
  discount,
  pieces,
  weight,
  returnedPieces,
  returnedWeight,
) => ({
  sku: "stock",
  amount,
  discount,
  issuedPieces: pieces,
  issuedWeight: weight,
  returnPieces: returnedPieces,
  returnWeight: returnedWeight,
});

test("invoice uses locked net for full sale, zero for full return, and Admin amount for partial", () => {
  const none = invoiceFromStageTwo([invoiceRow(1000, 7, 10, 5, 0, 0)]);
  assert.equal(none.finalInvoiceAmount, 930);
  assert.equal(none.items[0].billingMode, "full-sold");
  const partialRow = invoiceRow(1000, 6, 10, 5, 5, 2.5);
  assert.equal(
    invoiceReviewRows([partialRow])[0].billingMode,
    "partial-return",
  );
  assert.throws(() => invoiceFromStageTwo([partialRow]), /Final Billed Amount/);
  assert.equal(
    invoiceFromStageTwo([partialRow], ["400"]).finalInvoiceAmount,
    400,
  );
  assert.equal(
    invoiceFromStageTwo([partialRow], ["400.50"]).finalInvoiceAmount,
    400.5,
  );
  for (const bad of ["400.555", "-1", "bad", "940.01"]) {
    assert.throws(() => invoiceFromStageTwo([partialRow], [bad]));
  }
  const full = invoiceFromStageTwo([invoiceRow(1000, 6, 10, 5, 10, 5)]);
  assert.equal(full.items[0].finalAmount, 0);
  assert.equal(full.finalInvoiceAmount, 0);
  const mixed = invoiceFromStageTwo(
    [
      invoiceRow(1000, 6, 10, 5, 0, 0),
      invoiceRow(2500, 8, 10, 5, 5, 2.5),
      invoiceRow(700, 7, 2, 1, 2, 1),
    ],
    [undefined, "1200.50"],
  );
  assert.equal(mixed.grossAmount, 4200);
  assert.equal(mixed.stage1DiscountAmount, 309);
  assert.deepEqual(
    mixed.items.map((row) => row.finalAmount),
    [940, 1200.5, 0],
  );
  assert.equal(mixed.finalInvoiceAmount, 2140.5);
});
test("Stage 1 totals count only selected rows", () => {
  const rows = [
    { sku: "A", pieces: "10", weight: "5.125", amount: "1000", discount: "6" },
    { sku: "B", pieces: "7", weight: "2.375", amount: "2500", discount: "8" },
    { sku: "", pieces: "99", weight: "99", amount: "99999", discount: "0" },
  ];
  assert.deepEqual(stageOneTotals(rows), {
    itemCount: 2,
    pieces: 17,
    weight: 7.5,
    amount: 3500,
    discountAmount: 260,
    netAmount: 3240,
  });
  assert.deepEqual(stageOneTotals([{ ...rows[0], pieces: 0 }]), {
    itemCount: 1,
    pieces: 0,
    weight: 5.125,
    amount: 1000,
    discountAmount: 60,
    netAmount: 940,
  });
  assert.throws(
    () => stageOneTotals([{ ...rows[0], weight: 0 }]),
    /greater than zero/,
  );
});

test("weight-only manual Inventory retains zero Pieces through issue, return, sale, and invoice", () => {
  const item = {
    sku: "MANUAL",
    pieces: 0,
    weight: "5.000",
    amount: "1000",
    discount: "6",
  };
  assert.equal(stageOneTotals([item]).pieces, 0);
  assert.equal(stageOneTotals([{ ...item, pieces: "" }]).pieces, 0);
  assert.throws(() => movementFor(item, "", "0"), /Return Pieces/);
  const noReturn = movementFor(item, "0", "0");
  assert.deepEqual(
    [noReturn.returnPieces, noReturn.soldPieces, noReturn.soldWeight],
    [0, 0, 5],
  );
  const partial = movementFor(item, "0", "2.500");
  assert.deepEqual(
    [
      partial.returnPieces,
      partial.returnWeight,
      partial.soldPieces,
      partial.soldWeight,
    ],
    [0, 2.5, 0, 2.5],
  );
  const full = movementFor(item, "0", "5.000");
  assert.deepEqual(
    [full.returnPieces, full.soldPieces, full.soldWeight],
    [0, 0, 0],
  );
  const stageTwo = stageTwoTotals(
    [item],
    [{ returnPieces: "0", returnWeight: "2.500" }],
  );
  assert.deepEqual(
    [stageTwo.issuedPieces, stageTwo.returnPieces, stageTwo.soldPieces],
    [0, 0, 0],
  );
  assert.equal(
    invoiceFromStageTwo([invoiceRow(1000, 6, 0, 5, 0, 0)]).finalInvoiceAmount,
    940,
  );
  assert.equal(
    invoiceFromStageTwo([invoiceRow(1000, 6, 0, 5, 0, 2.5)], [400])
      .finalInvoiceAmount,
    400,
  );
  assert.equal(
    invoiceFromStageTwo([invoiceRow(1000, 6, 0, 5, 0, 5)]).finalInvoiceAmount,
    0,
  );
  assert.throws(() => movementFor(item, "1", "0"), /Return cannot exceed/);
});

test("advanced Stage 1 locks calculation fields but permits metadata-only edits", () => {
  const old = [
    {
      sku: "A",
      inventoryId: "stock-a",
      sourceInventoryId: "stock-a",
      pieces: 10,
      weight: 5.125,
      amount: 1000,
      discount: 6,
      discountAmount: 60,
      netAmount: 940,
    },
  ];
  const next = [{ ...old[0], notes: "changed", inventoryId: "stock-a" }];
  assert.equal(unchangedAdvancedStageOne(old, next), true);
  for (const change of [
    { amount: 2000 },
    { discount: 7 },
    { weight: 5.126 },
    { pieces: 11 },
    { inventoryId: "stock-b" },
    { netAmount: 941 },
  ])
    assert.equal(
      unchangedAdvancedStageOne(old, [{ ...next[0], ...change }]),
      false,
    );
});

test("Stage 2 guard ignores map order and harmless derived metadata but rejects real source changes", () => {
  const review = [
    {
      id: "line-a",
      sku: "1_Round_CVD",
      inventoryId: "stock-a",
      sourceInventoryId: "stock-a",
      pieces: 10,
      weight: 5,
      amount: 1000,
      discount: 6,
      discountAmount: 60,
      netAmount: 940,
      priceSource: "manual",
      priceContext: { height: "1", width: "" },
    },
  ];
  const latest = [
    {
      ...Object.fromEntries(Object.entries(review[0]).reverse()),
      pieces: "10",
      weight: "5.0004",
      amount: "1000.00",
      discount: "6.0",
      discountAmount: 61,
      netAmount: 939,
      priceContext: { width: "", height: "1" },
    },
  ];
  assert.notEqual(JSON.stringify(review), JSON.stringify(latest));
  assert.equal(sameStageOneReturnSource(review, latest), true);
  for (const change of [
    { sku: "2_Round_CVD" },
    { sourceInventoryId: "stock-b" },
    { pieces: 11 },
    { weight: 5.001 },
    { amount: 1000.01 },
    { discount: 7 },
  ])
    assert.equal(
      sameStageOneReturnSource(review, [{ ...latest[0], ...change }]),
      false,
    );
  assert.equal(
    sameStageOneReturnSource(review, [{ ...latest[0], amount: "bad" }]),
    false,
  );
  assert.equal(sameStageOneReturnSource(review, [...latest, latest[0]]), false);
  const second = {
    ...review[0],
    sku: "2_Round_CVD",
    inventoryId: "stock-b",
    sourceInventoryId: "stock-b",
  };
  assert.equal(
    sameStageOneReturnSource([...review, second], [second, ...latest]),
    false,
  );
});

test("settlement accepts blank discount, rejects sub-cent payment", () => {
  assert.equal(settlementFor(1000, "1000", "").remaining, 0);
  assert.equal(settlementFor(1000, "900", "").remaining, 100);
  assert.equal(settlementFor(1000, "900", "100").remaining, 0);
  assert.throws(() => settlementFor(100, "99.999", ""), /2 decimal/);
  assert.throws(() => settlementFor(100, "0", "-1"));
});

test("rapid same-batch updates retain Pieces and Weight across rows", () => {
  let rows = [
    { id: "a", returnPieces: "", returnWeight: "" },
    { id: "b", returnPieces: "", returnWeight: "" },
  ];
  for (const [id, key, value] of [
    ["a", "returnPieces", "1"],
    ["a", "returnWeight", "0.100"],
    ["b", "returnPieces", "2"],
    ["a", "returnPieces", "5"],
    ["b", "returnWeight", "1.250"],
  ])
    rows = updateReturnRows(rows, id, key, value);
  assert.deepEqual(rows, [
    { id: "a", returnPieces: "5", returnWeight: "0.100" },
    { id: "b", returnPieces: "2", returnWeight: "1.250" },
  ]);
});

test("independent integer reference matches 10, 50, 100, 250 rows", () => {
  for (const count of [10, 50, 100, 250]) {
    const stageOne = [],
      stageTwo = [],
      partialAmounts = [];
    let expectedPieces = 0,
      expectedMillis = 0n,
      expectedGrossCents = 0n,
      expectedFinalCents = 0n;
    let expectedDiscountCents = 0n;
    let expectedStageOneCents = 0n,
      expectedStageOneDiscountCents = 0n;
    for (let i = 0; i < count; i++) {
      const amountCents = 100001 + i * 1337;
      const amount = amountCents / 100;
      const discount = [0, 6, 7, 8, 12][i % 5];
      const returnedPieces = [0, 5, 10][i % 3];
      const issuedMillis = 5125 + (i % 5);
      const returnedMillis =
        i % 3 === 0 ? 0 : i % 3 === 1 ? 2375 + (i % 5) : issuedMillis;
      stageOne.push({
        sku: String(i),
        pieces: 10,
        weight: issuedMillis / 1000,
        amount,
        discount,
      });
      stageTwo.push(
        invoiceRow(
          amount,
          discount,
          10,
          issuedMillis / 1000,
          returnedPieces,
          returnedMillis / 1000,
        ),
      );
      expectedPieces += 10;
      expectedMillis += BigInt(issuedMillis);
      const deduction = (BigInt(amountCents * discount) * 2n + 100n) / 200n;
      expectedStageOneCents += BigInt(amountCents);
      expectedStageOneDiscountCents += deduction;
      expectedGrossCents += BigInt(amountCents);
      expectedDiscountCents += deduction;
      const manualCents = 50000 + i;
      partialAmounts.push(
        i % 3 === 1 ? (manualCents / 100).toFixed(2) : undefined,
      );
      expectedFinalCents +=
        i % 3 === 0
          ? BigInt(amountCents) - deduction
          : i % 3 === 1
            ? BigInt(manualCents)
            : 0n;
    }
    const totals = stageOneTotals(stageOne);
    assert.equal(totals.itemCount, count);
    assert.equal(totals.pieces, expectedPieces);
    assert.equal(totals.weight, Number(expectedMillis) / 1000);
    assert.equal(totals.amount, Number(expectedStageOneCents) / 100);
    assert.equal(
      totals.discountAmount,
      Number(expectedStageOneDiscountCents) / 100,
    );
    assert.equal(
      totals.netAmount,
      Number(expectedStageOneCents - expectedStageOneDiscountCents) / 100,
    );
    const movement = stageTwoTotals(
      stageOne,
      stageTwo.map((row) => ({
        returnPieces: row.returnPieces,
        returnWeight: row.returnWeight,
      })),
    );
    assert.equal(movement.issuedPieces, expectedPieces);
    assert.equal(movement.issuedWeight, Number(expectedMillis) / 1000);
    assert.equal(
      movement.soldPieces + movement.returnPieces,
      movement.issuedPieces,
    );
    assert.equal(
      Math.round((movement.soldWeight + movement.returnWeight) * 1000),
      Number(expectedMillis),
    );
    const invoice = invoiceFromStageTwo(stageTwo, partialAmounts);
    assert.equal(invoice.grossAmount, Number(expectedGrossCents) / 100);
    assert.equal(
      invoice.stage1DiscountAmount,
      Number(expectedDiscountCents) / 100,
    );
    assert.equal(invoice.finalInvoiceAmount, Number(expectedFinalCents) / 100);
    assert.equal(
      settlementFor(invoice.finalInvoiceAmount, invoice.finalInvoiceAmount, "")
        .remaining,
      0,
    );
  }
});

test("delete restoration uses full issue at Stage 1 and only sold stock at Stages 2-4", () => {
  const issued = {
    sku: "A",
    sourceInventoryId: "stock-a",
    pieces: 20,
    weight: 10,
  };
  const returned = {
    sku: "A",
    sourceInventoryId: "stock-a",
    issuedPieces: 20,
    issuedWeight: 10,
    returnPieces: 8,
    returnWeight: 6,
    soldPieces: 12,
    soldWeight: 4,
  };
  const base = { items: [issued], stage2Return: { items: [returned] } };
  assert.deepEqual(challanStockRestoration({ ...base, stage: 1 }).items[0], {
    inventoryId: "stock-a",
    sku: "A",
    pieces: 20,
    weight: 10,
  });
  for (const stage of [2, 3, 4]) {
    const result = challanStockRestoration({ ...base, stage });
    assert.deepEqual([result.totalPieces, result.totalWeight], [12, 4]);
  }
  assert.deepEqual(
    challanStockRestoration({
      ...base,
      stage: 2,
      stage2Return: {
        items: [
          {
            ...returned,
            returnPieces: 20,
            returnWeight: 10,
            soldPieces: 0,
            soldWeight: 0,
          },
        ],
      },
    }).items[0].pieces,
    0,
  );
  assert.equal(
    challanStockRestoration({
      ...base,
      stage: 2,
      stage2Return: {
        items: [
          {
            ...returned,
            returnPieces: 0,
            returnWeight: 0,
            soldPieces: 20,
            soldWeight: 10,
          },
        ],
      },
    }).totalWeight,
    10,
  );
});

test("delete restoration handles multiple items and weight-only stock; corrupt links fail closed", () => {
  const a = {
    sku: "A",
    sourceInventoryId: "stock-a",
    pieces: 10,
    weight: 5.125,
  };
  const b = { sku: "B", inventoryId: "stock-b", pieces: 0, weight: 1.001 };
  const record = {
    stage: 3,
    items: [a, b],
    stage2Return: {
      items: [
        {
          sku: "A",
          sourceInventoryId: "stock-a",
          issuedPieces: 10,
          issuedWeight: 5.125,
          returnPieces: 4,
          returnWeight: 2.125,
        },
        {
          sku: "B",
          inventoryId: "stock-b",
          issuedPieces: 0,
          issuedWeight: 1.001,
          returnPieces: 0,
          returnWeight: 0.5,
        },
      ],
    },
  };
  const result = challanStockRestoration(record);
  assert.deepEqual([result.totalPieces, result.totalWeight], [6, 3.501]);
  assert.deepEqual(
    result.items.map((row) => row.pieces),
    [6, 0],
  );
  assert.throws(
    () =>
      challanStockRestoration({
        ...record,
        stage2Return: {
          items: [
            { ...record.stage2Return.items[0], soldWeight: 9 },
            record.stage2Return.items[1],
          ],
        },
      }),
    /sold history/,
  );
  assert.throws(
    () =>
      challanStockRestoration({
        ...record,
        items: [{ ...a, inventoryId: "", sourceInventoryId: "" }, b],
      }),
    /identity/,
  );
  assert.throws(
    () => challanStockRestoration({ ...record, stage2Return: { items: [] } }),
    /history/,
  );
  assert.throws(
    () =>
      challanStockRestoration({
        ...record,
        stage2Return: {
          items: [
            { ...record.stage2Return.items[0], issuedWeight: 5.126 },
            record.stage2Return.items[1],
          ],
        },
      }),
    /disagree/,
  );
});

test("Stage 3 review comparison ignores harmless metadata and formatting but detects real movement or price changes", () => {
  const review = [
    {
      sku: "A",
      sourceInventoryId: "stock-a",
      issuedPieces: 10,
      issuedWeight: 5,
      returnPieces: 4,
      returnWeight: 2.125,
      soldPieces: 6,
      soldWeight: 2.875,
      amount: 1000,
      discount: 7,
    },
  ];
  const latest = [
    {
      ...Object.fromEntries(Object.entries(review[0]).reverse()),
      issuedPieces: "10",
      issuedWeight: "5.000",
      returnPieces: "4",
      returnWeight: "2.1250",
      amount: "1000.00",
      discount: "7.0",
      soldWeight: "2.8750",
      updatedAtMs: 123,
    },
  ];
  assert.notEqual(JSON.stringify(review), JSON.stringify(latest));
  assert.equal(sameStageTwoInvoiceSource(review, latest), true);
  for (const changed of [
    { returnPieces: 5 },
    { returnWeight: 2.126 },
    { issuedWeight: 5.001 },
    { amount: 1000.01 },
    { discount: 8 },
    { sourceInventoryId: "stock-b" },
    { sku: "B" },
  ])
    assert.equal(
      sameStageTwoInvoiceSource(review, [{ ...latest[0], ...changed }]),
      false,
    );
  assert.equal(sameStageTwoInvoiceSource(review, []), false);
});
