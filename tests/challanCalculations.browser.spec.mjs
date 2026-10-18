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

test("weighted Stage 1–4 views distinguish rate, gross, discount, and final", async ({
  page,
}) => {
  await page.goto(
    "/tests/challanCalculations.browser.html?mode=views-weighted",
  );
  for (const selector of [
    ".challan-view-stage-one",
    ".challan-view-stage-two",
    ".challan-view-stage-three",
    ".challan-view-stage-four",
  ]) {
    const view = page.locator(selector);
    await expect(view).toContainText("Price / Carat");
    await expect(view).toContainText("₹1,000.00");
    await expect(view).toContainText("₹10.00");
    await expect(view).toContainText("₹9.30");
  }
  await expect(page.locator(".challan-view-stage-three")).toContainText(
    "₹0.70",
  );
});

test("bulk review freezes the page, separates statuses and shows SKU-derived fields", async ({
  page,
}) => {
  await page.goto("/tests/challanCalculations.browser.html?mode=bulk-review");
  const dialog = page.getByRole("dialog", { name: "Import Challans" });
  await expect(dialog).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.locator(".challan-bulk-primary")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.locator(".challan-bulk-close")).toBeFocused();
  await expect(
    dialog.locator(".challan-bulk-summary-card").nth(0),
  ).toContainText("3");
  await expect(
    dialog.locator(".challan-bulk-summary-card").nth(1),
  ).toContainText("2");
  await expect(
    dialog.locator(".challan-bulk-summary-card").nth(2),
  ).toContainText("1");
  await expect(
    dialog.getByRole("tab", { name: "Valid Challans 2" }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(dialog.locator(".challan-bulk-group")).toHaveCount(2);
  await dialog.locator(".challan-bulk-group summary").first().click();
  const item = dialog.locator(".challan-bulk-items-table tbody tr").first();
  await expect(item).toContainText("SKU-1");
  await expect(item).toContainText("Oval");
  await expect(item).toContainText("HP");
  await expect(item).toContainText("₹930.00");
  expect(
    await dialog
      .locator(".challan-bulk-items-table")
      .first()
      .locator("th")
      .allTextContents(),
  ).toEqual([
    "SKU",
    "Width",
    "Shape",
    "Size",
    "Type",
    "Weight / Carat",
    "Pieces",
    "Price",
    "Discount %",
    "Net Amount",
    "Net Amount After Discount",
  ]);
  const labelStyle = await dialog
    .locator(".challan-bulk-summary-field small")
    .first()
    .evaluate((element) => ({
      background: getComputedStyle(element).backgroundColor,
      radius: getComputedStyle(element).borderRadius,
      padding: getComputedStyle(element).padding,
    }));
  expect(labelStyle.background).toBe("rgba(0, 0, 0, 0)");
  expect(labelStyle.radius).toBe("0px");
  expect(labelStyle.padding).toBe("0px");
  await dialog.getByRole("tab", { name: "Invalid Challans 1" }).click();
  await expect(dialog.locator(".challan-bulk-group")).toHaveCount(1);
  await dialog.locator(".challan-bulk-group summary").click();
  await expect(dialog.locator(".challan-bulk-reasons")).toContainText(
    "Row 4: SKU BAD does not exist.",
  );
  await expect(dialog.locator(".challan-bulk-reasons")).toContainText(
    "Row 4: Pieces must be a whole number.",
  );
  const bounds = await dialog.boundingBox();
  const viewport = page.viewportSize();
  expect(bounds.width / viewport.width).toBeGreaterThan(0.9);
  expect(bounds.height / viewport.height).toBeGreaterThan(0.85);
  await expect
    .poll(() => page.evaluate(() => document.body.style.overflow))
    .toBe("hidden");
  await expect
    .poll(() => page.evaluate(() => document.documentElement.style.overflow))
    .toBe("hidden");
  const blocked = await page.evaluate(() => {
    const button = document.querySelector("#background-action");
    const rect = button.getBoundingClientRect();
    return (
      document.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
      ) !== button
    );
  });
  expect(blocked).toBe(true);
  await dialog.getByRole("button", { name: "IMPORT 2 VALID CHALLANS" }).click();
  await expect
    .poll(() => page.evaluate(() => window.__bulkImportClicked))
    .toBe(true);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).not.toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.body.style.overflow))
    .toBe("");
  await expect
    .poll(() => page.evaluate(() => document.documentElement.style.overflow))
    .toBe("");
});
test("bulk review keeps 50 Challans scrollable with actions visible", async ({
  page,
}) => {
  await page.goto(
    "/tests/challanCalculations.browser.html?mode=bulk-review-50",
  );
  const dialog = page.getByRole("dialog", { name: "Import Challans" });
  await expect(
    dialog.getByRole("button", { name: "IMPORT 50 VALID CHALLANS" }),
  ).toBeVisible();
  const scroll = dialog.locator(".challan-bulk-scroll");
  const sizes = await scroll.evaluate((element) => ({
    client: element.clientHeight,
    content: element.scrollHeight,
  }));
  expect(sizes.content).toBeGreaterThan(sizes.client);
  const structure = await dialog.evaluate((element) => {
    const tabs = element
      .querySelector(".challan-bulk-tabs")
      .getBoundingClientRect();
    const area = element
      .querySelector(".challan-bulk-scroll")
      .getBoundingClientRect();
    const footer = element
      .querySelector(".challan-bulk-actions")
      .getBoundingClientRect();
    return {
      tabsBottom: tabs.bottom,
      areaTop: area.top,
      areaBottom: area.bottom,
      footerTop: footer.top,
    };
  });
  expect(structure.areaTop).toBeGreaterThanOrEqual(structure.tabsBottom - 1);
  expect(structure.areaBottom).toBeLessThanOrEqual(structure.footerTop + 1);
  await scroll.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(
    dialog.getByRole("button", { name: "IMPORT 50 VALID CHALLANS" }),
  ).toBeVisible();
});

for (const [mode, valid, invalid] of [
  ["bulk-review-1", 1, 0],
  ["bulk-review-5-2", 5, 2],
  ["bulk-review-0-5", 0, 5],
  ["bulk-review-20-10", 20, 10],
]) {
  test(
    "bulk review counts and tabs for " +
      valid +
      " valid / " +
      invalid +
      " invalid",
    async ({ page }) => {
      await page.goto("/tests/challanCalculations.browser.html?mode=" + mode);
      const dialog = page.getByRole("dialog", { name: "Import Challans" });
      await expect(
        dialog.locator(".challan-bulk-summary-card").nth(0),
      ).toContainText(String(valid + invalid));
      await expect(
        dialog.locator(".challan-bulk-summary-card").nth(1),
      ).toContainText(String(valid));
      await expect(
        dialog.locator(".challan-bulk-summary-card").nth(2),
      ).toContainText(String(invalid));
      const action = dialog.getByRole("button", {
        name: "IMPORT " + valid + " VALID CHALLANS",
      });
      if (valid === 0) await expect(action).toBeDisabled();
      else await expect(action).toBeEnabled();
      await dialog
        .getByRole("tab", { name: "Valid Challans " + valid })
        .click();
      await expect(dialog.locator(".challan-bulk-group")).toHaveCount(valid);
      if (!valid)
        await expect(dialog.locator(".challan-bulk-empty")).toHaveText(
          "No valid Challans.",
        );
      await dialog
        .getByRole("tab", { name: "Invalid Challans " + invalid })
        .click();
      await expect(dialog.locator(".challan-bulk-group")).toHaveCount(invalid);
      if (!invalid)
        await expect(dialog.locator(".challan-bulk-empty")).toHaveText(
          "No invalid Challans.",
        );
    },
  );
}

test("bulk review shows ten item rows and all five validation issues", async ({
  page,
}) => {
  await page.goto(
    "/tests/challanCalculations.browser.html?mode=bulk-review-10-items",
  );
  const dialog = page.getByRole("dialog", { name: "Import Challans" });
  await dialog.locator(".challan-bulk-group summary").click();
  await expect(
    dialog.locator(".challan-bulk-items-table tbody tr"),
  ).toHaveCount(10);
  await page.goto(
    "/tests/challanCalculations.browser.html?mode=bulk-review-5-errors",
  );
  const invalidDialog = page.getByRole("dialog", { name: "Import Challans" });
  await invalidDialog.locator(".challan-bulk-group summary").click();
  await expect(invalidDialog.locator(".challan-bulk-reasons li")).toHaveCount(
    5,
  );
});
for (const [theme, viewport] of [
  ["light", { width: 1440, height: 900 }],
  ["dark", { width: 1440, height: 900 }],
  ["light", { width: 820, height: 1000 }],
  ["dark", { width: 390, height: 844 }],
]) {
  test(
    "bulk review is readable at " + theme + " " + viewport.width + "px",
    async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto(
        "/tests/challanCalculations.browser.html?mode=bulk-review-10",
      );
      await page.evaluate((nextTheme) => {
        document.documentElement.dataset.theme = nextTheme;
      }, theme);
      const dialog = page.getByRole("dialog", { name: "Import Challans" });
      await expect(
        dialog.getByRole("button", { name: "IMPORT 10 VALID CHALLANS" }),
      ).toBeVisible();
      if (viewport.width === 390) {
        await dialog.locator(".challan-bulk-group summary").first().click();
      }
      const layout = await dialog.evaluate((element) => {
        const primary = element.querySelector(".challan-bulk-primary");
        const summary = element.querySelector(
          ".challan-bulk-summary-card.is-valid",
        );
        const rect = element.getBoundingClientRect();
        return {
          width: rect.width,
          height: rect.height,
          horizontalOverflow: element.scrollWidth > element.clientWidth + 1,
          buttonBackground: getComputedStyle(primary).backgroundColor,
          buttonColor: getComputedStyle(primary).color,
          summaryBackground: getComputedStyle(summary).backgroundColor,
          summaryColor: getComputedStyle(summary).color,
        };
      });
      expect(layout.width).toBeLessThan(viewport.width);
      expect(layout.height).toBeLessThan(viewport.height);
      expect(layout.horizontalOverflow).toBe(false);
      expect(layout.buttonBackground).not.toBe(layout.buttonColor);
      expect(layout.summaryBackground).not.toBe(layout.summaryColor);
    },
  );
}
