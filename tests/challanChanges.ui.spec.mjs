import { test, expect } from "@playwright/test";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { initializeTestEnvironment, assertFails } from "@firebase/rules-unit-testing";
import { readFile } from "node:fs/promises";
import { doc, updateDoc } from "firebase/firestore";
import * as XLSX from "xlsx";

if (!process.env.FIRESTORE_EMULATOR_HOST?.startsWith("127.0.0.1:"))
  throw Error("Loopback Firestore emulator required");
const app = initializeApp({ projectId: "demo-jewellery-ui" }, "challan-changes-tests");
const db = getFirestore(app);
let env;
const item = {
  id: "line", sku: "1_Round_CVD", type: "CVD", shape: "Round", size: "1", width: "",
  pieces: 1, weight: 1, amount: 1000, discount: 0, discountAmount: 0,
  netAmount: 1000, inventoryId: "stock", sourceInventoryId: "stock",
};
const image = {
  secureUrl: "https://res.cloudinary.com/test-cloud/image/upload/old.png",
  publicId: "old", originalFilename: "old.png",
};
async function seed(stage, createdBy = "admin", id = "challan-" + stage) {
  const row = {
    id, number: "B40/" + stage, party: "Test Party", date: "2026-10-06",
    stage, notes: "Saved note", items: [item], amount: 1000, discountAmount: 0,
    netAmount: 1000, createdAt: Timestamp.now(), createdBy,
    createdByRole: createdBy === "admin" ? "superadmin" : "employee",
    stageHistory: { stage1: { enteredAtMs: Date.now() } },
  };
  if (stage >= 2) {
    row.stage1Images = [image];
    row.stage2Return = {
      items: [{ ...item, issuedPieces: 1, issuedWeight: 1, returnPieces: 0,
        returnWeight: 0, soldPieces: 1, soldWeight: 1 }],
    };
  }
  if (stage >= 3) row.finalInvoice = {
    items: [{ ...row.stage2Return.items[0], grossAmount: 1000,
      stage1DiscountPercent: 0, stage1DiscountAmount: 0, finalAmount: 1000 }],
    grossAmount: 1000, stage1DiscountAmount: 0, finalInvoiceAmount: 1000,
    confirmedAtMs: Date.now(),
  };
  if (stage === 4) row.finalSettlement = {
    amountPaid: 1000, settlementDiscountAmount: 0, actualReceivedAmount: 1000,
    remaining: 0, completedAtMs: Date.now(),
  };
  await db.doc("challans/" + id).set(row);
  return id;
}
async function asRole(page, role) {
  await page.addInitScript((value) => localStorage.setItem("test-role", value), role);
  await page.goto("/dashboard/challan");
  await expect(page.locator(".availability-banner")).toHaveCount(0);
}
const photo = (name, mimeType = "image/png") => ({
  name, mimeType, buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/pXcAAAAASUVORK5CYII=", "base64"),
});

test.beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-jewellery-ui",
    firestore: { rules: await readFile("firestore.rules", "utf8") },
  });
});
test.afterAll(async () => { await env?.cleanup(); await deleteApp(app); });
test.beforeEach(async ({ page }) => {
  await env.clearFirestore();
  await Promise.all(["admin", "staff", "stage-one", "stage-two"].map((uid) =>
    db.doc("employeeProfiles/" + uid).set({
      uid, accessId: uid, role: uid === "admin" ? "superadmin" : "employee",
      active: true,
      permissions: uid === "admin" ? [] : uid === "stage-one" ? ["challan-stage-1"]
        : uid === "stage-two" ? ["challan-stage-2"]
          : ["challan-stage-1", "challan-stage-2", "challan-stage-3", "challan-stage-4"],
    }),
  ));
  await page.addInitScript(() => localStorage.setItem("theme", "light"));
  await page.route(/https:\/\/.*(?:googleapis\.com|firebaseio\.com)/, (route) => route.abort());
  await page.route("https://res.cloudinary.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: photo("tiny.png").buffer }));
});

for (const stage of [1, 2]) {
  for (const role of ["admin", "staff"]) {
    test(`Stage ${stage} ${role} uploads multiple images, appends later, and keeps stage references`, async ({ page }) => {
      const uid = role === "staff" ? (stage === 1 ? "stage-one" : "stage-two") : "admin";
      const id = await seed(stage, uid, "upload-" + stage + "-" + role);
      let count = 0;
      await page.route("https://api.cloudinary.com/**", async (route) => {
        count++;
        if (count === 4) return route.fulfill({ status: 400, contentType: "application/json", body: '{"error":{"message":"private failure"}}' });
        return route.fulfill({
          status: 200, contentType: "application/json",
          body: JSON.stringify({
            secure_url: "https://res.cloudinary.com/test-cloud/image/upload/new-" + count + ".png",
            public_id: "new-" + count,
            original_filename: "new-" + count + ".png",
          }),
        });
      });
      await asRole(page, uid);
      await page.locator(".challan-row .challan-view-button").click();
      const section = page.locator(".challan-image-section").filter({ hasText: "Stage " + stage + " Images" });
      await expect(section.getByRole("button", { name: "Upload Images" })).toBeVisible();
      await section.locator("input[type=file]").setInputFiles([photo("first.png"), photo("second.png")]);
      await expect(section.locator(".challan-image-thumbnail")).toHaveCount(2);
      await section.locator("input[type=file]").setInputFiles([photo("later.jpg", "image/jpeg"), photo("bad.png")]);
      await expect(section.locator(".challan-image-thumbnail")).toHaveCount(3);
      await expect(section.getByRole("status")).toContainText("bad.png");
      await expect(section.locator(".challan-image-thumbnail")).toHaveCount(3);
      const saved = (await db.doc("challans/" + id).get()).data();
      expect(saved["stage" + stage + "Images"]).toHaveLength(3);
      expect(saved["stage" + stage + "Images"].every((entry) => entry.secureUrl && entry.publicId)).toBe(true);
      expect(saved["stage" + (stage === 1 ? 2 : 1) + "Images"]?.length || 0).toBe(stage === 2 ? 1 : 0);
      await section.locator(".challan-image-thumbnail").first().click();
      await expect(page.getByRole("dialog", { name: "Challan image preview" })).toBeVisible();
      await page.getByRole("button", { name: "Close image preview" }).click();
      await page.getByRole("button", { name: "Back to Challans" }).click();
      await page.locator(".challan-row .challan-view-button").click();
      await expect(section.locator(".challan-image-thumbnail")).toHaveCount(3);
    });
  }
}

test("Stage-specific staff cannot see or attach images in an unauthorized stage", async ({ page }) => {
  const stage1Id = await seed(1, "stage-two", "denied-stage-1");
  const stage2Id = await seed(2, "stage-one", "denied-stage-2");
  await asRole(page, "stage-one");
  await expect(page.locator(".challan-row")).toHaveCount(1);
  await expect(page.locator(".challan-row")).toContainText("B40/1");
  const stageOneUser = env.authenticatedContext("stage-one");
  const stageTwoUser = env.authenticatedContext("stage-two");
  await assertFails(updateDoc(doc(stageOneUser.firestore(), "challans", stage2Id), {
    stage2Images: [image],
  }));
  await assertFails(updateDoc(doc(stageTwoUser.firestore(), "challans", stage1Id), {
    stage1Images: [image],
  }));
});

for (const stage of [1, 2, 3, 4]) {
  test(`Stage ${stage} Edit hides Print/Export; View prints and exports only this Challan`, async ({ page }) => {
    await seed(stage);
    await asRole(page, "admin");
    await page.locator(".challan-row .challan-edit").click();
    await expect(page.locator(".challan-create-actions").getByRole("button", { name: "Print" })).toHaveCount(0);
    await expect(page.locator(".challan-create-actions").getByRole("button", { name: "Export" })).toHaveCount(0);
    await page.getByRole("button", { name: "Back to Challans" }).click();
    await page.locator(".challan-row .challan-view-button").click();
    const toolbar = page.locator(".challan-view-toolbar");
    await expect(toolbar.getByRole("button", { name: "Print" })).toBeVisible();
    await expect(toolbar.getByRole("button", { name: "Export" })).toBeVisible();
    const downloadPromise = page.waitForEvent("download");
    await toolbar.getByRole("button", { name: "Export" }).click();
    const download = await downloadPromise;
    const book = XLSX.read(await readFile(await download.path()), { type: "buffer" });
    const details = XLSX.utils.sheet_to_json(book.Sheets.Challan, { header: 1 });
    expect(details).toContainEqual(["Stage", "Stage " + stage + " - " + ({
      1: "Goods Out", 2: "Return / Sale", 3: "Final Invoice / Payment Pending", 4: "Completed",
    })[stage]]);
    expect(XLSX.utils.sheet_to_json(book.Sheets.Items)[0].SKU).toBe("1_Round_CVD");
    if (stage >= 3) expect(details).toContainEqual(["Final Invoice Amount", 1000]);
    if (stage === 4) expect(details).toContainEqual(["Amount Paid", 1000]);
    await page.evaluate(() => {
      window.open = () => ({
        document: { write: (html) => { window.__challanPrintHtml = html; }, close: () => {} },
        focus: () => {}, print: () => { window.__challanPrinted = true; },
      });
    });
    await toolbar.getByRole("button", { name: "Print" }).click();
    await expect.poll(() => page.evaluate(() => window.__challanPrinted)).toBe(true);
    expect(await page.evaluate(() => window.__challanPrintHtml)).toContain("B40/" + stage);
  });
}

test("Final Settlement recalculates blank discount and exact remaining while typing", async ({ page }) => {
  await seed(3);
  await asRole(page, "admin");
  await page.locator(".challan-row .challan-workflow-button").click();
  const modal = page.getByRole("dialog", { name: "Final Settlement" });
  const paid = modal.locator(".settlement-input-grid input").nth(0);
  const discount = modal.locator(".settlement-input-grid input").nth(1);
  const remaining = modal.locator(".settlement-summary-grid strong").nth(3);
  const complete = modal.getByRole("button", { name: "Record Payment / Complete" });
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
  expect((await db.doc("challans/challan-3").get()).data().finalSettlement.settlementDiscountAmount).toBe(0);
});
