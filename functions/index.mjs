import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { defineSecret } from "firebase-functions/params";
import { createHash } from "node:crypto";
import { resetAction, processResetStep } from "./resetCore.mjs";
initializeApp();
const cloudinaryKey = defineSecret("CLOUDINARY_API_KEY"),
  cloudinarySecret = defineSecret("CLOUDINARY_API_SECRET");
export const businessReset = onCall({ timeoutSeconds: 60 }, async (request) => {
  const token = request.rawRequest.headers.authorization?.replace(
    /^Bearer /,
    "",
  );
  if (!token) throw new HttpsError("unauthenticated", "Sign in again.");
  try {
    const claims = await getAuth().verifyIdToken(token, true);
    return await resetAction(getFirestore(), claims, request.data || {});
  } catch (error) {
    const allowed = [
      "unauthenticated",
      "permission-denied",
      "failed-precondition",
      "already-exists",
    ];
    throw new HttpsError(
      allowed.includes(error.code) ? error.code : "permission-denied",
      allowed.includes(error.code)
        ? error.message
        : "Reset authorization failed. Re-authenticate and try again.",
    );
  }
});
export const businessResetWorker = onDocumentWritten(
  {
    document: "systemState/business",
    timeoutSeconds: 120,
    retry: true,
    secrets: [cloudinaryKey, cloudinarySecret],
  },
  async (event) => {
    const state = event.data?.after.data();
    if (!state?.locked || state.status !== "running") return;
    await processResetStep(getFirestore(), state, {
      removeImage: async (image) => {
        const cloud = process.env.CLOUDINARY_CLOUD_NAME;
        if (!cloud || !cloudinaryKey.value() || !cloudinarySecret.value())
          throw Object.assign(
            new Error("Configure image cleanup before resuming."),
            { code: "failed-precondition" },
          );
        const url = new URL(image.secureUrl);
        if (
          url.hostname !== "res.cloudinary.com" ||
          !url.pathname.startsWith(`/${cloud}/image/upload/`)
        )
          throw Object.assign(
            new Error("Unrecognized image ownership needs review."),
            { code: "failed-precondition" },
          );
        const assetPath = decodeURIComponent(url.pathname);
        const suffix =
          "/" + image.publicId + (image.format ? "." + image.format : "");
        if (!assetPath.endsWith(suffix))
          throw Object.assign(
            new Error(
              "Image URL and identifier disagree; review before deletion.",
            ),
            { code: "failed-precondition" },
          );
        const timestamp = Math.floor(Date.now() / 1000);
        const signature = createHash("sha1")
          .update(
            `invalidate=true&public_id=${image.publicId}&timestamp=${timestamp}${cloudinarySecret.value()}`,
          )
          .digest("hex");
        const response = await fetch(
          `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloud)}/image/destroy`,
          {
            method: "POST",
            body: new URLSearchParams({
              public_id: image.publicId,
              timestamp: String(timestamp),
              invalidate: "true",
              api_key: cloudinaryKey.value(),
              signature,
            }),
            signal: AbortSignal.timeout(15000),
          },
        );
        const result = await response.json();
        if (!response.ok || !["ok", "not found"].includes(result.result))
          throw new Error("Image cleanup failed.");
      },
    });
  },
);
