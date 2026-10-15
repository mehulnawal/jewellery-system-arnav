import { test, expect } from "@playwright/test";

test("Add Inventory starts clean, validates fields live and previews canonical SKU", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("test-role", "admin"));
  await page.goto("/tests/inventoryForm.browser.html");
  await expect(page.locator(".inventory-field-error")).toHaveCount(0);
  await expect(page.locator(".inventory-required-star")).toHaveCount(4);
  await expect(page.getByText("Optional", { exact: true })).toHaveCount(2);
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  for (const message of [
    "Type is required.",
    "Shape is required.",
    "Size is required.",
    "Weight is required.",
  ])
    await expect(page.getByText(message, { exact: true })).toBeVisible();
  await page.locator(".inventory-field select").nth(0).selectOption("CVD");
  await expect(
    page.getByText("Type is required.", { exact: true }),
  ).toHaveCount(0);
  await page.locator(".inventory-field select").nth(1).selectOption("Marquise");
  await page.getByLabel(/Size \(mm\)/).fill("5.00");
  await page.getByLabel(/Weight \(ct\)/).fill("100");
  await page.getByLabel(/Pieces/).fill("1.5");
  await page.getByLabel(/Pieces/).blur();
  await expect(
    page.getByText("Pieces must be a whole number.", { exact: true }),
  ).toBeVisible();
  await page.getByLabel(/Pieces/).fill("25");
  await expect(
    page.getByText("Pieces must be a whole number.", { exact: true }),
  ).toHaveCount(0);
  await page.getByLabel(/Box/).fill("B-29");
  await expect(
    page.getByText("Enter a valid Box, for example B29.", { exact: true }),
  ).toBeVisible();
  await page.getByLabel(/Box/).fill("B29");
  await expect(page.locator(".inventory-field-error")).toHaveCount(0);
  await expect(page.locator(".inventory-sku-field b")).toHaveText(
    "5_Marquise_CVD",
  );
  for (const theme of ["dark", "light"]) {
    await page.evaluate(
      (value) => (document.documentElement.dataset.theme = value),
      theme,
    );
    expect(
      await page
        .getByLabel(/Pieces/)
        .evaluate(
          (input) =>
            getComputedStyle(input).backgroundColor ===
            getComputedStyle(
              document.querySelector(".inventory-field input[placeholder=B29]"),
            ).backgroundColor,
        ),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 375, height: 667 });
  await expect(page.getByLabel(/Pieces/)).toBeVisible();
  expect(
    await page.locator(".inventory-modal-card").evaluate((card) => {
      const bounds = card.getBoundingClientRect();
      return bounds.left >= 0 && bounds.right <= window.innerWidth;
    }),
  ).toBe(true);
});
test("Edit Inventory starts clean and corrected errors disappear; dark and light controls render", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("test-role", "admin"));
  await page.goto("/tests/inventoryForm.browser.html?edit=1");
  await expect(page.locator(".inventory-field-error")).toHaveCount(0);
  await expect(page.getByLabel(/Pieces/)).toHaveValue("4");
  await expect(page.locator(".inventory-sku-field b")).toHaveText(
    "5_Marquise_HP",
  );
  await page.getByLabel(/Pieces/).fill("");
  await page.getByLabel(/Pieces/).blur();
  await expect(page.locator(".inventory-field-error")).toHaveCount(0);
  await page.getByLabel(/Pieces/).fill("1.5");
  await page.getByLabel(/Pieces/).blur();
  await expect(page.getByText("Pieces must be a whole number.")).toBeVisible();
  await page.getByLabel(/Pieces/).fill("25");
  await expect(page.locator(".inventory-field-error")).toHaveCount(0);
  await page.getByLabel(/Weight \(ct\)/).fill("abc");
  await page.getByLabel(/Weight \(ct\)/).blur();
  await expect(
    page.getByText("Enter a valid Weight greater than 0.", { exact: true }),
  ).toBeVisible();
  await page.getByLabel(/Weight \(ct\)/).fill("100");
  await expect(page.locator(".inventory-field-error")).toHaveCount(0);
  await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
  await expect(page.locator(".inventory-modal-card")).toHaveCSS(
    "background-color",
    "rgb(24, 34, 49)",
  );
  await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
  await expect(page.locator(".inventory-modal-card")).toHaveCSS(
    "background-color",
    "rgb(251, 252, 253)",
  );
});
test("Staff without Inventory permission gets a specific form-level denial", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("test-role", "purchase-only"),
  );
  await page.goto("/tests/inventoryForm.browser.html");
  await page.locator(".inventory-field select").nth(0).selectOption("CVD");
  await page.locator(".inventory-field select").nth(1).selectOption("Marquise");
  await page.getByLabel(/Size \(mm\)/).fill("5");
  await page.getByLabel(/Weight \(ct\)/).fill("100");
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "You do not have permission to add or edit Inventory.",
  );
  await expect(page.locator(".inventory-field-error")).toHaveCount(0);
});
