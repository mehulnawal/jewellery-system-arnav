// Keep Firestore errors understandable without exposing rule internals.
export function purchaseSaveError(error, edit = false) {
  const code = error?.code || "";
  if (code === "permission-denied")
    return `You don't have permission to ${edit ? "update" : "create"} purchases.`;
  if (code === "unauthenticated")
    return "Your session has expired. Please sign in again.";
  if (code === "unavailable" || code === "deadline-exceeded")
    return "Could not reach Purchases. Check your connection and try again.";
  if (error?.message?.startsWith("Number setup is incomplete"))
    return error.message;
  return code ? "Could not save this Purchase. Please try again." : error?.message || "Could not save this Purchase. Please try again.";
}
