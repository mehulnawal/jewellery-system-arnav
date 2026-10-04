import { test } from "node:test";
import assert from "node:assert/strict";
import {
  businessStatus,
  listenerFailure,
} from "../src/utils/businessStatus.js";
test("absent marker defaults safely; malformed or inconsistent markers fail closed", () => {
  assert.deepEqual(businessStatus(undefined), { generation: 0, locked: false });
  for (const record of [
    null,
    {},
    { locked: false },
    { locked: "false", generation: 0 },
    { locked: false, generation: -1 },
    { locked: false, generation: 1, status: "running" },
  ])
    assert.throws(() => businessStatus(record));
  assert.equal(
    businessStatus({ locked: true, generation: 1, status: "incomplete" })
      .locked,
    true,
  );
});
test("permission/configuration is distinct from temporary connectivity", () => {
  assert.equal(listenerFailure({ code: "permission-denied" }).phase, "error");
  assert.equal(listenerFailure({ code: "failed-precondition" }).phase, "error");
  assert.equal(listenerFailure({ code: "unavailable" }).phase, "offline");
});
