import { test, expect } from "@playwright/test";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { readFile } from "node:fs/promises";
if (!process.env.FIRESTORE_EMULATOR_HOST?.startsWith("127.0.0.1:"))
  throw Error("Local emulator required");
const app = initializeApp({ projectId: "demo-jewellery-ui" }, "sidebar-polish");
const db = getFirestore(app);
let env;
test.beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-jewellery-ui",
    firestore: { rules: await readFile("firestore.rules", "utf8") },
  });
});
test.afterAll(async () => {
  await env.cleanup();
  await deleteApp(app);
});
test.beforeEach(async ({ page }) => {
  await env.clearFirestore();
  for (const [uid, permissions] of [
    ["admin", []],
    ["purchase-only", ["purchase"]],
    ["no-purchase", ["inventory"]],
  ])
    await db
      .doc("employeeProfiles/" + uid)
      .set({
        uid,
        accessId: uid,
        role: uid === "admin" ? "superadmin" : "employee",
        active: true,
        permissions,
      });
  await page.route(/https:\/\/.*(?:googleapis\.com|firebaseio\.com)/, (route) =>
    route.abort(),
  );
});
const side = (page) =>
  page.getByRole("complementary", { name: "Main sidebar" });
const group = (page, name) =>
  side(page).getByRole("button", { name, exact: true });
async function go(page, route = "/dashboard") {
  await page.goto(route);
  await expect(side(page)).toBeVisible();
  await expect(page.locator(".availability-banner")).toHaveCount(0);
}
async function expand(page) {
  if (await side(page).getByRole("button", { name: "Expand sidebar" }).count())
    await side(page).getByRole("button", { name: "Expand sidebar" }).click();
  await expect
    .poll(async () => (await side(page).boundingBox()).width)
    .toBe(232);
}

for (const theme of ["dark", "light"])
  test(
    theme + " route selection, hierarchy, groups, hover, focus and tooltips",
    async ({ page }) => {
      await page.addInitScript(
        (value) => localStorage.setItem("theme", value),
        theme,
      );
      await go(page);
      await expand(page);
      const routes = [
        ["Dashboard", "/dashboard", null],
        ["Inventory", "/dashboard/inventory", "Operations"],
        ["Master Price List", "/dashboard/master-prices", "Admin"],
        ["Settings", "/dashboard/admin-settings", "Admin"],
      ];
      for (const [label, path, parent] of routes) {
        await go(page, path);
        await expect
          .poll(async () => (await side(page).boundingBox()).width)
          .toBe(232);
        const active = side(page).getByRole("link", {
          name: label,
          exact: true,
        });
        await expect(active).toHaveAttribute("aria-current", "page");
        await expect(side(page).locator("a.active")).toHaveCount(1);
        if (parent) {
          await expect(group(page, parent)).toHaveAttribute(
            "aria-expanded",
            "true",
          );
          await group(page, parent).click();
          await expect(group(page, parent)).toHaveAttribute(
            "aria-expanded",
            "true",
          );
          expect(
            await group(page, parent).evaluate(
              (el) => getComputedStyle(el).boxShadow,
            ),
          ).toBe("none");
        }
        await active.hover();
        expect(
          await active.evaluate((el) => getComputedStyle(el).backgroundColor),
        ).not.toBe("rgb(255, 255, 255)");
        await page.keyboard.press("Tab");
        await active.focus();
        expect(
          await active.evaluate((el) => getComputedStyle(el).outlineStyle),
        ).toBe("solid");
        await page.screenshot({
          path:
            "test-results/sidebar-check-" +
            theme +
            "-" +
            label.replaceAll(" ", "-") +
            ".png",
        });
      }
      await go(page);
      for (const name of ["Operations", "Reports", "Admin"]) {
        const row = group(page, name);
        if ((await row.getAttribute("aria-expanded")) === "true")
          await row.click();
        await expect(row).toHaveAttribute("aria-expanded", "false");
        await row.focus();
        await row.press("Space");
        await expect(row).toHaveAttribute("aria-expanded", "true");
        await row.press("Enter");
        await expect(row).toHaveAttribute("aria-expanded", "false");
      }
      for (const name of ["Operations", "Reports", "Admin"])
        await group(page, name).click();
      const hrefs = await side(page)
        .locator("a")
        .evaluateAll((nodes) => nodes.map((el) => el.getAttribute("href")));
      expect(new Set(hrefs).size).toBe(hrefs.length);
      expect(hrefs).toHaveLength(11);
      expect(
        await side(page)
          .locator(".nav-brand b")
          .evaluate((el) => getComputedStyle(el).fontSize),
      ).toBe("16px");
      expect(
        await group(page, "Admin").evaluate(
          (el) => getComputedStyle(el).fontSize,
        ),
      ).toBe("14px");
      expect(
        await side(page)
          .getByRole("link", { name: "Settings", exact: true })
          .evaluate((el) => getComputedStyle(el).fontSize),
      ).toBe("14px");
      expect(
        await side(page)
          .locator(".nav-brand")
          .evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
      await side(page)
        .getByRole("button", { name: "Collapse sidebar" })
        .click();
      await expect
        .poll(async () => (await side(page).boundingBox()).width)
        .toBe(72);
      await expect(
        side(page).getByRole("link", { name: "Dashboard", exact: true }),
      ).toHaveClass(/active/);
      for (const name of ["Dashboard", "Operations", "Reports", "Admin"]) {
        const row = side(page).getByRole(
          name === "Dashboard" ? "link" : "button",
          { name, exact: true },
        );
        await row.hover();
        await expect(page.getByRole("tooltip")).toHaveText(name);
        const box = await row.boundingBox(),
          icon = await row.locator(":scope > svg").boundingBox(),
          tip = await page.getByRole("tooltip").boundingBox();
        expect(box.width).toBe(44);
        expect(box.height).toBe(44);
        expect(
          Math.abs(icon.x + icon.width / 2 - box.x - box.width / 2),
        ).toBeLessThan(1);
        expect(tip.x).toBeGreaterThan(box.x + box.width);
        expect(tip.y).toBeGreaterThanOrEqual(0);
        await page.keyboard.press("Tab");
        await row.focus();
        await expect(page.getByRole("tooltip")).toHaveText(name);
        await row.press("Escape");
        await expect(page.getByRole("tooltip")).toHaveCount(0);
      }
      await page.screenshot({
        path:
          "test-results/sidebar-check-" + theme + "-collapsed-dashboard.png",
      });
      for (const name of ["Operations", "Reports", "Admin"]) {
        await group(page, name).click();
        await expect
          .poll(async () => (await side(page).boundingBox()).width)
          .toBe(232);
        await expect(group(page, name)).toHaveAttribute(
          "aria-expanded",
          "true",
        );
        await expect(side(page)).toHaveCount(1);
        await expect(page.getByRole("tooltip")).toHaveCount(0);
        await side(page)
          .getByRole("button", { name: "Collapse sidebar" })
          .click();
      }
      await expect(
        side(page).getByRole("button", { name: "Logout" }),
      ).toHaveCount(0);
      await expect(
        page.locator(".app-tools").getByRole("button", { name: "Logout" }),
      ).toBeVisible();
      await expect(
        page
          .locator(".app-tools")
          .getByRole("button", { name: "Toggle color theme" }),
      ).toBeVisible();
    },
  );

test("active group follows routes, collapsed preference persists and content tracks width", async ({
  page,
}) => {
  await go(page, "/dashboard/inventory");
  await expand(page);
  await expect(group(page, "Operations")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await side(page).getByRole("link", { name: "Challan", exact: true }).click();
  await expect(group(page, "Operations")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await group(page, "Admin").click();
  await side(page).getByRole("link", { name: "Settings", exact: true }).click();
  await expect(group(page, "Admin")).toHaveAttribute("aria-expanded", "true");
  await go(page, "/dashboard/admin-settings/danger-zone");
  await expect(group(page, "Admin")).toHaveAttribute("aria-expanded", "true");
  await expect(
    side(page).getByRole("link", { name: "Settings", exact: true }),
  ).toHaveClass(/active/);
  for (let i = 0; i < 2; i++) {
    const samples = await page.evaluate(async () => {
      document.querySelector(".nav-brand button").click();
      const values = [];
      const start = performance.now();
      while (performance.now() - start < 250) {
        await new Promise(requestAnimationFrame);
        const a = document
            .querySelector(".dashboard-sidebar")
            .getBoundingClientRect(),
          b = document.querySelector(".dashboard-main").getBoundingClientRect(),
          c = document
            .querySelector(".dashboard-header")
            .getBoundingClientRect();
        values.push([
          Math.abs(a.right - b.left),
          Math.abs(b.right - innerWidth),
          Math.abs(b.left - c.left),
        ]);
      }
      return values;
    });
    for (const values of samples)
      for (const delta of values) expect(delta).toBeLessThan(2);
  }
  await side(page).getByRole("button", { name: "Collapse sidebar" }).click();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("sidebar-expanded")))
    .toBe("false");
  await go(page, "/dashboard/inventory");
  await expect
    .poll(async () => (await side(page).boundingBox()).width)
    .toBe(72);
  await page.reload();
  await expect
    .poll(async () => (await side(page).boundingBox()).width)
    .toBe(72);
  await group(page, "Operations").click();
  await expect(group(page, "Operations")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await page.reload();
  await expect
    .poll(async () => (await side(page).boundingBox()).width)
    .toBe(232);
});

for (const role of ["purchase-only", "no-purchase"])
  test(
    role + " Staff sees only permitted navigation, no blank groups",
    async ({ page }) => {
      await page.addInitScript(
        (value) => localStorage.setItem("test-role", value),
        role,
      );
      await go(page, "/dashboard/check-inventory");
      await expand(page);
      await expect(group(page, "Admin")).toHaveCount(0);
      await expect(group(page, "Reports")).toHaveCount(0);
      await expect(side(page).locator(".nav-group")).toHaveCount(1);
      const names = await side(page)
        .locator("a")
        .evaluateAll((nodes) =>
          nodes.map((el) => el.getAttribute("aria-label")),
        );
      expect(names).toEqual(
        role === "purchase-only"
          ? ["Dashboard", "Check Inventory", "Purchase"]
          : ["Dashboard", "Inventory", "Check Inventory"],
      );
      await page.screenshot({
        path: "test-results/sidebar-check-" + role + ".png",
      });
      for (const path of [
        "/dashboard/master-prices",
        "/dashboard/admin-settings",
        "/dashboard/activity-log",
      ]) {
        await go(page, path);
        await expect(page).toHaveURL(/\/dashboard\/check-inventory$/);
        await expect(group(page, "Admin")).toHaveCount(0);
        await expect(group(page, "Reports")).toHaveCount(0);
      }
    },
  );

test("short laptop viewport keeps header fixed and all navigation reachable", async ({
  page,
}) => {
  await go(page);
  await expand(page);
  for (const name of ["Operations", "Reports", "Admin"])
    await group(page, name).click();
  await page.setViewportSize({ width: 1280, height: 420 });
  const brand = await side(page).locator(".nav-brand").boundingBox();
  const nav = side(page).locator("nav");
  expect(await nav.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(
    true,
  );
  await side(page)
    .getByRole("link", { name: "Settings", exact: true })
    .scrollIntoViewIfNeeded();
  await expect(
    side(page).getByRole("link", { name: "Settings", exact: true }),
  ).toBeInViewport();
  expect((await side(page).locator(".nav-brand").boundingBox()).y).toBe(
    brand.y,
  );
  await page.screenshot({ path: "test-results/sidebar-check-short.png" });
});
