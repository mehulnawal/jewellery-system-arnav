import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-20T12:00:00+05:30"));
  await page.goto("/tests/goodsWithCustomers.browser.html");
  await expect(page.getByLabel("From Date", { exact: true })).toHaveValue(
    "2026-10-20",
  );
});

test("24 October default excludes saved 23 October issues until From Date changes", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-10-24T00:30:00+05:30"));
  await page.reload();
  const from = page.getByLabel("From Date", { exact: true });
  const section = page.locator(".customer-goods");
  await expect(from).toHaveValue("2026-10-24");
  await expect(section).toContainText(
    "No Stage 1 goods match the current filters.",
  );
  await from.fill("2026-10-23");
  await expect(
    section.locator("tbody tr").first().locator("td").nth(1),
  ).toHaveText("4.000 ct");
  await section
    .getByRole("button", { name: "View Details for 3.35_Oval_HP" })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Manoj");
  await expect(page.getByRole("dialog")).toContainText("23 Oct 2026");
});

test("From-only, To-only, single-day and inclusive range use the same records in details", async ({
  page,
}) => {
  test.setTimeout(90000);
  const section = page.locator(".customer-goods");
  const from = page.getByLabel("From Date", { exact: true });
  const to = page.getByLabel("To Date", { exact: true });
  const summaryWeight = () =>
    section.locator("tbody tr").first().locator("td").nth(1);
  for (const [start, end, total, customers] of [
    ["2026-10-23", "", "4.000 ct", ["Manoj"]],
    ["2026-10-21", "", "7.000 ct", ["Shyam", "Manoj"]],
    ["", "2026-10-20", "7.000 ct", ["Rohan"]],
    ["2026-10-21", "2026-10-21", "3.000 ct", ["Shyam"]],
    ["2026-10-20", "2026-10-21", "10.000 ct", ["Rohan", "Shyam"]],
    ["2026-10-20", "2026-10-23", "14.000 ct", ["Rohan", "Shyam", "Manoj"]],
  ]) {
    await from.fill(start);
    await to.fill(end);
    await expect(summaryWeight()).toHaveText(total);
    await section
      .getByRole("button", { name: "View Details for 3.35_Oval_HP" })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.locator("tbody tr")).toHaveCount(customers.length);
    await expect(dialog.locator("tbody tr td:first-child")).toHaveText(
      customers,
    );
    await expect(dialog.locator("strong")).toHaveText(total);
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
  }
  await from.fill("2026-10-24");
  await to.fill("");
  await expect(section).toContainText(
    "No Stage 1 goods match the current filters.",
  );
  await to.fill("2026-10-20");
  await expect(section.getByRole("alert")).toContainText(
    "From Date must be on or before To Date",
  );
  await section.getByRole("button", { name: "Clear Filters" }).click();
  await expect(summaryWeight()).toHaveText("14.000 ct");
});
test("filters, live details, close and state messages", async ({ page }) => {
  const section = page.locator(".customer-goods");
  await expect(section).toContainText("14.000 ct");
  await section
    .getByRole("button", { name: "View Details for 3.35_Oval_HP" })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Rohan");
  await expect(dialog).toContainText("CH-101");
  await expect(dialog).toContainText("20 Oct 2026");
  // Simulate a listener delivering new props while the modal stays open.
  await page.evaluate(() => {
    [...document.querySelectorAll("button")]
      .find((button) => button.textContent.trim() === "Transition snapshot")
      .click();
  });
  await expect(dialog).toContainText("7.000 ct");
  await expect(dialog).not.toContainText("Rohan");
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await page
    .getByRole("button", { name: "Create / import snapshot", exact: true })
    .click();
  await page.getByLabel("From Date", { exact: true }).fill("2026-10-20");
  await page.getByLabel("To Date", { exact: true }).fill("2026-10-21");
  await expect(section).toContainText("12.000 ct");
  await section
    .getByRole("button", { name: "View Details for 3.35_Oval_HP" })
    .click();
  await expect(dialog).not.toContainText("Manoj");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByPlaceholder("Search SKU").fill("pear");
  await expect(section).toContainText(
    "No Stage 1 goods match the current filters.",
  );
  await section.getByRole("button", { name: "Clear Filters" }).click();
  await page.getByPlaceholder("Search SKU").fill("oVAL");
  await expect(section).toContainText("16.000 ct");
  await section.getByRole("button", { name: "Clear Filters" }).click();
  for (const [button, total] of [
    ["Create / import snapshot", "16.000 ct"],
    ["Edit snapshot", "16.000 ct"],
    ["Delete snapshot", "10.000 ct"],
    ["Transition snapshot", "7.000 ct"],
  ]) {
    await page.getByRole("button", { name: button, exact: true }).click();
    await expect(section).toContainText(total);
  }
  await section
    .getByRole("button", { name: "View Details for 3.35_Oval_HP" })
    .click();
  await expect(dialog).not.toContainText("Rohan");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Toggle loading" }).click();
  await expect(section.getByRole("status")).toContainText("Loading");
  await page.getByRole("button", { name: "Toggle loading" }).click();
  await page.getByRole("button", { name: "Toggle error" }).click();
  await expect(section.getByRole("alert")).toContainText("could not be loaded");
  await expect(section).not.toContainText("permission-denied");
  await page.getByRole("button", { name: "Toggle error" }).click();
  await page.getByRole("button", { name: "Empty snapshot" }).click();
  await expect(section).toContainText(
    "No Stage 1 goods match the current filters.",
  );
  await page.getByLabel("From Date", { exact: true }).fill("");
  await expect(section).toContainText("No goods are currently pending");
});

for (const theme of ["light", "dark"]) {
  for (const width of [1440, 768, 390]) {
    test(`${theme} at ${width}px, modal and no page overflow`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(
        (value) => (document.documentElement.dataset.theme = value),
        theme,
      );
      await page
        .getByRole("button", { name: "View Details for 3.35_Oval_HP" })
        .click();
      await expect(page.getByRole("dialog")).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(
        await page
          .getByRole("dialog")
          .evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
      await page.screenshot({
        path: `test-results/goods-${theme}-${width}.png`,
      });
    });
  }
}
