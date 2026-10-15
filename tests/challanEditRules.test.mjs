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
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";

let env;
const hour = 60 * 60 * 1000;
const now = Date.now();

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-jewellery-challan-edit",
    firestore: { rules: await readFile("firestore.rules", "utf8") },
  });
});
after(async () => env?.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    for (const uid of ["admin", "staff"]) {
      await setDoc(doc(db, "employeeProfiles", uid), {
        role: uid === "admin" ? "superadmin" : "employee",
        active: true,
        permissions:
          uid === "admin"
            ? []
            : [1, 2, 3, 4].map((stage) => "challan-stage-" + stage),
      });
    }
  });
});

async function seed(stage, enteredAtMs, owner = "staff") {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const history = { stage1: { enteredAtMs: now - 3 * 24 * hour } };
    if (stage >= 2)
      history.stage2 = {
        enteredAt: Timestamp.fromMillis(
          stage === 2 ? enteredAtMs : now - 2 * 24 * hour,
        ),
        enteredAtMs: now - 2 * 24 * hour,
      };
    if (stage >= 3)
      history.stage3 = {
        enteredAt: Timestamp.fromMillis(
          stage === 3 ? enteredAtMs : now - 24 * hour,
        ),
        enteredAtMs: now - 24 * hour,
      };
    if (stage >= 4)
      history.stage4 = {
        enteredAt: Timestamp.fromMillis(enteredAtMs),
        enteredAtMs: now - 12 * hour,
      };
    await setDoc(doc(db, "challans", "one"), {
      id: "one",
      number: "B40/1",
      stage,
      party: "Before",
      createdAt: Timestamp.fromMillis(now - 3 * 24 * hour),
      createdBy: owner,
      createdByRole: owner === "admin" ? "superadmin" : "employee",
      stageHistory: history,
      items: [],
      ...(stage >= 2 ? { stage2Return: { items: [] } } : {}),
      ...(stage >= 3
        ? { finalInvoice: { items: [], confirmedAtMs: enteredAtMs } }
        : {}),
      ...(stage >= 4
        ? { finalSettlement: { completedAtMs: enteredAtMs } }
        : {}),
    });
  });
}
const userDoc = (uid) =>
  doc(env.authenticatedContext(uid).firestore(), "challans", "one");

test("Stage 1 Admin remains unlimited while Staff is timed", async () => {
  await seed(1, now);
  await assertSucceeds(updateDoc(userDoc("admin"), { party: "Admin" }));
  await assertFails(updateDoc(userDoc("staff"), { party: "Staff" }));
});
for (const stage of [2, 3, 4]) {
  test(
    "Stage " +
      stage +
      " accepts fresh edits and rejects expired edits for both roles",
    async () => {
      await seed(stage, now - 30 * 60 * 1000);
      await assertSucceeds(updateDoc(userDoc("staff"), { party: "Staff" }));
      await assertSucceeds(updateDoc(userDoc("admin"), { party: "Admin" }));
      await assertFails(
        updateDoc(userDoc("staff"), {
          stageHistory: {
            stage1: { enteredAtMs: now },
            stage2: { enteredAtMs: now },
          },
        }),
      );
      await seed(stage, now - 2 * hour);
      await assertFails(
        updateDoc(userDoc("staff"), { party: "Expired Staff" }),
      );
      await assertFails(
        updateDoc(userDoc("admin"), { party: "Expired Admin" }),
      );
    },
  );
}
test("Stage 4 keeps Staff delete blocked and Admin delete available", async () => {
  await seed(4, now);
  await assertFails(deleteDoc(userDoc("staff")));
  await assertSucceeds(deleteDoc(userDoc("admin")));
});
test("Stage transition starts a server-stamped window even when Stage 1 is old", async () => {
  await seed(1, now);
  await assertSucceeds(
    updateDoc(userDoc("staff"), {
      stage: 2,
      stage2Return: { items: [] },
      stageHistory: {
        stage1: { enteredAtMs: now - 3 * 24 * hour },
        stage2: { enteredAtMs: now, enteredAt: serverTimestamp() },
      },
    }),
  );
  await assertSucceeds(updateDoc(userDoc("staff"), { party: "Fresh Stage 2" }));
});
