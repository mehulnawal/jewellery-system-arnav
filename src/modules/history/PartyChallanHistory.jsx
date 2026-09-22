import { collection, onSnapshot, query, where } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { db } from "../../firebase/config";
import { challanAging } from "../../utils/challanAging";
import { useToast } from "../../ui/ToastContext";
import { ChallanHistoryDetails } from "./HistoryDetails";
import { formatDate, HistoryDirectory, HistorySummary } from "./historyShared";
import "./history.css";

const stageLabel = (stage) => ({ 1: "Stage 1 — Goods Out", 2: "Stage 2 — Return / Sale", 3: "Stage 3 — Final Invoice / Payment Pending", 4: "Stage 4 — Completed" })[Number(stage)] || "Stage unavailable";
const todayKey = () => new Date().toLocaleDateString("en-CA");
const daysAgo = (days) => { const date = new Date(); date.setDate(date.getDate() - days); return date.toLocaleDateString("en-CA"); };
const inDateRange = (value, filter) => {
  if (!value || filter.date === "all") return true;
  const key = String(value).slice(0, 10);
  if (filter.date === "today") return key === todayKey();
  if (filter.date === "7") return key >= daysAgo(6) && key <= todayKey();
  if (filter.date === "30") return key >= daysAgo(29) && key <= todayKey();
  return (!filter.from || key >= filter.from) && (!filter.to || key <= filter.to);
};
const defaultFilters = { search: "", stage: "all", date: "all", from: "", to: "", aging: "all", sort: "newest" };

export default function PartyChallanHistory() {
  const toast = useToast();
  const [parties, setParties] = useState([]);
  const [queryText, setQueryText] = useState("");
  const [selectedParty, setSelectedParty] = useState("");
  const [challans, setChallans] = useState([]);
  const [loadedParty, setLoadedParty] = useState("");
  const [clock, setClock] = useState(() => Date.now());
  const [filters, setFilters] = useState(defaultFilters);
  const [selectedChallan, setSelectedChallan] = useState(null);

  useEffect(() => { const timer = window.setInterval(() => setClock(Date.now()), 60000); return () => window.clearInterval(timer); }, []);
  useEffect(() => onSnapshot(collection(db, "parties"), (snapshot) => setParties(snapshot.docs.map((entry) => String(entry.data()?.name || "").trim()).filter(Boolean).sort((left, right) => left.localeCompare(right))), () => toast("Party directory could not be loaded.", "error")), [toast]);
  useEffect(() => {
    if (!selectedParty) return undefined;
    return onSnapshot(query(collection(db, "challans"), where("party", "==", selectedParty)), (snapshot) => {
      setChallans(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
      setLoadedParty(selectedParty);
    }, () => { setChallans([]); setLoadedParty(selectedParty); toast("Challan history could not be loaded for this party.", "error"); });
  }, [selectedParty, toast]);

  const sourceChallans = useMemo(() => (loadedParty === selectedParty ? challans : []), [challans, loadedParty, selectedParty]);
  const activeSource = useMemo(() => sourceChallans.filter((challan) => Number(challan.stage) < 4), [sourceChallans]);
  const matchesFilters = (challan) => {
    const needle = filters.search.trim().toLocaleLowerCase();
    const stage = Number(challan.stage || 1);
    const age = stage < 4 ? challanAging(challan, clock) : null;
    return (!needle || String(challan.number || "").toLocaleLowerCase().includes(needle))
      && (filters.stage === "all" || stage === Number(filters.stage))
      && inDateRange(challan.date, filters)
      && (filters.aging === "all" || (stage < 4 && age?.status === filters.aging));
  };
  const sortRows = (rows) => [...rows].sort((left, right) => {
    if (filters.sort === "oldest") return String(left.date || "").localeCompare(String(right.date || ""));
    if (filters.sort === "number-asc") return String(left.number || "").localeCompare(String(right.number || ""), undefined, { numeric: true });
    if (filters.sort === "number-desc") return String(right.number || "").localeCompare(String(left.number || ""), undefined, { numeric: true });
    if (filters.sort === "aging-oldest") {
      const leftAge = Number(left.stage) < 4 ? challanAging(left, clock).elapsedMs : -1;
      const rightAge = Number(right.stage) < 4 ? challanAging(right, clock).elapsedMs : -1;
      return rightAge - leftAge;
    }
    return String(right.date || "").localeCompare(String(left.date || ""));
  });
  const visibleChallans = sortRows(sourceChallans.filter(matchesFilters));
  const visibleActive = sortRows(activeSource.filter(matchesFilters));
  const summary = useMemo(() => [{ label: "Total Challans", value: sourceChallans.length }, { label: "Active / Open", value: activeSource.length }, { label: "Payment Pending", value: sourceChallans.filter((challan) => Number(challan.stage) === 3).length }, { label: "Completed", value: sourceChallans.filter((challan) => Number(challan.stage) === 4).length }], [activeSource.length, sourceChallans]);
  const filtersActive = Object.entries(filters).some(([key, value]) => key !== "sort" && value !== defaultFilters[key]) || filters.sort !== "newest";

  return <section className="history-page">
    <header className="history-page-header"><h2>Party Challan History</h2><p>Search a party to view current and historical Challans.</p></header>
    <HistoryDirectory title="Party" placeholder="Search party name" query={queryText} onQuery={setQueryText} entries={parties} selected={selectedParty} onSelect={(party) => { setSelectedParty(party); setFilters(defaultFilters); }} />
    {!selectedParty ? <EmptyState title="No party selected" text="Search and select a party to view Challan history." /> : <main className="history-main">
      <header className="history-selected-header"><div><small>PARTY</small><h3>{selectedParty}</h3></div><button type="button" onClick={() => setSelectedParty("")}>Change party</button></header>
      <HistorySummary cards={summary} />
      {loadedParty !== selectedParty ? <EmptyState title="Loading Challan history" text="Please wait while Challans are loaded." /> : <>
        <PartyFilters filters={filters} setFilters={setFilters} showReset={filtersActive} />
        <HistoryTable title="Current / Active Challans" subtitle="Stages 1–3" rows={visibleActive} clock={clock} onDetails={setSelectedChallan} active filtered={filtersActive} onReset={() => setFilters(defaultFilters)} />
        <HistoryTable title="Challan History" subtitle={`${visibleChallans.length} of ${sourceChallans.length} Challans`} rows={visibleChallans} clock={clock} onDetails={setSelectedChallan} filtered={filtersActive} onReset={() => setFilters(defaultFilters)} />
      </>}
    </main>}
    {selectedChallan && <ChallanHistoryDetails record={selectedChallan} onClose={() => setSelectedChallan(null)} />}
  </section>;
}

function PartyFilters({ filters, setFilters, showReset }) {
  const update = (key) => (event) => setFilters((current) => ({ ...current, [key]: event.target.value }));
  return <section className="history-filters" aria-label="Challan history filters">
    <input value={filters.search} onChange={update("search")} placeholder="Search Challan number" type="search" />
    <select value={filters.stage} onChange={update("stage")}><option value="all">All stages</option><option value="1">Stage 1 — Goods Out</option><option value="2">Stage 2 — Return / Sale</option><option value="3">Stage 3 — Payment Pending</option><option value="4">Stage 4 — Completed</option></select>
    <select value={filters.date} onChange={update("date")}><option value="all">All dates</option><option value="today">Today</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="custom">Custom date range</option></select>
    {filters.date === "custom" && <><input aria-label="From date" value={filters.from} onChange={update("from")} type="date" /><input aria-label="To date" value={filters.to} onChange={update("to")} type="date" /></>}
    <select value={filters.aging} onChange={update("aging")}><option value="all">All aging</option><option value="green">Green aging</option><option value="yellow">Yellow aging</option><option value="red">Red aging</option></select>
    <select value={filters.sort} onChange={update("sort")}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="number-asc">Challan number: A–Z</option><option value="number-desc">Challan number: Z–A</option><option value="aging-oldest">Oldest active first</option></select>
    {showReset && <button type="button" className="history-reset" onClick={() => setFilters(defaultFilters)}>Reset</button>}
  </section>;
}

function HistoryTable({ title, subtitle, rows, clock, onDetails, active = false, filtered, onReset }) {
  return <section className="history-table-section"><div className="history-section-heading"><h3>{title}</h3><span>{subtitle}</span></div>{rows.length ? <div className="history-table-wrap"><table><thead><tr><th>Challan No.</th><th>Date</th><th>Items</th><th>Total Pieces</th><th>Stage</th>{active && <th>Aging</th>}<th>Details</th></tr></thead><tbody>{rows.map((challan) => {
    const age = active ? challanAging(challan, clock) : null;
    const pieces = (challan.items || []).reduce((total, item) => total + Number(item.pieces || 0), 0);
    return <tr key={challan.id}><td><strong>{challan.number || "—"}</strong></td><td>{formatDate(challan.date)}</td><td>{challan.items?.length || 0}</td><td>{pieces}</td><td><span className={`history-stage stage-${challan.stage}`}>{stageLabel(challan.stage)}</span></td>{active && <td><span className={`history-aging ${age.status}`}>{age.status} · {age.elapsedLabel}</span></td>}<td><button type="button" onClick={() => onDetails(challan)}>Details</button></td></tr>;
  })}</tbody></table></div> : <div className="history-empty"><strong>{filtered ? "No Challans match the selected filters." : active ? "No active Challans found for this party." : "No Challans found for this party."}</strong>{filtered && <button type="button" onClick={onReset}>Clear filters</button>}</div>}</section>;
}
function EmptyState({ title, text }) { return <div className="history-empty"><strong>{title}</strong><p>{text}</p></div>; }
