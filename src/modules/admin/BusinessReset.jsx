import { useEffect, useState } from "react";
import { EmailAuthProvider, reauthenticateWithCredential } from "firebase/auth";
import { getFunctions, httpsCallable } from "firebase/functions";
import { auth } from "../../firebase/config";
import { useBusinessAvailability } from "../../hooks/useBusinessAvailability.js";
import { useAuth } from "../../auth/AuthContext";
import "./businessReset.css";
const invoke = async (data) =>
  (await httpsCallable(getFunctions(auth.app), "businessReset")(data)).data;
export default function BusinessReset({ state }) {
  const { user } = useAuth();
  const availability = useBusinessAvailability();
  const unavailable =
    availability.phase !== "ready" && availability.phase !== "maintenance";
  const [step, setStep] = useState(0),
    [password, setPassword] = useState(""),
    [token, setToken] = useState(""),
    [phrase, setPhrase] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(timer);
  }, []);
  if (user?.role !== "superadmin") return null;
  const cancel = () => {
    setStep(0);
    setPassword("");
    setToken("");
    setPhrase("");
    setError("");
  };
  const run = async (task) => {
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (failure) {
      setError(
        failure.code?.startsWith("auth/")
          ? "Password verification failed. Please check your current login password."
          : failure.code === "functions/unavailable"
            ? "The secure reset service is unavailable. No reset was confirmed."
            : failure.message || "Reset could not proceed.",
      );
    } finally {
      setBusy(false);
      setPassword("");
    }
  };
  return (
    <section className="business-danger-zone">
      <h3>Destructive action</h3>
      <h4>Reset All Business Data</h4>
      <p>
        Permanently deletes Inventory, Purchases, Challans, parties, vendors,
        brokers, Master Prices, business logs and number/identity registries,
        including their nested data and recorded Challan images. Login accounts
        and application settings are preserved.
      </p>
      {state?.message && state.status !== "complete" && (
        <p role="status">{state.message}</p>
      )}
      {state?.locked && (
        <p>
          Business writes are locked until verification and recovery finish.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {step === 0 && (
        <button
          className="danger-button"
          disabled={
            busy ||
            unavailable ||
            (state?.locked &&
              state.status === "running" &&
              now - (state.updatedAt?.toMillis?.() || now) < 300000)
          }
          onClick={() => setStep(1)}
        >
          {state?.locked
            ? "Re-authenticate to Resume Reset"
            : "Delete All Records"}
        </button>
      )}
      {step === 1 && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            run(async () => {
              if (!auth.currentUser?.email)
                throw new Error(
                  "Sign in with your Admin email and password first.",
                );
              await reauthenticateWithCredential(
                auth.currentUser,
                EmailAuthProvider.credential(auth.currentUser.email, password),
              );
              await auth.currentUser.getIdToken(true);
              const authorization = await invoke({ action: "prepare" });
              setToken(authorization.token);
              setStep(2);
            });
          }}
        >
          <h4>1. Verify Admin password</h4>
          <label>
            Current login password
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          <button disabled={busy || unavailable || !password}>
            Verify Password
          </button>
          <button type="button" disabled={busy} onClick={cancel}>
            Cancel
          </button>
        </form>
      )}
      {step === 2 && (
        <div>
          <h4>2. Permanent deletion warning</h4>
          <p>
            This permanently removes persisted business records and their
            recorded images. This cannot be undone. Confirm only after retaining
            any backups you need.
          </p>
          <button disabled={busy} onClick={cancel}>
            Cancel
          </button>
          <button
            disabled={busy || unavailable}
            onClick={() =>
              run(async () => {
                await invoke({ action: "acknowledge", token });
                setStep(3);
              })
            }
          >
            I Understand, Continue
          </button>
        </div>
      )}
      {step === 3 && (
        <div>
          <h4>3. Final confirmation</h4>
          <label>
            Type DELETE ALL RECORDS
            <input
              autoComplete="off"
              value={phrase}
              onChange={(event) => setPhrase(event.target.value)}
            />
          </label>
          <button disabled={busy} onClick={cancel}>
            Cancel
          </button>
          <button
            className="danger-button"
            disabled={busy || unavailable || phrase !== "DELETE ALL RECORDS"}
            onClick={() =>
              run(async () => {
                await invoke({ action: "start", token, phrase });
                cancel();
              })
            }
          >
            {busy ? "Starting reset…" : "Delete Everything Permanently"}
          </button>
        </div>
      )}
    </section>
  );
}
