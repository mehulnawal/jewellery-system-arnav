import { before, beforeEach, after, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, runTransaction, writeBatch, serverTimestamp, Timestamp, setLogLevel } from "firebase/firestore";
import { prepareNumberClaim, prepareNumberRelease, numberRegistryRef } from "../src/utils/numberRegistry.js";
import { registerExistingNumbers } from "../src/utils/registerExistingNumbers.js";

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("Run with the Firestore emulator; live databases are never used by this suite.");
setLogLevel("silent"); // Expected rule denials are asserted below.
let env;
const permissions = ["inventory", "purchase", "challan-stage-1", "challan-stage-2", "challan-stage-3", "challan-stage-4"];
const database = (uid = "staff") => env.authenticatedContext(uid).firestore();
before(async () => {
  env = await initializeTestEnvironment({ projectId: "demo-jewellery-numbering", firestore: { rules: await readFile("firestore.rules", "utf8") } });
});
after(async () => env?.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all(["admin", "staff", "other", "limited"].map((uid) => setDoc(doc(db, "employeeProfiles", uid), {
      uid, role: uid === "admin" ? "superadmin" : "employee", active: true,
      accessId: uid, permissions: ["limited", "admin"].includes(uid) ? [] : permissions,
    })));
    await setDoc(doc(db, "numberingMigrations", "manual-v1"), { ready: true });
  });
});
const source = (kind) => kind === "challan" ? "challans" : "purchases";
const field = (kind) => kind === "challan" ? "number" : "purchaseId";
async function create(db, kind, number, id = crypto.randomUUID(), uid = "staff") {
  let data = { [field(kind)]: number, stage: 1, createdBy: uid, createdAt: serverTimestamp() };
  if (kind === "purchase") {
    const checked = { id, purchaseId: number, date: "2026-09-29", vendorName: "Test Vendor", brokerName: "", totalWeight: 1, amount: 100, discount: 0, discountAmount: 0, netPayable: 100, paymentDueDays: 0, paymentDueDate: "2026-09-29", items: [{ id: "line", weight: 1 }], itemCount: 1 };
    data = { ...data, ...checked };
  }
  await runTransaction(db, async (tx) => {
    const claim = await prepareNumberClaim(tx, db, kind, number, id);
    claim();
    tx.set(doc(db, source(kind), id), data);
  });
  return id;
}
// Bypass all frontend/service validation to exercise the server rules directly.
async function rawCreate(db, kind, value, id = crypto.randomUUID(), includeClaim = true, uid = "staff") {
  const batch = writeBatch(db);
  const data = { stage: 1, createdBy: uid, createdAt: serverTimestamp() };
  if (value !== undefined) data[field(kind)] = value;
  batch.set(doc(db, source(kind), id), data);
  if (includeClaim && typeof value === "string" && value) {
    const key = value.replaceAll("/", "-");
    batch.set(doc(db, kind === "challan" ? "challanNumbers" : "purchaseNumbers", key), { number: value, recordId: id });
  }
  return batch.commit();
}

for (const uid of ["staff", "admin"]) {
  for (const kind of ["challan", "purchase"]) {
    test(`${uid} ${kind}: dynamic series, valid boundaries, duplicates`, async () => {
      const db = database(uid);
      for (const [series, n] of [[1, 1], [12, 25], [35, 50], [99, 100], [125, 7]]) {
        const number = kind === "challan" ? `A${series}/${n}` : `PR-A${series}-${n}`;
        await assertSucceeds(create(db, kind, number, `${series}`, uid));
        await assert.rejects(create(db, kind, number, `duplicate-${series}`, uid), /already exists/);
        await assertFails(rawCreate(db, kind, number, `bypass-${series}`, true, uid));
      }
    });
    test(`${uid} ${kind}: server rejects malformed, required, and unclaimed numbers`, async () => {
      const db = database(uid);
      const invalid = kind === "challan"
        ? [undefined, "", "A35/0", "A35/101", "A35/01", "a35/1", "35/1", "A35-1", " A35/1", "A35/1 ", "A35/1\n", "A/1", "A3.5/1"]
        : [undefined, "", "PR-", "PR-A35-0", "PR-A35-101", "PR-A35-01", "PR-a35-1", "A35-1", "PR-A35/1", " PR-A35-1", "PR-A35-1\n", "PR-A-1", "PR-A3.5-1"];
      for (const value of invalid) await assertFails(rawCreate(db, kind, value, crypto.randomUUID(), true, uid));
      await assertFails(rawCreate(db, kind, kind === "challan" ? "A1/1" : "PR-A1-1", "unclaimed", false, uid));
    });
  }
}
test("concurrent requests have exactly one winner for each number", async () => {
  for (const kind of ["challan", "purchase"]) {
    const number = kind === "challan" ? "A125/7" : "PR-A125-7";
    const outcomes = await Promise.allSettled([
      create(database("staff"), kind, number, "first"),
      create(database("other"), kind, number, "second", "other"),
    ]);
    assert.equal(outcomes.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal((await getDocs(collection(database("admin"), source(kind)))).size, 1);
  }
});
test("Admin can rename Challans at every stage; staff cannot; links remain stable", async () => {
  const admin = database("admin"), staff = database();
  for (let stage = 1; stage <= 4; stage++) {
    const id = await create(staff, "challan", `A12/${stage}`);
    await updateDoc(doc(admin, "challans", id), { stage, items: [{ sourceInventoryId: "unchanged-stock" }] });
    await assertFails(updateDoc(doc(staff, "challans", id), { number: `A99/${stage}` }));
    await assertSucceeds(runTransaction(admin, async (tx) => {
      const claim = await prepareNumberClaim(tx, admin, "challan", `A125/${stage}`, id, `A12/${stage}`);
      claim();
      tx.update(doc(admin, "challans", id), { number: `A125/${stage}` });
    }));
    assert.equal((await getDoc(doc(admin, "challans", id))).data().items[0].sourceInventoryId, "unchanged-stock");
    assert.equal((await getDoc(numberRegistryRef(admin, "challan", `A12/${stage}`))).exists(), false);
    await assertSucceeds(create(staff, "challan", `A12/${stage}`));
    await assertFails(updateDoc(doc(admin, "challans", id), { number: "A125/01" }));
    await assertFails(updateDoc(doc(admin, "challans", id), { number: `A12/${stage}` }));
  }
});
test("staff cannot rename even with an atomic claim; purchase number remains immutable", async () => {
  const db = database();
  const id = await create(db, "challan", "A1/1");
  await assertFails(runTransaction(db, async (tx) => {
    const claim = await prepareNumberClaim(tx, db, "challan", "A1/2", id);
    claim(); tx.update(doc(db, "challans", id), { number: "A1/2" });
  }));
  const pid = await create(db, "purchase", "PR-A1-1");
  for (const uid of ["staff", "admin"])
    await assertFails(updateDoc(doc(database(uid), "purchases", pid), { purchaseId: "PR-A1-2" }));
});
test("legacy records and ordinary staff edits/stage transitions remain usable", async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    for (const kind of ["challan", "purchase"])
      await setDoc(doc(db, source(kind), "legacy"), { [field(kind)]: "LEGACY-0001", createdBy: "staff", createdAt: Timestamp.now(), stage: 1 });
  });
  for (const kind of ["challan", "purchase"]) {
    await assertSucceeds(updateDoc(doc(database(), source(kind), "legacy"), { notes: "unchanged identifier" }));
    assert.equal((await getDoc(doc(database(), source(kind), "legacy"))).data()[field(kind)], "LEGACY-0001");
  }
  await assertSucceeds(updateDoc(doc(database("other"), "challans", "legacy"), { stage: 2, stage2Return: { items: [] }, stageHistory: {} }));
});
test("registry cannot be forged, overwritten, or deleted while the record owns it", async () => {
  const db = database("admin");
  await create(db, "challan", "A1/1", "existing", "admin");
  await assertFails(setDoc(numberRegistryRef(db, "challan", "A1/2"), { number: "A1/2", recordId: "missing" }));
  await assertFails(setDoc(numberRegistryRef(db, "challan", "A1/1"), { number: "A1/1", recordId: "other" }));
  await assertFails(deleteDoc(numberRegistryRef(db, "challan", "A1/1")));
  await assertFails(setDoc(doc(database("limited"), "numberingMigrations", "manual-v1"), { ready: true }));
});
test("deletion releases the number atomically and allows reuse", async () => {
  const db = database("admin");
  for (const kind of ["challan", "purchase"]) {
    const number = kind === "challan" ? "A1/1" : "PR-A1-1";
    await create(db, kind, number, "deleted", "admin");
    await assertSucceeds(runTransaction(db, async (tx) => {
      const release = await prepareNumberRelease(tx, db, kind, number, "deleted");
      release(); tx.delete(doc(db, source(kind), "deleted"));
    }));
    await assertSucceeds(create(db, kind, number, "replacement", "admin"));
  }
});
test("no counter writes, no unauthorized staff access, fail closed until indexed", async () => {
  const db = database("admin");
  for (const kind of ["challan", "purchase"]) {
    await assertFails(setDoc(doc(db, "counters", kind), { series: 35, number: 1 }));
    await assertFails(rawCreate(database("limited"), kind, kind === "challan" ? "A1/1" : "PR-A1-1", kind, true, "limited"));
  }
  await env.withSecurityRulesDisabled((context) => deleteDoc(doc(context.firestore(), "numberingMigrations", "manual-v1")));
  await assertFails(rawCreate(db, "challan", "A1/1", "blocked", true, "admin"));
  await assertFails(rawCreate(db, "purchase", "PR-A1-1", "blocked", true, "admin"));
});
test("migration preserves original records, indexes legacy numbers, and reserves pre-existing duplicates", async () => {
  const admin = database("admin");
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await deleteDoc(doc(db, "numberingMigrations", "manual-v1"));
    await setDoc(doc(db, "challans", "old"), { number: "A125/7", items: [{ inventoryId: "stock", amount: 250 }], stage: 4 });
    await setDoc(doc(db, "challans", "old-format"), { number: "CH-0001", stage: 2 });
    await setDoc(doc(db, "challans", "duplicate-one"), { number: "A12/25" });
    await setDoc(doc(db, "challans", "duplicate-two"), { number: "A12/25" });
    await setDoc(doc(db, "purchases", "old-purchase"), { purchaseId: "PR-A99-100", amount: 100 });
  });
  const dump = async () => JSON.stringify(await Promise.all(["challans", "purchases"].map(async (name) => (await getDocs(collection(admin, name))).docs.map((entry) => [entry.id, entry.data()]))));
  const before = await dump();
  const run = promisify(execFile);
  const args = ["scripts/registerDocumentNumbers.mjs", "--project=demo-jewellery-numbering"];
  await run(process.execPath, args);
  assert.equal((await getDoc(doc(admin, "numberingMigrations", "manual-v1"))).exists(), false);
  assert.equal((await getDocs(collection(admin, "challanNumbers"))).size, 0);
  await run(process.execPath, [...args, "--apply"]);
  assert.equal((await getDoc(doc(admin, "numberingMigrations", "manual-v1"))).data().ready, true);
  assert.equal(await dump(), before);
  assert.equal((await getDoc(numberRegistryRef(admin, "challan", "A125/7"))).data().recordId, "old");
  assert.equal((await getDoc(numberRegistryRef(admin, "challan", "A12/25"))).data().recordId, null);
  await assert.rejects(create(admin, "challan", "A12/25", "third", "admin"), /already exists/);
  await assertFails(rawCreate(admin, "purchase", "PR-A99-100", "duplicate-purchase", true, "admin"));
  await run(process.execPath, [...args, "--apply"]);
  assert.equal(await dump(), before);
});
test("Admin can register existing numbers from Settings on the free plan", async () => {
  const admin = database("admin"), staff = database("staff");
  await env.withSecurityRulesDisabled(async (context) => {
    const local = context.firestore();
    await deleteDoc(doc(local, "numberingMigrations", "manual-v1"));
    await setDoc(doc(local, "challans", "old"), { number: "A125/7", stage: 1 });
    await setDoc(doc(local, "purchases", "old"), { purchaseId: "PR-A1-1", amount: 10 });
  });
  await assert.rejects(create(staff, "challan", "A1/1", "before"), /Number setup is incomplete/);
  const result = await registerExistingNumbers(admin);
  assert.equal(result.challans, 1);
  assert.equal(result.purchases, 1);
  assert.equal((await getDoc(doc(admin, "numberingMigrations", "manual-v1"))).data().ready, true);
  assert.equal((await getDoc(numberRegistryRef(admin, "challan", "A125/7"))).data().recordId, "old");
  assert.equal((await getDoc(numberRegistryRef(admin, "purchase", "PR-A1-1"))).data().recordId, "old");
  await assert.rejects(create(admin, "purchase", "PR-A1-1", "repeat", "admin"), /already exists/);
  await assertSucceeds(create(staff, "challan", "A1/1", "after"));
});

test("audit: Staff Stage 2 stock return is denied for older Admin-owned Inventory", async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "inventory", "stock"), {
      weight: 1, pieces: 1, createdBy: "admin",
      createdAt: Timestamp.fromMillis(Date.now() - 2 * 60 * 60 * 1000),
    });
    await setDoc(doc(db, "challans", "return"), {
      number: "A1/1", stage: 1, createdBy: "staff", createdAt: Timestamp.now(),
    });
  });
  const move = async (db) => runTransaction(db, async (tx) => {
    const stock = doc(db, "inventory", "stock");
    const challan = doc(db, "challans", "return");
    await Promise.all([tx.get(stock), tx.get(challan)]);
    tx.update(stock, { weight: 1.5, pieces: 2, updatedAt: serverTimestamp() });
    tx.update(challan, { stage: 2, stage2Return: { items: [] }, stageHistory: {} });
  });
  await assertFails(move(database("staff")));
  assert.equal((await getDoc(doc(database("admin"), "challans", "return"))).data().stage, 1);
  await assertSucceeds(move(database("admin")));
});
