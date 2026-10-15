import test from "node:test";
import assert from "node:assert/strict";
import {
  canEditChallan,
  challanEditRemaining,
} from "../src/utils/challanEditWindow.js";

const hour = 60 * 60 * 1000;
const now = Date.UTC(2026, 9, 7, 17);
const staff = {
  uid: "staff",
  role: "employee",
  permissions: [1, 2, 3, 4].map((stage) => "challan-stage-" + stage),
};
const admin = { uid: "admin", role: "superadmin" };
const record = (stage) => ({
  id: "one",
  stage,
  createdAt: new Date(now - 6 * 24 * hour),
  createdBy: "staff",
  createdByRole: "employee",
  stageHistory: {
    stage1: { enteredAtMs: now - 6 * 24 * hour },
    stage2: {
      enteredAtMs: now - 4 * 24 * hour,
      enteredAt: new Date(now - 30 * 60 * 1000),
    },
    stage3: {
      enteredAtMs: now - 2 * 24 * hour,
      enteredAt: new Date(now - 30 * 60 * 1000),
    },
    stage4: {
      enteredAtMs: now - 24 * hour,
      enteredAt: new Date(now - 30 * 60 * 1000),
    },
  },
});

test("Stage 1 is timed for Staff and unlimited for Admin", () => {
  const row = record(1);
  assert.equal(canEditChallan(row, staff, now), false);
  assert.equal(canEditChallan(row, admin, now), true);
  row.createdAt = new Date(now - 59 * 60 * 1000);
  assert.equal(canEditChallan(row, staff, now), true);
  row.createdAt = new Date(now - hour);
  assert.equal(canEditChallan(row, staff, now), false);
});

for (const stage of [2, 3, 4]) {
  test("Stage " + stage + " uses its own persisted transition time", () => {
    const row = record(stage);
    assert.equal(challanEditRemaining(row, now), 30 * 60 * 1000);
    assert.equal(canEditChallan(row, staff, now), true);
    assert.equal(canEditChallan(row, admin, now), true);
    assert.equal(canEditChallan(row, staff, now + 29 * 60 * 1000), true);
    assert.equal(canEditChallan(row, admin, now + 30 * 60 * 1000), false);
    assert.equal(canEditChallan(row, staff, now + 30 * 60 * 1000), false);
  });
}

test("Staff ownership and permission still apply", () => {
  assert.equal(
    canEditChallan({ ...record(2), createdBy: "admin" }, staff, now),
    false,
  );
  assert.equal(
    canEditChallan(record(2), { ...staff, permissions: [] }, now),
    false,
  );
});
