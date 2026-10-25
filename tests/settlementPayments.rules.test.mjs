import test, { before, after, beforeEach } from "node:test";
import { readFile } from "node:fs/promises";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from "@firebase/rules-unit-testing";
import {
  doc,
  setDoc,
  updateDoc,
  getDoc,
  getDocs,
  collection,
  query,
  where,
  serverTimestamp,
  runTransaction,
} from "firebase/firestore";
import {
  recordSettlementPayment,
  correctSettlement,
  initializeSettlement,
} from "../src/utils/settlementPayments.js";
let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-settlement-payments",
    firestore: {
      host: "127.0.0.1",
      port: 8180,
      rules: await readFile("firestore.rules", "utf8"),
    },
  });
});
after(async () => env?.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    for (const [uid, permissions] of [
      ["admin", []],
      ["staff", ["challan-stage-4"]],
      ["read-only", ["challan-stage-3"]],
    ])
      await setDoc(doc(db, "employeeProfiles", uid), {
        active: true,
        role: uid === "admin" ? "superadmin" : "employee",
        permissions,
      });
    await setDoc(doc(db, "challans", "one"), {
      stage: 3,
      number: "A1/1",
      party: "Rohan",
      items: [],
      stageHistory: { stage1: { enteredAtMs: 1 }, stage3: { enteredAtMs: 2 } },
      finalInvoice: { finalInvoiceAmount: 15000 },
    });
  });
});
const dbFor = (uid) => env.authenticatedContext(uid).firestore();
async function pay(uid, paid, discount, id) {
  const db = dbFor(uid),
    ref = doc(db, "challans", "one");
  return runTransaction(db, async (tx) => {
    const current = (await tx.get(ref)).data();
    if (current.settlementPayments?.some((entry) => entry.id === id))
      return current;
    const update = recordSettlementPayment(
      current,
      paid,
      discount,
      id,
      Date.now(),
      { uid, accessId: uid, role: uid === "admin" ? "superadmin" : "employee" },
    );
    if (current.stage === 3)
      update.stageHistory = {
        ...current.stageHistory,
        stage4: {
          enteredAtMs: update.finalSettlement.completedAtMs,
          enteredAt: serverTimestamp(),
        },
      };
    tx.update(ref, update);
    return { ...current, ...update };
  });
}
test("Admin and authorized Staff move partial payments to Stage 4 and collect outstanding there", async () => {
  await assertSucceeds(pay("staff", "10000", "", "p1"));
  let current = (await getDoc(doc(dbFor("admin"), "challans", "one"))).data();
  if (current.stage !== 4 || current.finalSettlement.remaining !== 5000)
    throw Error("Incorrect partial state");
  const enteredAtMs = current.stageHistory.stage4.enteredAtMs;
  await assertSucceeds(pay("admin", "5000", "", "p2"));
  current = (await getDoc(doc(dbFor("admin"), "challans", "one"))).data();
  if (current.stage !== 4 || current.finalSettlement.amountPaid !== 15000)
    throw Error("Incorrect completion");
  if (current.stageHistory.stage4.enteredAtMs !== enteredAtMs)
    throw Error("Collecting outstanding reset the Stage 4 edit window");
});
test("unauthorized writes, ledger edits and forged totals are rejected", async () => {
  await assertFails(pay("read-only", "10000", "", "p1"));
  await pay("staff", "10000", "", "p1");
  const ref = doc(dbFor("staff"), "challans", "one");
  await assertFails(updateDoc(ref, { settlementPayments: [] }));
  await assertFails(updateDoc(ref, { "paymentSummary.remaining": 0 }));
  await assertFails(updateDoc(ref, { items: [{ sku: "tampered" }] }));
});
test("retry ID is idempotent and concurrent excessive payments cannot overpay", async () => {
  await pay("staff", "10000", "", "p1");
  await pay("staff", "10000", "", "p1");
  const results = await Promise.allSettled([
    pay("staff", "4000", "", "p2"),
    pay("admin", "4000", "", "p3"),
  ]);
  if (results.filter((entry) => entry.status === "fulfilled").length !== 1)
    throw Error("Concurrent overpayment was accepted");
  const current = (await getDoc(doc(dbFor("admin"), "challans", "one"))).data();
  if (
    current.paymentSummary.remaining !== 1000 ||
    current.settlementPayments.length !== 2
  )
    throw Error("Duplicate payment counted");
});

async function seedLegacy(ageMinutes = 120) {
  await env.withSecurityRulesDisabled(async (c) => {
    await setDoc(doc(c.firestore(), "employeeProfiles", "role-admin"), {
      active: true,
      role: "admin",
      permissions: [],
    });
    await setDoc(doc(c.firestore(), "challans", "one"), {
      stage: 4,
      createdBy: "staff",
      createdByRole: "employee",
      party: "Rohan",
      date: "2026-10-26",
      notes: "",
      finalInvoice: { finalInvoiceAmount: 5000 },
      finalSettlement: {
        amountPaid: 3000,
        settlementDiscountAmount: 350,
        remaining: 0,
        completedAtMs: 123,
      },
      stageHistory: {
        stage4: { enteredAtMs: Date.now() - ageMinutes * 60000 },
      },
    });
  });
}
async function correct(uid, paid = "2900", discount = "350", id = "c1") {
  const db = dbFor(uid);
  const ref = doc(db, "challans", "one");
  return runTransaction(db, async (tx) => {
    const current = (await tx.get(ref)).data();
    const update = correctSettlement(current, paid, discount, id, Date.now(), {
      uid,
      accessId: uid,
      role:
        uid === "admin"
          ? "superadmin"
          : uid === "role-admin"
            ? "admin"
            : "employee",
    });
    tx.update(ref, update);
    return { ...current, ...update };
  });
}
test("legacy carry-forward and corrections keep history/summary consistent and Staff edits timed", async () => {
  await seedLegacy();
  await assertFails(correct("staff"));
  await assertSucceeds(correct("role-admin"));
  await assertSucceeds(correct("admin", "2800", "350", "c2"));
  await assertSucceeds(pay("staff", "1000", "", "r1"));
  const current = (await getDoc(doc(dbFor("admin"), "challans", "one"))).data();
  if (
    current.paymentSummary.remaining !== 850 ||
    current.settlementPayments.length !== 1 ||
    current.settlementCorrections.length !== 2
  )
    throw Error("Legacy cumulative state lost or fictional receipts added");
  const ref = doc(dbFor("admin"), "challans", "one");
  await assertFails(updateDoc(ref, { settlementCorrections: [] }));
  await assertFails(
    updateDoc(ref, {
      settlementOpening: {
        amountPaid: 0,
        paidCents: 0,
        discountCents: 0,
        settlementDiscountAmount: 0,
      },
    }),
  );
  await assertFails(updateDoc(ref, { "finalSettlement.remaining": 0 }));
  await seedLegacy(30);
  await assertSucceeds(correct("staff"));
});

test("role-admin query/read and metadata edit exception remains scoped to Stage 4", async () => {
  await seedLegacy(5 * 24 * 60);
  const db = dbFor("role-admin");
  await assertSucceeds(
    getDocs(query(collection(db, "challans"), where("stage", "==", 4))),
  );
  await assertFails(getDocs(collection(db, "challans")));
  await assertSucceeds(
    updateDoc(doc(db, "challans", "one"), { notes: "Edited days later" }),
  );
  for (const stage of [1, 2, 3]) {
    await env.withSecurityRulesDisabled((c) =>
      updateDoc(doc(c.firestore(), "challans", "one"), { stage }),
    );
    await assertFails(getDoc(doc(db, "challans", "one")));
    await assertFails(
      updateDoc(doc(db, "challans", "one"), { notes: "Not allowed" }),
    );
  }
});
test("legacy metadata save can synchronize totals without inventing receipt events", async () => {
  await seedLegacy();
  const db = dbFor("admin"),
    ref = doc(db, "challans", "one");
  const current = (await getDoc(ref)).data();
  await assertSucceeds(
    updateDoc(ref, {
      ...initializeSettlement(current),
      notes: "Metadata correction",
    }),
  );
  const saved = (await getDoc(ref)).data();
  if (
    saved.finalSettlement.remaining !== 1650 ||
    saved.settlementPayments.length !== 0 ||
    saved.settlementCorrections
  )
    throw Error("Metadata save fabricated a financial event");
});
