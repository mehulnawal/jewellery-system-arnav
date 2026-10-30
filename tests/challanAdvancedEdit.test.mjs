import { before, after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from "@firebase/rules-unit-testing";
import { doc, setDoc, getDoc, updateDoc, Timestamp } from "firebase/firestore";
import {
  advancedEditRows,
  saveAdvancedChallanEdit,
} from "../src/utils/challanAdvancedEdit.js";
import { priceWeightedItem } from "../src/utils/challanCalculations.js";

let env;
const user = {
  uid: "staff",
  role: "employee",
  permissions: ["challan-stage-2", "challan-stage-3"],
};
before(async () => {
  assert.ok(
    process.env.FIRESTORE_EMULATOR_HOST?.startsWith("127.0.0.1:"),
    "Local emulator required",
  );
  env = await initializeTestEnvironment({
    projectId: "demo-advanced-challan-edit",
    firestore: { rules: await readFile("firestore.rules", "utf8") },
  });
});
after(async () => env?.cleanup());
beforeEach(async () => env.clearFirestore());

async function seed(stage, { stock = 30, age = 10 } = {}) {
  const item = {
    id: "line",
    inventoryId: "A",
    sourceInventoryId: "A",
    sku: "1_Pear_CVD",
    shape: "Pear",
    size: "1",
    width: "",
    type: "CVD",
    weight: 10,
    pieces: 10,
    ...priceWeightedItem(10, 100, 10),
  };
  const row = {
    id: "one",
    number: "A1/1",
    party: "Customer",
    date: "2026-10-31",
    notes: "",
    stage,
    createdAt: Timestamp.fromMillis(Date.now() - 3 * 86400000),
    createdBy: "staff",
    createdByRole: "employee",
    items: [item],
    amount: 1000,
    discountAmount: 100,
    netAmount: 900,
    discount: 10,
    stage2Return: {
      items: [
        {
          ...item,
          issuedWeight: 10,
          issuedPieces: 10,
          returnWeight: 5,
          returnPieces: 5,
          soldWeight: 5,
          soldPieces: 5,
        },
      ],
      transitionedAtMs: 1,
      notes: "Returned five",
    },
    stageHistory: {
      stage2: { enteredAtMs: Date.now() - (stage === 2 ? age : 200) * 60000 },
      ...(stage === 3
        ? { stage3: { enteredAtMs: Date.now() - age * 60000 } }
        : {}),
    },
    ...(stage === 3
      ? {
          finalInvoice: {
            items: [{ finalAmount: 450 }],
            finalInvoiceAmount: 450,
            confirmedAtMs: 123,
          },
        }
      : {}),
  };
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "employeeProfiles", "staff"), {
      active: true,
      role: "employee",
      permissions: user.permissions,
    });
    await setDoc(doc(db, "employeeProfiles", "admin"), {
      active: true,
      role: "superadmin",
      permissions: [],
    });
    await setDoc(doc(db, "inventory", "A"), {
      sku: item.sku,
      shape: "Pear",
      type: "CVD",
      size: "1",
      weight: 95,
      pieces: 95,
    });
    await setDoc(doc(db, "inventory", "B"), {
      sku: "2_Oval_HP",
      shape: "Oval",
      type: "HP",
      size: "2",
      weight: stock,
      pieces: stock,
    });
    await setDoc(doc(db, "challans", "one"), row);
  });
  return row;
}
const dbFor = (uid = "staff") => env.authenticatedContext(uid).firestore();
const read = async (collection, id, uid = "staff") =>
  (await getDoc(doc(dbFor(uid), collection, id))).data();
const formFor = (row) => ({
  number: row.number,
  party: row.party,
  date: row.date,
  notes: row.notes,
  items: advancedEditRows(row),
});
const replacement = (form) => ({
  ...form,
  items: [
    {
      ...form.items[0],
      inventoryId: "B",
      sku: "2_Oval_HP",
      type: "HP",
      shape: "Oval",
      size: "2",
      weight: "8",
      pieces: "8",
      returnWeight: "2",
      returnPieces: "2",
      amount: "200",
      discount: "5",
    },
  ],
});

for (const stage of [2, 3]) {
  for (const role of ["staff", "admin"]) {
    test(`Stage ${stage} ${role} can replace SKU and edit quantities/rate/discount atomically`, async () => {
      const row = await seed(stage);
      const actor =
        role === "admin" ? { uid: "admin", role: "superadmin" } : user;
      const saved = await saveAdvancedChallanEdit(
        dbFor(role),
        row,
        replacement(formFor(row)),
        actor,
        Date.now(),
      );
      assert.equal((await read("inventory", "A")).weight, 100);
      assert.equal((await read("inventory", "A")).pieces, 100);
      assert.equal((await read("inventory", "B")).weight, 24);
      assert.equal((await read("inventory", "B")).pieces, 24);
      assert.equal(saved.items[0].sourceInventoryId, "B");
      assert.equal(saved.stage2Return.items[0].soldWeight, 6);
      assert.equal(saved.items[0].netAmount, 1520);
      assert.deepEqual(saved.stageHistory, row.stageHistory);
      if (stage === 3) {
        assert.equal(saved.finalInvoice.finalInvoiceAmount, 1140);
        assert.equal(saved.finalInvoice.confirmedAtMs, 123);
      } else assert.equal(saved.finalInvoice, undefined);
      assert.equal((await read("challans", "one")).stockEdit.actorUid, role);
    });
  }
  test(`Stage ${stage} rate/discount edit recalculates billing without moving stock`, async () => {
    const row = await seed(stage);
    const form = formFor(row);
    form.items[0].amount = 200;
    form.items[0].discount = 5;
    const saved = await saveAdvancedChallanEdit(
      dbFor(),
      row,
      form,
      user,
      Date.now(),
    );
    assert.equal((await read("inventory", "A")).weight, 95);
    assert.equal(
      (await read("inventory", "A")).challanReservations.one.weightMillis,
      5000,
    );
    assert.equal(saved.items[0].netAmount, 1900);
    if (stage === 3) assert.equal(saved.finalInvoice.finalInvoiceAmount, 950);
  });
  test(`Stage ${stage} insufficient replacement stock saves nothing`, async () => {
    const row = await seed(stage, { stock: 2 });
    await assert.rejects(
      saveAdvancedChallanEdit(
        dbFor(),
        row,
        replacement(formFor(row)),
        user,
        Date.now(),
      ),
      /Not enough stock/,
    );
    assert.equal((await read("inventory", "A")).weight, 95);
    assert.equal((await read("inventory", "B")).weight, 2);
    assert.equal((await read("challans", "one")).items[0].inventoryId, "A");
  });
  test(`Stage ${stage} expires for both roles without changing stock or restarting its timer`, async () => {
    const row = await seed(stage, { age: 61 });
    for (const actor of [user, { uid: "admin", role: "superadmin" }])
      await assert.rejects(
        saveAdvancedChallanEdit(
          dbFor(actor.uid),
          row,
          replacement(formFor(row)),
          actor,
          Date.now(),
        ),
        /no longer editable/,
      );
    assert.equal((await read("inventory", "A")).weight, 95);
  });
}

test("A concurrent price edit is detected and two saves cannot restore stock twice", async () => {
  const row = await seed(2);
  const results = await Promise.allSettled(
    [1, 2].map(() =>
      saveAdvancedChallanEdit(
        dbFor(),
        row,
        replacement(formFor(row)),
        user,
        Date.now(),
      ),
    ),
  );
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal((await read("inventory", "A")).weight, 100);
  assert.equal((await read("inventory", "B")).weight, 24);
  const next = await seed(2);
  await env.withSecurityRulesDisabled((context) =>
    updateDoc(doc(context.firestore(), "challans", "one"), {
      stage2Prices: { 0: 120 },
    }),
  );
  await assert.rejects(
    saveAdvancedChallanEdit(
      dbFor(),
      next,
      replacement(formFor(next)),
      user,
      Date.now(),
    ),
    /changed while you were editing/,
  );
});

test("Staff cannot independently restore stock, forge quantities, or edit after expiry", async () => {
  await seed(2);
  await assertFails(
    updateDoc(doc(dbFor(), "inventory", "A"), { weight: 100, pieces: 100 }),
  );
  await assertFails(
    updateDoc(doc(dbFor(), "inventory", "A"), {
      weight: 100,
      pieces: 100,
      challanEdit: {
        id: "forged",
        challanId: "one",
        oldIndex: 0,
        newIndex: -1,
      },
    }),
  );
  await assertFails(
    updateDoc(doc(dbFor(), "challans", "one"), { items: [{ sku: "forged" }] }),
  );
  await assertSucceeds(
    updateDoc(doc(dbFor(), "challans", "one"), {
      notes: "Metadata remains editable",
    }),
  );
});

test("Changing quantities on the same SKU applies only the difference and a full return credits the remainder", async () => {
  const row = await seed(3);
  const form = formFor(row);
  form.items[0].weight = 12;
  form.items[0].pieces = 12;
  const saved = await saveAdvancedChallanEdit(
    dbFor(),
    row,
    form,
    user,
    Date.now(),
  );
  assert.equal((await read("inventory", "A")).weight, 93);
  assert.equal(saved.finalInvoice.finalInvoiceAmount, 630);
  const next = await read("challans", "one");
  const full = formFor(next);
  full.items[0].returnWeight = 12;
  full.items[0].returnPieces = 12;
  const returned = await saveAdvancedChallanEdit(
    dbFor(),
    next,
    full,
    user,
    Date.now(),
  );
  assert.equal((await read("inventory", "A")).weight, 100);
  assert.equal(returned.finalInvoice.finalInvoiceAmount, 0);
});

test("Adding several different SKUs reconciles all linked stock in one save", async () => {
  const row = await seed(2);
  const form = formFor(row);
  const sample = replacement(form).items[0];
  const additions = [];
  await env.withSecurityRulesDisabled(async (context) => {
    for (let index = 0; index < 6; index++) {
      const inventoryId = "extra-" + index;
      const sku = `${index + 2}_Oval_HP`;
      await setDoc(doc(context.firestore(), "inventory", inventoryId), {
        sku,
        shape: "Oval",
        size: String(index + 2),
        type: "HP",
        weight: 30,
        pieces: 30,
      });
      additions.push({
        ...sample,
        id: inventoryId,
        inventoryId,
        sku,
        size: String(index + 2),
      });
    }
  });
  const saved = await saveAdvancedChallanEdit(
    dbFor(),
    row,
    { ...form, items: additions },
    user,
    Date.now(),
  );
  assert.equal(saved.items.length, 6);
  assert.equal((await read("inventory", "A")).weight, 100);
  for (const item of additions)
    assert.equal((await read("inventory", item.inventoryId)).weight, 24);
});
