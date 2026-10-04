import { test, expect } from "@playwright/test";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { readFile } from "node:fs/promises";
if (!process.env.FIRESTORE_EMULATOR_HOST?.startsWith("127.0.0.1:"))
  throw Error("Loopback emulator required");
const app = initializeApp({ projectId: "demo-jewellery-ui" }, "status-tests"),
  db = getFirestore(app);
const rules = await readFile("firestore.rules", "utf8");
let env;
async function setRules(value) {
  const next = await initializeTestEnvironment({
    projectId: "demo-jewellery-ui",
    firestore: { rules: value },
  });
  await next.cleanup();
}
const denyStatus = rules.replace(
  "match /systemState/{id} { allow read: if request.auth != null; allow write: if false; }",
  "match /systemState/{id} { allow read, write: if false; }",
);
const denyPrices = (value) =>
  value.replace(
    "allow read: if admin() || (challanEmployee() && resource.data.active == true);",
    "allow read: if false;",
  );
test.beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-jewellery-ui",
    firestore: { rules },
  });
});
test.afterAll(async () => {
  await env.cleanup();
  await deleteApp(app);
});
test.beforeEach(async ({ page }) => {
  await setRules(rules);
  await env.clearFirestore();
  for (const uid of ["admin", "staff"])
    await db
      .doc("employeeProfiles/" + uid)
      .set({
        uid,
        role: uid === "admin" ? "superadmin" : "employee",
        active: true,
        permissions: ["inventory", "challan-stage-1"],
        accessId: uid,
      });
  await page.addInitScript(() => {
    localStorage.setItem("theme", "dark");
    localStorage.setItem("test-role", "admin");
  });
  await page.route(/https:\/\/.*(?:googleapis\.com|firebaseio\.com)/, (route) =>
    route.abort(),
  );
});
test.afterEach(async () => setRules(rules));
async function healthy(page) {
  await expect(page.locator(".availability-banner")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Add Price", exact: true }),
  ).toBeEnabled();
}
async function seedPrice() {
  await db
    .doc("masterPrices/5_PR_CBD__default")
    .set({
      type: "CBD",
      shape: "PR",
      height: "5",
      width: "",
      price: 5000,
      active: true,
      revision: 1,
    });
}

test("server-confirmed missing marker is healthy; settings navigation, templates and staff route protection", async ({
  page,
}) => {
  await page.goto("/dashboard/master-prices");
  await healthy(page);
  await expect(page.getByText("No Master Prices added yet.")).toBeVisible();
  await page.goto("/dashboard/admin-settings");
  await expect(
    page.getByRole("button", { name: "Delete All Records", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Import Templates", exact: true })
    .click();
  await expect(page).toHaveURL(/section=templates/);
  await expect(
    page.getByRole("button", { name: "Download Master Price Template" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Download Sample Excel" }),
  ).toBeVisible();
  await page
    .locator(".import-template-toggle")
    .filter({ hasText: "Purchase" })
    .click();
  await expect(
    page.getByRole("button", { name: "Download Purchase Template" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Open Danger Zone" }).click();
  await expect(page).toHaveURL(/admin-settings\/danger-zone$/);
  await expect(
    page.getByRole("button", { name: "Delete All Records", exact: true }),
  ).toBeEnabled();
  await page.goBack();
  await expect(page).toHaveURL(/section=templates/);
  await page.goForward();
  await expect(
    page.getByRole("heading", { name: "Danger Zone", exact: true }),
  ).toBeVisible();
  await page.addInitScript(() => localStorage.setItem("test-role", "staff"));
  await page.goto("/dashboard/admin-settings/danger-zone");
  await expect(
    page.getByRole("button", { name: "Delete All Records", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".availability-banner")).toHaveCount(0);
});

test("supplied rules omissions reproduce both failures; one global error; retry restores both listeners", async ({
  page,
}) => {
  expect(denyStatus).not.toBe(rules);
  expect(denyPrices(rules)).not.toBe(rules);
  await seedPrice();
  await setRules(denyPrices(denyStatus));
  const diagnostics = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") diagnostics.push(msg.text());
  });
  await page.goto("/dashboard/master-prices");
  await expect(page.locator(".availability-banner")).toContainText(
    "System status access was denied",
  );
  await expect(page.locator(".master-notice")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Add Price", exact: true }),
  ).toBeDisabled();
  await expect.poll(() => diagnostics.join(" ")).toContain("masterPrices");
  await setRules(rules);
  await page.getByRole("button", { name: "Retry connection" }).click();
  await healthy(page);
  await expect(page.locator(".master-records tbody tr")).toHaveCount(1);
});

test("Master-specific permission error recovers automatically without reload", async ({
  page,
}) => {
  await seedPrice();
  await setRules(denyPrices(rules));
  await page.goto("/dashboard/master-prices");
  await expect(page.locator(".availability-banner")).toHaveCount(0);
  await expect(page.locator(".master-notice")).toContainText(
    "Master Price access was denied",
  );
  await expect(
    page.getByRole("button", { name: "Retry price list" }),
  ).toBeVisible();
  await setRules(rules);
  await healthy(page);
  await expect(page.locator(".master-records tbody tr")).toHaveCount(1);
});

test("offline cached rows stay visible; writes disabled; reconnect restores without reload", async ({
  page,
}) => {
  await seedPrice();
  await page.goto("/dashboard/master-prices");
  await healthy(page);
  await page.evaluate(async () => {
    const f = await import("/tests/fixtures/firebase.js");
    await f.disableNetwork(f.db);
    window.dispatchEvent(new Event("offline"));
  });
  await expect(page.locator(".availability-banner")).toContainText(
    "Connection issue",
  );
  await expect(page.locator(".master-notice")).toHaveCount(0);
  await expect(page.locator(".master-records tbody tr")).toHaveCount(1);
  for (const name of ["Add Price", "Import", "Edit", "Delete"])
    await expect(
      page.getByRole("button", { name, exact: true }),
    ).toBeDisabled();
  await page.evaluate(async () => {
    const f = await import("/tests/fixtures/firebase.js");
    await f.enableNetwork(f.db);
    window.dispatchEvent(new Event("online"));
  });
  await healthy(page);
});

test("invalid marker fails closed, locks remain maintenance, verified repair restores pages", async ({
  page,
}) => {
  await db
    .doc("systemState/business")
    .set({ locked: false, generation: "broken" });
  await page.goto("/dashboard/master-prices");
  await expect(page.locator(".availability-banner")).toContainText(
    "configuration error",
  );
  await expect(
    page.getByRole("button", { name: "Add Price", exact: true }),
  ).toBeDisabled();
  await db
    .doc("systemState/business")
    .set({ locked: true, generation: 1, status: "incomplete" });
  await expect(
    page.getByText(
      "Business writes are locked until verification and recovery finish.",
    ),
  ).toBeVisible();
  await expect(page.locator(".master-prices")).toHaveCount(0);
  await db
    .doc("systemState/business")
    .set({ locked: false, generation: 1, status: "complete" });
  await healthy(page);
});

for (const theme of ["dark", "light"])
  test(
    theme + " hover/focus/active, settings, danger and modal controls",
    async ({ page }) => {
      await seedPrice();
      await page.goto("/dashboard/master-prices");
      await healthy(page);
      await page.evaluate(
        (value) => (document.documentElement.dataset.theme = value),
        theme,
      );
      await page.getByRole("button", { name: "Admin", exact: true }).click();
      const active = page.getByRole("link", {
        name: "Master Price List",
        exact: true,
      });
      await expect(active).toHaveClass(/active/);
      await active.hover();
      expect(
        await active.evaluate((el) => getComputedStyle(el).boxShadow),
      ).not.toBe("none");
      expect(
        await page
          .getByRole("button", { name: "Admin", exact: true })
          .evaluate((el) => getComputedStyle(el).boxShadow),
      ).toBe("none");
      const hoverTargets = [
        ".master-actions button",
        ".master-discovery input",
        ".master-discovery select",
        ".master-row-actions button",
        ".app-tools button",
        ".dashboard-sidebar .nav-row",
      ];
      for (const selector of hoverTargets)
        for (const control of await page.locator(selector).all()) {
          if (!(await control.isVisible())) continue;
          await control.hover();
          const style = await control.evaluate((el) => {
            const s = getComputedStyle(el);
            return { bg: s.backgroundColor, color: s.color };
          });
          if (theme === "dark")
            expect(style.bg, selector).not.toBe("rgb(255, 255, 255)");
          expect(style.color).not.toBe(style.bg);
          await page.keyboard.press("Tab");
          await control.focus();
          expect(
            await control.evaluate((el) => getComputedStyle(el).outlineStyle),
            selector,
          ).not.toBe("none");
        }
      await page
        .getByRole("button", { name: "Add Price", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Save Price", exact: true })
        .click();
      const invalid = page.locator('[aria-invalid="true"]').first();
      await invalid.focus();
      expect(
        await invalid.evaluate((el) => getComputedStyle(el).outlineStyle),
      ).toBe("solid");
      await page.screenshot({
        path: "test-results/status-" + theme + "-modal.png",
        fullPage: true,
      });
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await page.screenshot({
        path: "test-results/status-" + theme + "-prices.png",
        fullPage: true,
      });
      await page.goto("/dashboard/admin-settings");
      await page.evaluate(
        (value) => (document.documentElement.dataset.theme = value),
        theme,
      );
      await page
        .getByRole("button", { name: "Import Templates", exact: true })
        .hover();
      await page.screenshot({
        path: "test-results/status-" + theme + "-settings.png",
        fullPage: true,
      });
      await page.getByRole("link", { name: "Open Danger Zone" }).click();
      await page
        .getByRole("button", { name: "Delete All Records", exact: true })
        .hover();
      await page.screenshot({
        path: "test-results/status-" + theme + "-danger.png",
        fullPage: true,
      });
    },
  );

test("startup connection failure transitions from loading and recovers without reload", async ({
  page,
}) => {
  await seedPrice();
  await page.route("http://127.0.0.1:8180/**", (route) => route.abort());
  await page.goto("/dashboard/master-prices");
  await expect(page.locator(".availability-banner")).toContainText(
    "Checking system status",
  );
  await expect(
    page.getByRole("button", { name: "Add Price", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".availability-banner")).toContainText(
    "Connection issue",
  );
  await expect(page.locator(".master-notice")).toHaveCount(0);
  await page.unroute("http://127.0.0.1:8180/**");
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await healthy(page);
  await expect(page.locator(".master-records tbody tr")).toHaveCount(1);
});

test("sidebar compact geometry, tooltips, one-click groups and short viewport scrolling", async ({
  page,
}) => {
  await page.goto("/dashboard/master-prices");
  await healthy(page);
  const sidebar = page.getByRole("complementary", { name: "Main sidebar" });
  await expect(sidebar).toHaveCount(1);
  expect((await sidebar.boundingBox()).width).toBe(72);
  for (const label of ["Dashboard", "Operations", "Reports", "Admin"]) {
    const row = sidebar.getByRole(label === "Dashboard" ? "link" : "button", {
      name: label,
      exact: true,
    });
    const box = await row.boundingBox();
    expect(box.width).toBe(44);
    expect(box.height).toBe(44);
    const svg = await row.locator(":scope > svg").boundingBox();
    expect(
      Math.abs(svg.x + svg.width / 2 - (box.x + box.width / 2)),
    ).toBeLessThan(1);
    await row.hover();
    await expect(page.getByRole("tooltip")).toHaveText(label);
    await row.focus();
    await expect(page.getByRole("tooltip")).toHaveText(label);
    await row.press("Escape");
    await expect(page.getByRole("tooltip")).toHaveCount(0);
  }
  for (const theme of ["dark", "light"]) {
    await page.evaluate(
      (value) => (document.documentElement.dataset.theme = value),
      theme,
    );
    await page.screenshot({
      path: "test-results/sidebar-final-" + theme + "-collapsed.png",
    });
    await sidebar
      .getByRole("button", { name: "Operations", exact: true })
      .click();
    await expect(
      sidebar.getByRole("link", { name: "Inventory", exact: true }),
    ).toBeVisible();
    await expect
      .poll(async () => (await sidebar.boundingBox()).width)
      .toBe(232);
    await sidebar.getByRole("link", { name: "Inventory", exact: true }).click();
    await expect(
      sidebar.getByRole("link", { name: "Inventory", exact: true }),
    ).toHaveClass(/active/);
    expect(
      (
        await sidebar
          .getByRole("link", { name: "Inventory", exact: true })
          .boundingBox()
      ).height,
    ).toBe(40);
    expect((await sidebar.locator(".nav-brand").boundingBox()).height).toBe(68);
    const reports = sidebar.getByRole("button", {
      name: "Reports",
      exact: true,
    });
    if ((await reports.getAttribute("aria-expanded")) === "false")
      await reports.click();
    await page.screenshot({
      path: "test-results/sidebar-final-" + theme + "-expanded.png",
    });
    await page.setViewportSize({ width: 1000, height: 420 });
    expect(
      await sidebar
        .locator("nav")
        .evaluate((el) => el.scrollHeight > el.clientHeight),
    ).toBe(true);
    const before = await sidebar.locator(".nav-brand").boundingBox();
    await sidebar
      .locator("nav")
      .evaluate((el) => (el.scrollTop = el.scrollHeight));
    expect((await sidebar.locator(".nav-brand").boundingBox()).y).toBe(
      before.y,
    );
    await sidebar.getByRole("button", { name: "Collapse sidebar" }).click();
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
  await expect(
    sidebar.getByRole("button", { name: "Logout", exact: true }),
  ).toHaveCount(0);
  await expect(
    page
      .locator(".app-tools")
      .getByRole("button", { name: "Logout", exact: true }),
  ).toBeVisible();
});
