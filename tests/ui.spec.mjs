import { test, expect } from "@playwright/test";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { readFile } from "node:fs/promises";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import * as XLSX from "xlsx";

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
    db.doc("numberingMigrations/manual-v1").set({ ready: true }),
    db.doc("numberingMigrations/letters-v1").set({ ready: true }),
    db.doc("inventory/stock").set({ sku: "1_Round_CVD", shape: "Round", type: "CVD", size: "1", weight: 10, pieces: 10, createdAt: Timestamp.now(), createdBy: "admin" }),
  ]);
  await page.addInitScript(() => localStorage.setItem("theme", "dark"));
  // No test browser request may reach a production Firebase service.
  await page.route(/https:\/\/.*(?:googleapis\.com|firebaseio\.com)/, (route) => route.abort());
});
async function asRole(page, role, path) {
  await page.addInitScript((value) => localStorage.setItem("test-role", value), role);
  await page.goto(path);
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
test("Admin sidebar items are standalone with distinct active states and collapsed labels", async ({ page }) => {
  await asRole(page, "admin", "/dashboard/check-inventory");
  const nav = page.locator(".dashboard-sidebar nav");
  await expect(nav.locator(".dashboard-nav-item").last()).toContainText("Settings");
  await expect(nav.locator(".dashboard-nav-item").nth(4)).toContainText("Admin / Management");
  await expect(nav.locator(".dashboard-nav-item").nth(5)).toContainText("Activity Log");
  await page.getByRole("button", { name: "Admin / Management", exact: true }).click();
  await expect(page.locator(".admin-management-flyout").getByText("Activity Log", { exact: true })).toHaveCount(0);
  await expect(page.locator(".admin-management-flyout").getByText("Settings", { exact: true })).toHaveCount(0);
  for (const [path, label] of [["activity-log", "Activity Log"], ["admin-settings", "Settings"]]) {
    await nav.locator(`a[href='/dashboard/${path}']`).click();
    await expect(nav.locator(".active")).toHaveCount(1);
    await expect(nav.locator(".active")).toContainText(label);
    await expect(nav.locator(`a[href='/dashboard/${path}'] svg`)).toHaveCount(1);
  }
  await page.getByRole("button", { name: "Expand sidebar", exact: true }).click();
  await expect(nav.locator("a[href='/dashboard/admin-settings'] .dashboard-nav-label")).toBeVisible();
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
