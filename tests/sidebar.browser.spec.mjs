import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("test-role", "admin");
    localStorage.setItem("sidebar-expanded", "false");
    localStorage.setItem("theme", "light");
  });
  await page.goto("/tests/sidebar.browser.html");
});
const destinations = [
  ["Dashboard", ""], ["Inventory", "inventory"],
  ["Check Inventory", "check-inventory"], ["Purchase", "purchase"],
  ["Challan", "challan"], ["Order List", "order-list"],
  ["Activity Log", "activity-log"], ["Weekly Report", "weekly-report"],
  ["Vendor Purchase History", "vendor-purchase-history"],
  ["Party Challan History", "party-challan-history"],
  ["Master Price List", "master-prices"], ["Settings", "admin-settings"],
];

test("all destinations need only one click in both expanded and compact navigation", async ({ page }) => {
  const side = page.getByLabel("Main sidebar");
  await expect(side).toHaveCSS("width", "252px");
  for (const compact of [false, true]) {
    if (compact) await page.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
    for (const [name, path] of destinations) {
      const link = side.getByRole("link", { name, exact: true });
      await link.click();
      await expect(page.getByTestId("current-page")).toHaveText("/dashboard" + (path ? "/" + path : ""));
      await expect(link).toHaveAttribute("aria-current", "page");
      await expect(page.getByRole("menu")).toHaveCount(0);
    }
  }
  await page.reload();
  await expect(side).toHaveCSS("width", "72px");
  await side.getByRole("link", { name: "Challan", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("current-page")).toHaveText("/dashboard/challan");
});

test("sidebar fits both themes, scrolls on short screens and uses direct labelled mobile links", async ({ page }) => {
  const side = page.getByLabel("Main sidebar");
  for (const theme of ["light", "dark"]) {
    await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(side.getByRole("link")).toHaveCount(12);
    await page.screenshot({path: `test-results/sidebar-direct-${theme}.png`});
  }
  await page.setViewportSize({ width: 1280, height: 550 });
  await side.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page.getByTestId("current-page")).toHaveText("/dashboard/admin-settings");
  expect(await side.locator("nav").evaluate(nav => nav.scrollTop)).toBeGreaterThan(0);
  await page.setViewportSize({ width: 390, height: 740 });
  await expect(page.getByRole("button", {name:"Collapse sidebar",exact:true})).toBeHidden();
  await side.getByRole("link", { name: "Party Challan History", exact: true }).click();
  await expect(page.getByTestId("current-page")).toHaveText("/dashboard/party-challan-history");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path:"test-results/sidebar-direct-mobile.png"});
});

test("staff permissions remain unchanged and permitted pages are direct links", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.addInitScript(() => localStorage.setItem("test-role", "purchase-only"));
  await page.goto("/tests/sidebar.browser.html");
  const side = page.getByLabel("Main sidebar");
  for (const name of ["Inventory", "Challan", "Dashboard", "Settings", "Activity Log"])
    await expect(side.getByRole("link", { name, exact: true })).toHaveCount(0);
  for (const [name, path] of [["Check Inventory", "check-inventory"], ["Purchase", "purchase"], ["Order List", "order-list"]]) {
    await side.getByRole("link", { name, exact: true }).click();
    await expect(page.getByTestId("current-page")).toHaveText("/dashboard/" + path);
  }
  await context.close();
});

test("compact sidebar shows names on hover and focus, and scrolls when the screen is short", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 350 });
  await page.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
  const side = page.getByLabel("Main sidebar");
  await side.getByRole("link", { name: "Inventory", exact: true }).hover();
  const tooltip = page.getByRole("tooltip");
  await expect(tooltip).toHaveText("Inventory");
  const box = await tooltip.boundingBox(), sidebar = await side.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(sidebar.x + sidebar.width - 8);
  await page.keyboard.press("Escape");
  await expect(tooltip).toHaveCount(0);
  const nav = side.locator("nav");
  expect(await nav.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
  await nav.evaluate(node => node.scrollTop = node.scrollHeight);
  await side.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page.getByTestId("current-page")).toHaveText("/dashboard/admin-settings");
  await expect(tooltip).toHaveCount(0);
  await side.getByRole("link", { name: "Dashboard", exact: true }).focus();
  await expect(tooltip).toHaveText("Dashboard");
});
