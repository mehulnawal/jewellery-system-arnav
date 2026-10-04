import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { identityFingerprint, reconcileReservation } from "../scripts/lib/initializeInventoryIdentities.mjs";

const cli = (args, emulator = "") => spawnSync(process.execPath, ["scripts/initializeInventoryIdentities.mjs", ...args], {
  encoding: "utf8", timeout: 20000, env: { ...process.env, FIRESTORE_EMULATOR_HOST: emulator },
});
test("offline export produces a deterministic read-only plan without database access", async () => {
  const data = JSON.parse(await readFile("tests/fixtures/dimension-audit.json", "utf8"));
  const result = cli(["--input=tests/fixtures/dimension-audit.json"]);
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.mode, "read-only");
  assert.equal(plan.productionAuditRun, false);
  assert.equal(plan.fingerprint, identityFingerprint(data.inventory.slice().reverse()));
  assert.equal(plan.collisions.length, 1);
});
test("export cannot be applied as a database backfill", () => {
  const result = cli(["--input=tests/fixtures/dimension-audit.json", "--apply"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /JSON exports are read-only audit inputs/);
});
test("non-emulator access is rejected before credential discovery without explicit confirmation", () => {
  const result = cli(["--project=not-a-real-project"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Live access disabled/);
});
test("apply requires reviewed fingerprint and guard acknowledgment", () => {
  const result = cli(["--project=demo-rollout", "--apply"], "127.0.0.1:8180");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Apply requires a reviewed/);
});
test("emulator mode refuses non-loopback endpoints and real project IDs", () => {
  for (const [project, host] of [["demo-rollout", "example.invalid:8180"], ["not-a-demo-project", "127.0.0.1:8180"]]) {
    const result = cli([`--project=${project}`], host);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Local initialization requires/);
  }
});
test("existing owner safely promotes to collision; old collision members and metadata remain", () => {
  const desired = { sku: "5_PR_CBD", recordId: null, legacyRecordIds: ["a", "b"] };
  assert.deepEqual(reconcileReservation({ sku: desired.sku, recordId: "a", note: "retained" }, desired), { ...desired, note: "retained" });
  const existing = { ...desired, legacyRecordIds: ["a", "historic"], note: "retained" };
  assert.deepEqual(reconcileReservation(existing, desired).legacyRecordIds, ["a", "b", "historic"]);
  assert.equal(reconcileReservation(existing, desired).note, "retained");
  assert.throws(() => reconcileReservation({ sku: desired.sku, recordId: "unknown" }, desired), /Conflicting registry owner/);
});
