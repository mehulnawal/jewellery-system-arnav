import { test, expect } from "@playwright/test";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { getAuth } = require("firebase-admin/auth");
if (
  process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8280" ||
  process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9299"
)
  throw Error("Isolated loopback emulators required");
const app = initializeApp({ projectId: "demo-reset-local" }, "reset-ui"),
  db = getFirestore(app),
  auth = getAuth(app);
const password = "LocalResetTest123!";
test.beforeAll(async () => {
  for (const uid of ["admin", "staff"]) {
    try {
      await auth.createUser({
        uid,
        email: `${uid}@reset.example.test`,
        password,
      });
    } catch (e) {
      if (e.code !== "auth/uid-already-exists") throw e;
    }
  }
});
test.afterAll(async () => deleteApp(app));
test("real password authentication, cancel, typed phrase, backend worker, live empty UI and Auth preservation", async ({
  page,
  browser,
}) => {
  await fetch(
    "http://127.0.0.1:8280/emulator/v1/projects/demo-reset-local/databases/(default)/documents",
    { method: "DELETE" },
  );
  for (const uid of ["admin", "staff"])
    await db
      .doc(`employeeProfiles/${uid}`)
      .set({
        uid,
        accessId: uid,
        role: uid === "admin" ? "superadmin" : "employee",
        active: true,
        permissions: ["inventory", "challan-stage-1"],
      });
  await db
    .doc("inventory/legacy")
    .set({
      size: "5",
      shape: "PR",
      type: "CBD",
      sku: "5_PR_CBD",
      weight: 3,
      pieces: 3,
    });
  await db
    .doc("inventoryIdentities/5_PR_CBD")
    .set({ sku: "5_PR_CBD", recordId: "legacy" });
  for (const path of [
    "inventoryIdentityMigrations/v1",
    "numberingMigrations/manual-v1",
    "numberingMigrations/letters-v1",
  ])
    await db.doc(path).set({ ready: true });
  await db.doc("settings/config").set({ keep: true });
  await page.addInitScript(() => {
    localStorage.setItem("test-reset-mode", "true");
    localStorage.setItem("test-role", "admin");
  });
  await page.route(/https:\/\/.*(?:googleapis\.com|firebaseio\.com)/, (r) =>
    r.abort(),
  );
  await page.goto("/dashboard/admin-settings/danger-zone");
  await page.evaluate(async (pass) => {
    const f = await import("/tests/fixtures/firebase.js");
    await f.signInWithEmailAndPassword(
      f.auth,
      "admin@reset.example.test",
      pass,
    );
  }, password);
  const staff = await browser.newContext();
  await staff.addInitScript(() => {
    localStorage.setItem("test-reset-mode", "true");
    localStorage.setItem("test-role", "staff");
  });
  const other = await staff.newPage();
  await other.goto("/dashboard/check-inventory");
  await expect(other.getByText("DANGER ZONE", { exact: true })).toHaveCount(0);
  await page
    .getByRole("button", { name: "Delete All Records", exact: true })
    .click();
  await page.getByLabel("Current login password").fill("wrong-password");
  await page.getByRole("button", { name: "Verify Password" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Password verification failed",
  );
  await page.getByLabel("Current login password").fill(password);
  await page.getByRole("button", { name: "Verify Password" }).click();
  await expect(page.getByText("2. Permanent deletion warning")).toBeVisible();
  await page
    .locator(".business-danger-zone")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  expect((await db.doc("inventory/legacy").get()).exists).toBe(true);
  await page
    .getByRole("button", { name: "Delete All Records", exact: true })
    .click();
  await page.getByLabel("Current login password").fill(password);
  await page.getByRole("button", { name: "Verify Password" }).click();
  await page.getByRole("button", { name: "I Understand, Continue" }).click();
  const final = page.getByRole("button", {
    name: "Delete Everything Permanently",
  });
  await expect(final).toBeDisabled();
  await page.getByLabel("Type DELETE ALL RECORDS").fill("delete all records");
  await expect(final).toBeDisabled();
  await page.getByLabel("Type DELETE ALL RECORDS").fill("DELETE ALL RECORDS");
  await final.click();
  await expect
    .poll(
      async () => (await db.doc("systemState/business").get()).data()?.status,
      { timeout: 90000 },
    )
    .toBe("complete");
  expect((await db.collection("inventory").get()).empty).toBe(true);
  expect((await db.doc("settings/config").get()).exists).toBe(true);
  expect((await auth.getUser("admin")).uid).toBe("admin");
  expect((await auth.getUser("staff")).uid).toBe("staff");
  await expect(
    page.getByText("All business records were deleted successfully.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    other.getByText("All business records were deleted successfully.", {
      exact: true,
    }),
  ).toBeVisible();
  await staff.close();
});
