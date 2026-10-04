import { before, beforeEach, after, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc, deleteDoc, getDoc, serverTimestamp, setLogLevel } from "firebase/firestore";
import { initializeInventoryIdentities, readIdentityPlan, reconcileReservation } from "../scripts/lib/initializeInventoryIdentities.mjs";
import { auditDimensions } from "../src/utils/dimensionAudit.js";
import { saveInventoryIdentity } from "../src/utils/inventoryIdentity.js";

if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || "")) throw new Error("Loopback emulator required; never production.");
setLogLevel("silent");
const projectId = "demo-identity-rollout";
const app = initializeApp({ projectId }, "identity-rollout-tests"), db = getFirestore(app);
let env;
before(async () => { env = await initializeTestEnvironment({ projectId, firestore: { rules: await readFile("firestore.rules", "utf8") } }); });
after(async () => { await env?.cleanup(); await deleteApp(app); });
beforeEach(async () => {
  await env.clearFirestore();
  for (const [id, role, permissions] of [["admin", "superadmin", []], ["staff", "employee", ["inventory", "purchase", "challan-stage-1"]], ["other", "employee", []]])
    await db.doc(`employeeProfiles/${id}`).set({ role, permissions, active: true });
});
const client = (uid = "admin") => env.authenticatedContext(uid).firestore();
const row = (id, size, extra = {}) => ({ id, size, shape: "PR", type: "CBD", sku: `${size}_PR_CBD`, weight: 10, pieces: 10, createdBy: "admin", createdAt: new Date(), ...extra });
const seed = async (rows) => { for (const { id, ...data } of rows) await db.doc(`inventory/${id}`).set(data); };
const setup = async (options = {}) => initializeInventoryIdentities(db, { expectedFingerprint: (await readIdentityPlan(db)).fingerprint, guardRulesAcknowledged: true, ...options });
const claim = async (sku) => (await db.doc(`inventoryIdentities/${sku}`).get()).data();
const marker = async () => (await db.doc("inventoryIdentityMigrations/v1").get()).data();
const businessSnapshot = async () => Object.fromEntries(await Promise.all(["inventory", "purchases", "challans", "activityLog"].map(async (name) => [name, (await db.collection(name).orderBy("__name__").get()).docs.map((doc) => ({ id: doc.id, ...doc.data() }))])));

test("A/B: single legacy owner and distinct records reserve without any business/history writes", async () => {
  await seed([row("legacy-5.00", "5.00"), row("second", "6.12500"), row("third", 7)]);
  await db.doc("purchases/p").set({ items: [{ inventoryId: "legacy-5.00" }] });
  await db.doc("challans/c").set({ items: [{ sourceInventoryId: "second" }] });
  await db.doc("activityLog/history").set({ snapshot: { size: "5.00", sku: "5.00_PR_CBD" } });
  const before = await businessSnapshot();
  const result = await setup();
  assert.equal(result.canonicalIdentityCount, 3);
  assert.deepEqual(await claim("5_PR_CBD"), { sku: "5_PR_CBD", recordId: "legacy-5.00" });
  assert.equal((await marker()).ready, true);
  assert.deepEqual(await businessSnapshot(), before);
});

test("C/D/E/F: 5/5.00 and 5.3/5.30 collide across mixed types; 5.03 stays distinct", async () => {
  await seed([row("a", 5), row("b", "5.00"), row("c", 5.3), row("d", "5.30"), row("e", "5.03")]);
  const before = await businessSnapshot();
  const result = await setup();
  assert.equal(result.collisionCount, 2);
  assert.deepEqual(await claim("5_PR_CBD"), { sku: "5_PR_CBD", recordId: null, legacyRecordIds: ["a", "b"] });
  assert.deepEqual(await claim("5.3_PR_CBD"), { sku: "5.3_PR_CBD", recordId: null, legacyRecordIds: ["c", "d"] });
  assert.equal((await claim("5.03_PR_CBD")).recordId, "e");
  assert.deepEqual(await businessSnapshot(), before);
});

test("G: invalid Size/Shape/Type are fully reported with stock/references and prevent readiness", async () => {
  const inventory = [row("bad", "5..3"), row("blank", "5", { shape: " " }), row("typed", "5", { type: 42 }), row("path", "5", { shape: "P/R" }), row("ambiguous", "5", { type: "B_C" })];
  const report = auditDimensions({ inventory, purchases: [{ id: "p", items: [{ inventoryId: "bad" }] }], challans: [{ id: "c", items: [{ sourceInventoryId: "bad" }] }] });
  assert.equal(report.invalid.length, 5);
  assert.equal(report.invalid[0].rawSize, "5..3");
  assert.equal(report.invalid[0].weight, 10);
  assert(report.invalid.every((entry) => entry.reasons.length));
  assert.deepEqual(report.invalid[0].purchaseReferences, ["p"]);
  assert.deepEqual(report.invalid[0].challanReferences, ["c"]);
  await seed(inventory);
  const before = await businessSnapshot();
  await assert.rejects(setup(), /Invalid legacy identities/);
  assert.notEqual((await marker())?.ready, true);
  assert.equal((await db.collection("inventoryIdentities").get()).size, 0);
  assert.deepEqual(await businessSnapshot(), before);
});

test("H/I: interrupted batches resume; repeated initialization is a verified no-op", async () => {
  await seed([row("a", 5), row("b", "5.00"), row("c", "6")]);
  const before = await businessSnapshot();
  await assert.rejects(setup({ batchSize: 1, afterBatch: async () => { throw new Error("simulated interruption"); } }), /simulated interruption/);
  assert.equal((await marker()).ready, false);
  assert.equal((await db.collection("inventoryIdentities").get()).size, 1);
  await assertFails(deleteDoc(doc(client(), "inventory", "a")));
  await assertFails(updateDoc(doc(client(), "inventory", "a"), { size: "8", sku: "8_PR_CBD" }));
  const result = await setup({ batchSize: 1 });
  assert.equal(result.reservationsWritten, 1);
  const readyBefore = await marker();
  assert.equal((await setup()).status, "already-ready-verified");
  assert.deepEqual(await marker(), readyBefore);
  assert.deepEqual(await businessSnapshot(), before);
});

test("source drift fails closed; stock-only changes remain usable during setup", async () => {
  await seed([row("a", "5.00")]);
  const reviewed = (await readIdentityPlan(db)).fingerprint;
  await db.doc("inventory/a").update({ size: "6" });
  await assert.rejects(setup({ expectedFingerprint: reviewed }), /changed since dry run/);
  await assert.rejects(setup({ afterBatch: async () => db.doc("inventory/a").update({ size: "7" }) }), /changed during initialization/);
  assert.equal((await marker()).ready, false);
  await assert.rejects(setup(), /Interrupted setup source changed/);
  await assertSucceeds(updateDoc(doc(client(), "inventory", "a"), { weight: 9 }));
});

test("stock-only updates during indexing do not invalidate identity verification", async () => {
  await seed([row("a", "5.00")]);
  await setup({ afterBatch: async () => assertSucceeds(updateDoc(doc(client(), "inventory", "a"), { weight: 9 })) });
  assert.equal((await marker()).ready, true);
  assert.equal((await db.doc("inventory/a").get()).data().weight, 9);
});

test("registry conflicts stop setup; prior collision metadata is never downgraded", async () => {
  await seed([row("a", 5)]);
  await db.doc("inventoryIdentities/5_PR_CBD").set({ sku: "5_PR_CBD", recordId: "unexpected" });
  await assert.rejects(setup(), /Conflicting registry owner/);
  assert.equal((await marker()).ready, false);
  assert.equal((await claim("5_PR_CBD")).recordId, "unexpected");
  const reservation = { sku: "5_PR_CBD", recordId: null, legacyRecordIds: ["a", "historical-b"], note: "keep" };
  assert.deepEqual(reconcileReservation(reservation, { sku: "5_PR_CBD", recordId: "a" }), reservation);
});

test("J/K/O/P: Admin and Staff auto-register new stock; concurrent equivalent writes have one winner", async () => {
  await seed([row("legacy", "5.00")]);
  await setup();
  const store = client("staff");
  const payload = (size) => ({ size, shape: "PR", type: "CBD", weight: 1, pieces: 1, createdBy: "staff", createdAt: serverTimestamp() });
  const results = await Promise.allSettled(["6", "6.0", "6.00"].map((size, index) => saveInventoryIdentity(store, doc(store, "inventory", `new${index}`), payload(size))));
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  await assert.rejects(saveInventoryIdentity(store, doc(store, "inventory", "dup"), payload("5.000")), /already exists/);
  const admin = client();
  await saveInventoryIdentity(admin, doc(admin, "inventory", "admin-new"), { ...payload("7.300"), createdBy: "admin" });
  assert.equal((await claim("7.3_PR_CBD")).recordId, "admin-new");
  assert.equal((await setup()).reservationsWritten, 0);
});

test("Staff cannot toggle setup, forge claims, alter collision metadata or edit reservations alone", async () => {
  await seed([row("a", 5), row("b", "5.00"), row("normal", "6")]);
  await setup();
  const store = client("staff");
  await assertFails(setDoc(doc(store, "inventoryIdentityMigrations", "v1"), { ready: true }));
  await assertFails(setDoc(doc(client(), "inventoryIdentityMigrations", "v1"), { ready: true }));
  await assertFails(setDoc(doc(store, "inventoryIdentities", "6_PR_CBD"), { sku: "6_PR_CBD", recordId: "normal" }));
  await assertFails(setDoc(doc(store, "inventoryIdentities", "5_PR_CBD"), { sku: "5_PR_CBD", recordId: "a" }));
  await assertFails(deleteDoc(doc(store, "inventoryIdentities", "5_PR_CBD")));
  await assertSucceeds(getDoc(doc(store, "inventory", "a")));
  await assertSucceeds(getDoc(doc(store, "inventory", "b")));
  await assert.rejects(saveInventoryIdentity(store, doc(store, "inventory", "third"), { size: "5.000", shape: "PR", type: "CBD" }), /collision/);
});

test("two simultaneous initializers reconcile deterministically without business writes", async () => {
  await seed([row("a", 5), row("b", "5.00"), row("normal", "6")]);
  const before = await businessSnapshot();
  await Promise.all([setup({ batchSize: 1 }), setup({ batchSize: 1 })]);
  assert.equal((await marker()).ready, true);
  assert.equal((await db.collection("inventoryIdentities").get()).size, 2);
  assert.deepEqual(await businessSnapshot(), before);
});
