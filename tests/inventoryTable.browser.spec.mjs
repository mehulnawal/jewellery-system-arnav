import { test, expect } from "@playwright/test";

test("Inventory table shows Pieces per record and per existing group", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("test-role", "admin"));
  await page.goto("/tests/inventoryTable.browser.html");
  const table = page.locator(".inventory-table");
  await expect(table).toBeVisible();
  expect(await table.locator("thead th").allTextContents()).toEqual([
    "",
    "TYPE",
    "SHAPE",
    "SIZE (MM)",
    "WEIGHT (CT)",
    "PIECES",
    "AGEING",
    "BOX",
    "SKU",
    "GROUP",
    "ACTION",
  ]);
  const group = (shape) =>
    table.locator("tr.inventory-group").filter({ hasText: shape });
  const row = (sku) =>
    table.locator("tr.inventory-item").filter({ hasText: sku });
  const pieces = (record) => record.locator("td").nth(5);
  await expect(pieces(group("Pan"))).toHaveText("10");
  await expect(pieces(group("Oval"))).toHaveText("26");
  await expect(pieces(group("Round"))).toHaveText("--");
  await expect(group("Pan").locator("td").nth(4)).toHaveText("9.000 ct");
  await group("Pan").locator(".inventory-chevron").click();
  await expect(pieces(row("5_Pan_CVD"))).toHaveText("10");
  await expect(pieces(row("6_Pan_CVD"))).toHaveText("0");
  await expect(pieces(row("7_Pan_CVD"))).toHaveText("--");
  await group("Pan").locator(".inventory-chevron").click();
  await expect(row("5_Pan_CVD")).toHaveCount(0);
  for (const theme of ["dark", "light"]) {
    await page.evaluate(
      (value) => (document.documentElement.dataset.theme = value),
      theme,
    );
    await expect(group("Pan")).toBeVisible();
    await expect(pieces(group("Pan"))).toHaveText("10");
  }
  await page.setViewportSize({ width: 375, height: 667 });
  await expect(table.locator("thead th").nth(5)).toHaveText("PIECES");
  expect(
    await page
      .locator(".inventory-table-wrap")
      .evaluate(
        (wrap) =>
          wrap.scrollWidth > wrap.clientWidth &&
          getComputedStyle(wrap).overflowX === "auto",
      ),
  ).toBe(true);
});
