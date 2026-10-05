import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("test-role", "admin");
    localStorage.setItem("sidebar-expanded", "false");
    localStorage.setItem("theme", "light");
  });
  await page.goto("/tests/sidebar.browser.html");
});

test("collapsed groups open compact menus and navigate without expanding", async ({ page }) => {
  const sidebar = page.getByLabel("Main sidebar");
  const operations = sidebar.getByRole("button", { name: "Operations" });
  await operations.click();
  await expect(sidebar).toHaveCSS("width", "72px");
  const menu = page.getByRole("menu", { name: "Operations" });
  await expect(menu).toBeVisible();
  await menu.getByRole("menuitem", { name: "Inventory" }).click();
  await expect(page.getByTestId("current-page")).toHaveText("/dashboard/inventory");
  await expect(menu).toHaveCount(0);
  await operations.click();
  await expect(menu.getByRole("menuitem", { name: "Inventory" })).toHaveClass(/active/);
  await menu.getByRole("menuitem", { name: "Challan" }).click();
  await expect(page.getByTestId("current-page")).toHaveText("/dashboard/challan");
  await sidebar.getByRole("link", { name: "Dashboard" }).click();
  await expect(page.getByTestId("current-page")).toHaveText("/dashboard");
});

test("menu closes on outside click, Escape, switching groups, and expansion", async ({ page }) => {
  const sidebar = page.getByLabel("Main sidebar");
  await sidebar.getByRole("button", { name: "Operations" }).click();
  await sidebar.getByRole("button", { name: "Reports" }).click();
  await expect(page.getByRole("menu", { name: "Reports" })).toBeVisible();
  await expect(page.getByRole("menu", { name: "Operations" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await sidebar.getByRole("button", { name: "Admin" }).click();
  await expect(page.getByRole("menu", { name: "Admin" }).getByRole("menuitem", { name: "Settings" })).toBeVisible();
  await page.getByTestId("current-page").click();
  await expect(page.getByRole("menu")).toHaveCount(0);
  await sidebar.getByRole("button", { name: "Operations" }).click();
  await sidebar.getByRole("button", { name: "Expand sidebar" }).click();
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(sidebar).toHaveCSS("width", "232px");
  await expect(sidebar.getByRole("link", { name: "Inventory" })).toBeVisible();
});

test("menu supports keyboard navigation and stays inside a short viewport", async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 310 });
  await page.getByLabel("Main sidebar").getByRole("button", { name: "Reports" }).click();
  const menu = page.getByRole("menu", { name: "Reports" });
  await expect(menu).toBeVisible();
  const bounds = await menu.boundingBox();
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(310);
  await page.keyboard.press("End");
  await expect(menu.getByRole("menuitem", { name: "Party Challan History" })).toBeFocused();
  await page.keyboard.press("Home");
  await expect(menu.getByRole("menuitem", { name: "Activity Log" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("current-page")).toHaveText("/dashboard/activity-log");
});

test("staff sees only permitted collapsed children", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.addInitScript(() => {
    localStorage.setItem("test-role", "purchase-only");
    localStorage.setItem("sidebar-expanded", "false");
  });
  await page.goto("/tests/sidebar.browser.html");
  const sidebar = page.getByLabel("Main sidebar");
  await expect(sidebar.getByRole("button", { name: "Reports" })).toHaveCount(0);
  await expect(sidebar.getByRole("button", { name: "Admin" })).toHaveCount(0);
  await sidebar.getByRole("button", { name: "Operations" }).click();
  const menu = page.getByRole("menu", { name: "Operations" });
  await expect(menu.getByRole("menuitem", { name: "Purchase" })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Inventory" })).toHaveCount(0);
  await expect(menu.getByRole("menuitem", { name: "Challan" })).toHaveCount(0);
  await context.close();
});