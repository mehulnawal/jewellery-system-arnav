import { randomBytes, randomUUID, createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";

// Audited against every collection reference in src/ and scripts/. Never widen
// this to "all collections": identities, permissions and configuration survive.
export const BUSINESS_COLLECTIONS = [
  "challans",
  "purchases",
  "inventory",
  "parties",
  "vendors",
  "brokers",
  "masterPrices",
  "activityLog",
  "activityLogFirstLogins",
  "challanNumbers",
  "purchaseNumbers",
  "inventoryIdentities",
  "counters",
  "numberingMigrations",
  "inventoryIdentityMigrations",
];
export const PRESERVED_COLLECTIONS = [
  "employeeProfiles",
  "staffCredentials",
  "settings",
  "shapes",
  "systemState",
  "businessResetAudits",
  "resetAuthorizations",
];
const CONTROL = "systemState/business";
const stamp = () => FieldValue.serverTimestamp();
const failure = (code, message) => Object.assign(new Error(message), { code });
const digest = (token) =>
  createHash("sha256").update(String(token)).digest("hex");
export async function authorizeReset(db, claims, now = Date.now()) {
  if (!claims?.uid) throw failure("unauthenticated", "Sign in again.");
  const profile = (await db.doc(`employeeProfiles/${claims.uid}`).get()).data();
  if (profile?.role !== "superadmin" || profile.active !== true)
    throw failure(
      "permission-denied",
      "Only an active Admin can reset business data.",
    );
  if (
    claims.firebase?.sign_in_provider !== "password" ||
    !claims.auth_time ||
    now / 1000 - claims.auth_time > 180 ||
    claims.auth_time > now / 1000 + 30
  )
    throw failure(
      "failed-precondition",
      "Re-authenticate with your current password immediately before resetting.",
    );
}
export async function resetAction(db, claims, data, now = Date.now()) {
  await authorizeReset(db, claims, now);
  if (data.action === "prepare") {
    const token = randomBytes(32).toString("hex");
    await db
      .doc(`resetAuthorizations/${digest(token)}`)
      .set({
        uid: claims.uid,
        stage: "authenticated",
        expiresAtMs: now + 180000,
        createdAt: stamp(),
        authTime: claims.auth_time,
      });
    return { token };
  }
  if (!/^[a-f0-9]{64}$/.test(data.token || ""))
    throw failure("permission-denied", "Reset authorization is missing.");
  const permissionRef = db.doc(`resetAuthorizations/${digest(data.token)}`),
    controlRef = db.doc(CONTROL);
  return db.runTransaction(async (tx) => {
    const permission = (await tx.get(permissionRef)).data(),
      current = (await tx.get(controlRef)).data() || {};
    if (
      !permission ||
      permission.uid !== claims.uid ||
      permission.expiresAtMs < now ||
      permission.stage === "used"
    )
      throw failure(
        "permission-denied",
        "Reset authorization expired or was already used. Re-authenticate.",
      );
    if (data.action === "acknowledge" && permission.stage === "authenticated") {
      tx.update(permissionRef, { stage: "warned" });
      return { acknowledged: true };
    }
    if (
      data.action !== "start" ||
      permission.stage !== "warned" ||
      data.phrase !== "DELETE ALL RECORDS"
    )
      throw failure(
        "failed-precondition",
        "Both confirmations, including the exact phrase, are required.",
      );
    if (
      current.locked &&
      current.status === "running" &&
      now - (current.updatedAt?.toMillis?.() || now) < 300000
    )
      throw failure("already-exists", "A reset is already running.");
    const resume = current.locked === true;
    const jobId = resume ? current.jobId : randomUUID();
    const next = {
      locked: true,
      status: "running",
      initiatedBy: resume ? current.initiatedBy : claims.uid,
      phase: resume ? current.phase : -1,
      step: (current.step || 0) + 1,
      generation: resume ? current.generation : (current.generation || 0) + 1,
      jobId,
      message: resume ? "Resuming reset" : "Preparing reset",
      updatedAt: stamp(),
    };
    tx.set(controlRef, next);
    tx.set(
      db.doc(`businessResetAudits/${jobId}`),
      {
        initiatedBy: resume ? current.initiatedBy || claims.uid : claims.uid,
        lastAuthorizedBy: claims.uid,
        status: "running",
        resumed: resume,
        authorizedAt: stamp(),
        ...(resume ? {} : { startedAt: stamp() }),
      },
      { merge: true },
    );
    tx.update(permissionRef, { stage: "used", jobId });
    return { jobId };
  });
}
async function deletionCandidates(collection, limit = 40) {
  const result = [];
  async function visit(ref) {
    for (const child of await ref.listCollections())
      for (const doc of await child.listDocuments()) {
        await visit(doc);
        if (result.length >= limit) return;
      }
    if (result.length < limit) result.push(ref);
  }
  const existing = await collection.limit(10).get();
  // listDocuments also finds documents whose parent data is already missing,
  // so orphaned subcollections are not silently skipped by a normal query.
  const roots = existing.empty
    ? await collection.listDocuments()
    : existing.docs.map((doc) => doc.ref);
  for (const root of roots) {
    await visit(root);
    if (result.length >= limit) break;
  }
  return result;
}
export async function processResetStep(
  db,
  expected,
  {
    removeImage = async () => {
      throw failure("failed-precondition", "Image cleanup is not configured.");
    },
    beforeCommit,
  } = {},
) {
  const controlRef = db.doc(CONTROL);
  const same = (value) =>
    value?.locked &&
    value.status === "running" &&
    value.jobId === expected.jobId &&
    value.step === expected.step;
  if (!same((await controlRef.get()).data())) return false;
  try {
    let refs = [],
      nextPhase = expected.phase,
      nextMessage = "Deleting business records";
    if (expected.phase === -1) {
      const unknown = (await db.listCollections())
        .map((ref) => ref.id)
        .filter(
          (name) =>
            !BUSINESS_COLLECTIONS.includes(name) &&
            !PRESERVED_COLLECTIONS.includes(name),
        );
      if (unknown.length)
        throw failure(
          "failed-precondition",
          "Unclassified collections require a reviewed reset scope before continuing.",
        );
      nextPhase = 0;
    } else if (expected.phase < BUSINESS_COLLECTIONS.length) {
      const name = BUSINESS_COLLECTIONS[expected.phase];
      refs = await deletionCandidates(db.collection(name));
      if (name === "challans")
        for (const ref of refs) {
          const row = (await ref.get()).data();
          for (const image of [
            ...(row?.stage1Images || []),
            ...(row?.stage2Images || []),
          ]) {
            if (!image.publicId || !image.secureUrl)
              throw failure(
                "failed-precondition",
                "A legacy image needs review before deletion.",
              );
            await removeImage(image); // Idempotent external delete before deleting its reference.
          }
        }
      if (!refs.length) nextPhase++;
      if (expected.phase >= 9) nextMessage = "Cleaning registries";
    } else {
      nextMessage = "Verifying reset";
      for (const name of BUSINESS_COLLECTIONS)
        if ((await deletionCandidates(db.collection(name), 1)).length)
          throw failure(
            "failed-precondition",
            "Reset verification found remaining data. Resume the reset.",
          );
    }
    await beforeCommit?.();
    return await db.runTransaction(async (tx) => {
      if (!same((await tx.get(controlRef)).data())) return false;
      if (expected.phase >= BUSINESS_COLLECTIONS.length) {
        // Empty-data verification and readiness initialization precede unlocking.
        // These writes are atomic: no client sees an unlocked unready system.
        for (const path of [
          "inventoryIdentityMigrations/v1",
          "numberingMigrations/manual-v1",
          "numberingMigrations/letters-v1",
        ])
          tx.set(db.doc(path), { ready: true, completedAt: stamp() });
        tx.update(controlRef, {
          locked: false,
          status: "complete",
          message: "All business records were deleted successfully.",
          step: expected.step + 1,
          completedAt: stamp(),
          updatedAt: stamp(),
        });
        tx.set(
          db.doc(`businessResetAudits/${expected.jobId}`),
          {
            status: "complete",
            completedAt: stamp(),
            verifiedEmpty: BUSINESS_COLLECTIONS,
            readyMarkers: true,
          },
          { merge: true },
        );
      } else {
        for (const ref of refs) tx.delete(ref);
        tx.update(controlRef, {
          phase: nextPhase,
          step: expected.step + 1,
          message: nextMessage,
          updatedAt: stamp(),
        });
        tx.set(
          db.doc(`businessResetAudits/${expected.jobId}`),
          {
            deletedDocuments: FieldValue.increment(refs.length),
            updatedAt: stamp(),
          },
          { merge: true },
        );
      }
      return true;
    });
  } catch (error) {
    await db.runTransaction(async (tx) => {
      if (!same((await tx.get(controlRef)).data())) return;
      tx.update(controlRef, {
        status: "incomplete",
        phase:
          expected.phase >= BUSINESS_COLLECTIONS.length ? 0 : expected.phase,
        message:
          "Reset incomplete. Business writes remain locked. Admin must review and resume.",
        updatedAt: stamp(),
      });
      tx.set(
        db.doc(`businessResetAudits/${expected.jobId}`),
        {
          status: "incomplete",
          failedAt: stamp(),
          reason:
            error.code === "failed-precondition"
              ? error.message
              : "Backend operation failed; review server configuration and retry.",
        },
        { merge: true },
      );
    });
    return false;
  }
}
