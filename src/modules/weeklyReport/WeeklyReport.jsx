import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "../../firebase/config";
import "./weeklyReport.css";

const PANELS = ["inventory", "challan", "purchase"];
const localDate = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 10);
};
const mondayFor = (value = new Date()) => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return localDate(date);
};
const dateFor = (key) => new Date(`${key}T00:00:00`);
const weekRange = (monday) => {
  const start = dateFor(monday), end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return { start, end };
};
const eventAt = (entry) => Number(entry.eventAtMs ?? entry.createdAtMs ?? entry.createdAt?.toMillis?.() ?? 0);
const actorId = (entry) => entry.actor?.accessId || entry.accessIdSnapshot || "Unavailable";
const actionKey = (entry) => {
  if (["stage_moved", "return_recorded", "final_invoice_confirmed", "final_settlement_completed"].includes(entry.action)) return "stage_moved";
  if (entry.action === "created") return "created";
  if (entry.action === "edited") return "edited";
  if (entry.action === "deleted") return "deleted";
  return entry.action || "activity";
};
const actionLabel = (entry) => ({ created: "Created", edited: "Edited", deleted: "Deleted", stage_moved: "Stage Move" })[actionKey(entry)] || "Activity";
const snapshot = (entry) => entry.snapshot || entry;
const formatTime = (entry) => {
  const date = new Date(eventAt(entry));
  return { date: date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }), time: date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) };
};
const weekNumber = (monday) => {
  const date = dateFor(monday);
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
  const firstThursday = new Date(date.getFullYear(), 0, 4);
  return 1 + Math.round(((date - firstThursday) / 86400000 - 3 + ((firstThursday.getDay() + 6) % 7)) / 7);
};
const stageText = (entry) => {
  const value = entry.transition || entry.stage || snapshot(entry).stage;
  if (value === undefined || value === null || value === "") return "--";
  return /^\d+$/.test(String(value).trim()) ? `Stage ${value}` : value;
};
const sourceText = (entry) => {
  const source = snapshot(entry).origin ?? entry.origin;
  return source === "Import" ? "Imported" : source === "Manual" ? "Manual" : source || "--";
};
const emptyFilters = { module: "all", action: "all", actor: "all", search: "", sort: "newest" };
const statTone = (label) => ({ Added: "created", Created: "created", Edited: "edited", Deleted: "deleted", "Stage Moves": "stage", "Manual Added": "manual", "Imported Added": "imported", "Unique Purchase IDs": "primary", "Unique Challans": "primary" })[label] || "primary";

export default function WeeklyReport() {
  const [monday, setMonday] = useState(() => mondayFor());
  const [entries, setEntries] = useState([]);
  const [filters, setFilters] = useState(emptyFilters);
  useEffect(() => onSnapshot(query(collection(db, "activityLog"), orderBy("createdAt", "desc")), (snap) => setEntries(snap.docs.map((row) => ({ id: row.id, ...row.data() }))), () => setEntries([])), []);
  const currentMonday = mondayFor();
  const range = useMemo(() => weekRange(monday), [monday]);
  const weekEntries = useMemo(() => entries.filter((entry) => PANELS.includes(entry.panel) && eventAt(entry) >= range.start.getTime() && eventAt(entry) <= range.end.getTime()), [entries, range]);
  const actors = useMemo(() => [...new Set(weekEntries.map(actorId))].sort(), [weekEntries]);
  const filtered = useMemo(() => weekEntries.filter((entry) => {
    const haystack = [entry.recordId, entry.purchaseId, entry.challanNo, entry.partyName, ...Object.values(snapshot(entry) || {})].join(" ").toLowerCase();
    return (filters.module === "all" || entry.panel === filters.module) && (filters.action === "all" || actionKey(entry) === filters.action) && (filters.actor === "all" || actorId(entry) === filters.actor) && haystack.includes(filters.search.toLowerCase());
  }).sort((a, b) => filters.sort === "newest" ? eventAt(b) - eventAt(a) : eventAt(a) - eventAt(b)), [filters, weekEntries]);
  const count = (panel, action) => weekEntries.filter((entry) => entry.panel === panel && (!action || actionKey(entry) === action)).length;
  const moduleRows = (panel) => filtered.filter((entry) => entry.panel === panel);
  const changeWeek = (delta) => {
    const next = dateFor(monday);
    next.setDate(next.getDate() + delta * 7);
    const key = localDate(next);
    if (key <= currentMonday) setMonday(key);
  };
  const hasFilters = Object.entries(filters).some(([key, value]) => value !== emptyFilters[key]);
  const endLabel = range.end.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: range.end.getFullYear() !== range.start.getFullYear() ? "numeric" : undefined });
  return <section className="weekly-report">
    <header className="weekly-heading"><div><h2>Weekly Report</h2><p>Inventory, Purchase and Challan activity for the selected week.</p></div></header>
    <div className="weekly-period"><button onClick={() => changeWeek(-1)}>← Previous Week</button><div><b>WEEK {weekNumber(monday)}</b><strong>{range.start.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })} to {endLabel}</strong></div><div className="weekly-period-actions"><button onClick={() => changeWeek(1)} disabled={monday >= currentMonday}>Next Week →</button><button className="weekly-current" onClick={() => setMonday(currentMonday)}>Current Week / Reset</button></div></div>
    <div className="weekly-summary">{[["Inventory Actions", count("inventory"), "inventory"], ["Purchase Actions", count("purchase"), "purchase"], ["Challan Actions", count("challan"), "challan"], ["Total Actions", weekEntries.length, "total"]].map(([label, value, tone]) => <article className={`weekly-summary--${tone}`} key={label}><span>{label}</span><b>{value}</b></article>)}</div>
    <div className="weekly-filters"><input value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} placeholder="Search SKU, Purchase ID, Challan No., Vendor or Party" /><Select label="Module" value={filters.module} onChange={(value) => setFilters({ ...filters, module: value })} options={[["all", "All Modules"], ["inventory", "Inventory"], ["challan", "Challan"], ["purchase", "Purchase"]]} /><Select label="Action" value={filters.action} onChange={(value) => setFilters({ ...filters, action: value })} options={[["all", "All Actions"], ["created", "Created / Added"], ["edited", "Edited"], ["deleted", "Deleted"], ["stage_moved", "Stage Move"]]} /><Select label="Done By" value={filters.actor} onChange={(value) => setFilters({ ...filters, actor: value })} options={[["all", "All IDs"], ...actors.map((actor) => [actor, actor])]} /><Select label="Sort" value={filters.sort} onChange={(value) => setFilters({ ...filters, sort: value })} options={[["newest", "Newest First"], ["oldest", "Oldest First"]]} />{hasFilters && <button onClick={() => setFilters(emptyFilters)}>Reset Filters</button>}</div>
    {!weekEntries.length ? <p className="weekly-empty">No business activity recorded for this week.</p> : !filtered.length ? <p className="weekly-empty">No activities match the selected filters. <button onClick={() => setFilters(emptyFilters)}>Clear Filters</button></p> : <div className="weekly-sections"><ReportSection title="Inventory" count={count("inventory")} stats={[["Added", count("inventory", "created")], ["Edited", count("inventory", "edited")], ["Deleted", count("inventory", "deleted")], ["Manual Added", weekEntries.filter((entry) => entry.panel === "inventory" && actionKey(entry) === "created" && sourceText(entry) === "Manual").length], ["Imported Added", weekEntries.filter((entry) => entry.panel === "inventory" && actionKey(entry) === "created" && sourceText(entry) === "Imported").length]]} panel="inventory" entries={moduleRows("inventory")} /><ReportSection title="Challan" count={count("challan")} stats={[["Created", count("challan", "created")], ["Edited", count("challan", "edited")], ["Deleted", count("challan", "deleted")], ["Stage Moves", count("challan", "stage_moved")], ["Unique Challans", new Set(weekEntries.filter((entry) => entry.panel === "challan").map((entry) => entry.recordId)).size]]} panel="challan" entries={moduleRows("challan")} /><ReportSection title="Purchase" count={count("purchase")} stats={[["Created", count("purchase", "created")], ["Edited", count("purchase", "edited")], ["Deleted", count("purchase", "deleted")], ["Unique Purchase IDs", new Set(weekEntries.filter((entry) => entry.panel === "purchase").map((entry) => entry.recordId)).size]]} panel="purchase" entries={moduleRows("purchase")} /></div>}
  </section>;
}

const Select = ({ label, value, onChange, options }) => <label className="weekly-select"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}>{options.map(([option, text]) => <option key={option} value={option}>{text}</option>)}</select></label>;
function ReportSection({ title, count, stats, panel, entries }) { const headings = panel === "inventory" ? ["Time", "Action", "Type", "Shape", "Size", "Weight", "SKU", "Source", "Done By"] : panel === "challan" ? ["Time", "Action", "Challan No.", "Party", "Stage / Transition", "Amount", "Done By"] : ["Time", "Action", "Purchase ID", "Vendor", "Amount", "Weight", "Source", "Done By"]; return <article className={`weekly-section weekly-section--${panel}`}><header><div><h3>{title}</h3><p>{count} activities</p></div></header><div className="weekly-mini-stats">{stats.map(([label, value]) => <span className={`weekly-stat--${statTone(label)}`} key={label}>{label}<b>{value}</b></span>)}</div>{entries.length ? <div className="weekly-table-wrap"><table className={`weekly-table--${panel}`}><thead><tr>{headings.map((label) => <th key={label}>{label}</th>)}</tr></thead><tbody>{entries.map((entry) => <EventRow key={entry.id} entry={entry} panel={panel} />)}</tbody></table></div> : <p className="weekly-empty">No activities match the selected filters.</p>}</article>; }
function EventRow({ entry, panel }) { const data = snapshot(entry), time = formatTime(entry), action = actionKey(entry), money = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(data.amount ?? entry.amount ?? 0)), timeCell = <span className="weekly-time"><span>{time.date}</span><small>{time.time}</small></span>, actionCell = <span className={`weekly-action weekly-action--${action}`}>{actionLabel(entry)}</span>; const cells = panel === "inventory" ? [timeCell, actionCell, data.type || "--", data.shape || "--", data.size || "--", `${Number(data.weight || 0).toFixed(3)} ct`, <strong>{data.sku || "--"}</strong>, sourceText(entry), actorId(entry)] : panel === "challan" ? [timeCell, actionCell, <strong>{data.challanNo || entry.challanNo || entry.recordId || "--"}</strong>, data.partyName || entry.partyName || "--", <span className="weekly-stage">{stageText(entry)}</span>, money, actorId(entry)] : [timeCell, actionCell, <strong>{data.purchaseId || entry.purchaseId || entry.recordId || "--"}</strong>, data.partyName || entry.partyName || "--", money, `${Number(data.weight ?? entry.weight ?? 0).toFixed(3)} ct`, sourceText(entry), actorId(entry)]; return <tr>{cells.map((cell, index) => <td key={index}>{cell}</td>)}</tr>; }
