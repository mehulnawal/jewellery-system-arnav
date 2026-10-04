import { test, expect } from "@playwright/test";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { readFile } from "node:fs/promises";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import * as XLSX from "xlsx";
import { auditDimensions } from "../src/utils/dimensionAudit.js";
import { writeFile } from "node:fs/promises";
import { initializeInventoryIdentities, readIdentityPlan } from "../scripts/lib/initializeInventoryIdentities.mjs";

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("UI tests require the local Firestore emulator.");
const app = initializeApp({ projectId: "demo-jewellery-ui" }, "ui-tests");
const db = getFirestore(app);
let env;
const permissions = ["inventory", "purchase", "challan-stage-1", "challan-stage-2", "challan-stage-3", "challan-stage-4"];
test.beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: "demo-jewellery-ui", firestore: { rules: await readFile("firestore.rules", "utf8") } });
});
test.afterAll(async () => { await env?.cleanup(); await deleteApp(app); });
test.beforeEach(async ({ page }) => {
  await env.clearFirestore();
  await Promise.all([
    ...["admin", "staff", "purchase-only", "no-purchase"].map((uid) => db.doc(`employeeProfiles/${uid}`).set({ uid, accessId: uid, role: uid === "admin" ? "superadmin" : "employee", active: true, permissions: uid === "admin" ? [] : uid === "purchase-only" ? ["purchase"] : uid === "no-purchase" ? ["inventory"] : permissions })),
    db.doc("inventoryIdentityMigrations/v1").set({ ready: true }),
    db.doc("inventoryIdentities/1_Round_CVD").set({ sku: "1_Round_CVD", recordId: "stock" }),
    db.doc("numberingMigrations/manual-v1").set({ ready: true }),
    db.doc("numberingMigrations/letters-v1").set({ ready: true }),
    db.doc("inventory/stock").set({ sku: "1_Round_CVD", shape: "Round", type: "CVD", size: "1", weight: 10, pieces: 10, createdAt: Timestamp.now(), createdBy: "admin" }),
  ]);
  await page.addInitScript(() => localStorage.setItem("theme", "dark"));
  // No test browser request may reach a production Firebase service.
  await page.route(/https:\/\/.*(?:googleapis\.com|firebaseio\.com)/, (route) => route.abort());
});
async function asRole(page, role, path, waitForAvailability = true) {
  await page.addInitScript((value) => localStorage.setItem("test-role", value), role);
  await page.goto(path);
  await expect(page.locator('.business-availability')).toBeVisible();
  if (waitForAvailability) await expect(page.locator('.availability-banner')).toHaveCount(0);
}
async function fillChallan(page, number) {
  await page.getByRole("button", { name: "Create Challan", exact: true }).click();
  await page.getByPlaceholder("B35/1", { exact: true }).fill(number);
  await page.locator(".party-picker input").fill("Test Party");
  await page.getByPlaceholder("Search SKU...").fill("1_Round_CVD");
  await page.locator(".sku-menu button").first().click();
  await page.getByPlaceholder("Weight (ct)", { exact: true }).fill("1");
  await page.getByPlaceholder("pieces", { exact: true }).fill("1");
  await page.getByPlaceholder("Price", { exact: true }).fill("100");
  await page.getByPlaceholder("Discount %", { exact: true }).fill("10");
}

async function prepareLegacyIndex(rows) {
  for (const row of rows) await db.doc(`inventory/${row.id}`).set({ shape: "Round", type: "HP", weight: 10, pieces: 10, createdBy: "staff", createdAt: Timestamp.now(), ...row });
  await db.doc("inventoryIdentityMigrations/v1").set({ ready: false });
  return initializeInventoryIdentities(db, { expectedFingerprint: (await readIdentityPlan(db)).fingerprint, guardRulesAcknowledged: true, batchSize: 1 });
}

for (const role of ["admin", "purchase-only"]) {
  test(`Rollout: ${role} Purchase auto-registers unused identities and refuses occupied/collision stock`, async ({ page }) => {
    await prepareLegacyIndex([
      { id: "single", size: "5.00", sku: "5.00_Round_HP" },
      { id: "collision-a", size: 6, sku: "6_Round_HP" },
      { id: "collision-b", size: "6.00", sku: "6.00_Round_HP" },
    ]);
    await asRole(page, role, "/dashboard/purchase");
    const result = await page.evaluate(async () => {
      const { savePurchase } = await import("/src/utils/purchase.js");
      const { testUser } = await import("/tests/fixtures/auth.jsx");
      const results = [];
      for (const [index, size] of ["5.000", "6.000", "7.2500"].entries()) {
        try {
          const saved = await savePurchase({
            purchase: { purchaseId: `PR-B80-${index + 1}`, date: "2026-10-03", vendorName: "Rollout", totalWeight: 1, amount: 100, discount: 0, paymentDueDays: 0 },
            items: [{ id: "line", type: "HP", shape: "Round", size, weight: 1, pieces: 1, box: "" }], user: testUser,
            existingInventory: [], // Prove transactional checks work without frontend data.
          });
          results.push({ id: saved.id });
        } catch (error) { results.push({ error: error.message }); }
      }
      return results;
    });
    expect(result[0].error).toContain("already exists");
    expect(result[1].error).toContain("collision");
    expect(result[2].id).toBeTruthy();
    expect((await db.doc("inventoryIdentities/7.25_Round_HP").get()).data().recordId).toBe(`${result[2].id}_line`);
    expect((await db.collection("purchases").get()).size).toBe(1);
    expect((await db.collection("purchaseNumbers").get()).size).toBe(1);
    for (const id of ["single", "collision-a", "collision-b"]) expect((await db.doc(`inventory/${id}`).get()).data().weight).toBe(10);
  });
}

for (const [role, id, size, sku] of [["staff", "normal", "7.00", "7.00_Round_HP"], ["admin", "collision-a", 5, "5_Round_HP"], ["admin", "collision-b", "5.00", "5.00_Round_HP"]]) {
  test(`Rollout: ${role} Challan deduction and return preserve physical record ${id}`, async ({ page }) => {
    await prepareLegacyIndex([
      { id: "normal", size: "7.00", sku: "7.00_Round_HP" },
      { id: "collision-a", size: 5, sku: "5_Round_HP" },
      { id: "collision-b", size: "5.00", sku: "5.00_Round_HP" },
    ]);
    await asRole(page, role, "/dashboard/challan");
    await page.getByRole("button", { name: "Create Challan", exact: true }).click();
    await page.getByPlaceholder("B35/1", { exact: true }).fill("B90/1");
    await page.locator(".party-picker input").fill("Rollout Party");
    await page.getByPlaceholder("Search SKU...").fill(sku);
    await page.locator(".sku-menu button").filter({ has: page.locator("b", { hasText: new RegExp(`^${sku.replaceAll(".", "\\.")}$`) }) }).click();
    await page.getByPlaceholder("Weight (ct)", { exact: true }).fill("2");
    await page.getByPlaceholder("pieces", { exact: true }).fill("2");
    await page.getByPlaceholder("Price", { exact: true }).fill("100");
    await page.getByPlaceholder("Discount %", { exact: true }).fill("0");
    await page.getByRole("button", { name: "Create Challan", exact: true }).click();
    await expect(page.locator(".challan-row")).toHaveCount(1);
    expect((await db.doc(`inventory/${id}`).get()).data().weight).toBe(8);
    await page.locator(".challan-row .challan-workflow-button").click();
    const modal = page.getByRole("dialog", { name: "Process Return / Move to Stage 2" });
    await modal.locator(".stage-two-row input").nth(0).fill("1");
    await modal.locator(".stage-two-row input").nth(1).fill("1");
    await modal.getByRole("button", { name: /Move to Stage 2/ }).click();
    await expect(modal).toHaveCount(0);
    const challan = (await db.collection("challans").get()).docs[0].data();
    expect(challan.stage2Return.items[0].sourceInventoryId).toBe(id);
    for (const other of ["normal", "collision-a", "collision-b"]) expect((await db.doc(`inventory/${other}`).get()).data().weight).toBe(other === id ? 9 : 10);
    expect((await db.doc(`inventory/${id}`).get()).data().size).toBe(size);
    expect((await db.doc("inventoryIdentities/5_Round_HP").get()).data().recordId).toBeNull();
  });
}

test("Size: Inventory add/edit, immediate validation, duplicates and live search", async ({ page }) => {
  await asRole(page, "admin", "/dashboard/inventory");
  await page.getByRole("button", { name: "Add Item", exact: true }).click();
  const modal = page.locator(".inventory-modal-card");
  await modal.locator("select").nth(0).selectOption("HP");
  await modal.locator("select").nth(1).selectOption("Round");
  const size = modal.getByPlaceholder("4.3", { exact: true });
  await size.fill("5..3");
  await expect(modal.getByText("Enter a positive numeric size.", { exact: true })).toBeVisible();
  await size.fill("5.00");
  await expect(modal.locator(".inventory-field-error")).toHaveCount(0);
  await expect(size).toHaveValue("5.00");
  await modal.getByLabel("Weight (ct)", { exact: true }).fill("2");
  await expect(size).toHaveValue("5");
  await expect(modal.locator(".inventory-sku-field b")).toHaveText("5_Round_HP");
  await modal.getByRole("button", { name: "Add item", exact: true }).click();
  await expect(modal).toHaveCount(0);
  const saved = (await db.collection("inventory").where("sku", "==", "5_Round_HP").get()).docs[0];
  expect(saved.data().size).toBe("5");
  await page.getByPlaceholder("Search; use 5.3mm for Size only").fill("5.000mm");
  await expect(page.locator(".inventory-chevron")).toHaveCount(1);
  await page.locator(".inventory-chevron").click();
  await expect(page.locator(".inventory-item")).toHaveCount(1);
  await page.getByRole("button", { name: "Edit 5_Round_HP", exact: true }).click();
  await size.fill("6.2500");
  await modal.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(modal).toHaveCount(0);
  expect((await saved.ref.get()).data().size).toBe("6.25");
  await expect(page.locator(".inventory-item td").nth(3)).toHaveText("6.25 mm");
  await page.getByPlaceholder("Search; use 5.3mm for Size only").fill("6.250mm");
  await expect(page.locator(".inventory-item")).toHaveCount(1);
  await page.getByRole("button", { name: "Add Item", exact: true }).click();
  await modal.locator("select").nth(0).selectOption("HP");
  await modal.locator("select").nth(1).selectOption("Round");
  await size.fill("6.25000");
  await expect(modal.getByText("This Type, Shape and Size already exists in Inventory.", { exact: true })).toBeVisible();
});

test("Size: legacy collisions stay visible; Check Inventory filters and Challan selection retain physical identity", async ({ page }) => {
  const inventory = [
    { id: "legacy-a", size: 5, sku: "5_PR_CBD", weight: 2 },
    { id: "legacy-b", size: "5.00", sku: "5.00_PR_CBD", weight: 3 },
  ].map((row) => ({ ...row, shape: "PR", type: "CBD", pieces: 4, group: "Uncategorized", createdBy: "admin", createdAt: Timestamp.now() }));
  for (const row of inventory) await db.doc(`inventory/${row.id}`).set(row);
  await db.doc("inventoryIdentities/5_PR_CBD").set({ sku: "5_PR_CBD", recordId: null, legacyRecordIds: inventory.map((row) => row.id) });
  const report = auditDimensions({ inventory, purchases: [], challans: [] });
  await writeFile("test-results/dimension-audit-local.json", JSON.stringify({ source: "synthetic emulator fixture, not production", readOnly: true, ...report }, null, 2));
  expect(report.collisions).toHaveLength(1);
  await asRole(page, "admin", "/dashboard/inventory");
  await expect(page.getByText("1 legacy canonical Size collision(s). Stock records remain separate.", { exact: true })).toBeVisible();
  await page.goto("/dashboard/check-inventory");
  await page.locator(".check-search input").fill("5.000mm");
  await expect(page.locator(".check-cards > *")).toHaveCount(2);
  await page.locator(".check-filter select").nth(2).selectOption("Uncategorized");
  await expect(page.locator(".check-cards > *")).toHaveCount(2);
  await db.doc("inventory/legacy-b").update({ size: "5.30" });
  await page.locator(".check-search input").fill("5.300mm");
  await expect(page.locator(".check-cards > *")).toHaveCount(1);
  await expect(page.locator(".check-card-size")).toHaveText("5.3 mm");
  await db.doc("inventory/legacy-b").update({ size: "5.00" });
  await expect(page.locator(".check-cards > *")).toHaveCount(0);
  await page.locator(".check-search input").fill("5.000mm");
  await expect(page.locator(".check-cards > *")).toHaveCount(2);
  await page.goto("/dashboard/challan");
  await page.getByRole("button", { name: "Create Challan", exact: true }).click();
  await page.getByPlaceholder("B35/1", { exact: true }).fill("B35/1");
  await page.locator(".party-picker input").fill("Size Test Party");
  await page.getByPlaceholder("Search SKU...").fill("5.000_PR_CBD");
  await expect(page.locator(".sku-menu button")).toHaveCount(2);
  await page.locator(".sku-menu button").filter({ hasText: "5.00_PR_CBD" }).click();
  await page.getByPlaceholder("Weight (ct)", { exact: true }).fill("1");
  await page.getByPlaceholder("pieces", { exact: true }).fill("1");
  await page.getByPlaceholder("Price", { exact: true }).fill("100");
  await page.getByPlaceholder("Discount %", { exact: true }).fill("10");
  await page.getByRole("button", { name: "Create Challan", exact: true }).click();
  await expect(page.locator(".challan-row")).toHaveCount(1);
  const challan = (await db.collection("challans").get()).docs[0].data();
  expect(challan.items[0].sourceInventoryId || challan.items[0].inventoryId).toBe("legacy-b");
  expect(challan.items[0].size).toBe("5");
  expect((await db.doc("inventory/legacy-a").get()).data().weight).toBe(2);
  expect((await db.doc("inventory/legacy-b").get()).data().weight).toBe(2);
});

test("Size: Inventory import preview and commit use canonical identity", async ({ page }) => {
  await asRole(page, "admin", "/dashboard/inventory");
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(["5.00", "5.0", "5.03"].map((size) => ({ Type: "HP", Shape: "Round", "Size (mm)": size, "Weight (ct)": 2, BOX: "" }))), "Inventory");
  await page.locator("input[type=file]").setInputFiles({ name: "sizes.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: XLSX.write(book, { type: "buffer", bookType: "xlsx" }) });
  const modal = page.locator(".inventory-import-card");
  await expect(modal.getByText("Duplicate SKU", { exact: true })).toBeVisible();
  await expect(modal.locator("tbody tr").first().locator("td").nth(3)).toHaveText("5");
  await modal.getByRole("button", { name: /Import 2/ }).click();
  await expect(modal).toHaveCount(0);
  await expect.poll(async () => (await db.collection("inventory").where("type", "==", "HP").get()).size).toBe(2);
  const rows = (await db.collection("inventory").where("type", "==", "HP").get()).docs.map((row) => row.data());
  expect(rows.map((row) => row.size).sort()).toEqual(["5", "5.03"]);
});

test("Size: Purchase import uses canonical preview, duplicate checks and saved stock", async ({ page }) => {
  await asRole(page, "admin", "/dashboard/purchase");
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet([1, 2].map((index) => ({
    "Import Ref": `ref${index}`, "Purchase Number": `PR-A60-${index}`, Date: "2026-10-02",
    "Vendor Name": "Import Vendor", "Total Purchase Weight (ct)": 1, Amount: 100, Discount: 0, "Payment Due Days": 0,
  }))), "Purchases");
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(["5.00", "5.000"].map((size, index) => ({
    "Import Ref": `ref${index + 1}`, Type: "HP", Shape: "Round", "Size (mm)": size, "Weight (ct)": 1, Pieces: 1, BOX: "",
  }))), "Items");
  await page.locator("input[type=file]").setInputFiles({ name: "purchase-sizes.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: XLSX.write(book, { type: "buffer", bookType: "xlsx" }) });
  const modal = page.locator(".purchase-import-card");
  await expect(modal.getByText("Duplicate Inventory identity: 5_Round_HP.", { exact: false })).toBeVisible();
  await expect(modal.getByText("5_Round_HP", { exact: true })).toHaveCount(2);
  await modal.getByRole("button", { name: "Import 1 valid Purchases", exact: true }).click();
  await expect(modal).toHaveCount(0);
  const purchases = (await db.collection("purchases").get()).docs;
  expect(purchases).toHaveLength(1);
  expect(purchases[0].data().items[0].size).toBe("5");
  const stock = await db.doc(`inventory/${purchases[0].data().items[0].inventoryId}`).get();
  expect(stock.data().size).toBe("5");
  expect(stock.data().sku).toBe("5_Round_HP");
});

test("Size: Purchase entry, completion, edit, duplicate validation and search", async ({ page }) => {
  await asRole(page, "staff", "/dashboard/purchase");
  await page.locator(".purchase-actions").getByRole("button", { name: /Create Purchase/ }).click();
  await page.getByRole("textbox", { name: "Purchase Number after PR-" }).fill("A50-1");
  await page.getByLabel("Vendor Name", { exact: true }).fill("Dimension Vendor");
  await page.getByLabel("Total Purchase Weight (ct)", { exact: true }).fill("1");
  await page.getByLabel("Amount", { exact: true }).fill("100");
  await page.getByLabel("Item 1 Type", { exact: true }).selectOption("HP");
  await page.getByLabel("Item 1 Shape", { exact: true }).selectOption("Round");
  const size = page.getByLabel("Item 1 Size", { exact: true });
  await size.fill("5..3");
  await expect(size).toHaveAttribute("aria-invalid", "true");
  await size.fill("5.00");
  await expect(size).toHaveAttribute("aria-invalid", "false");
  await page.getByLabel("Item 1 Weight", { exact: true }).fill("1");
  await page.getByLabel("Item 1 Pieces", { exact: true }).fill("1");
  await expect(size).toHaveValue("5");
  await page.getByRole("button", { name: "Create Purchase", exact: true }).click();
  await expect(page.locator(".purchase-form-card")).toHaveCount(0);
  const purchaseRef = (await db.collection("purchases").get()).docs[0].ref;
  let purchase = (await purchaseRef.get()).data();
  expect(purchase.items[0].size).toBe("5");
  expect((await db.doc(`inventory/${purchase.items[0].inventoryId}`).get()).data().sku).toBe("5_Round_HP");
  await page.getByPlaceholder("Search Purchase ID, Vendor, Broker, SKU or Size").fill("5.00mm");
  await expect(page.locator(".purchase-row-actions")).toHaveCount(1);
  await page.locator(".purchase-row-actions").getByRole("button", { name: "Edit", exact: true }).click();
  await size.fill("1.000");
  await page.getByLabel("Item 1 Type", { exact: true }).selectOption("CVD");
  await expect(size).toHaveAttribute("aria-invalid", "true");
  await size.fill("5.300");
  await expect(size).toHaveAttribute("aria-invalid", "false");
  await page.getByRole("button", { name: "Save Purchase", exact: true }).click();
  await expect(page.locator(".purchase-form-card")).toHaveCount(0);
  purchase = (await purchaseRef.get()).data();
  expect(purchase.items[0].size).toBe("5.3");
  expect((await db.doc(`inventory/${purchase.items[0].inventoryId}`).get()).data().sku).toBe("5.3_Round_CVD");
});
for (const role of ["staff", "admin"]) {
  test(`${role}: Challan valid/invalid/duplicate/required and Price calculations`, async ({ page }) => {
    await asRole(page, role, "/dashboard/challan");
    await fillChallan(page, "B125/7");
    const number = page.getByPlaceholder("B35/1", { exact: true });
    const save = page.getByRole("button", { name: "Create Challan", exact: true });
    for (const invalid of ["", "B35/0", "Z35/101", "B35/01", "B35-1", " B35/1", "b35/1", "AB35/1"]) {
      await number.fill(invalid); await save.click();
      expect(await number.evaluate((input) => input.checkValidity())).toBe(false);
      expect((await db.collection("challans").get()).size).toBe(0);
    }
    await number.fill("B125/7"); await save.click();
    await expect(page.locator(".challan-row").filter({ hasText: "B125/7" })).toBeVisible();
    const record = (await db.collection("challans").get()).docs[0].data();
    expect(record.items[0].amount).toBe(100);
    expect(record.netAmount).toBe(90);
    await fillChallan(page, "B125/7"); await save.click();
    await expect(page.getByText("Challan Number B125/7 already exists.", { exact: true })).toBeVisible();
    expect((await db.collection("challans").get()).size).toBe(1);
    await page.getByRole("button", { name: "Back to Challans", exact: true }).click();
    await page.locator(".challan-row").getByRole("button", { name: "Edit", exact: true }).click();
    if (role === "staff") await expect(number).toHaveAttribute("readonly", "");
    else {
      await number.fill("Z1/100");
      await page.getByRole("button", { name: "Save Changes", exact: true }).click();
      await expect(page.locator(".challan-row").filter({ hasText: "Z1/100" })).toBeVisible();
      expect((await db.collection("challans").get()).size).toBe(1);
      expect((await db.doc("inventory/stock").get()).data().weight).toBe(9);
    }
  });
  test(`${role}: fixed Purchase prefix, required/invalid/duplicate and valid saves`, async ({ page }) => {
    await asRole(page, role, "/dashboard/purchase");
    await page.locator(".purchase-actions").getByRole("button", { name: /Create Purchase/ }).click();
    const suffix = page.getByRole("textbox", { name: "Purchase Number after PR-" });
    await expect(page.locator(".purchase-number-input > span")).toHaveText("PR-");
    await suffix.fill("A12-25"); await suffix.press("Control+a"); await suffix.press("Backspace");
    await expect(page.locator(".purchase-number-input > span")).toHaveText("PR-");
    const save = page.getByRole("button", { name: "Create Purchase", exact: true });
    for (const invalid of ["", "B35-0", "Z35-101", "B35-01", "PR-B35-1", " B35-1", "B35/1", "b35-1", "AB35-1"]) {
      await suffix.fill(invalid); await save.click();
      expect(await suffix.evaluate((input) => input.checkValidity())).toBe(false);
      expect((await db.collection("purchases").get()).size).toBe(0);
    }
    await suffix.fill("Z12-25");
    await page.getByLabel("Vendor Name", { exact: true }).fill("Test Vendor");
    await page.getByLabel("Total Purchase Weight (ct)", { exact: true }).fill("1");
    await page.getByLabel("Amount", { exact: true }).fill("100");
    const item = page.locator(".purchase-form-card .purchase-items tbody tr").first();
    await item.locator("select").nth(0).selectOption("HP");
    await item.locator("select").nth(1).selectOption("Round");
    for (const [index, value] of ["2", "1", "1", "AB29"].entries()) await item.locator("input").nth(index).fill(value);
    await save.click();
    await expect(page.locator(".purchase-form-card")).toHaveCount(0);
    await expect(page.getByText("PR-Z12-25", { exact: true })).toBeVisible();
    expect((await db.collection("purchases").get()).docs[0].data().purchaseId).toBe("PR-Z12-25");
    await page.locator(".purchase-actions").getByRole("button", { name: /Create Purchase/ }).click();
    await suffix.fill("Z12-25"); await save.click();
    await expect(page.getByText("This Purchase Number already exists.", { exact: true })).toBeVisible();
    expect((await db.collection("purchases").get()).size).toBe(1);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.locator(".purchase-row-actions").getByRole("button", { name: "Edit", exact: true }).click();
    await expect(page.locator(".purchase-form-card input[readonly]")).toHaveValue("PR-Z12-25");
    await page.getByLabel("Amount", { exact: true }).fill("200");
    await page.getByLabel("Discount", { exact: true }).selectOption("6");
    await page.getByRole("button", { name: "Save Purchase", exact: true }).click();
    await expect(page.locator(".purchase-form-card")).toHaveCount(0);
    const updated = (await db.collection("purchases").get()).docs[0].data();
    expect(updated.purchaseId).toBe("PR-Z12-25");
    expect(updated.netPayable).toBe(188);
    expect(updated.items[0].sku).toBe("2_Round_HP");
  });
}
test("Purchase-only staff can save the full transaction; unassigned staff are denied", async ({ page }) => {
  for (const role of ["purchase-only", "no-purchase"]) {
    await asRole(page, role, "/dashboard/purchase");
    if (role === "no-purchase") await expect(page).toHaveURL(/\/dashboard\/check-inventory$/);
    const result = await page.evaluate(async () => {
      const { savePurchase } = await import("/src/utils/purchase.js");
      const { testUser } = await import("/tests/fixtures/auth.jsx");
      try {
        const purchase = await savePurchase({
          purchase: { purchaseId: testUser.uid === "purchase-only" ? "PR-A125-7" : "PR-A125-8", date: "2026-09-29", paymentDueDays: 0, vendorName: "Permission Test", totalWeight: 1, amount: 100, discount: 6, discountAmount: 6, netPayable: 94 },
          items: [{ id: "line", shape: "Round", type: "HP", size: "3", weight: 1, pieces: 1, box: "AB29" }], user: testUser,
        });
        return { id: purchase.id };
      } catch (error) { return { code: error.code, message: error.message }; }
    });
    if (role === "purchase-only") {
      expect(result.id).toBeTruthy();
      const saved = (await db.doc(`purchases/${result.id}`).get()).data();
      expect(saved.purchaseId).toBe("PR-A125-7");
      expect(saved.netPayable).toBe(94);
      expect((await db.doc(`inventory/${result.id}_line`).get()).data().sourcePurchaseId).toBe(result.id);
      expect((await db.collection("activityLog").where("recordId", "==", result.id).get()).size).toBe(1);
    } else expect(result.code).toBe("permission-denied");
  }
  expect((await db.collection("purchases").get()).size).toBe(1);
  expect((await db.collection("counters").get()).size).toBe(0);
});

test("Purchase field errors, red borders and corrections update without submit", async ({ page }) => {
  await asRole(page, "admin", "/dashboard/purchase");
  await page.locator(".purchase-actions").getByRole("button", { name: /Create Purchase/ }).click();
  const modal = page.locator(".purchase-form-card");
  await expect(modal.locator('[aria-invalid="true"]')).toHaveCount(0);
  await modal.getByRole("button", { name: "Create Purchase", exact: true }).click();
  await expect(modal.locator('[aria-invalid="true"]')).toHaveCount(9);
  const field = (label) => modal.getByLabel(label, { exact: true });
  const errorFor = async (input) => page.locator(`[id="${(await input.getAttribute("aria-describedby")).split(" ")[0]}"]`);
  const invalid = async (input, message) => {
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(input).toHaveCSS("border-top-color", "rgb(228, 92, 92)");
    await expect(await errorFor(input)).toContainText(message);
  };
  const valid = async (input) => {
    await expect(input).toHaveAttribute("aria-invalid", "false");
    await expect(await errorFor(input)).not.toHaveAttribute("role", "alert");
    await expect(input).not.toHaveCSS("border-top-color", "rgb(228, 92, 92)");
  };
  const number = field("Purchase Number after PR-");
  await number.fill("A12/1"); await invalid(number, "must follow PR-{letter}{series}-{number}");
  await number.fill("A12-101"); await invalid(number, "between 1 and 100");
  await number.fill("A12-01"); await invalid(number, "leading zeros");
  await number.fill("A12-1"); await valid(number);
  await expect(modal.getByText("Checking availability...", { exact: true })).toHaveCount(0);
  for (const [label, bad, good, message] of [
    ["Vendor Name", "", "Test Vendor", "required"],
    ["Total Purchase Weight (ct)", "-1", "1", "greater than 0"],
    ["Amount", "bad", "100", "greater than 0"],
    ["Payment Due Days", "1.5", "2", "whole number"],
    ["Item 1 Size", "0", "2", "positive"],
    ["Item 1 Weight", "-1", "1", "greater than 0"],
    ["Item 1 Pieces", "-1", "1", "whole number"],
    ["Item 1 BOX", "BAD?", "", "letters followed by numbers"],
  ]) {
    const input = field(label); await input.fill(bad); await invalid(input, message); await input.fill(good); await valid(input);
  }
  await invalid(field("Item 1 Type"), "required");
  await field("Item 1 Type").selectOption("HP"); await valid(field("Item 1 Type"));
  await invalid(field("Item 1 Shape"), "required");
  await field("Item 1 Shape").selectOption("Round"); await valid(field("Item 1 Shape"));
  await field("Discount").selectOption("custom");
  await field("Custom Discount %").fill("101"); await invalid(field("Custom Discount %"), "between 0 and 100");
  await expect(modal.locator(".purchase-financials > div").nth(2)).toContainText("--");
  await field("Custom Discount %").fill("10"); await valid(field("Custom Discount %"));
  await expect(modal.locator(".purchase-financials > div").nth(2)).toContainText("90.00");
  await field("Date").fill(""); await invalid(field("Date"), "required");
  await expect(modal.locator(".purchase-financials > div").nth(3)).toContainText("--");
  await field("Date").fill("2026-09-29"); await valid(field("Date"));
  await expect(modal.locator(".purchase-financials > div").nth(3)).toContainText("01 Oct 2026");
  await field("Total Purchase Weight (ct)").fill("3");
  await invalid(field("Total Purchase Weight (ct)"), "1.000 ct");
  await field("Item 1 Weight").fill("3"); await valid(field("Total Purchase Weight (ct)"));
  await modal.getByRole("button", { name: "+ Add Item", exact: true }).click();
  await invalid(field("Item 2 Weight"), "required");
  await valid(field("Item 1 Weight"));
  await field("Item 2 Type").selectOption("HP"); await field("Item 2 Shape").selectOption("Round");
  await field("Item 2 Size").fill("3"); await field("Item 2 Weight").fill("1"); await field("Item 2 Pieces").fill("0");
  await invalid(field("Total Purchase Weight (ct)"), "4.000 ct");
  await modal.getByRole("button", { name: "Remove item 2", exact: true }).click();
  await valid(field("Total Purchase Weight (ct)"));
  await expect(modal.locator('[aria-invalid="true"]')).toHaveCount(0);
  await db.doc("purchases/existing-number").set({ purchaseId: "PR-A12-1", vendorName: "Existing", createdAt: Timestamp.now() });
  await invalid(number, "already exists");
  await number.fill("A125-100"); await valid(number);
  await modal.getByRole("button", { name: "Create Purchase", exact: true }).click();
  await expect(modal).toHaveCount(0);
  expect((await db.collection("purchases").where("purchaseId", "==", "PR-A125-100").get()).docs[0].data().netPayable).toBe(90);
});
test("Challan and Party helpers use dark text on their existing light backgrounds", async ({ page }) => {
  await asRole(page, "admin", "/dashboard/challan");
  await page.getByRole("button", { name: "Create Challan", exact: true }).click();
  for (const selector of ["#challan-number-help", ".party-help"]) {
    await expect(page.locator(selector)).toHaveCSS("color", "rgb(51, 65, 85)");
    await expect(page.locator(selector)).toHaveCSS("background-color", "rgb(238, 242, 247)");
  }
  await expect(page.locator("#challan-number-help")).toHaveText("Format: B35/1. Use one letter from A to Z, a numeric series, and a final number from 1 to 100.");
  await page.screenshot({ path: "test-results/challan-helper-dark.png" });
});
test("Admin Settings registers old numbers once and unlocks both forms", async ({ page }) => {
  test.setTimeout(90000);
  await db.doc("numberingMigrations/manual-v1").delete();
  await db.doc("numberingMigrations/letters-v1").delete();
  await db.doc("challans/old-challan").set({ number: "A125/7", stage: 4, items: [], party: "Old Party", date: "2026-09-29" });
  await db.doc("purchases/old-purchase").set({ purchaseId: "PR-A99-100", vendorName: "Old Vendor", amount: 100, items: [], createdAt: Timestamp.now() });
  await asRole(page, "admin", "/dashboard/admin-settings");
  await page.getByRole("button", { name: "Register existing numbers", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Number setup complete" })).toBeVisible();
  expect((await db.doc("numberingMigrations/manual-v1").get()).data().ready).toBe(true);
  expect((await db.doc("numberingMigrations/letters-v1").get()).data().ready).toBe(true);
  expect((await db.doc("challanNumbers/A125-7").get()).data().recordId).toBe("old-challan");
  expect((await db.doc("purchaseNumbers/PR-A99-100").get()).data().recordId).toBe("old-purchase");
  await page.goto("/dashboard/challan");
  await fillChallan(page, "A1/1");
  await page.getByRole("button", { name: "Create Challan", exact: true }).click();
  await expect(page.locator(".challan-row").filter({ hasText: "A1/1" })).toBeVisible();
  await page.goto("/dashboard/purchase");
  await page.locator(".purchase-actions").getByRole("button", { name: /Create Purchase/ }).click();
  await page.getByRole("textbox", { name: "Purchase Number after PR-" }).fill("A1-1");
  await page.getByLabel("Vendor Name", { exact: true }).fill("New Vendor");
  await page.getByLabel("Total Purchase Weight (ct)", { exact: true }).fill("1");
  await page.getByLabel("Amount", { exact: true }).fill("100");
  const item = page.locator(".purchase-form-card .purchase-items tbody tr").first();
  await item.locator("select").nth(0).selectOption("HP");
  await item.locator("select").nth(1).selectOption("Round");
  for (const [index, value] of ["2", "1", "1", ""].entries()) await item.locator("input").nth(index).fill(value);
  await page.getByRole("button", { name: "Create Purchase", exact: true }).click();
  await expect(page.locator(".purchase-form-card")).toHaveCount(0);
  expect((await db.collection("purchases").where("purchaseId", "==", "PR-A1-1").get()).size).toBe(1);
});
test("Single sidebar groups expand on collapsed click and preserve route activity", async ({ page }) => {
 await asRole(page,"admin","/dashboard/check-inventory");
 const nav=page.locator('.dashboard-sidebar nav');
 await nav.getByRole('button',{name:'Operations',exact:true}).click();
 await expect(page.getByRole('button',{name:'Collapse sidebar',exact:true})).toBeVisible();
 await expect(nav.getByRole('link',{name:'Challan',exact:true})).toBeVisible();
 await nav.getByRole('button',{name:'Reports',exact:true}).click();
 await nav.getByRole('link',{name:'Activity Log',exact:true}).click();
 await expect(nav.locator('a.active')).toHaveText('Activity Log');
 await nav.getByRole('button',{name:'Admin',exact:true}).click();
 await nav.getByRole('link',{name:'Settings',exact:true}).click();
 await expect(nav.locator('a.active')).toHaveText('Settings');
 await page.getByRole('button',{name:'Collapse sidebar',exact:true}).click();
 await nav.getByRole('button',{name:'Admin',exact:true}).click();
 await expect(nav.getByRole('link',{name:'Settings',exact:true})).toBeVisible();
 await expect(page.locator('.dashboard-sidebar')).toHaveCount(1);
 await expect(page.locator('.admin-management-flyout')).toHaveCount(0);
 await expect(page.locator('.dashboard-header').getByRole('button',{name:'Logout',exact:true})).toBeVisible();
 await page.locator('.dashboard-header').getByRole('button',{name:'Toggle color theme'}).click();
 await expect(page.locator('html')).toHaveAttribute('data-theme','light');
 await expect(page.getByText('DANGER ZONE',{exact:true})).toBeVisible();
});

test("Staff cannot see or directly access Activity Log and Settings", async ({ page }) => {
  await asRole(page, "staff", "/dashboard/check-inventory");
  for (const path of ["activity-log", "admin-settings"]) {
    await expect(page.locator(`.dashboard-sidebar a[href='/dashboard/${path}']`)).toHaveCount(0);
    await page.goto(`/dashboard/${path}`);
    await expect(page).toHaveURL(/\/dashboard\/check-inventory$/);
  }
});
test("Inventory preview text has readable dark-theme contrast without changing columns", async ({ page }) => {
  await asRole(page, "admin", "/dashboard/inventory");
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([
    { Shape: "Marquise", Type: "HP", "Weight (ct)": 11, "Size (mm)": 0.3, BOX: "" },
    { Shape: "Round", Type: "INVALID", "Weight (ct)": 1, "Size (mm)": 0.4, BOX: "BAD?" },
  ]), "Inventory");
  await page.locator("input[type=file]").setInputFiles({ name: "inventory.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) });
  const modal = page.locator(".inventory-import-card");
  await expect(modal).toBeVisible();
  await expect(modal.locator("table").first().locator("th")).toHaveText(["Shape", "Type", "Weight (ct)", "Size (mm)", "SKU", "BOX", "Result"]);
  await expect(modal.locator(".inventory-import-placeholder").first()).toHaveText("--");
  const colors = await modal.evaluate((root) => {
    const rgb = (value) => (value.match(/[\d.]+/g) || []).map(Number);
    const luminance = (color) => rgb(color).slice(0, 3).map((v) => v / 255).map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
    return [...root.querySelectorAll("h3, p, header b, header span, th, td")].map((el) => {
      let ancestor = el, background;
      while (ancestor) {
        const candidate = getComputedStyle(ancestor).backgroundColor;
        if (rgb(candidate)[3] !== 0) { background = candidate; break; }
        ancestor = ancestor.parentElement;
      }
      const a = luminance(getComputedStyle(el).color), b = luminance(background || "rgb(0,0,0)");
      return { text: el.textContent, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
    });
  });
  for (const entry of colors) expect(entry.ratio, entry.text).toBeGreaterThanOrEqual(4.5);
  await modal.screenshot({ path: "test-results/inventory-import-dark.png" });
});

test('Inventory picker natural tokens, viewport portal, keyboard, physical IDs and live stock',async({page})=>{
 const rows=[['a','5.00','Emerlad','CVD'],['b','5','Emerald','CVD'],['c','4.5','Emerlad','CVD'],['d','5.03','PR','CBD']];
 for(const [id,size,shape,type]of rows)await db.doc(`inventory/${id}`).set({sku:`${size}_${shape}_${type}`,size,shape,type,weight:3,pieces:12});
 for(let i=0;i<25;i++)await db.doc(`inventory/browse${i}`).set({sku:`${i+10}_PR_CBD`,size:String(i+10),shape:'PR',type:'CBD',weight:2,pieces:1});
 await asRole(page,'admin','/dashboard/challan');await page.getByRole('button',{name:'Create Challan',exact:true}).click();
 const input=page.getByRole('combobox',{name:'Inventory picker'}),options=page.getByRole('option');await input.click();await expect(options).toHaveCount(30);
 for(const [query,count]of [['4.5',1],['4.5 CVD',1],['4.5 emerald',1],['emerald CVD',3],['4.5 emerald CVD',1],['4.5_Emerlad_CVD',1],['5.00',6],['5',6]]){await input.fill(query);await expect(options).toHaveCount(count);}
 await input.fill('');const popup=page.getByRole('listbox',{name:'Available Inventory'});expect(await popup.evaluate(el=>el.parentElement===document.body)).toBe(true);
 const before=await page.evaluate(()=>window.scrollY);await popup.evaluate(el=>el.scrollTop=el.scrollHeight);expect(await popup.evaluate(el=>el.scrollTop)).toBeGreaterThan(0);expect(await page.evaluate(()=>window.scrollY)).toBe(before);
 await input.fill('5 emerald');await input.press('ArrowDown');await input.press('Enter');await expect(input).toHaveValue('5_Emerald_CVD');await expect(popup).toHaveCount(0);
 // Width follows the picker in DOM, irrespective of responsive wrapping.
 expect(await input.evaluate(el=>el.closest('.inventory-picker').nextElementSibling.querySelector('input').getAttribute('aria-label'))).toBe('Width');
 await input.click();await input.press('Escape');await expect(popup).toHaveCount(0);
 await db.doc('inventory/live').set({sku:'5.25_PR_CBD',size:'5.250',shape:'PR',type:'CBD',weight:2,pieces:2});await input.click();await input.fill('5.25');await expect(options).toHaveCount(1);
 await db.doc('inventory/live').update({weight:0,pieces:0});await expect(options).toHaveCount(0);
 await input.fill('');await page.setViewportSize({width:900,height:520});await input.scrollIntoViewIfNeeded();
 const rect=await input.boundingBox(),box=await popup.boundingBox();expect(box.y).toBeGreaterThanOrEqual(0);expect(box.y+box.height).toBeLessThanOrEqual(521);if(rect.y>260)expect(box.y+box.height).toBeLessThanOrEqual(rect.y);
 await page.screenshot({path:'test-results/picker-dark.png'});
 await input.press('Escape');await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Operations',exact:true}).click();await page.screenshot({path:'test-results/sidebar-mobile.png'});
});

test('Unavailable reset status preserves every page read-only and retry restores writes',async({page})=>{
 const rules=await readFile('firestore.rules','utf8');
 const denied=rules.replace('match /systemState/{id} { allow read: if request.auth != null; allow write: if false; }','match /systemState/{id} { allow read, write: if false; }');
 expect(denied).not.toBe(rules);
 const restricted=await initializeTestEnvironment({projectId:'demo-jewellery-ui',firestore:{rules:denied}});
 try {
  for(const path of ['','inventory','check-inventory','purchase','challan','master-prices','activity-log','weekly-report','admin-settings']) {
   await asRole(page,'admin',`/dashboard/${path}`,false);
   await expect(page.getByRole('alert').filter({hasText:'Records remain viewable'})).toBeVisible();
   await expect(page.locator('.dashboard-content h2,.dashboard-content h3').first()).toBeVisible();
  }
  const result=await page.evaluate(async()=>{
   const moduleUrl=performance.getEntriesByType('resource').filter(entry=>entry.name.includes('/src/firebase/businessWrites.js')).at(-1).name;const writes=await import(moduleUrl),{db}=await import('/tests/fixtures/firebase.js');
   const calls=[()=>writes.setDoc({path:'inventory/x'},{}),()=>writes.updateDoc({path:'inventory/x'},{}),()=>writes.addDoc({path:'inventory'},{}),()=>writes.runTransaction(db,()=>{}),()=>writes.deleteDoc({firestore:db}),()=>writes.writeBatch(db).commit()];
   const messages=[];for(const call of calls){try{await call();messages.push('UNEXPECTED SAVE');}catch(error){messages.push(error.message);}}return messages;
  });
  expect(result).toHaveLength(6);for(const message of result)expect(message).toContain('Saving is unavailable');
  const restored=await initializeTestEnvironment({projectId:'demo-jewellery-ui',firestore:{rules}});
  await page.getByRole('button',{name:'Retry connection',exact:true}).click();
  await expect(page.getByRole('alert').filter({hasText:'Records remain viewable'})).toHaveCount(0);
  await page.evaluate(async()=>{const moduleUrl=performance.getEntriesByType('resource').filter(entry=>entry.name.includes('/src/firebase/businessWrites.js')).at(-1).name;const writes=await import(moduleUrl),{db}=await import('/tests/fixtures/firebase.js');await writes.runTransaction(db,()=>{});});
  await restored.cleanup();
 } finally {const restored=await initializeTestEnvironment({projectId:'demo-jewellery-ui',firestore:{rules}});await restored.cleanup();await restricted.cleanup();}
});

test('Dashboard restored, compact empty cards, live analytics, sidebar structure and themes',async({page})=>{
 await asRole(page,'admin','/dashboard');
 const titles=['Inventory Performance','Inventory Aging','Attention Required','Clear First','Party Performance','Challan Performance','Purchase Due Overview','Largest Purchases','Risk & Opportunity'];
 for(const title of titles)await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible();
 expect(await page.locator('.business-quick').evaluate(el=>el.closest('.business-hero')!==null)).toBe(true);
 const heights=await page.locator('.business-card').evaluateAll(cards=>cards.filter(c=>['Inventory Performance','Party Performance','Largest Purchases','Risk & Opportunity'].includes(c.querySelector('h3').textContent)).map(c=>c.getBoundingClientRect().height));for(const height of heights)expect(height).toBeLessThan(230);
 expect(await page.locator('.business-aging-row.is-zero .business-bar').evaluateAll(bars=>bars.every(bar=>bar.getBoundingClientRect().width===0))).toBe(true);
 const side=page.locator('.dashboard-sidebar');expect((await side.boundingBox()).width).toBe(72);
 await page.getByRole('button',{name:'Operations',exact:true}).click();await expect(page.getByRole('link',{name:'Challan',exact:true})).toBeVisible();await expect.poll(async()=>(await side.boundingBox()).width).toBe(232);
 await expect(page.getByText('Grantha Exports',{exact:true})).toHaveCount(1);
 for(const theme of ['dark','light']){
  await page.evaluate(value=>document.documentElement.dataset.theme=value,theme);
  const colors=await side.locator('a.active,button.nav-group-toggle').evaluateAll(nodes=>nodes.map(el=>getComputedStyle(el).backgroundColor));expect(colors).not.toContain('rgb(255, 255, 255)');
  await page.screenshot({path:`test-results/dashboard-${theme}-expanded.png`,fullPage:true});
  await page.getByRole('button',{name:'Collapse sidebar',exact:true}).click();await expect.poll(async()=>(await side.boundingBox()).width).toBe(72);await page.screenshot({path:`test-results/dashboard-${theme}-collapsed.png`,fullPage:true});await page.getByRole('button',{name:'Operations',exact:true}).click();
 }
 await page.locator('.dashboard-sidebar').getByRole('link',{name:'Challan',exact:true}).click();await expect(side.locator('a.active')).toContainText('Challan');await page.reload();await expect(side.locator('a.active')).toBeVisible();
 await page.goto('/dashboard');await page.getByLabel('Analysis period').selectOption('custom');await page.getByLabel('Period start').fill('2026-01-01');await page.getByLabel('Period end').fill('2026-12-31');await expect(page.locator('.business-period small')).toContainText('2026');
 const now=Date.now();await db.doc('inventory/stock').update({weight:20,createdAt:Timestamp.fromMillis(now-120*86400000)});
 for(let i=0;i<2;i++)await db.doc(`challans/analytic${i}`).set({party:'Demo Party',stage:3,createdAtMs:now-4*86400000,finalInvoice:{finalInvoiceAmount:700},stage2Return:{transitionedAtMs:now-86400000,items:[{inventoryId:'stock',shape:'Round',size:'1',type:'CVD',issuedWeight:5,soldWeight:4,returnWeight:1}]}});
 await db.doc('purchases/analytic').set({purchaseId:'PR-A1-1',vendorName:'Demo Vendor',date:'2026-10-03',paymentDueDate:'2026-10-02',totalWeight:3,netPayable:300});
 await expect(page.locator('.business-live-strip')).toContainText('20 ct');await expect(page.locator('.business-party')).toContainText('Demo Party');await expect(page.locator('.business-reason-tags').first()).toContainText('Old stock');await expect(page.locator('.business-purchase-list')).toContainText('PR-A1-1');
 await page.screenshot({path:'test-results/dashboard-populated.png',fullPage:true});
 for(const width of [1024,768,390]){await page.setViewportSize({width,height:900});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`test-results/dashboard-${width}.png`,fullPage:true});}
 await page.getByRole('button',{name:'Reports',exact:true}).click();await page.getByRole('button',{name:'Admin',exact:true}).click();await page.setViewportSize({width:390,height:420});expect(await side.locator('nav').evaluate(el=>el.scrollHeight>el.clientHeight)).toBe(true);
 await expect(page.locator('.dashboard-sidebar')).toHaveCount(1);await expect(page.locator('.admin-management-flyout')).toHaveCount(0);
});

test('Dashboard permissions, offline automatic recovery and genuine reset protection',async({page})=>{
 await asRole(page,'purchase-only','/dashboard');await expect(page.getByRole('button',{name:'+ Create Purchase',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'+ Add Inventory',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Admin',exact:true})).toHaveCount(0);
 await page.evaluate(async()=>{const f=await import('/tests/fixtures/firebase.js');await f.disableNetwork(f.db);});await expect(page.locator('.availability-banner')).toContainText('Connection issue');await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();
 await page.evaluate(async()=>{const f=await import('/tests/fixtures/firebase.js');await f.enableNetwork(f.db);});await expect(page.locator('.availability-banner')).toHaveCount(0);
 await db.doc('systemState/business').set({locked:true,status:'running',generation:1,message:'Deleting local test records'});await expect(page.getByRole('heading',{name:'Business system is being reset'})).toBeVisible();await expect(page.locator('.business-dashboard')).toHaveCount(0);
 await db.doc('systemState/business').update({locked:true,status:'incomplete'});await expect(page.locator('.business-dashboard')).toHaveCount(0);
 await db.doc('systemState/business').update({locked:false,status:'complete'});await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();
 await db.doc('systemState/business').update({locked:true,status:'unknown'});await expect(page.locator('.availability-banner')).toBeVisible();await expect(page.locator('.business-dashboard')).toBeVisible();
 await db.doc('systemState/business').delete();await expect(page.locator('.availability-banner')).toHaveCount(0);await expect(page.locator('.business-dashboard')).toBeVisible();
});
