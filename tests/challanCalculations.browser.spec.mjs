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
  await expect(page.locator(".stage-two-totals strong").nth(6)).toHaveText(
    "3.375",
  );
  await page.getByRole("button", { name: /Move to Stage 2/ }).click();
  await expect
    .poll(() => page.evaluate(() => window.__savedReturnRows))
    .toEqual([
      { id: "a", returnPieces: "5", returnWeight: "2.375", price: "1000" },
      { id: "b", returnPieces: "2", returnWeight: "1.250", price: "500" },
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

test("Stage 2 totals align under the same eleven columns and edited rate reaches confirmation", async ({
  page,
}) => {
  await page.goto("/tests/challanCalculations.browser.html");
  const rows = page.locator(".stage-two-row");
  for (const row of await rows.all()) {
    await row.locator("input").nth(0).fill("0");
    await row.locator("input").nth(1).fill("0");
  }
  await page
    .getByRole("spinbutton", { name: "A Price / Carat" })
    .fill("900.25");
  const totals = page.locator(".stage-two-totals");
  await expect(totals).not.toContainText("Total Issued");
  await expect(totals.locator("strong").first()).toHaveText("TOTAL");
  await expect(totals.locator("strong").nth(2)).toHaveText("7.000");
  const grid = async (selector) =>
    page
      .locator(selector)
      .first()
      .evaluate((element) => getComputedStyle(element).gridTemplateColumns);
  expect(await grid(".stage-two-totals")).toBe(await grid(".stage-two-head"));
  expect(await grid(".stage-two-row")).toBe(await grid(".stage-two-head"));
  await expect(totals.locator(":scope > *")).toHaveCount(11);
  await page.getByRole("button", { name: /Move to Stage 2/ }).click();
  await expect
    .poll(() => page.evaluate(() => window.__savedReturnRows?.[0].price))
    .toBe("900.25");
});

test("Stage 2 Amount and its aligned total update live with rates, return weights and discounts", async ({
  page,
}) => {
  await page.goto(
    "/tests/challanCalculations.browser.html?mode=return-pricing",
  );
  const rows = page.locator(".stage-two-row");
  const total = page.getByLabel("Total Amount", { exact: true });
  await expect(total).toHaveText("--");
  for (const row of await rows.all())
    await row.locator("input").nth(0).fill("0");
  await rows.nth(0).locator("input").nth(1).fill("5");
  await rows.nth(1).locator("input").nth(1).fill("7");
  await expect(page.getByLabel("Pear Amount", { exact: true })).toHaveText(
    "₹10,000.00",
  );
  await expect(page.getByLabel("Marquise Amount", { exact: true })).toHaveText(
    "₹9,660.00",
  );
  await expect(total).toHaveText("₹19,660.00");
  await page
    .getByRole("spinbutton", { name: "Pear Price / Carat" })
    .fill("2100");
  await expect(total).toHaveText("₹20,160.00");
  await rows.nth(1).locator("input").nth(1).fill("8");
  await expect(total).toHaveText("₹16,940.00");
  await page.getByRole("spinbutton", { name: "Pear Price / Carat" }).fill("");
  await expect(total).toHaveText("--");
  await page
    .getByRole("spinbutton", { name: "Pear Price / Carat" })
    .fill("2100");
  await rows.nth(0).locator("input").nth(1).fill("10");
  await expect(page.getByLabel("Pear Amount", { exact: true })).toHaveText(
    "₹0.00",
  );
  await expect(total).toHaveText("₹6,440.00");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const cells = async (selector) =>
      page
        .locator(selector)
        .first()
        .evaluate((row) =>
          [...row.children].map((cell) => ({
            x: cell.getBoundingClientRect().x,
            w: cell.getBoundingClientRect().width,
          })),
        );
    const header = await cells(".stage-two-head"),
      footer = await cells(".stage-two-totals");
    expect(header).toHaveLength(11);
    for (let index = 0; index < header.length; index++) {
      expect(Math.abs(header[index].x - footer[index].x)).toBeLessThan(1);
      expect(Math.abs(header[index].w - footer[index].w)).toBeLessThan(1);
    }
  }
});

test("existing Stage 2 pricing modal defaults to the quote and validates edited rates", async ({
  page,
}) => {
  await page.goto("/tests/challanCalculations.browser.html?mode=stage2-prices");
  const price = page.getByLabel("A — Price / Carat");
  await expect(price).toHaveValue("1000");
  await price.fill("900.123");
  await page.getByRole("button", { name: "Save Stage 2 Prices" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "at most 2 decimal places",
  );
  await price.fill("900.25");
  await page.getByRole("button", { name: "Save Stage 2 Prices" }).click();
  await expect
    .poll(() => page.evaluate(() => window.__stage2Prices))
    .toEqual({ 0: 900.25 });
});

test("Challan print has matching Original/Duplicate serials, totals and Customer Signature", async ({
  page,
}) => {
  await page.goto("/tests/challanCalculations.browser.html?mode=print");
  const frame = page.frameLocator('iframe[title="Challan print"]');
  await expect(frame.locator(".copy")).toHaveCount(2);
  for (const copy of await frame.locator(".copy").all()) {
    await expect(copy).not.toContainText("Type / CVD / HP");
    await expect(copy).not.toContainText("Original Amount");
    await expect(copy).not.toContainText("After Discount");
    await expect(copy).toContainText("15 10 2026");
    await expect(copy.locator(".signature")).toHaveText("Customer Signature");
    await expect(copy.locator("tbody tr td").first()).toHaveText("1");
    await expect(copy.locator("tfoot td").last()).toHaveText("₹10");
  }
  await frame
    .locator(".copy")
    .first()
    .screenshot({ path: "test-results/client-challan-print.png" });
});

test("few/many item print endings keep physical signature space and Stage 4 normalized balance", async ({
  page,
}) => {
  for (const mode of ["print", "print-many", "print-stage4"]) {
    await page.goto("/tests/challanCalculations.browser.html?mode=" + mode);
    const frame = page.frameLocator('iframe[title="Challan print"]');
    await expect(frame.locator(".signature")).toHaveCount(2);
    for (const ending of await frame.locator(".copy-ending").all()) {
      const signature = ending.locator(".signature");
      await expect(signature).toContainText("Customer Signature");
      const geometry = await signature.evaluate((e) => ({
        padding: parseFloat(getComputedStyle(e).paddingTop),
        width: e.querySelector("span").getBoundingClientRect().width,
        breakInside: getComputedStyle(e.parentElement).breakInside,
      }));
      expect(geometry.padding).toBeGreaterThanOrEqual(83);
      expect(geometry.width).toBeGreaterThanOrEqual(264);
      expect(geometry.breakInside).toBe("avoid");
    }
    if (mode === "print-stage4")
      for (const ending of await frame.locator(".copy-ending").all())
        await expect(ending).toContainText("Outstanding Amount: ₹1,650");
    const html = await page.locator("iframe").getAttribute("srcdoc");
    await page.setContent(html);
    await page.emulateMedia({ media: "print" });
    await page.pdf({
      path: `test-results/${mode}-restored.pdf`,
      format: "A4",
      printBackground: true,
    });
    await page.screenshot({
      path: `test-results/${mode}-restored.png`,
      fullPage: true,
    });
  }
});
test("weight-only manual return requires an explicit zero Pieces entry and retains zero totals", async ({
  page,
}) => {
  await page.goto("/tests/challanCalculations.browser.html?mode=weight-only");
  const fields = page.locator(".stage-two-row input");
  await expect(fields).toHaveCount(3);
  await fields.nth(1).fill("2.500");
  await page.getByRole("button", { name: /Move to Stage 2/ }).click();
  await expect(page.getByText(/Enter 0 to 0/)).toBeVisible();
  expect(await page.evaluate(() => window.__savedReturnRows)).toBeUndefined();
  await fields.nth(0).fill("0");
  await expect(page.locator(".stage-two-totals strong").nth(5)).toHaveText("0");
  await page.getByRole("button", { name: /Move to Stage 2/ }).click();
  await expect
    .poll(() => page.evaluate(() => window.__savedReturnRows))
    .toEqual([
      { id: "manual", returnPieces: "0", returnWeight: "2.500", price: "1000" },
    ]);
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
  const review = page.locator(".final-invoice-modal");
  await expect(review.locator(".stage-two-head > span")).toHaveText([
    "SKU / TYPE",
    "ISSUED",
    "RETURN",
    "SOLD / KEPT",
    "PRICE / CARAT",
    "DISCOUNT",
    "FINAL BILLED AMOUNT",
  ]);
  await expect(review.locator(".stage-two-row > span").nth(4)).toHaveText("6%");
  await expect(review.locator(".stage-two-totals > strong")).toHaveCount(1);
  await expect(review.locator(".stage-two-totals small")).toHaveText(
    "Final Invoice Amount",
  );
  await expect(review).not.toContainText("Stage 1");
  await expect(finalAmount).toBeVisible();
  await expect(
    page.getByText("Enter billed amount to calculate total"),
  ).toBeVisible();
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
  await expect(review.locator(".stage-two-row > span").last()).toHaveText(
    "₹0.00",
  );
  await expect(review).not.toContainText("locked");
  await expect(page.locator(".final-invoice-modal input")).toHaveCount(0);
  await page.goto("/tests/challanCalculations.browser.html?mode=invoice-none");
  await expect(review.locator(".stage-two-row > span").last()).toHaveText(
    "₹940.00",
  );
  await expect(review).not.toContainText("locked");
  await expect(page.locator(".final-invoice-modal input")).toHaveCount(0);

  await page.goto("/tests/challanCalculations.browser.html?mode=invoice-staff");
  await expect(page.getByText("Admin entry required")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Confirm Final Invoice/ }),
  ).toBeDisabled();
});
test("simplified invoice review keeps seven columns aligned in both themes and small screens", async ({
  page,
}) => {
  await page.goto("/tests/challanCalculations.browser.html?mode=invoice-none");
  const review = page.locator(".final-invoice-modal");
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (value) => (document.documentElement.dataset.theme = value),
      theme,
    );
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(review).toBeVisible();
      await expect(review.locator(".stage-two-head > span")).toHaveCount(7);
      await expect(review.locator(".stage-two-row > *")).toHaveCount(7);
      const columns = await review
        .locator(".stage-two-head")
        .evaluate(
          (element) =>
            getComputedStyle(element).gridTemplateColumns.split(" ").length,
        );
      expect(columns).toBe(7);
      if (width === 1440) {
        for (let index = 1; index <= 5; index++) {
          const header = await review
            .locator(".stage-two-head > span")
            .nth(index)
            .boundingBox();
          const text = await review
            .locator(".stage-two-row > *")
            .nth(index)
            .evaluate((element) => {
              const range = document.createRange();
              range.selectNodeContents(element);
              const rect = range.getBoundingClientRect();
              return { x: rect.x, width: rect.width };
            });
          expect(
            Math.abs(header.x + header.width / 2 - text.x - text.width / 2),
          ).toBeLessThan(2);
        }
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(
        await review.evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `test-results/invoice-review-${theme}-${width}.png`,
      });
    }
  }
});

test("partial invoice pending total and amount hint avoid inherited badge styles", async ({
  page,
}) => {
  await page.goto(
    "/tests/challanCalculations.browser.html?mode=invoice-partial",
  );
  const review = page.locator(".final-invoice-modal");
  const input = page.getByRole("spinbutton", { name: "A Final Billed Amount" });
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (value) => (document.documentElement.dataset.theme = value),
      theme,
    );
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await input.fill("");
      await expect(
        review.locator(".final-invoice-total-value.is-pending"),
      ).toHaveText("Enter billed amount to calculate total");
      for (const selector of [
        ".stage-two-totals small",
        ".final-invoice-amount-hint",
      ]) {
        expect(
          await review
            .locator(selector)
            .evaluate((element) => getComputedStyle(element).backgroundColor),
        ).toBe("rgba(0, 0, 0, 0)");
      }
      if (width === 390)
        await review
          .locator(".stage-two-table-wrap")
          .evaluate((element) => (element.scrollLeft = element.scrollWidth));
      await page.screenshot({
        path: `test-results/invoice-pending-${theme}-${width}.png`,
      });
      await input.fill("400.50");
      await expect(review.locator(".final-invoice-total-value")).toHaveText(
        "₹400.50",
      );
      await expect(review.locator(".is-pending")).toHaveCount(0);
    }
  }
});

test("settlement updates Remaining immediately and rejects sub-cent Paid", async ({
  page,
}) => {
  await page.goto("/tests/challanCalculations.browser.html?mode=settlement");
  const paid = page.getByRole("spinbutton", {
    name: "Amount Paid by Customer",
  });
  const discount = page.getByRole("spinbutton", { name: "Discount Amount" });
  const complete = page.locator(".settlement-modal footer button.primary");
  await paid.fill("900");
  await expect(page.getByText("₹100.00")).toBeVisible();
  await expect(complete).toHaveText("Record Payment / Complete");
  await expect(complete).toBeEnabled();
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

test("outstanding preview remains available and settlement labels have no badge background", async ({
  page,
}) => {
  await page.goto("/tests/challanCalculations.browser.html?mode=settlement");
  await page
    .getByRole("spinbutton", { name: "Amount Paid by Customer" })
    .fill("900");
  const summary = page.locator(".settlement-summary-grid");
  await expect(summary.locator("strong").last()).toHaveText(
    /Outstanding Amount\s*₹100.00/,
  );
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (value) => (document.documentElement.dataset.theme = value),
      theme,
    );
    for (const label of await summary.locator("small").all()) {
      expect(
        await label.evaluate(
          (element) => getComputedStyle(element).backgroundColor,
        ),
      ).toBe("rgba(0, 0, 0, 0)");
    }
    await page.screenshot({
      path: `test-results/settlement-outstanding-${theme}.png`,
    });
  }
  await expect(
    page.getByRole("button", { name: "Record Payment / Complete" }),
  ).toBeEnabled();
});

test("15000 invoice saves 10000, reopens with 5000 due, then completes after the next payment", async ({
  page,
}) => {
  await page.goto(
    "/tests/challanCalculations.browser.html?mode=settlement-partial",
  );
  const modal = page.getByRole("dialog", { name: "Final Settlement" });
  await modal
    .getByRole("spinbutton", { name: "Amount Paid by Customer" })
    .fill("10000");
  await expect(
    modal.locator(".settlement-summary-grid strong").last(),
  ).toContainText("₹5000.00");
  await modal
    .getByRole("button", { name: "Record Payment / Complete" })
    .click();
  await expect(modal).not.toBeVisible();
  await expect(page.getByLabel("Current Stage")).toHaveText("Stage 4");
  await expect(page.getByLabel("Saved Outstanding")).toHaveText("₹5000");
  await page.getByRole("button", { name: "Record Next Payment" }).click();
  await expect(modal).toContainText("Already paid: ₹10000.00");
  await expect(
    modal.getByRole("region", { name: "Payment History" }),
  ).toContainText("₹10000.00");
  await modal
    .getByRole("spinbutton", { name: /Amount Paid by Customer/ })
    .fill("6000");
  await expect(modal).toContainText("cannot exceed the outstanding amount");
  await modal
    .getByRole("spinbutton", { name: /Amount Paid by Customer/ })
    .fill("5000");
  await modal
    .getByRole("button", { name: "Record Payment / Complete" })
    .click();
  await expect(page.getByLabel("Current Stage")).toHaveText("Stage 4");
  await expect(page.getByLabel("Saved Outstanding")).toHaveText("₹0");
  await expect(
    page.getByRole("region", { name: "Payment History" }).locator("tbody tr"),
  ).toHaveCount(2);
  await expect
    .poll(() =>
      page.evaluate(() => window.__paymentRecord.finalSettlement.amountPaid),
    )
    .toBe(15000);
});

test("Stage 4 partial payment clearly shows outstanding without claiming completion", async ({
  page,
}) => {
  await page.goto(
    "/tests/challanCalculations.browser.html?mode=view-partial-payment",
  );
  const fourth = page.locator(".challan-view-stage-four");
  await expect(fourth.getByRole("status")).toContainText("Partially Paid");
  await expect(fourth.getByRole("status")).toContainText("Outstanding Amount");
  await expect(fourth.getByRole("status")).toContainText("₹5,000.00");
  await expect(fourth).not.toContainText("Completed:");
  await expect(fourth).toContainText("Stage 4 entered:");
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
