import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inventoryPiecesText,
  inventoryGroupPiecesText,
} from "../src/utils/inventoryTablePieces.js";

test("Inventory Pieces cells retain zero and show absent or invalid values as dashes", () => {
  for (const [value, expected] of [
    [10, "10"],
    [0, "0"],
    [undefined, "--"],
    [null, "--"],
    ["", "--"],
    ["  ", "--"],
    [1.5, "--"],
    [-1, "--"],
    ["abc", "--"],
  ])
    assert.equal(inventoryPiecesText(value), expected);
});

test("group Pieces totals use valid child counts and distinguish zero from absent", () => {
  assert.equal(
    inventoryGroupPiecesText([{ pieces: 10 }, { pieces: 0 }, { pieces: 25 }]),
    "35",
  );
  assert.equal(inventoryGroupPiecesText([{ pieces: 0 }, {}]), "0");
  assert.equal(
    inventoryGroupPiecesText([{}, { pieces: null }, { pieces: "" }]),
    "--",
  );
  assert.equal(
    inventoryGroupPiecesText([{ pieces: 2 }, { pieces: "abc" }]),
    "2",
  );
});
