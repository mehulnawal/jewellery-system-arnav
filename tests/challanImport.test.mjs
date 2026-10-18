import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import {
  CHALLAN_IMPORT_HEADERS,
  CHALLAN_IMPORT_FILENAME,
  CHALLAN_IMPORT_SHEET,
  canImportChallan,
  nextBulkChallanNumber,
  parseChallanImport,
  prepareImportedStageOneRecord,
} from "../src/utils/challanImport.js";
import { createChallanImportWorkbook } from "../src/utils/challanImportTemplate.js";
import { stageOneInventoryDeduction } from "../src/utils/challanStageOneCreate.js";
import { masterPriceMap } from "../src/utils/masterPrices.js";
import { invoiceFromStageTwo } from "../src/utils/challanCalculations.js";

const stock = (n, overrides = {}) => ({
  id: "physical-" + n,
  sku: "SKU-" + n,
  shape: "Round",
  size: String(n),
  type: "CVD",
  weight: 10,
  pieces: 20,
  ...overrides,
});
const row = (ref, skuNumber, overrides = {}) => {
  const fields = {
    "Challan Ref": ref,
    Party: "Sonam",
    Date: "2026-10-17",
    Notes: "",
    "Inventory SKU": "SKU-" + skuNumber,
    Width: "",
    Weight: "1.000",
    Pieces: "1",
    Price: "1000",
    "Discount %": "7",
    ...overrides,
  };
  return CHALLAN_IMPORT_HEADERS.map((name) => fields[name]);
};
const parse = (rows, inventory, prices = new Map()) =>
  parseChallanImport([CHALLAN_IMPORT_HEADERS, ...rows], inventory, prices);
const messages = (group) =>
  group.reasons
    .map((reason) => "Row " + reason.rowNumber + ": " + reason.message)
    .join("\n");

for (const count of [1, 5, 10, 50]) {
  test(count + " separate valid Challans are grouped in file order", () => {
    const inventory = Array.from({ length: count }, (_, index) =>
      stock(index + 1),
    );
    const result = parse(
      inventory.map((_, index) => row("C" + (index + 1), index + 1)),
      inventory,
    );
    assert.equal(result.groups.length, count);
    assert.equal(result.validCount, count);
    assert.equal(result.invalidCount, 0);
    assert.deepEqual(
      result.groups.map((group) => group.ref),
      inventory.map((_, index) => "C" + (index + 1)),
    );
    assert.ok(result.groups.every((group) => group.items.length === 1));
  });
}

test("one Challan may contain multiple item rows and has weighted financial totals", () => {
  const result = parse(
    [
      row("C1", 1, { Weight: "2.500", Price: "4000" }),
      row("C1", 2, { Weight: "0.010", Pieces: "0", Price: "1000" }),
      row("C2", 3, { Party: "Rohan" }),
    ],
    [stock(1), stock(2, { pieces: 0 }), stock(3)],
  );
  assert.equal(result.groups.length, 2);
  assert.equal(result.groups[0].items.length, 2);
  assert.equal(result.groups[1].party, "Rohan");
  assert.equal(result.groups[0].totals.amount, 10010);
  assert.equal(result.groups[0].totals.discountAmount, 700.7);
  assert.equal(result.groups[0].totals.netAmount, 9309.3);
  assert.equal(result.groups[0].totals.pieces, 1);
});

test("five valid and two invalid Challans keep whole-group status and all row reasons", () => {
  const inventory = Array.from({ length: 7 }, (_, index) => stock(index + 1));
  const rows = inventory
    .slice(0, 5)
    .map((_, index) => row("C" + index, index + 1));
  rows.push(row("BAD-A", 6));
  rows.push(
    row("BAD-A", 999, { Pieces: "1.5", Weight: "bad", "Discount %": "107" }),
  );
  rows.push(row("BAD-B", 7, { Party: "" }));
  const result = parse(rows, inventory);
  assert.equal(result.validCount, 5);
  assert.equal(result.invalidCount, 2);
  assert.equal(result.groups[5].items.length, 2);
  assert.match(messages(result.groups[5]), /Row 8:.*SKU SKU-999/);
  assert.match(messages(result.groups[5]), /Pieces must be a whole number/);
  assert.match(messages(result.groups[5]), /Weight must be a valid/);
  assert.match(messages(result.groups[5]), /Discount % must be between/);
  assert.match(messages(result.groups[6]), /Party is required/);
});

test("missing SKU and invalid Weight both appear on the same row", () => {
  const result = parse(
    [
      row("C1", 1, {
        "Inventory SKU": "",
        Weight: "bad",
      }),
    ],
    [stock(1)],
  );
  assert.match(messages(result.groups[0]), /Inventory SKU is required/);
  assert.match(messages(result.groups[0]), /Weight must be a valid/);
});

test("invalid Price, malformed Width and invalid Discount aggregate", () => {
  const result = parse(
    [
      row("C1", 1, {
        Width: "bad",
        Price: "wrong",
        "Discount %": "-1",
      }),
    ],
    [stock(1)],
  );
  const reason = messages(result.groups[0]);
  for (const part of ["Width", "Price", "Discount %"])
    assert.match(reason, new RegExp(part));
});
test("duplicate physical item invalidates only its own Challan", () => {
  const result = parse(
    [row("BAD", 1), row("BAD", 1), row("GOOD", 2)],
    [stock(1), stock(2)],
  );
  assert.equal(result.groups[0].status, "INVALID");
  assert.match(messages(result.groups[0]), /same physical Inventory item/);
  assert.equal(result.groups[1].status, "VALID");
});

test("two Challans can use one physical item when cumulative Weight and Pieces fit", () => {
  const result = parse(
    [
      row("C1", 1, { Weight: "4", Pieces: "7" }),
      row("C2", 1, { Weight: "6", Pieces: "13" }),
    ],
    [stock(1)],
  );
  assert.equal(result.validCount, 2);
});

test("deterministic batch allocation rejects later cumulative Weight or Pieces excess", () => {
  const weight = parse(
    [
      row("C1", 1, { Weight: "7", Pieces: "1" }),
      row("C2", 1, { Weight: "6", Pieces: "1" }),
    ],
    [stock(1)],
  );
  assert.deepEqual(
    weight.groups.map((group) => group.status),
    ["VALID", "INVALID"],
  );
  assert.match(
    messages(weight.groups[1]),
    /Batch stock conflict.*SKU SKU-1.*remaining 3.000 ct/,
  );
  const pieces = parse(
    [
      row("C1", 1, { Weight: "1", Pieces: "12" }),
      row("C2", 1, { Weight: "1", Pieces: "9" }),
    ],
    [stock(1)],
  );
  assert.match(messages(pieces.groups[1]), /Batch stock conflict.*remaining 8/);
});

test("independent stock insufficiency reports requested and available values", () => {
  const result = parse(
    [
      row("C1", 1, {
        Weight: "11.000",
        Pieces: "21",
      }),
    ],
    [stock(1)],
  );
  assert.match(
    messages(result.groups[0]),
    /10.000 ct available; requested 11.000 ct/,
  );
  assert.match(messages(result.groups[0]), /20 Pieces available; requested 21/);
});

test("bad Challan does not reserve stock against a later valid Challan", () => {
  const result = parse(
    [
      row("BAD", 1, { Weight: "9", Price: "bad" }),
      row("GOOD", 1, { Weight: "9" }),
    ],
    [stock(1)],
  );
  assert.deepEqual(
    result.groups.map((group) => group.status),
    ["INVALID", "VALID"],
  );
});

test("conflicting Party, Date and Notes inside one Ref invalidate the group", () => {
  const result = parse(
    [
      row("C1", 1),
      row("C1", 2, { Party: "Rohan", Date: "2026-10-18", Notes: "other" }),
    ],
    [stock(1), stock(2)],
  );
  assert.match(messages(result.groups[0]), /Conflicting Party/);
  assert.match(messages(result.groups[0]), /Conflicting Date/);
  assert.match(messages(result.groups[0]), /Conflicting Notes/);
});

test("missing Ref and invalid Date are separate Challan-level reasons", () => {
  const result = parse([row("", 1, { Date: "2026-02-30" })], [stock(1)]);
  assert.match(messages(result.groups[0]), /Challan Ref is required/);
  assert.match(messages(result.groups[0]), /Date must be a valid/);
});

test("three and four decimal Weights use the shared rounding rule", () => {
  const result = parse(
    [row("C1", 1, { Weight: "9.4565", Pieces: "0" })],
    [stock(1, { pieces: 0 })],
  );
  assert.equal(result.validCount, 1);
  assert.equal(result.groups[0].totals.weight, 9.457);
  const three = parse(
    [
      row("C1", 1, {
        Weight: "9.456",
        Pieces: "0",
      }),
    ],
    [stock(1, { pieces: 0 })],
  );
  assert.equal(three.groups[0].totals.weight, 9.456);
});

test("blank Price uses exact Master Price and explicit rate is manual", () => {
  const inventory = [stock(1)];
  const prices = masterPriceMap([
    {
      id: "master",
      type: "CVD",
      shape: "Round",
      height: "1",
      width: "",
      price: 5800,
    },
  ]);
  const automatic = parse([row("C1", 1, { Price: "" })], inventory, prices);
  assert.equal(automatic.groups[0].items[0].amount, "5800");
  assert.equal(automatic.groups[0].items[0].priceSource, "master-auto");
  const manual = parse([row("C1", 1, { Price: "4000" })], inventory, prices);
  assert.equal(manual.groups[0].items[0].priceSource, "manual");
  assert.equal(manual.groups[0].totals.amount, 4000);
});

test("new Inventory snapshot changes preview status before final import", () => {
  const matrix = [CHALLAN_IMPORT_HEADERS, row("C1", 1, { Weight: "2" })];
  assert.equal(parseChallanImport(matrix, [stock(1)], new Map()).validCount, 1);
  const after = parseChallanImport(
    matrix,
    [stock(1, { weight: 1 })],
    new Map(),
  );
  assert.equal(after.validCount, 0);
  assert.match(
    messages(after.groups[0]),
    /1.000 ct available; requested 2.000 ct/,
  );
});

test("each prepared record is independent Stage 1 with a unique real number", () => {
  const result = parse([row("C1", 1), row("C2", 2)], [stock(1), stock(2)]);
  const used = new Set(["A1/1"]);
  const numbers = result.groups.map(() => {
    const next = nextBulkChallanNumber(used);
    used.add(next);
    return next;
  });
  assert.deepEqual(numbers, ["A1/2", "A1/3"]);
  const records = result.groups.map((group, index) =>
    prepareImportedStageOneRecord(
      group,
      numbers[index],
      { uid: "staff", role: "staff" },
      "record-" + index,
    ),
  );
  assert.ok(records.every((record) => record.stage === 1));
  assert.ok(records.every((record) => record.items.length === 1));
  assert.ok(records.every((record) => !("importRowNumber" in record.items[0])));
  assert.equal(records[0].items[0].inventoryId, "physical-1");
  assert.equal(records[0].items[0].grossAmount, 1000);
  assert.equal(records[0].items[0].netAmount, 930);
  const invoice = invoiceFromStageTwo([
    {
      ...records[0].items[0],
      issuedWeight: 1,
      issuedPieces: 1,
      returnWeight: 0,
      returnPieces: 0,
      soldWeight: 1,
      soldPieces: 1,
    },
  ]);
  assert.equal(invoice.finalInvoiceAmount, 930);
});

test("generated Settings workbook is empty and accepted by the actual grouped parser", () => {
  const book = createChallanImportWorkbook(XLSX);
  assert.equal(CHALLAN_IMPORT_FILENAME, "challan-import-template.xlsx");
  assert.deepEqual(book.SheetNames, [CHALLAN_IMPORT_SHEET]);
  const sheet = book.Sheets[CHALLAN_IMPORT_SHEET];
  assert.deepEqual(XLSX.utils.sheet_to_json(sheet, { header: 1 }), [
    CHALLAN_IMPORT_HEADERS,
  ]);
  XLSX.utils.sheet_add_aoa(sheet, [row("C1", 1), row("C1", 2), row("C2", 3)], {
    origin: "A2",
  });
  const bytes = XLSX.write(book, { type: "buffer", bookType: "xlsx" });
  const opened = XLSX.read(bytes, { type: "buffer" });
  const matrix = XLSX.utils.sheet_to_json(opened.Sheets[CHALLAN_IMPORT_SHEET], {
    header: 1,
    defval: "",
    blankrows: true,
    raw: true,
  });
  const result = parseChallanImport(
    matrix,
    [stock(1), stock(2), stock(3)],
    new Map(),
  );
  assert.equal(result.groups.length, 2);
  assert.equal(result.validCount, 2);
});

test("stage columns, guessed headers, and hidden data are rejected", () => {
  for (const extra of ["Stage", "Return Weight", "Paid Amount"])
    assert.throws(
      () =>
        parseChallanImport(
          [[...CHALLAN_IMPORT_HEADERS, extra], row("C1", 1)],
          [stock(1)],
          new Map(),
        ),
      /Headers must be exactly/,
    );
  const extraCell = parseChallanImport(
    [CHALLAN_IMPORT_HEADERS, [...row("C1", 1), "Stage 4"]],
    [stock(1)],
    new Map(),
  );
  assert.equal(extraCell.invalidCount, 1);
  assert.match(messages(extraCell.groups[0]), /Unexpected extra column/);
});

test("Import handler gate allows only authorized new Stage 1 creation", () => {
  assert.equal(canImportChallan("create", null, true), true);
  for (const [page, editingId, allowed] of [
    ["create", null, false],
    ["create", "edit", true],
    ["stage2", null, true],
    ["stage3", null, true],
    ["stage4", null, true],
    ["list", null, true],
  ])
    assert.equal(canImportChallan(page, editingId, allowed), false);
});

test("the shared transaction deduction uses latest physical stock and rejects stale review", () => {
  const parsed = parse(
    [
      row("C1", 1, {
        Weight: "2.500",
        Pieces: "5",
      }),
    ],
    [stock(1)],
  );
  const record = prepareImportedStageOneRecord(
    parsed.groups[0],
    "A1/1",
    { uid: "staff" },
    "record",
  );
  const item = record.items[0];
  assert.deepEqual(stageOneInventoryDeduction(item, stock(1)), {
    weight: 7.5,
    pieces: 15,
  });
  assert.throws(
    () => stageOneInventoryDeduction(item, stock(1, { weight: 2 })),
    /2.000 ct available; requested 2.500 ct/,
  );
  assert.throws(
    () => stageOneInventoryDeduction(item, stock(1, { pieces: 4 })),
    /4 Pieces available; requested 5/,
  );
  assert.throws(
    () => stageOneInventoryDeduction(item, stock(1, { size: "9" })),
    /Inventory identity changed/,
  );
});

test("SKU errors distinguish unknown, unavailable and ambiguous physical Inventory", () => {
  const unknown = parse([row("C1", 99)], [stock(1)]);
  assert.match(
    messages(unknown.groups[0]),
    /SKU SKU-99 does not exist in Inventory/,
  );
  const unavailable = parse(
    [row("C1", 1)],
    [stock(1, { weight: 0, pieces: 0 })],
  );
  assert.match(
    messages(unavailable.groups[0]),
    /no eligible physical Inventory record/,
  );
  const ambiguous = parse(
    [row("C1", 1)],
    [stock(1), stock(1, { id: "second-physical" })],
  );
  assert.match(
    messages(ambiguous.groups[0]),
    /multiple physical Inventory records/,
  );
});

test("Shape, Size and Type are taken from the resolved SKU; Width remains manual", () => {
  const inventory = [stock(1, { shape: "Oval", size: "5.00", type: "HP" })];
  const prices = masterPriceMap([
    {
      id: "default",
      type: "HP",
      shape: "Oval",
      height: "5",
      width: "",
      price: 5800,
    },
    {
      id: "width",
      type: "HP",
      shape: "Oval",
      height: "5",
      width: "1",
      price: 4000,
    },
  ]);
  const matching = parse(
    [
      row("C1", 1, {
        Width: "1",
        Price: "",
      }),
    ],
    inventory,
    prices,
  );
  assert.equal(matching.validCount, 1);
  assert.equal(matching.groups[0].items[0].shape, "Oval");
  assert.equal(matching.groups[0].items[0].size, "5");
  assert.equal(matching.groups[0].items[0].type, "HP");
  assert.equal(matching.groups[0].items[0].width, "1");
  assert.equal(matching.groups[0].items[0].amount, "4000");
  const noFallback = parse(
    [
      row("C1", 1, {
        Width: "2",
        Price: "",
      }),
    ],
    inventory,
    prices,
  );
  assert.equal(noFallback.invalidCount, 1);
  assert.match(messages(noFallback.groups[0]), /Price is required/);
  for (const derived of ["Shape", "Size", "Type"])
    assert.ok(!CHALLAN_IMPORT_HEADERS.includes(derived));
});
