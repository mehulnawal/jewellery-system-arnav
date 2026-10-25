import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/tests/orderList.browser.html");
  await page.getByRole("button", { name: "Open Add Order" }).click();
});

test("form validates after submit and retains multiline text", async ({
  page,
}) => {
  const dialog = page.getByRole("dialog", { name: "Add Order" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Add order details or an image.")).toHaveCount(
    0,
  );
  await dialog.getByRole("button", { name: "Add Order", exact: true }).click();
  await expect(
    dialog.getByText("Add order details or an image."),
  ).toBeVisible();
  await dialog.getByLabel(/Client Name/).fill("  Client A  ");
  await dialog.getByLabel(/Staff Name/).fill("  Staff B  ");
  const details = "Ring order\nSize 12\n\nRose gold";
  await dialog.getByLabel(/Order Details/).fill(details);
  await expect(dialog.getByText("Add order details or an image.")).toHaveCount(
    0,
  );
  await dialog.getByRole("button", { name: "Add Order", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => window.savedOrder.description)).toBe(
    details,
  );
});

test("pasted image previews and can be removed", async ({ page }) => {
  const dialog = page.getByRole("dialog", { name: "Add Order" });
  const drop = dialog.locator(".order-drop");
  await drop.evaluate((element) => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([new Uint8Array([137, 80, 78, 71])], "pasted.png", {
        type: "image/png",
      }),
    );
    element.dispatchEvent(
      new ClipboardEvent("paste", { bubbles: true, clipboardData: transfer }),
    );
  });
  await expect(dialog.getByAltText("pasted.png")).toBeVisible();
  await dialog.getByRole("button", { name: "Remove Image" }).click();
  await expect(dialog.getByAltText("pasted.png")).toHaveCount(0);
});

test("image selection, invalid files, oversized images, replacement and drop remain usable", async ({
  page,
}) => {
  const modal = page.getByRole("dialog", { name: "Add Order" });
  const input = modal.locator('input[type="file"]').first();
  await input.setInputFiles({
    name: "bad.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("bad"),
  });
  await expect(modal.getByRole("alert")).toContainText(
    "Select a JPG, PNG or WEBP",
  );
  await input.setInputFiles({
    name: "large.png",
    mimeType: "image/png",
    buffer: Buffer.alloc(10 * 1024 * 1024 + 1),
  });
  await expect(modal.getByRole("alert")).toContainText("10 MB");
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/pXcAAAAASUVORK5CYII=",
    "base64",
  );
  await input.setInputFiles({
    name: "selected.png",
    mimeType: "image/png",
    buffer: png,
  });
  await expect(modal.getByAltText("selected.png")).toBeVisible();
  await modal
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "replacement.png",
      mimeType: "image/png",
      buffer: png,
    });
  await expect(modal.getByAltText("replacement.png")).toBeVisible();
  await modal.getByRole("button", { name: "Remove Image" }).click();
  await modal.locator(".order-drop").evaluate((element) => {
    const dt = new DataTransfer();
    dt.items.add(
      new File([new Uint8Array([137, 80, 78, 71])], "dropped.png", {
        type: "image/png",
      }),
    );
    element.dispatchEvent(
      new DragEvent("drop", { bubbles: true, dataTransfer: dt }),
    );
  });
  await expect(modal.getByAltText("dropped.png")).toBeVisible();
  await modal.getByLabel(/Client Name/).fill("Client");
  await modal.getByLabel(/Staff Name/).fill("Staff");
  await modal.getByRole("button", { name: "Add Order", exact: true }).click();
  await expect(modal).not.toBeVisible();
  expect(await page.evaluate(() => window.savedOrder.file.name)).toBe(
    "dropped.png",
  );
});

for (const theme of ["light", "dark"])
  for (const width of [1440, 1024, 768, 480, 375]) {
    test(theme + " modal fits " + width + "px", async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      const dialog = page.getByRole("dialog", { name: "Add Order" });
      if (width === 1440 || width === 375) {
        await page.screenshot({
          path: `test-results/order-list-${theme}-${width}.png`,
          fullPage: true,
        });
      }
      if (width === 1440) {
        expect(
          await dialog
            .locator(".order-dialog-body")
            .evaluate((body) => body.scrollHeight <= body.clientHeight + 1),
        ).toBe(true);
        await expect(dialog.locator(".order-drop")).toBeInViewport();
      }
      const bounds = await dialog.boundingBox();
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(800);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    });
  }

test("edit form shows saved details and image preview without desktop scrolling", async ({
  page,
}) => {
  await page
    .getByRole("dialog", { name: "Add Order" })
    .getByRole("button", { name: "Close Add Order" })
    .click();
  await page.getByRole("button", { name: "Open Edit Order" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit Order" });
  await expect(dialog.getByLabel(/Client Name/)).toHaveValue("Ananya Sharma");
  await expect(dialog.getByAltText("order-image.svg")).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Save Changes" }),
  ).toBeVisible();
  expect(
    await dialog
      .locator(".order-dialog-body")
      .evaluate((body) => body.scrollHeight <= body.clientHeight + 1),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/order-edit-preview-light-1440.png",
    fullPage: true,
  });
});
