import test, { before, after, beforeEach } from "node:test";
import { readFile } from "node:fs/promises";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from "@firebase/rules-unit-testing";
import {
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  serverTimestamp,
} from "firebase/firestore";
let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-order-list-rules",
    firestore: {
      host: "127.0.0.1",
      port: 8180,
      rules: await readFile("firestore.rules", "utf8"),
    },
  });
});
after(async () => env?.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    for (const role of ["employee", "staff", "admin", "superadmin", "inactive"])
      await setDoc(doc(c.firestore(), "employeeProfiles", role), {
        role: role === "inactive" ? "employee" : role,
        active: role !== "inactive",
        permissions: [],
      });
  });
});
const dbFor = (role) => env.authenticatedContext(role).firestore();
const record = (role) => ({
  orderDate: "2026-10-26",
  clientName: "Client",
  staffName: "Free text",
  description: "Ring\nSize 12\n\nUrgent",
  image: null,
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
  createdBy: { uid: role, name: role, role },
  updatedBy: null,
});
test("all active baseline roles have CRUD without optional permissions and preserve creation metadata", async () => {
  for (const role of ["employee", "staff", "admin", "superadmin"]) {
    const ref = doc(dbFor(role), "orderList", role);
    await assertSucceeds(setDoc(ref, record(role)));
    await assertSucceeds(getDoc(ref));
    await assertSucceeds(
      updateDoc(ref, {
        description: "Updated\nDetails",
        updatedAt: serverTimestamp(),
        updatedBy: { uid: role, name: role, role },
      }),
    );
    await assertFails(
      updateDoc(ref, {
        createdBy: { uid: role, name: "forged", role },
        updatedAt: serverTimestamp(),
      }),
    );
    await assertSucceeds(deleteDoc(ref));
  }
});
test("unauthenticated/inactive/malformed/empty entries denied; image-only accepted", async () => {
  await assertFails(
    setDoc(
      doc(env.unauthenticatedContext().firestore(), "orderList", "anon"),
      record("employee"),
    ),
  );
  await assertFails(
    setDoc(doc(dbFor("inactive"), "orderList", "bad"), record("inactive")),
  );
  const ref = doc(dbFor("employee"), "orderList", "one");
  for (const change of [
    { description: "   " },
    { clientName: " " },
    { staffName: "\t" },
    { orderDate: "bad" },
    {
      image: {
        secureUrl: "data:image/png;base64,abc",
        publicId: "x",
        filename: "x.png",
      },
    },
  ])
    await assertFails(setDoc(ref, { ...record("employee"), ...change }));
  await assertSucceeds(
    setDoc(ref, {
      ...record("employee"),
      description: "",
      image: {
        secureUrl: "https://res.cloudinary.com/test/image/upload/x.png",
        publicId: "x",
        filename: "x.png",
      },
    }),
  );
});
test("Order writes respect business lock and generation while standalone orders survive reset scope", async () => {
  const ref = doc(dbFor("employee"), "orderList", "one");
  await env.withSecurityRulesDisabled(async (c) =>
    setDoc(doc(c.firestore(), "systemState", "business"), {
      locked: false,
      generation: 2,
    }),
  );
  await assertFails(setDoc(ref, record("employee")));
  await assertSucceeds(
    setDoc(ref, { ...record("employee"), businessGeneration: 2 }),
  );
  await env.withSecurityRulesDisabled(async (c) =>
    updateDoc(doc(c.firestore(), "systemState", "business"), { locked: true }),
  );
  await assertFails(deleteDoc(ref));
  await assertFails(
    updateDoc(ref, { description: "stale", updatedAt: serverTimestamp() }),
  );
});
