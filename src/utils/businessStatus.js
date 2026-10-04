// Absence is safe only after Firestore confirms it from the server.
export function businessStatus(record) {
  if (record === undefined) return { generation: 0, locked: false };
  if (
    !record ||
    typeof record.locked !== "boolean" ||
    !Number.isSafeInteger(record.generation) ||
    record.generation < 0 ||
    (record.locked === false &&
      ["running", "incomplete"].includes(record.status))
  ) {
    throw Object.assign(
      new Error(
        "Invalid systemState/business marker: expected a nonnegative generation and a consistent boolean lock.",
      ),
      { code: "invalid-status" },
    );
  }
  return record;
}
export function listenerFailure(error) {
  const code = (error.code || "unknown").replace(/^firestore\//, "");
  return {
    code,
    phase: [
      "unavailable",
      "deadline-exceeded",
      "cancelled",
      "unknown",
    ].includes(code)
      ? "offline"
      : "error",
  };
}
export function logListenerFailure(db, resource, user, error) {
  console.error("[Firestore subscription]", {
    projectId: db.app?.options?.projectId,
    resource,
    uid: user?.uid,
    role: user?.role,
    code: error.code || "unknown",
    message: error.message,
  });
}
