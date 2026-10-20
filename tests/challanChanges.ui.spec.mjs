import { test, expect } from "@playwright/test";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import {
  initializeTestEnvironment,
  assertFails,
} from "@firebase/rules-unit-testing";
import { readFile } from "node:fs/promises";
import { doc, updateDoc } from "firebase/firestore";
import * as XLSX from "xlsx";

if (!process.env.FIRESTORE_EMULATOR_HOST?.startsWith("127.0.0.1:"))
  throw Error("Loopback Firestore emulator required");
const app = initializeApp(
  { projectId: "demo-jewellery-ui" },
  "challan-changes-tests",
);
const db = getFirestore(app);
let env;
const item = {
  id: "line",
  sku: "1_Round_CVD",
  type: "CVD",
  shape: "Round",
  size: "1",
  width: "",
  pieces: 1,
  weight: 1,
  amount: 1000,
  discount: 0,
  discountAmount: 0,
  netAmount: 1000,
  inventoryId: "stock",
  sourceInventoryId: "stock",
};
const image = {
  secureUrl: "https://res.cloudinary.com/test-cloud/image/upload/old.png",
  publicId: "old",
  originalFilename: "old.png",
};
async function seed(stage, createdBy = "admin", id = "challan-" + stage) {
  const row = {
    id,
    number: "B40/" + stage,
    party: "Test Party",
    date: "2026-10-06",
    stage,
    notes: "Saved note",
    items: [item],
    amount: 1000,
    discountAmount: 0,
    netAmount: 1000,
    createdAt: Timestamp.now(),
    createdBy,
    createdByRole: createdBy === "admin" ? "superadmin" : "employee",
    stageHistory: { stage1: { enteredAtMs: Date.now() } },
  };
  if (stage >= 2) {
    row.stage1Images = [image];
    row.stageHistory.stage2 = {
      enteredAt: Timestamp.now(),
      enteredAtMs: Date.now(),
    };
    row.stage2Return = {
      items: [
        {
          ...item,
          issuedPieces: 1,
          issuedWeight: 1,
          returnPieces: 0,
          returnWeight: 0,
          soldPieces: 1,
          soldWeight: 1,
        },
      ],
    };
  }
  if (stage >= 3) {
    row.stageHistory.stage3 = {
      enteredAt: Timestamp.now(),
      enteredAtMs: Date.now(),
    };
    row.finalInvoice = {
      items: [
        {
          ...row.stage2Return.items[0],
          grossAmount: 1000,
          stage1DiscountPercent: 0,
          stage1DiscountAmount: 0,
          finalAmount: 1000,
        },
      ],
      grossAmount: 1000,
      stage1DiscountAmount: 0,
      finalInvoiceAmount: 1000,
      confirmedAtMs: Date.now(),
    };
  }
  if (stage === 4) {
    row.stageHistory.stage4 = {
      enteredAt: Timestamp.now(),
      enteredAtMs: Date.now(),
    };
    row.finalSettlement = {
      amountPaid: 1000,
      settlementDiscountAmount: 0,
      actualReceivedAmount: 1000,
      remaining: 0,
      completedAtMs: Date.now(),
    };
  }
  await db.doc("challans/" + id).set(row);
  return id;
}
async function asRole(page, role) {
  await page.addInitScript(
    (value) => localStorage.setItem("test-role", value),
    role,
  );
  await page.goto("/dashboard/challan");
  await expect(page.locator(".availability-banner")).toHaveCount(0);
}
const photo = (name, mimeType = "image/png") => ({
  name,
  mimeType,
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/pXcAAAAASUVORK5CYII=",
    "base64",
  ),
});

test.beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-jewellery-ui",
    firestore: { rules: await readFile("firestore.rules", "utf8") },
  });
});
test.afterAll(async () => {
  await env?.cleanup();
  await deleteApp(app);
});
test.beforeEach(async ({ page }) => {
  await env.clearFirestore();
  await Promise.all(
    ["admin", "staff", "stage-one", "stage-two"].map((uid) =>
      db.doc("employeeProfiles/" + uid).set({
        uid,
        accessId: uid,
        role: uid === "admin" ? "superadmin" : "employee",
        active: true,
        permissions:
          uid === "admin"
            ? []
            : uid === "stage-one"
              ? ["challan-stage-1"]
              : uid === "stage-two"
                ? ["challan-stage-2"]
                : [
                    "challan-stage-1",
                    "challan-stage-2",
                    "challan-stage-3",
                    "challan-stage-4",
                  ],
      }),
    ),
  );
  await page.addInitScript(() => localStorage.setItem("theme", "light"));
  await page.route(/https:\/\/.*(?:googleapis\.com|firebaseio\.com)/, (route) =>
    route.abort(),
  );
  await page.route("https://res.cloudinary.com/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/png",
      body: photo("tiny.png").buffer,
    }),
  );
});

for (const stage of [1, 2]) {
  for (const role of ["admin", "staff"]) {
    test(`Stage ${stage} ${role} uploads multiple images, appends later, and keeps stage references`, async ({
      page,
    }) => {
      const uid =
        role === "staff" ? (stage === 1 ? "stage-one" : "stage-two") : "admin";
      const id = await seed(stage, uid, "upload-" + stage + "-" + role);
      let count = 0;
      await page.route("https://api.cloudinary.com/**", async (route) => {
        count++;
        if (count === 4)
          return route.fulfill({
            status: 400,
            contentType: "application/json",
            body: '{"error":{"message":"private failure"}}',
          });
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            secure_url:
              "https://res.cloudinary.com/test-cloud/image/upload/new-" +
              count +
              ".png",
            public_id: "new-" + count,
            original_filename: "new-" + count + ".png",
          }),
        });
      });
      await asRole(page, uid);
      await page.locator(".challan-row .challan-view-button").click();
      const section = page
        .locator(".challan-image-section")
        .filter({ hasText: "Stage " + stage + " Images" });
      await expect(
        section.getByRole("button", { name: "Upload Images" }),
      ).toBeVisible();
      await section
        .locator("input[type=file]")
        .setInputFiles([photo("first.png"), photo("second.png")]);
      await expect(section.locator(".challan-image-thumbnail")).toHaveCount(2);
      await section
        .locator("input[type=file]")
        .setInputFiles([photo("later.jpg", "image/jpeg"), photo("bad.png")]);
      await expect(section.locator(".challan-image-thumbnail")).toHaveCount(3);
      await expect(section.getByRole("status")).toContainText("bad.png");
      await expect(section.locator(".challan-image-thumbnail")).toHaveCount(3);
      const saved = (await db.doc("challans/" + id).get()).data();
      expect(saved["stage" + stage + "Images"]).toHaveLength(3);
      expect(
        saved["stage" + stage + "Images"].every(
          (entry) => entry.secureUrl && entry.publicId,
        ),
      ).toBe(true);
      expect(
        saved["stage" + (stage === 1 ? 2 : 1) + "Images"]?.length || 0,
      ).toBe(stage === 2 ? 1 : 0);
      await section.locator(".challan-image-thumbnail").first().click();
      await expect(
        page.getByRole("dialog", { name: "Challan image preview" }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Close image preview" }).click();
      await page.getByRole("button", { name: "Back to Challans" }).click();
      await page.locator(".challan-row .challan-view-button").click();
      await expect(section.locator(".challan-image-thumbnail")).toHaveCount(3);
    });
  }
}

test("Stage-specific staff cannot see or attach images in an unauthorized stage", async ({
  page,
}) => {
  const stage1Id = await seed(1, "stage-two", "denied-stage-1");
  const stage2Id = await seed(2, "stage-one", "denied-stage-2");
  await asRole(page, "stage-one");
  await expect(page.locator(".challan-row")).toHaveCount(1);
  await expect(page.locator(".challan-row")).toContainText("B40/1");
  const stageOneUser = env.authenticatedContext("stage-one");
  const stageTwoUser = env.authenticatedContext("stage-two");
  await assertFails(
    updateDoc(doc(stageOneUser.firestore(), "challans", stage2Id), {
      stage2Images: [image],
    }),
  );
  await assertFails(
    updateDoc(doc(stageTwoUser.firestore(), "challans", stage1Id), {
      stage1Images: [image],
    }),
  );
});

for (const stage of [1, 2, 3, 4]) {
  test(`Stage ${stage} Edit hides Print/Export; View prints and exports only this Challan`, async ({
    page,
  }) => {
    await seed(stage);
    await asRole(page, "admin");
    await page.locator(".challan-row .challan-edit").click();
    await expect(
      page
        .locator(".challan-create-actions")
        .getByRole("button", { name: "Print" }),
    ).toHaveCount(0);
    await expect(
      page
        .locator(".challan-create-actions")
        .getByRole("button", { name: "Export" }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Back to Challans" }).click();
    await page.locator(".challan-row .challan-view-button").click();
    const toolbar = page.locator(".challan-view-toolbar");
    await expect(toolbar.getByRole("button", { name: "Print" })).toBeVisible();
    await expect(toolbar.getByRole("button", { name: "Export" })).toBeVisible();
    const downloadPromise = page.waitForEvent("download");
    await toolbar.getByRole("button", { name: "Export" }).click();
    const download = await downloadPromise;
    const book = XLSX.read(await readFile(await download.path()), {
      type: "buffer",
    });
    const details = XLSX.utils.sheet_to_json(book.Sheets.Challan, {
      header: 1,
    });
    expect(details).toContainEqual([
      "Stage",
      "Stage " +
        stage +
        " - " +
        {
          1: "Goods Out",
          2: "Return / Sale",
          3: "Final Invoice / Payment Pending",
          4: "Completed",
        }[stage],
    ]);
    expect(XLSX.utils.sheet_to_json(book.Sheets.Items)[0].SKU).toBe(
      "1_Round_CVD",
    );
    if (stage >= 3)
      expect(details).toContainEqual(["Final Invoice Amount", 1000]);
    if (stage === 4) expect(details).toContainEqual(["Amount Paid", 1000]);
    await page.evaluate(() => {
      window.open = () => ({
        document: {
          write: (html) => {
            window.__challanPrintHtml = html;
          },
          close: () => {},
        },
        focus: () => {},
        print: () => {
          window.__challanPrinted = true;
        },
      });
    });
    await toolbar.getByRole("button", { name: "Print" }).click();
    await expect
      .poll(() => page.evaluate(() => window.__challanPrinted))
      .toBe(true);
    expect(await page.evaluate(() => window.__challanPrintHtml)).toContain(
      "B40/" + stage,
    );
  });
}

test("old Stage 1 keeps Admin Edit and expires Staff Edit", async ({
  page,
}) => {
  await seed(1, "staff", "old-stage-one");
  await db.doc("challans/old-stage-one").update({
    createdAt: Timestamp.fromMillis(Date.now() - 2 * 60 * 60 * 1000),
  });
  await asRole(page, "staff");
  await expect(page.locator(".challan-row .challan-edit")).toHaveCount(0);
  await expect(page.locator(".challan-row .challan-edit-timer")).toHaveText(
    "Edit time ended",
  );
  await expect(page.locator(".challan-row .challan-delete")).toHaveCount(0);
});

for (const stage of [2, 3, 4]) {
  test(
    "Stage " +
      stage +
      " fresh window survives refresh and expires from its own timestamp",
    async ({ page }) => {
      const id = "edit-window-" + stage;
      await seed(stage, "staff", id);
      await db.doc("challans/" + id).update({
        createdAt: Timestamp.fromMillis(Date.now() - 5 * 24 * 60 * 60 * 1000),
      });
      await asRole(page, "staff");
      await expect(page.locator(".challan-row .challan-edit")).toBeVisible();
      await expect(
        page.locator(".challan-row .challan-edit-timer"),
      ).toContainText("Edit available:");
      await page.reload();
      await expect(page.locator(".challan-row .challan-edit")).toBeVisible();
      await db.doc("challans/" + id).update({
        ["stageHistory.stage" + stage + ".enteredAt"]: Timestamp.fromMillis(
          Date.now() - 2 * 60 * 60 * 1000,
        ),
      });
      await expect(page.locator(".challan-row .challan-edit")).toHaveCount(0);
      await expect(page.locator(".challan-row .challan-edit-timer")).toHaveText(
        "Edit time ended",
      );
    },
  );
}

for (const change of ["expire", "finalize"]) {
  test("stale Stage 2 edit cannot save after " + change, async ({ page }) => {
    const id = "stale-edit-" + change;
    await seed(2, "staff", id);
    await asRole(page, "staff");
    await page.locator(".challan-row .challan-edit").click();
    await page.locator(".challan-create textarea").fill("Stale edit");
    if (change === "expire") {
      await db.doc("challans/" + id).update({
        "stageHistory.stage2.enteredAt": Timestamp.fromMillis(
          Date.now() - 2 * 60 * 60 * 1000,
        ),
      });
    } else {
      await db.doc("challans/" + id).update({
        stage: 4,
        finalSettlement: {
          amountPaid: 1000,
          settlementDiscountAmount: 0,
          actualReceivedAmount: 1000,
          remaining: 0,
          completedAtMs: Date.now(),
        },
      });
    }
    await page.getByRole("button", { name: "Save Changes" }).click();
    await expect(page.locator(".challan-form-error")).toContainText(
      change === "expire"
        ? "no longer editable"
        : "changed while you were editing",
    );
    expect((await db.doc("challans/" + id).get()).data().notes).toBe(
      "Saved note",
    );
  });
}

test("Admin Stage 1 remains editable after several days", async ({ page }) => {
  await seed(1, "admin", "admin-old-stage-one");
  await db.doc("challans/admin-old-stage-one").update({
    createdAt: Timestamp.fromMillis(Date.now() - 5 * 24 * 60 * 60 * 1000),
  });
  await asRole(page, "admin");
  await expect(page.locator(".challan-row .challan-edit")).toBeVisible();
  await expect(page.locator(".challan-row .challan-edit-timer")).toHaveCount(0);
  await expect(page.locator(".challan-row .challan-delete")).toBeVisible();
});

test("Final Settlement recalculates blank discount and exact remaining while typing", async ({
  page,
}) => {
  await seed(3);
  await asRole(page, "admin");
  await page.locator(".challan-row .challan-workflow-button").click();
  const modal = page.getByRole("dialog", { name: "Final Settlement" });
  const paid = modal.locator(".settlement-input-grid input").nth(0);
  const discount = modal.locator(".settlement-input-grid input").nth(1);
  const remaining = modal.locator(".settlement-summary-grid strong").nth(3);
  const complete = modal.getByRole("button", {
    name: "Record Payment / Complete",
  });
  await paid.fill("900");
  await expect(remaining).toContainText("₹100.00");
  await expect(complete).toBeDisabled();
  await discount.fill("100");
  await expect(remaining).toContainText("₹0.00");
  await expect(complete).toBeEnabled();
  await discount.fill("");
  await expect(remaining).toContainText("₹100.00");
  await paid.fill("1000");
  await expect(remaining).toContainText("₹0.00");
  await expect(discount).toHaveValue("");
  await expect(complete).toBeEnabled();
  await discount.fill("50");
  await expect(remaining).toContainText("₹-50.00");
  await expect(complete).toBeDisabled();
  await discount.fill("");
  await expect(remaining).toContainText("₹0.00");
  await complete.click();
  await expect(modal).toHaveCount(0);
  expect(
    (await db.doc("challans/challan-3").get()).data().finalSettlement
      .settlementDiscountAmount,
  ).toBe(0);
});
for (const [name, movement, expected] of [
  [
    "full",
    {
      issuedPieces: 1,
      issuedWeight: 1,
      returnPieces: 1,
      returnWeight: 1,
      soldPieces: 0,
      soldWeight: 0,
    },
    0,
  ],
  [
    "no-return",
    {
      issuedPieces: 1,
      issuedWeight: 1,
      returnPieces: 0,
      returnWeight: 0,
      soldPieces: 1,
      soldWeight: 1,
    },
    940,
  ],
  [
    "partial",
    {
      issuedPieces: 10,
      issuedWeight: 5,
      returnPieces: 5,
      returnWeight: 2.5,
      soldPieces: 5,
      soldWeight: 2.5,
    },
    400.5,
  ],
]) {
  test(
    "Stage 3 " +
      name +
      " return invoice saves, reopens, prints and exports the sold amount",
    async ({ page }) => {
      const id = await seed(2, "admin", "invoice-" + name);
      await db.doc("challans/" + id).update({
        items: [
          {
            ...item,
            pieces: movement.issuedPieces,
            weight: movement.issuedWeight,
            amount: 1000,
            discount: 6,
            discountAmount: 60,
            netAmount: 940,
          },
        ],
        stage2Return: {
          items: [{ ...item, ...movement, amount: 1000, discount: 6 }],
        },
      });
      await asRole(page, "admin");
      await page.locator(".challan-row .challan-workflow-button").click();
      const review = page.getByRole("dialog", { name: "Final Invoice Review" });
      if (name === "no-return") {
        await review.getByRole("button", { name: "Close" }).click();
        await page.locator(".challan-row .challan-workflow-button").click();
      }
      if (name === "partial")
        await review
          .getByRole("spinbutton", { name: /Final Billed Amount/ })
          .fill("400.50");
      await expect(review).toContainText("₹" + expected.toFixed(2));
      await review
        .getByRole("button", { name: /Confirm Final Invoice/ })
        .click();
      await expect(review).toHaveCount(0);
      const saved = (await db.doc("challans/" + id).get()).data();
      expect(saved.stage).toBe(3);
      expect(saved.finalInvoice.finalInvoiceAmount).toBe(expected);
      expect(saved.finalInvoice.items[0].finalAmount).toBe(expected);
      await page.reload();
      await page.locator(".challan-row .challan-view-button").click();
      await expect(page.locator(".challan-view-stage-three")).toContainText(
        "₹" + expected.toFixed(2),
      );
      const toolbar = page.locator(".challan-view-toolbar");
      const downloadPromise = page.waitForEvent("download");
      await toolbar.getByRole("button", { name: "Export" }).click();
      const download = await downloadPromise;
      const book = XLSX.read(await readFile(await download.path()), {
        type: "buffer",
      });
      const details = XLSX.utils.sheet_to_json(book.Sheets.Challan, {
        header: 1,
      });
      const rows = XLSX.utils.sheet_to_json(book.Sheets.Items);
      expect(details).toContainEqual(["Final Invoice Amount", expected]);
      expect(rows[0]["Final Item Amount"]).toBe(expected);
      expect(rows[0]["Final Billed Amount"]).toBe(expected);
      await page.evaluate(() => {
        window.open = () => ({
          document: {
            write: (html) => {
              window.__challanPrintHtml = html;
            },
            close: () => {},
          },
          focus: () => {},
          print: () => {
            window.__challanPrinted = true;
          },
        });
      });
      await toolbar.getByRole("button", { name: "Print" }).click();
      await expect
        .poll(() => page.evaluate(() => window.__challanPrinted))
        .toBe(true);
      expect(await page.evaluate(() => window.__challanPrintHtml)).toContain(
        "Final Invoice Amount: &#8377;" + expected.toFixed(2),
      );
      if (name === "partial") {
        await toolbar.getByRole("button", { name: "Back to Challans" }).click();
        await page.locator(".challan-row .challan-workflow-button").click();
        const settlement = page.getByRole("dialog", {
          name: "Final Settlement",
        });
        await settlement
          .locator(".settlement-input-grid input")
          .nth(0)
          .fill("400.50");
        await settlement
          .getByRole("button", { name: "Record Payment / Complete" })
          .click();
        await expect(settlement).toHaveCount(0);
        const completed = (await db.doc("challans/" + id).get()).data();
        expect(completed.finalInvoice.finalInvoiceAmount).toBe(400.5);
        expect(completed.finalSettlement.finalInvoiceAmount).toBe(400.5);
      }
    },
  );
}

// Emulator-only Stage 1 -> Stage 2 checks. No production documents are used.
async function seedIssuedStock(id) {
  await seed(1, "admin", id);
  await db.doc("inventory/stock").set({
    sku: "1_Round_CVD",
    size: "1",
    shape: "Round",
    type: "CVD",
    pieces: 0,
    weight: 0,
  });
}
async function submitReturn(page, pieces, weight) {
  const modal = page.getByRole("dialog", {
    name: "Process Return / Move to Stage 2",
  });
  const fields = modal.locator(".stage-two-row input");
  await fields.nth(0).fill(pieces);
  await fields.nth(1).fill(weight);
  await modal.getByRole("button", { name: /Move to Stage 2/ }).click();
  return modal;
}
for (const reopen of [false, true]) {
  test(
    "Stage 1 -> Stage 2 saves return once " +
      (reopen ? "after reopen" : "fresh"),
    async ({ page }) => {
      const id = "return-" + (reopen ? "reopen" : "fresh");
      await seedIssuedStock(id);
      await asRole(page, "admin");
      if (reopen) await page.reload();
      await page.locator(".challan-row .challan-workflow-button").click();
      const modal = await submitReturn(page, "1", "1.000");
      await expect(modal).toHaveCount(0);
      const saved = (await db.doc("challans/" + id).get()).data();
      const stock = (await db.doc("inventory/stock").get()).data();
      expect(saved.stage).toBe(2);
      expect(saved.stage2Return.items[0].returnPieces).toBe(1);
      expect(saved.stage2Return.items[0].returnWeight).toBe(1);
      expect(saved.stage2Return.items[0].soldPieces).toBe(0);
      expect(saved.stage2Return.items[0].soldWeight).toBe(0);
      expect(stock.pieces).toBe(1);
      expect(stock.weight).toBe(1);
      await page.locator(".challan-row .challan-workflow-button").click();
      await page
        .getByRole("dialog", { name: "Final Invoice Review" })
        .getByRole("button", { name: /Confirm Final Invoice/ })
        .click();
      expect((await db.doc("inventory/stock").get()).data().weight).toBe(1);
    },
  );
}
test("harmless Stage 1 item metadata change does not block the return", async ({
  page,
}) => {
  const id = "return-metadata";
  await seedIssuedStock(id);
  await asRole(page, "admin");
  await page.locator(".challan-row .challan-workflow-button").click();
  await db.doc("challans/" + id).update({
    items: [
      {
        ...item,
        priceSource: "manual",
        priceContext: { width: "", height: "1" },
        discountAmount: 1,
        netAmount: 999,
      },
    ],
  });
  const modal = await submitReturn(page, "1", "1.000");
  await expect(modal).toHaveCount(0);
  expect((await db.doc("challans/" + id).get()).data().stage).toBe(2);
  expect((await db.doc("inventory/stock").get()).data().weight).toBe(1);
});
test("real Stage 1 Amount change during return review blocks transition and stock write", async ({
  page,
}) => {
  const id = "return-conflict";
  await seedIssuedStock(id);
  await asRole(page, "admin");
  await page.locator(".challan-row .challan-workflow-button").click();
  await db
    .doc("challans/" + id)
    .update({ items: [{ ...item, amount: 2000, netAmount: 2000 }] });
  const modal = await submitReturn(page, "1", "1.000");
  await expect(modal).toContainText(
    "This Challan changed during return review. Reopen it and try again.",
  );
  expect((await db.doc("challans/" + id).get()).data().stage).toBe(1);
  expect((await db.doc("inventory/stock").get()).data().weight).toBe(0);
});

async function seedDeleteCase(
  stage,
  id,
  { returnPieces = 4, returnWeight = 2, pieces = 10, weight = 5 } = {},
) {
  await seed(stage, "admin", id);
  const issued = {
    ...item,
    pieces,
    weight,
    amount: 1000,
    discount: 0,
    sourceInventoryId: "stock",
    inventoryId: "stock",
  };
  const update = { items: [issued] };
  if (stage > 1)
    update.stage2Return = {
      items: [
        {
          ...issued,
          issuedPieces: pieces,
          issuedWeight: weight,
          returnPieces,
          returnWeight,
          soldPieces: pieces - returnPieces,
          soldWeight: weight - returnWeight,
        },
      ],
    };
  await db.doc("challans/" + id).update(update);
  await db.doc("inventory/stock").set({
    sku: item.sku,
    size: "1",
    shape: "Round",
    type: "CVD",
    pieces: stage === 1 ? 0 : returnPieces,
    weight: stage === 1 ? 0 : returnWeight,
  });
}
for (const stage of [1, 2, 3, 4]) {
  test(
    "Stage " + stage + " delete restores the outstanding stock exactly once",
    async ({ page }) => {
      const id = "delete-" + stage;
      await seedDeleteCase(stage, id);
      await asRole(page, "admin");
      await page.locator(".challan-row .challan-delete").click();
      const modal = page.getByRole("dialog", {
        name: "Delete challan confirmation",
      });
      await expect(modal).toContainText(
        stage === 1 ? "10 pcs / 5.000 ct" : "6 pcs / 3.000 ct",
      );
      await modal.getByRole("button", { name: "Delete Challan" }).click();
      await expect(modal).toHaveCount(0);
      expect((await db.doc("challans/" + id).get()).exists).toBe(false);
      const stock = (await db.doc("inventory/stock").get()).data();
      expect(stock.pieces).toBe(10);
      expect(stock.weight).toBe(5);
    },
  );
}
test("full return delete adds nothing; weight-only delete restores Weight with zero Pieces", async ({
  page,
}) => {
  await seedDeleteCase(2, "delete-full", { returnPieces: 10, returnWeight: 5 });
  await asRole(page, "admin");
  await page.locator(".challan-row .challan-delete").click();
  await expect(
    page.getByRole("dialog", { name: "Delete challan confirmation" }),
  ).toContainText("0 pcs / 0.000 ct");
  await page.getByRole("button", { name: "Delete Challan" }).click();
  expect((await db.doc("inventory/stock").get()).data().weight).toBe(5);
});
test("missing linked Inventory keeps Challan and does not commit a partial reversal", async ({
  page,
}) => {
  await seedDeleteCase(2, "delete-missing");
  await db.doc("inventory/stock").delete();
  await asRole(page, "admin");
  await page.locator(".challan-row .challan-delete").click();
  await page.getByRole("button", { name: "Delete Challan" }).click();
  await expect(
    page.getByRole("dialog", { name: "Delete challan confirmation" }),
  ).toContainText("Linked Inventory is missing");
  expect((await db.doc("challans/delete-missing").get()).exists).toBe(true);
});
test("two Admin delete attempts cannot restore the same stock twice", async ({
  page,
  context,
}) => {
  await seedDeleteCase(2, "delete-concurrent");
  await asRole(page, "admin");
  const other = await context.newPage();
  await asRole(other, "admin");
  await page.locator(".challan-row .challan-delete").click();
  await other.locator(".challan-row .challan-delete").click();
  await Promise.all([
    page.getByRole("button", { name: "Delete Challan" }).click(),
    other.getByRole("button", { name: "Delete Challan" }).click(),
  ]);
  await expect
    .poll(async () => (await db.doc("challans/delete-concurrent").get()).exists)
    .toBe(false);
  const stock = (await db.doc("inventory/stock").get()).data();
  expect(stock.pieces).toBe(10);
  expect(stock.weight).toBe(5);
  await other.close();
});
test("Stage 3 harmless listener update passes, material return change rejects", async ({
  page,
}) => {
  await seed(2, "admin", "invoice-metadata");
  await asRole(page, "admin");
  await page.locator(".challan-row .challan-workflow-button").click();
  await db.doc("challans/invoice-metadata").update({
    stage2Return: {
      items: [
        {
          ...item,
          issuedPieces: 1,
          issuedWeight: 1,
          returnPieces: 0,
          returnWeight: 0,
          soldPieces: 1,
          soldWeight: 1,
          harmlessLabel: "refresh",
        },
      ],
    },
  });
  await page
    .getByRole("dialog", { name: "Final Invoice Review" })
    .getByRole("button", { name: /Confirm Final Invoice/ })
    .click();
  await expect
    .poll(
      async () =>
        (await db.doc("challans/invoice-metadata").get()).data().stage,
    )
    .toBe(3);

  await seed(2, "admin", "invoice-conflict");
  await db.doc("challans/invoice-conflict").update({ number: "B41/2" });
  await page.reload();
  await page
    .locator(".challan-row")
    .filter({ hasText: "B41/2" })
    .locator(".challan-workflow-button")
    .click();
  await db.doc("challans/invoice-conflict").update({
    stage2Return: {
      items: [
        {
          ...item,
          issuedPieces: 1,
          issuedWeight: 1,
          returnPieces: 1,
          returnWeight: 1,
          soldPieces: 0,
          soldWeight: 0,
        },
      ],
    },
  });
  await page
    .getByRole("dialog", { name: "Final Invoice Review" })
    .getByRole("button", { name: /Confirm Final Invoice/ })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Final Invoice Review" }),
  ).toContainText("Return or pricing data changed during invoice review");
  expect((await db.doc("challans/invoice-conflict").get()).data().stage).toBe(
    2,
  );
});
test("weight-only Stage 2 delete restores sold Weight and keeps Pieces at zero", async ({
  page,
}) => {
  await seedDeleteCase(2, "delete-weight-only", {
    pieces: 0,
    weight: 5,
    returnPieces: 0,
    returnWeight: 2,
  });
  await asRole(page, "admin");
  await page.locator(".challan-row .challan-delete").click();
  const modal = page.getByRole("dialog", {
    name: "Delete challan confirmation",
  });
  await expect(modal).toContainText("0 pcs / 3.000 ct");
  await modal.getByRole("button", { name: "Delete Challan" }).click();
  const stock = (await db.doc("inventory/stock").get()).data();
  expect(stock.pieces).toBe(0);
  expect(stock.weight).toBe(5);
});
test("multiple linked Inventory documents restore together or not at all", async ({
  page,
}) => {
  await seedDeleteCase(2, "delete-multiple");
  const second = {
    ...item,
    id: "second",
    sku: "2_Round_CVD",
    inventoryId: "stock-2",
    sourceInventoryId: "stock-2",
    pieces: 2,
    weight: 1.25,
    amount: 100,
    discount: 0,
  };
  const first = {
    ...item,
    pieces: 10,
    weight: 5,
    inventoryId: "stock",
    sourceInventoryId: "stock",
  };
  await db.doc("challans/delete-multiple").update({
    items: [first, second],
    stage2Return: {
      items: [
        {
          ...first,
          issuedPieces: 10,
          issuedWeight: 5,
          returnPieces: 4,
          returnWeight: 2,
          soldPieces: 6,
          soldWeight: 3,
        },
        {
          ...second,
          issuedPieces: 2,
          issuedWeight: 1.25,
          returnPieces: 0,
          returnWeight: 0,
          soldPieces: 2,
          soldWeight: 1.25,
        },
      ],
    },
  });
  await asRole(page, "admin");
  await page.locator(".challan-row .challan-delete").click();
  await page.getByRole("button", { name: "Delete Challan" }).click();
  await expect(
    page.getByRole("dialog", { name: "Delete challan confirmation" }),
  ).toContainText("Linked Inventory is missing");
  expect((await db.doc("challans/delete-multiple").get()).exists).toBe(true);
  expect((await db.doc("inventory/stock").get()).data().weight).toBe(2);

  await db.doc("inventory/stock-2").set({
    sku: "2_Round_CVD",
    size: "2",
    shape: "Round",
    type: "CVD",
    pieces: 0,
    weight: 0,
  });
  await page.getByRole("button", { name: "Delete Challan" }).click();
  await expect
    .poll(async () => (await db.doc("challans/delete-multiple").get()).exists)
    .toBe(false);
  expect((await db.doc("inventory/stock").get()).data().weight).toBe(5);
  expect((await db.doc("inventory/stock-2").get()).data().weight).toBe(1.25);
});

for (const field of ["notes", "price", "discount"]) {
  test(
    "Stage 1 " + field + " edit saves without a false stale conflict",
    async ({ page }) => {
      const id = "stage-one-save-" + field;
      await seed(1, "admin", id);
      await asRole(page, "admin");
      await page.locator(".challan-row .challan-edit").click();
      if (field === "notes")
        await page.locator(".challan-create textarea").fill("Edited note");
      if (field === "price")
        await page
          .locator('.challan-create input[placeholder="Price"]')
          .fill("1200");
      if (field === "discount")
        await page
          .locator('.challan-create input[placeholder="Discount %"]')
          .fill("5");
      await page.getByRole("button", { name: "Save Changes" }).click();
      await expect(page.locator(".challan-form-error")).toHaveCount(0);
      await expect
        .poll(async () => (await db.doc("challans/" + id).get()).data())
        .toMatchObject(
          field === "notes"
            ? { notes: "Edited note" }
            : field === "price"
              ? { items: [{ amount: 1200 }] }
              : { items: [{ discount: 5 }] },
        );
    },
  );
}

test("Stage 1 metadata-only write permits Save, but a concurrent Price change blocks it", async ({
  page,
}) => {
  const id = "stage-one-metadata-and-price";
  await seed(1, "admin", id);
  await asRole(page, "admin");
  await page.locator(".challan-row .challan-edit").click();
  await page.locator(".challan-create textarea").fill("After metadata");
  await db.doc("challans/" + id).update({ updatedAt: Timestamp.now() });
  await page.getByRole("button", { name: "Save Changes" }).click();
  await expect
    .poll(async () => (await db.doc("challans/" + id).get()).data().notes)
    .toBe("After metadata");
  await page.locator(".challan-row .challan-edit").click();
  await page.locator(".challan-create textarea").fill("Should not save");
  const latest = (await db.doc("challans/" + id).get()).data();
  await db
    .doc("challans/" + id)
    .update({ items: [{ ...latest.items[0], amount: 1300 }] });
  await page.getByRole("button", { name: "Save Changes" }).click();
  await expect(page.locator(".challan-form-error")).toContainText(
    "changed while you were editing",
  );
  expect((await db.doc("challans/" + id).get()).data().notes).toBe(
    "After metadata",
  );
});

test("Stage 1 edit blocks a concurrent Stage 2 advance", async ({ page }) => {
  const id = "stage-one-advanced-while-editing";
  await seed(1, "admin", id);
  await asRole(page, "admin");
  await page.locator(".challan-row .challan-edit").click();
  await page.locator(".challan-create textarea").fill("Should not save");
  await db.doc("challans/" + id).update({ stage: 2 });
  await page.getByRole("button", { name: "Save Changes" }).click();
  await expect(page.locator(".challan-form-error")).toContainText(
    "changed while you were editing",
  );
  expect((await db.doc("challans/" + id).get()).data().notes).toBe(
    "Saved note",
  );
});
