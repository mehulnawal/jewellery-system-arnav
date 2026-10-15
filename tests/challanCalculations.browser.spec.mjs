import { test, expect } from "@playwright/test";
test("rapid Stage 2 Pieces and Weight edits remain visible and reach save together", async ({
  page,
}) => {
  await page.goto("/tests/challanCalculations.browser.html");
  const rows = page.locator(".stage-two-row");
  await expect(rows).toHaveCount(2);
  const first = rows.nth(0).locator("input");
  const second = rows.nth(1).locator("input");
  await first.nth(0).fill("1");
  await first.nth(1).fill("0.500");
  await second.nth(0).fill("2");
  await second.nth(1).fill("1.250");
  await first.nth(0).fill("5");
  await first.nth(1).fill("2.375");
  await expect(first.nth(0)).toHaveValue("5");
  await expect(first.nth(1)).toHaveValue("2.375");
  await expect(second.nth(0)).toHaveValue("2");
  await expect(second.nth(1)).toHaveValue("1.250");
  await expect(page.getByText("Total Sold Weight")).toBeVisible();
  await page.getByRole("button", { name: /Move to Stage 2/ }).click();
  await expect
    .poll(() => page.evaluate(() => window.__savedReturnRows))
    .toEqual([
      { id: "a", returnPieces: "5", returnWeight: "2.375" },
      { id: "b", returnPieces: "2", returnWeight: "1.250" },
    ]);
});
test("contradictory Pieces and Weight cannot be submitted", async ({
  page,
}) => {
  await page.goto("/tests/challanCalculations.browser.html");
  const rows = page.locator(".stage-two-row");
  const first = rows.nth(0).locator("input");
  const second = rows.nth(1).locator("input");
  await first.nth(0).fill("0");
  await first.nth(1).fill("0.001");
  await second.nth(0).fill("0");
  await second.nth(1).fill("0");
  await page.getByRole("button", { name: /Move to Stage 2/ }).click();
  await expect(
    page.getByText(/Return and Sold Pieces and Weight must both be zero/),
  ).toBeVisible();
  expect(await page.evaluate(() => window.__savedReturnRows)).toBeUndefined();
});
test("weight-only manual return requires an explicit zero Pieces entry and retains zero totals", async ({
  page,
}) => {
  await page.goto("/tests/challanCalculations.browser.html?mode=weight-only");
  const fields = page.locator(".stage-two-row input");
  await expect(fields).toHaveCount(2);
  await fields.nth(1).fill("2.500");
  await page.getByRole("button", { name: /Move to Stage 2/ }).click();
  await expect(page.getByText(/Enter 0 to 0/)).toBeVisible();
  expect(await page.evaluate(() => window.__savedReturnRows)).toBeUndefined();
  await fields.nth(0).fill("0");
  await expect(page.getByText("Total Sold Pieces").locator("..")).toHaveText(
    /Total Sold Pieces\s+0/,
  );
  await page.getByRole("button", { name: /Move to Stage 2/ }).click();
  await expect
    .poll(() => page.evaluate(() => window.__savedReturnRows))
    .toEqual([{ id: "manual", returnPieces: "0", returnWeight: "2.500" }]);
});

test("invoice review requires Admin manual partial amount and locks full/no return amounts", async ({
  page,
}) => {
  await page.goto(
    "/tests/challanCalculations.browser.html?mode=invoice-partial",
  );
  const finalAmount = page.getByRole("spinbutton", {
    name: "A Final Billed Amount",
  });
  await expect(finalAmount).toBeVisible();
  await expect(page.getByText("Pending valid partial amount")).toBeVisible();
  await finalAmount.fill("400.555");
  await page.getByRole("button", { name: /Confirm Final Invoice/ }).click();
  await expect(page.getByText(/at most 2 decimal places/)).toBeVisible();
  await finalAmount.fill("400.50");
  await expect(page.getByText("₹400.50")).toBeVisible();
  await page.getByRole("button", { name: /Confirm Final Invoice/ }).click();
  await expect
    .poll(() => page.evaluate(() => window.__invoiceConfirmed))
    .toEqual(["400.50"]);

  await page.goto("/tests/challanCalculations.browser.html?mode=invoice-full");
  await expect(page.getByText("₹0.00 (locked)")).toBeVisible();
  await expect(page.locator(".final-invoice-modal input")).toHaveCount(0);
  await page.goto("/tests/challanCalculations.browser.html?mode=invoice-none");
  await expect(page.getByText("₹940.00 (locked)")).toBeVisible();
  await expect(page.locator(".final-invoice-modal input")).toHaveCount(0);

  await page.goto("/tests/challanCalculations.browser.html?mode=invoice-staff");
  await expect(page.getByText("Admin entry required")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Confirm Final Invoice/ }),
  ).toBeDisabled();
});
test("settlement updates Remaining immediately and rejects sub-cent Paid", async ({
  page,
}) => {
  await page.goto("/tests/challanCalculations.browser.html?mode=settlement");
  const paid = page.getByRole("spinbutton", {
    name: "Amount Paid by Customer",
  });
  const discount = page.getByRole("spinbutton", { name: "Discount Amount" });
  const complete = page.getByRole("button", {
    name: "Record Payment / Complete",
  });
  await paid.fill("900");
  await expect(page.getByText("₹100.00")).toBeVisible();
  await expect(complete).toBeDisabled();
  await discount.fill("100");
  await expect(page.getByText("₹0.00")).toBeVisible();
  await expect(complete).toBeEnabled();
  await paid.fill("99.999");
  await expect(page.getByText(/at most 2 decimal places/)).toBeVisible();
  await expect(complete).toBeDisabled();
  await paid.fill("1000");
  await discount.fill("");
  await expect(complete).toBeEnabled();
  await complete.click();
  await expect
    .poll(() => page.evaluate(() => window.__settlement))
    .toEqual({
      paid: "1000",
      discount: "",
    });
});

test("saved Stage 3 and 4 Views show quoted, billable, discount, and final values", async ({
  page,
}) => {
  await page.goto("/tests/challanCalculations.browser.html?mode=views");
  const third = page.locator(".challan-view-stage-three");
  const fourth = page.locator(".challan-view-stage-four");
  await expect(third).toContainText("₹1,000.00");
  await expect(third).toContainText("₹30.00");
  await expect(third).toContainText("₹470.00");
  await expect(third).toContainText("₹500.00");
  await expect(fourth).toContainText("₹1,000.00");
  await expect(fourth).toContainText("₹30.00");
  await expect(fourth).toContainText("₹470.00");
  await expect(fourth).toContainText("2.500 ct");
});

test("new saved manual invoice Views distinguish original Stage 1 Amount from Final Billed Amount", async ({
  page,
}) => {
  await page.goto("/tests/challanCalculations.browser.html?mode=views-new");
  const third = page.locator(".challan-view-stage-three");
  const fourth = page.locator(".challan-view-stage-four");
  for (const view of [third, fourth]) {
    await expect(view).toContainText("Original Stage 1 Amount");
    await expect(view).toContainText("Final Billed Amount");
    await expect(view).toContainText("₹1,000.00");
    await expect(view).toContainText("₹60.00");
    await expect(view).toContainText("₹400.50");
  }
});
test("delete warning shows sold stock and synchronous repeat clicks invoke confirmation once", async ({
  page,
}) => {
  await page.goto("/tests/challanCalculations.browser.html?mode=delete");
  const modal = page.getByRole("dialog", {
    name: "Delete challan confirmation",
  });
  await expect(modal).toContainText("restore only Sold / Kept stock");
  await expect(modal).toContainText("6 pcs / 3.000 ct");
  await page.evaluate(() => {
    const button = document.querySelector(".challan-delete-confirm");
    button.click();
    button.click();
  });
  await expect.poll(() => page.evaluate(() => window.__deleteCount)).toBe(1);
  await expect(
    modal.getByRole("button", { name: "Deleting..." }),
  ).toBeDisabled();
});
