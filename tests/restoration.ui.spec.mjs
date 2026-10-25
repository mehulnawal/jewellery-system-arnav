import { test, expect } from "@playwright/test";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { readFile } from "node:fs/promises";
import { recordSettlementPayment } from "../src/utils/settlementPayments.js";
if (!process.env.FIRESTORE_EMULATOR_HOST?.startsWith("127.0.0.1:"))
  throw Error("Local emulator required");
const app = initializeApp({ projectId: "demo-jewellery-ui" }, "restoration-ui"),
  db = getFirestore(app);
let env;
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
test.beforeEach(async () => {
  await env.clearFirestore();
  for (const uid of ["admin", "role-admin", "baseline", "staff"])
    await db
      .doc("employeeProfiles/" + uid)
      .set({
        active: true,
        uid,
        accessId: uid,
        role:
          uid === "admin"
            ? "superadmin"
            : uid === "role-admin"
              ? "admin"
              : "employee",
        permissions: uid === "staff" ? ["challan-stage-4"] : [],
      });
});
const login = async (page, uid, path) => {
  await page.addInitScript(
    (value) => localStorage.setItem("test-role", value),
    uid,
  );
  await page.goto(path);
};

test("Stage 4 receipt-backed edits save and actual concurrent edits remain protected", async ({ page }) => {
  await legacy("ledger", 3000);
  const ref = db.doc("challans/ledger");
  const source = (await ref.get()).data();
  const update = recordSettlementPayment(
    { ...source, stage: 3, finalSettlement: undefined },
    "3000", "350", "receipt-1", Date.now(),
    { uid: "admin", role: "superadmin", accessId: "admin" },
  );
  await ref.update(update);
  await login(page, "admin", "/dashboard/challan");
  await page.locator(".challan-page nav button").filter({ hasText: "Stage 4" }).click();
  const row = page.locator(".challan-row").filter({ hasText: "A1/ledger" });
  await row.locator(".challan-edit").click();
  const edit = page.getByRole("dialog", { name: "Edit Stage 4 Settlement" });
  await edit.getByLabel("Amount Paid by Customer").fill("2900");
  await edit.locator("textarea").fill("Saved correction");
  await edit.getByRole("button", { name: "Save Settlement Changes" }).click();
  await expect(edit).not.toBeVisible();
  const saved = (await ref.get()).data();
  expect(saved.finalSettlement.amountPaid).toBe(2900);
  expect(saved.finalSettlement.remaining).toBe(1750);
  expect(saved.settlementPayments).toHaveLength(1);
  expect(saved.settlementCorrections).toHaveLength(1);
  await row.locator(".challan-edit").click();
  await expect(edit).toBeVisible();
  await ref.update({ notes: "Another user's change" });
  await edit.locator("textarea").fill("Stale draft");
  await edit.getByRole("button", { name: "Save Settlement Changes" }).click();
  await expect(edit.getByRole("alert")).toContainText("Settlement changed while you were editing");
  expect((await ref.get()).data().notes).toBe("Another user's change");
});
const fillOrder = async (modal) => {
  await modal.getByLabel(/Client Name/).fill("Client Alpha");
  await modal.getByLabel(/Staff Name/).fill("Any staff text");
  await modal
    .getByLabel(/Order Details/)
    .fill("Ring Order\nSize 12\nRose Gold\n\nUrgent");
};
for (const role of ["baseline", "role-admin", "admin"])
  test(`Order List baseline access and CRUD for ${role}`, async ({ page }) => {
    await login(page, role, "/dashboard/order-list");
    await expect(
      page.getByRole("heading", { name: "Order List", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Add Order", exact: true }).click();
    let modal = page.getByRole("dialog", { name: "Add Order" });
    await fillOrder(modal);
    await modal.getByRole("button", { name: "Add Order", exact: true }).click();
    await expect(modal).not.toBeVisible();
    await page
      .getByRole("button", { name: "View order for Client Alpha" })
      .first()
      .click();
    modal = page.getByRole("dialog", { name: "Order Details" });
    await expect(modal.locator(".order-full-text")).toHaveText(
      "Ring Order\nSize 12\nRose Gold\n\nUrgent",
    );
    await modal.getByRole("button", { name: "Edit", exact: true }).click();
    modal = page.getByRole("dialog", { name: "Edit Order" });
    await modal.getByLabel(/Client Name/).fill("Client Beta");
    await modal.getByRole("button", { name: "Save Changes" }).click();
    await expect(modal).not.toBeVisible();
    const saved = await db.collection("orderList").get(),
      before = saved.docs[0].data();
    expect(before.createdBy.uid).toBe(role);
    expect(before.updatedBy.uid).toBe(role);
    await page
      .getByRole("button", { name: "Delete order for Client Beta" })
      .first()
      .click();
    await page
      .getByRole("dialog", { name: "Delete Order?" })
      .getByRole("button", { name: "Cancel" })
      .click();
    expect((await db.collection("orderList").get()).size).toBe(1);
    await page
      .getByRole("button", { name: "Delete order for Client Beta" })
      .first()
      .click();
    await page
      .getByRole("dialog", { name: "Delete Order?" })
      .getByRole("button", { name: "Delete Order", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "No orders added yet." }),
    ).toBeVisible();
    for (const name of ["challans", "inventory", "purchases"])
      expect((await db.collection(name).get()).size).toBe(0);
  });
test("unauthenticated Order List route redirects to login", async ({
  page,
}) => {
  await login(page, "anonymous", "/dashboard/order-list");
  await expect(page).toHaveURL(/login/);
});

test("Order List pagination, filters, sort, and responsive cards retain full details", async ({
  page,
}) => {
  const batch = db.batch();
  for (let i = 0; i < 26; i++)
    batch.set(db.doc("orderList/o" + i), {
      orderDate: i === 25 ? "2026-10-25" : "2026-10-26",
      clientName: i === 25 ? "Special" : "Client " + i,
      staffName: i === 25 ? "Sana" : "Ravi",
      description: "Order " + i,
      image: null,
      createdAt: Timestamp.fromMillis(i + 1),
      updatedAt: Timestamp.fromMillis(100 - i),
      createdBy: { uid: "baseline", name: "Staff", role: "employee" },
      updatedBy: null,
    });
  await batch.commit();
  await login(page, "baseline", "/dashboard/order-list");
  await expect(page.locator(".order-table tbody tr")).toHaveCount(25);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.locator(".order-table tbody tr")).toHaveCount(1);
  await page.getByLabel("Search", { exact: true }).fill("Special");
  await expect(page.locator(".order-table tbody tr")).toHaveCount(1);
  await page.getByRole("button", { name: "Clear Filters" }).click();
  await page.getByLabel("Client", { exact: true }).selectOption("Special");
  await page.getByLabel("Staff", { exact: true }).selectOption("Sana");
  await page.getByLabel("From Date").fill("2026-10-25");
  await page.getByLabel("To Date").fill("2026-10-25");
  await expect(page.locator(".order-table tbody tr")).toHaveCount(1);
  await page.getByRole("button", { name: "Clear Filters" }).click();
  for (const sort of ["oldest", "added", "updated", "newest"]) {
    await page.getByLabel("Sort", { exact: true }).selectOption(sort);
    await expect(page.locator(".order-table tbody tr")).toHaveCount(25);
  }
  for (const theme of ["light", "dark"])
    for (const width of [1440, 1024, 768, 480, 375]) {
      await page.evaluate(
        (value) => (document.documentElement.dataset.theme = value),
        theme,
      );
      await page.setViewportSize({ width, height: 1000 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      if (width <= 1024)
        await expect(page.locator(".order-cards")).toBeVisible();
      if (width === 375 || width === 1440)
        await page.screenshot({
          path: `test-results/order-list-page-${theme}-${width}.png`,
          fullPage: true,
        });
    }
});
async function legacy(id, paid, owner = "staff", age = 5 * 86400000) {
  await db
    .doc("challans/" + id)
    .set({
      id,
      stage: 4,
      number: "A1/" + id,
      party: "Rohan",
      date: "2026-10-26",
      notes: "",
      items: [],
      createdBy: owner,
      createdByRole: "employee",
      createdAt: Timestamp.now(),
      stageHistory: {
        stage4: {
          enteredAt: Timestamp.fromMillis(Date.now() - age),
          enteredAtMs: 123,
        },
      },
      finalInvoice: { finalInvoiceAmount: 5000, items: [] },
      finalSettlement: {
        amountPaid: paid,
        settlementDiscountAmount: 350,
        remaining: 0,
        completedAtMs: 123,
      },
    });
}
test("old Stage 4 list/filter/View/Admin correction and later receipt stay consistent", async ({
  page,
}) => {
  await legacy("1", 3000);
  await legacy("2", 4650);
  await login(page, "role-admin", "/dashboard/challan");
  const row = page.locator(".challan-row").filter({ hasText: "A1/1" });
  await expect(row).toContainText("Paid: ₹3,000.00");
  await expect(row).toContainText("Outstanding: ₹1,650.00");
  await page.getByLabel("Payment Status").selectOption("outstanding");
  await expect(page.locator(".challan-row")).toHaveCount(1);
  await row.locator(".challan-edit").click();
  const edit = page.getByRole("dialog", { name: "Edit Stage 4 Settlement" });
  await expect(edit.getByLabel("Amount Paid by Customer")).toHaveValue("3000");
  await edit.getByLabel("Amount Paid by Customer").fill("2900");
  await expect(edit.getByRole("status")).toContainText("1750.00");
  for (const theme of ["light", "dark"])
    for (const width of [1440, 390]) {
      await page.evaluate(
        (value) => (document.documentElement.dataset.theme = value),
        theme,
      );
      await page.setViewportSize({ width, height: 800 });
      await expect(edit.getByRole("button", {name: "Save Settlement Changes"})).toBeInViewport();
      const bounds = await edit.boundingBox();
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1);
      await page.screenshot({
        path: `test-results/stage4-editor-${theme}-${width}.png`,
        fullPage: true,
      });
    }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await edit.getByRole("button", { name: "Save Settlement Changes" }).click();
  await expect(edit).not.toBeVisible();
  await row.getByRole("button", { name: "Record Outstanding Payment" }).click();
  const payment = page.getByRole("dialog", { name: "Final Settlement" });
  await payment.getByLabel(/Amount Paid by Customer/).fill("1750");
  await payment
    .getByRole("button", { name: "Record Payment / Complete" })
    .click();
  await expect(payment).not.toBeVisible();
  await expect(page.locator(".challan-row")).toHaveCount(0);
  await page.getByLabel("Payment Status").selectOption("settled");
  await expect(page.locator(".challan-row")).toHaveCount(2);
  const saved = (await db.doc("challans/1").get()).data();
  expect(saved.settlementPayments).toHaveLength(1);
  expect(saved.settlementCorrections).toHaveLength(1);
  expect(saved.finalSettlement.remaining).toBe(0);
  expect(saved.finalSettlement.completedAtMs).toBe(123);
  await row.locator(".challan-view-button").click();
  await expect(page.locator(".challan-view-current")).toContainText(
    "Fully Paid",
  );
  await expect(
    page.getByRole("region", { name: "Payment History" }),
  ).toContainText("Settlement Corrections");
  for (const theme of ["light", "dark"])
    for (const width of [1440, 390]) {
      await page.evaluate(
        (value) => (document.documentElement.dataset.theme = value),
        theme,
      );
      await page.setViewportSize({ width, height: 1000 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `test-results/stage4-view-${theme}-${width}.png`,
        fullPage: true,
      });
    }
});
test("Staff Stage 4 editor available within window and hidden after expiry", async ({
  page,
}) => {
  await legacy("1", 3000, "staff", 30 * 60000);
  await legacy("2", 3000);
  await login(page, "staff", "/dashboard/challan");
  await page
    .locator(".challan-page nav button")
    .filter({ hasText: "Stage 4" })
    .click();
  await expect(
    page
      .locator(".challan-row")
      .filter({ hasText: "A1/1" })
      .locator(".challan-edit"),
  ).toBeVisible();
  await expect(
    page
      .locator(".challan-row")
      .filter({ hasText: "A1/2" })
      .locator(".challan-edit"),
  ).toHaveCount(0);
});
