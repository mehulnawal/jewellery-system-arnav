import { test } from "node:test";
import assert from "node:assert/strict";
import { documentNumberError, isValidDocumentNumber, numberRegistryKey } from "../src/utils/documentNumbers.js";

test("dynamic series and all 100 allowed final numbers", () => {
  for (const series of ["0", "1", "12", "35", "99", "125", "12345678901234567890"]) {
    for (let number = 1; number <= 100; number++) {
      assert.equal(isValidDocumentNumber("challan", `A${series}/${number}`), true);
      assert.equal(isValidDocumentNumber("purchase", `PR-A${series}-${number}`), true);
    }
  }
});
test("reject missing, malformed and noncanonical final numbers without coercion", () => {
  for (const value of [undefined, null, "", "A35/0", "A35/101", "A35/01", "A35/001", "A35/-1", "A35/1.5", "A35/1e1", "35/1", "a35/1", "A35-1", " A35/1", "A35/1 ", "A35/1\n", "A35/1\r", "A 35/1", "A/1", "A-35/1", "A3.5/1", "A٣٥/1", 351])
    assert.equal(isValidDocumentNumber("challan", value), false, String(value));
  for (const value of [undefined, "", "PR-", "PR-A35-0", "PR-A35-101", "PR-A35-01", "PR-A35/1", "PR-a35-1", "A35-1", "PR-PR-A35-1", " PR-A35-1", "PR-A35-1\n", "PR-A-1", "PR-A3.5-1"])
    assert.equal(isValidDocumentNumber("purchase", value), false, String(value));
});
test("frontend duplicates exclude the current record when editing", () => {
  assert.match(documentNumberError("challan", "A125/7", [{ id: "old", number: "A125/7" }]), /already exists/);
  assert.equal(documentNumberError("challan", "A125/7", [{ id: "old", number: "A125/7" }], "old"), "");
  assert.match(documentNumberError("purchase", "PR-A12-25", [{ id: "old", purchaseId: "PR-A12-25" }]), /already exists/);
  assert.match(documentNumberError("challan", ""), /required/);
  assert.match(documentNumberError("purchase", "PR-"), /required/);
  assert.equal(numberRegistryKey("challan", "A125/7"), "A125-7");
});
