import { useCallback, useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase/config";
import {
  setBusinessGeneration,
  setBusinessAvailabilityBlocked,
} from "../firebase/businessWrites.js";
import { useAuth } from "../auth/AuthContext";
import { BusinessAvailabilityContext } from "../hooks/useBusinessAvailability.js";
import {
  businessStatus,
  listenerFailure,
  logListenerFailure,
} from "../utils/businessStatus.js";
import SystemStatusBanner from "../components/ui/SystemStatusBanner";
import BusinessReset from "../modules/admin/BusinessReset";
export default function BusinessGate({ children }) {
  const { user } = useAuth();
  const [availability, setAvailability] = useState({
    record: null,
    phase: "loading",
  });
  const [revision, setRevision] = useState(0),
    [now, setNow] = useState(Date.now);
  const retry = useCallback(() => {
    setBusinessAvailabilityBlocked(true);
    setAvailability((previous) => ({ ...previous, phase: "loading" }));
    setRevision((value) => value + 1);
  }, []);
  useEffect(() => {
    let disposed = false,
      unsubscribe = () => {},
      retryTimer,
      initialTimer,
      attempt = 0;
    const fail = (error) => {
      if (disposed) return;
      clearTimeout(initialTimer);
      setBusinessAvailabilityBlocked(true);
      logListenerFailure(
        db,
        "systemState/business",
        { uid: user?.uid, role: user?.role },
        error,
      );
      setAvailability((previous) => ({
        ...previous,
        ...listenerFailure(error),
      }));
      clearTimeout(retryTimer);
      retryTimer = setTimeout(listen, Math.min(60000, 5000 * 2 ** attempt++));
    };
    const listen = () => {
      if (disposed) return;
      clearTimeout(retryTimer);
      clearTimeout(initialTimer);
      unsubscribe();
      setBusinessAvailabilityBlocked(true);
      initialTimer = setTimeout(
        () =>
          setAvailability((previous) => ({
            ...previous,
            phase: previous.phase === "error" ? "error" : "offline",
          })),
        8000,
      );
      unsubscribe = onSnapshot(
        doc(db, "systemState", "business"),
        { includeMetadataChanges: true },
        (snapshot) => {
          if (disposed) return;
          try {
            const record = businessStatus(snapshot.data());
            const cached = snapshot.metadata.fromCache;
            if (!cached) {
              clearTimeout(initialTimer);
              attempt = 0;
            }
            if (!cached) setBusinessGeneration(record.generation);
            setBusinessAvailabilityBlocked(cached || record.locked);
            setAvailability((previous) => ({
              record:
                cached && previous.record?.locked ? previous.record : record,
              phase: record.locked
                ? "maintenance"
                : cached
                  ? previous.phase === "loading" && navigator.onLine
                    ? "loading"
                    : "offline"
                  : "ready",
            }));
          } catch (error) {
            fail(error);
          }
        },
        fail,
      );
    };
    const offline = () => {
      setBusinessAvailabilityBlocked(true);
      setAvailability((previous) => ({ ...previous, phase: "offline" }));
    };
    listen();
    window.addEventListener("online", listen);
    window.addEventListener("offline", offline);
    return () => {
      disposed = true;
      unsubscribe();
      clearTimeout(retryTimer);
      clearTimeout(initialTimer);
      setBusinessAvailabilityBlocked(true);
      window.removeEventListener("online", listen);
      window.removeEventListener("offline", offline);
    };
  }, [revision, user?.uid, user?.role]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(timer);
  }, []);
  const { record, phase } = availability;
  const maintenance = record?.locked === true;
  return (
    <BusinessAvailabilityContext.Provider
      value={{ ...availability, retry, revision }}
    >
      <div className="business-availability">
        {!maintenance && phase !== "ready" && (
          <SystemStatusBanner
            phase={phase}
            code={availability.code}
            retry={retry}
          />
        )}
        {maintenance ? (
          user?.role === "superadmin" ? (
            <BusinessReset state={record} />
          ) : (
            <section className="business-maintenance" role="status">
              <h2>Business system is being reset</h2>
              <p>{record.message}</p>
              <p>
                Your account is preserved. Business pages return automatically
                after verified completion.
              </p>
            </section>
          )
        ) : (
          <>
            {record?.status === "complete" &&
              now - (record.completedAt?.toMillis?.() || 0) < 60000 && (
                <p role="status">
                  All business records were deleted successfully.
                </p>
              )}
            <div key={record?.generation || 0}>{children}</div>
          </>
        )}
      </div>
    </BusinessAvailabilityContext.Provider>
  );
}
