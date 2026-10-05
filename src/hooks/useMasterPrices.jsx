import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../firebase/config";
import { useAuth } from "../auth/AuthContext";
import { useBusinessAvailability } from "./useBusinessAvailability.js";
import {
  listenerFailure,
  logListenerFailure,
} from "../utils/businessStatus.js";
import { masterPriceMap } from "../utils/masterPrices.js";
const initial = {
  uid: "",
  rows: [],
  loading: true,
  stale: false,
  error: "",
  phase: "loading",
};
const Context = createContext({
  ...initial,
  prices: new Map(),
  retry: () => {},
});
export function MasterPricesProvider({ children }) {
  const { user } = useAuth();
  const availability = useBusinessAvailability();
  const allowed =
    user?.role === "superadmin" ||
    user?.permissions?.some((permission) =>
      /^challan-stage-[1-4]$/.test(permission),
    );
  const [state, setState] = useState(initial),
    [revision, setRevision] = useState(0);
  const retry = useCallback(() => setRevision((value) => value + 1), []);
  const systemReady = availability.phase === "ready";
  useEffect(() => {
    if (!allowed || !user?.uid) return;
    let disposed = false,
      unsubscribe = () => {},
      timer,
      initialTimer,
      attempt = 0;
    const listen = () => {
      if (disposed) return;
      unsubscribe();
      clearTimeout(timer);
      clearTimeout(initialTimer);
      initialTimer = setTimeout(
        () =>
          setState((previous) => ({
            ...previous,
            uid: user.uid,
            loading: false,
            stale: true,
            phase: "offline",
            error: "Price list connection is unavailable.",
          })),
        8000,
      );
      unsubscribe = onSnapshot(
        user.role === "superadmin"
          ? collection(db, "masterPrices")
          : query(collection(db, "masterPrices"), where("active", "==", true)),
        { includeMetadataChanges: true },
        (snap) => {
          if (disposed) return;
          const cached = snap.metadata.fromCache;
          if (!cached) {
            clearTimeout(initialTimer);
            attempt = 0;
          }
          setState((previous) => ({
            uid: user.uid,
            rows:
              cached && !snap.docs.length && previous.uid === user.uid
                ? previous.rows
                : snap.docs.map((row) => ({ ...row.data(), id: row.id })),
            loading:
              cached &&
              !snap.docs.length &&
              previous.loading &&
              navigator.onLine,
            stale: cached,
            phase: cached ? "offline" : snap.empty ? "empty" : "data",
            error: cached
              ? "Master Prices are offline or still connecting. You can enter Price manually."
              : "",
          }));
        },
        (error) => {
          if (disposed) return;
          clearTimeout(initialTimer);
          const failure = listenerFailure(error);
          logListenerFailure(
            db,
            user.role === "superadmin" ? "masterPrices collection listen" : "masterPrices where active == true",
            { uid: user?.uid, role: user?.role },
            error,
          );
          setState((previous) => ({
            ...previous,
            uid: user.uid,
            rows: previous.uid === user.uid ? previous.rows : [],
            loading: false,
            stale: true,
            ...failure,
            error:
              failure.code === "permission-denied"
                ? "Master Price access was denied. Check the account permissions and masterPrices Firestore rules."
                : failure.code === "failed-precondition"
                  ? "Master Price query configuration failed. Check the Firestore console diagnostic."
                  : "Unable to load Master Prices. Retrying automatically.",
          }));
          timer = setTimeout(listen, Math.min(60000, 5000 * 2 ** attempt++));
        },
      );
    };
    listen();
    window.addEventListener("online", listen);
    return () => {
      disposed = true;
      unsubscribe();
      clearTimeout(timer);
      clearTimeout(initialTimer);
      window.removeEventListener("online", listen);
    };
  }, [
    allowed,
    user?.uid,
    user?.role,
    revision,
    availability.revision,
    systemReady,
  ]);
  const value = useMemo(() => {
    const current =
      allowed && state.uid === user?.uid
        ? state
        : { ...initial, loading: Boolean(allowed) };
    const rows = current.rows.filter(row => row.active === true);
    return { ...current, rows, managementRows: current.rows, prices: masterPriceMap(rows), retry };
  }, [state, allowed, user?.uid, retry]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export const useMasterPrices = () => useContext(Context);
