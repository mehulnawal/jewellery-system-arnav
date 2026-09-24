import { collection, onSnapshot, query, where } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { db } from "../../firebase/config";
import { challanAging } from "../../utils/challanAging";
import { useToast } from "../../ui/ToastContext";
import { formatDate, HistoryDirectory, HistorySummary } from "./historyShared";
import "./history.css";

const stageLabel = (stage) =>
  ({
    1: "Stage 1 — Goods Out",
    2: "Stage 2 — Return / Sale",
    3: "Stage 3 — Final Invoice / Payment Pending",
    4: "Stage 4 — Completed",
  })[Number(stage)] || "Stage unavailable";

export default function PartyChallanHistory() {
  const toast = useToast();
  const navigate = useNavigate();
  const [parties, setParties] = useState([]);
  const [queryText, setQueryText] = useState("");
  const [selectedParty, setSelectedParty] = useState("");
  const [challans, setChallans] = useState([]);
  const [loadedParty, setLoadedParty] = useState("");
  const [clock, setClock] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(
    () =>
      onSnapshot(
        collection(db, "parties"),
        (snapshot) =>
          setParties(
            snapshot.docs
              .map((entry) => String(entry.data()?.name || "").trim())
              .filter(Boolean)
              .sort((left, right) => left.localeCompare(right)),
          ),
        () => toast("Party directory could not be loaded.", "error"),
      ),
    [toast],
  );
  useEffect(() => {
    if (!selectedParty) return undefined;
    return onSnapshot(
      query(collection(db, "challans"), where("party", "==", selectedParty)),
      (snapshot) => {
        setChallans(
          snapshot.docs
            .map((entry) => ({ id: entry.id, ...entry.data() }))
            .sort((left, right) =>
              String(right.date || "").localeCompare(String(left.date || "")),
            ),
        );
        setLoadedParty(selectedParty);
      },
      () => {
        setChallans([]);
        setLoadedParty(selectedParty);
        toast("Challan history could not be loaded for this party.", "error");
      },
    );
  }, [selectedParty, toast]);

  const visibleChallans = useMemo(
    () => (loadedParty === selectedParty ? challans : []),
    [challans, loadedParty, selectedParty],
  );
  const active = useMemo(
    () => visibleChallans.filter((challan) => Number(challan.stage) < 4),
    [visibleChallans],
  );
  const summary = useMemo(
    () => [
      { label: "Total Challans", value: visibleChallans.length },
      { label: "Active / Open", value: active.length },
      {
        label: "Payment Pending",
        value: visibleChallans.filter((challan) => Number(challan.stage) === 3)
          .length,
      },
      {
        label: "Completed",
        value: visibleChallans.filter((challan) => Number(challan.stage) === 4)
          .length,
      },
    ],
    [active.length, visibleChallans],
  );
  const details = (challan) =>
    navigate("/dashboard/challan", { state: { viewChallanId: challan.id } });

  return (
    <section className="history-page">
      <header className="history-page-header">
        <h2>Party Challan History</h2>
        <p>Search a party to view current and historical Challans.</p>
      </header>
      <div className="history-layout">
        <HistoryDirectory
          title="Party"
          placeholder="Search party name"
          query={queryText}
          onQuery={setQueryText}
          entries={parties}
          selected={selectedParty}
          onSelect={setSelectedParty}
        />
        <main className="history-main">
          {!selectedParty ? (
            <div className="history-empty">
              Select a party to view Challan history.
            </div>
          ) : (
            <>
              <header className="history-selected-header">
                <small>PARTY</small>
                <h3>{selectedParty}</h3>
              </header>
              <HistorySummary cards={summary} />
              {loadedParty !== selectedParty ? (
                <div className="history-empty">Loading Challan history…</div>
              ) : (
                <>
                  <HistoryTable
                    title="Current / Active Challans"
                    subtitle="Stages 1–3"
                    rows={active}
                    clock={clock}
                    details={details}
                    active
                  />
                  <HistoryTable
                    title="Challan History"
                    subtitle="Newest first"
                    rows={visibleChallans}
                    clock={clock}
                    details={details}
                  />
                </>
              )}
            </>
          )}
        </main>
      </div>
    </section>
  );
}

function HistoryTable({
  title,
  subtitle,
  rows,
  clock,
  details,
  active = false,
}) {
  return (
    <section className="history-table-section">
      <div className="history-section-heading">
        <h3>{title}</h3>
        <span>{subtitle}</span>
      </div>
      {rows.length ? (
        <div className="history-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Challan No.</th>
                <th>Date</th>
                <th>Items</th>
                <th>Total Pieces</th>
                <th>Stage</th>
                {active && <th>Aging</th>}
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((challan) => {
                const age = active ? challanAging(challan, clock) : null;
                const pieces = (challan.items || []).reduce(
                  (total, item) => total + Number(item.pieces || 0),
                  0,
                );
                return (
                  <tr key={challan.id}>
                    <td>
                      <strong>{challan.number || "—"}</strong>
                    </td>
                    <td>{formatDate(challan.date)}</td>
                    <td>{challan.items?.length || 0}</td>
                    <td>{pieces}</td>
                    <td>
                      <span className={`history-stage stage-${challan.stage}`}>
                        {stageLabel(challan.stage)}
                      </span>
                    </td>
                    {active && (
                      <td>
                        <span className={`history-aging ${age.status}`}>
                          {age.label} · {age.elapsedLabel}
                        </span>
                      </td>
                    )}
                    <td>
                      <button type="button" onClick={() => details(challan)}>
                        Details
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="history-empty">
          {active
            ? "No active Challans found for this party."
            : "No Challans found for this party."}
        </div>
      )}
    </section>
  );
}
