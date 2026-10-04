import { before, beforeEach, after, test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import {
  initializeTestEnvironment,
  assertFails,
} from "@firebase/rules-unit-testing";
import {
  doc,
  setDoc,
  getDoc,
  serverTimestamp,
  setLogLevel,
} from "firebase/firestore";
import {
  resetAction,
  processResetStep,
  BUSINESS_COLLECTIONS,
} from "../functions/resetCore.mjs";
import {
  setBusinessGeneration,
  runTransaction,
} from "../src/firebase/businessWrites.js";
import { saveInventoryIdentity } from "../src/utils/inventoryIdentity.js";
import { prepareNumberClaim } from "../src/utils/numberRegistry.js";
if (!/^127\.0\.0\.1:/.test(process.env.FIRESTORE_EMULATOR_HOST || ""))
  throw Error("Loopback emulator required");
const require = createRequire(
  new URL("../functions/package.json", import.meta.url),
);
const { initializeApp, deleteApp } = require("firebase-admin/app"),
  { getFirestore } = require("firebase-admin/firestore");
const app = initializeApp({ projectId: "demo-business-reset" }, "reset-tests"),
  db = getFirestore(app);
setLogLevel("silent");
let env;
const claims = (uid = "admin") => ({
  uid,
  auth_time: Math.floor(Date.now() / 1000),
  firebase: { sign_in_provider: "password" },
});
const state = async () => (await db.doc("systemState/business").get()).data();
async function start() {
  const c = claims(),
    { token } = await resetAction(db, c, { action: "prepare" });
  await resetAction(db, c, { action: "acknowledge", token });
  await resetAction(db, c, {
    action: "start",
    token,
    phrase: "DELETE ALL RECORDS",
  });
  return state();
}
async function finish(options) {
  for (let i = 0; i < 200; i++) {
    const s = await state();
    if (s.status !== "running") return s;
    await processResetStep(db, s, options);
  }
  throw Error("Reset did not terminate");
}
before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-business-reset",
    firestore: { rules: await readFile("firestore.rules", "utf8") },
  });
});
after(async () => {
  await env.cleanup();
  await deleteApp(app);
});
beforeEach(async () => {
  await env.clearFirestore();
  setBusinessGeneration(0);
  await db
    .doc("employeeProfiles/admin")
    .set({ role: "superadmin", active: true, accessId: "admin" });
  await db
    .doc("employeeProfiles/staff")
    .set({
      role: "employee",
      active: true,
      permissions: ["inventory", "purchase", "challan-stage-1"],
    });
});
test("backend denies unauthenticated, Staff, stale auth, skipped warning, wrong phrase and reused token", async () => {
  for (const c of [{}, claims("staff"), { ...claims(), auth_time: 1 }])
    await assert.rejects(resetAction(db, c, { action: "prepare" }));
  const c = claims(),
    { token } = await resetAction(db, c, { action: "prepare" });
  await assert.rejects(
    resetAction(db, c, {
      action: "start",
      token,
      phrase: "DELETE ALL RECORDS",
    }),
  );
  assert.equal(await state(), undefined);
  await resetAction(db, c, { action: "acknowledge", token });
  await assert.rejects(
    resetAction(db, c, {
      action: "start",
      token,
      phrase: "delete all records",
    }),
  );
  await resetAction(db, c, {
    action: "start",
    token,
    phrase: "DELETE ALL RECORDS",
  });
  await assert.rejects(
    resetAction(db, c, {
      action: "start",
      token,
      phrase: "DELETE ALL RECORDS",
    }),
  );
});
test("all audited business roots, nested/orphan data removed; configuration/accounts preserved; ready state", async () => {
  for (const name of BUSINESS_COLLECTIONS) {
    await db.doc(`${name}/old`).set({ sample: true });
    await db.doc(`${name}/missing/nested/child`).set({ sample: true });
  }
  for (const name of ["settings", "shapes", "staffCredentials"])
    await db.doc(`${name}/keep`).set({ preserved: true });
  await start();
  assert.equal((await finish()).status, "complete");
  for (const name of BUSINESS_COLLECTIONS) {
    const docs = await db.collection(name).get();
    assert.equal(
      docs.size,
      name === "numberingMigrations"
        ? 2
        : name === "inventoryIdentityMigrations"
          ? 1
          : 0,
    );
    assert.equal(
      (await db.doc(`${name}/missing/nested/child`).get()).exists,
      false,
    );
  }
  for (const path of [
    "employeeProfiles/admin",
    "employeeProfiles/staff",
    "settings/keep",
    "shapes/keep",
    "staffCredentials/keep",
  ])
    assert.equal((await db.doc(path).get()).exists, true);
  for (const path of [
    "inventoryIdentityMigrations/v1",
    "numberingMigrations/manual-v1",
    "numberingMigrations/letters-v1",
  ])
    assert.equal((await db.doc(path).get()).data().ready, true);
  assert.equal((await state()).locked, false);
  assert.equal(
    (await db.collection("businessResetAudits").get()).docs[0].data().status,
    "complete",
  );
});
test("maintenance blocks Admin/Staff direct writes and control/token forgery", async () => {
  await start();
  for (const uid of ["admin", "staff"]) {
    const client = env.authenticatedContext(uid).firestore();
    for (const name of BUSINESS_COLLECTIONS)
      await assertFails(
        setDoc(doc(client, name, "attack"), { businessGeneration: 1 }),
      );
    await assertFails(
      setDoc(doc(client, "systemState", "business"), { locked: false }),
    );
    await assertFails(getDoc(doc(client, "resetAuthorizations", "secret")));
  }
});
test("interrupted image cleanup remains locked, preserves reference, resumes idempotently; duplicate worker is fenced", async () => {
  await db
    .doc("challans/old")
    .set({
      stage1Images: [
        { publicId: "local-image", secureUrl: "https://example.test/image" },
      ],
    });
  await start();
  await processResetStep(db, await state());
  const s = await state();
  await processResetStep(db, s, {
    removeImage: async () => {
      throw Error("injected failure");
    },
  });
  assert.equal((await state()).status, "incomplete");
  assert.equal((await state()).locked, true);
  assert.equal((await db.doc("challans/old").get()).exists, true);
  await start();
  const resumed = await state();
  let images = 0;
  const results = await Promise.all([
    processResetStep(db, resumed, { removeImage: async () => images++ }),
    processResetStep(db, resumed, { removeImage: async () => images++ }),
  ]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.ok(images >= 1);
  assert.equal((await finish()).status, "complete");
  await start();
  assert.equal((await finish()).status, "complete");
  assert.equal((await state()).generation, 2);
});
test("unknown collection fails closed before deleting known data", async () => {
  await db.doc("unreviewed/a").set({ keep: true });
  await db.doc("inventory/a").set({ keep: true });
  await start();
  await processResetStep(db, await state());
  assert.equal((await state()).status, "incomplete");
  assert.equal((await db.doc("inventory/a").get()).exists, true);
});
test("fresh Inventory, Purchase and Challan creation work; stale pre-reset payload rejected", async () => {
  await start();
  await finish();
  const client = env.authenticatedContext("admin").firestore();
  await assertFails(setDoc(doc(client, "parties", "stale"), { name: "old" }));
  setBusinessGeneration(1);
  await saveInventoryIdentity(client, doc(client, "inventory", "fresh"), {
    size: "5.00",
    shape: "PR",
    type: "CBD",
    weight: 2,
    createdBy: "admin",
    createdAt: serverTimestamp(),
  });
  assert.equal(
    (await getDoc(doc(client, "inventory", "fresh"))).data().sku,
    "5_PR_CBD",
  );
  for (const kind of ["challan", "purchase"])
    await runTransaction(client, async (tx) => {
      const id = `new-${kind}`,
        number = kind === "challan" ? "A1/1" : "PR-A1-1",
        claim = await prepareNumberClaim(tx, client, kind, number, id);
      claim();
      const data =
        kind === "challan"
          ? { number, stage: 1 }
          : {
              id,
              purchaseId: number,
              date: "2026-10-03",
              vendorName: "New Vendor",
              totalWeight: 1,
              amount: 100,
              discount: 0,
              discountAmount: 0,
              netPayable: 100,
              paymentDueDays: 0,
              paymentDueDate: "2026-10-03",
              items: [{ weight: 1 }],
              itemCount: 1,
            };
      tx.set(doc(client, kind === "challan" ? "challans" : "purchases", id), {
        ...data,
        createdBy: "admin",
        createdAt: serverTimestamp(),
      });
    });
  assert.equal((await db.collection("challans").get()).size, 1);
  assert.equal((await db.collection("purchases").get()).size, 1);
});
