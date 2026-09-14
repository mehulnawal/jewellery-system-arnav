import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "../../firebase/config";
import "./activityLog.css";

const PANELS = ["Inventory", "Challan", "Purchase"];
const STAGES = ["Stage 1", "Stage 2", "Stage 3", "Stage 4"];
const localDateKey = (value) => { const date = value?.toDate?.() ?? (value instanceof Date ? value : new Date(value ?? Date.now())), offset = date.getTimezoneOffset(); return Number.isNaN(date.getTime()) ? "" : new Date(date.getTime() - offset * 60000).toISOString().slice(0, 10); };
const today = () => localDateKey(new Date());
const asDate = (value) => new Date(value + "T00:00:00");
const eventTimestampMs = (entry) => Number(entry?.eventAtMs ?? entry?.createdAtMs ?? entry?.createdAt?.toMillis?.() ?? 0);
const loginTimestampMs = (entry) => Number(entry?.firstLoginAtMs ?? 0);
const eventDate = (entry) => localDateKey(entry?.eventAtMs ?? entry?.createdAtMs ?? entry?.createdAt);
const formatTime = (value) => Number(value) ? new Date(Number(value)).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true }) : "—";
const eventTime = (entry) => formatTime(eventTimestampMs(entry));
const loginTime = (entry) => formatTime(loginTimestampMs(entry));
const isStaffProfile = (profile) => String(profile?.role || "").toLowerCase() === "employee";
const actorId = (entry) => entry.actor?.accessId || entry.accessIdSnapshot || "Unavailable";
const actorKey = (entry) => entry.actor?.uid || actorId(entry);
const roleLabel = (entry, profile) => profile?.role || entry.actor?.role || "employee";
const value = (input) => input === undefined || input === null || input === "" ? "—" : input;
const numberValue = (input) => input === undefined || input === null || input === "" ? "—" : Number(input).toLocaleString(undefined, { maximumFractionDigits: 3 });
const stageForEntry = (entry) => { const raw = entry?.stage ?? entry?.snapshot?.stage ?? entry?.stage2Return?.stage ?? "", hits = String(raw).match(/Stage\s*\d/g); if (hits?.length) return hits[hits.length - 1].replace(/Stage\s*/, "Stage "); const number = Number(raw); return Number.isInteger(number) && number >= 1 && number <= 4 ? "Stage " + number : ""; };
const sourceLabel = (entry) => { const origin = entry.snapshot?.origin ?? entry.origin; if (origin === "Import") return "Imported"; if (origin === "Manual") return "Manually Created"; return value(origin); };
const columnsFor = (panel) => {
  if (panel === "inventory") return [
    ["Timestamp", eventTime],
    ["Shape (Type)", (entry) => { const shape = entry.snapshot?.shape ?? entry.shape, type = entry.snapshot?.type ?? entry.type; return shape && type ? `${shape} (${type})` : value(shape || type); }],
    ["Weight", (entry) => numberValue(entry.snapshot?.weight ?? entry.weight)],
    ["SKU", (entry) => value(entry.snapshot?.sku ?? entry.sku)],
    ["Source", sourceLabel],
  ];
  if (panel === "challan") return [
    ["Timestamp", eventTime],
    ["Challan Number", (entry) => value(entry.snapshot?.challanNo ?? entry.challanNo)],
    ["Party Name", (entry) => value(entry.snapshot?.partyName ?? entry.partyName)],
    ["Amount", (entry) => numberValue(entry.snapshot?.amount ?? entry.amount)],
  ];
  return [
    ["Timestamp", eventTime],
    ["Party Name", (entry) => value(entry.snapshot?.partyName ?? entry.partyName)],
    ["Amount", (entry) => numberValue(entry.snapshot?.amount ?? entry.amount)],
    ["Weight", (entry) => numberValue(entry.snapshot?.weight ?? entry.weight)],
    ["ID", (entry) => value(entry.snapshot?.purchaseId ?? entry.snapshot?.id ?? entry.purchaseId ?? entry.recordId)],
  ];
};
const groupByActor = (entries) => { const groups = new Map(); entries.forEach((entry) => { const key = actorKey(entry); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(entry); }); return [...groups.entries()]; };
const escapeHtml = (input) => String(input ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);

export default function ActivityLog() {
  const [selectedDate, setSelectedDate] = useState(today), [entries, setEntries] = useState([]), [firstLogins, setFirstLogins] = useState([]), [profiles, setProfiles] = useState([]), [open, setOpen] = useState({}), [loading, setLoading] = useState(true);
  useEffect(() => onSnapshot(query(collection(db, "activityLog"), orderBy("createdAt", "desc")), (snap) => { setEntries(snap.docs.map((row) => ({ id: row.id, ...row.data() }))); setLoading(false); }, () => setLoading(false)), []);
  useEffect(() => onSnapshot(collection(db, "activityLogFirstLogins"), (snap) => setFirstLogins(snap.docs.map((row) => ({ id: row.id, ...row.data() }))), () => setFirstLogins([])), []);
  useEffect(() => onSnapshot(collection(db, "employeeProfiles"), (snap) => setProfiles(snap.docs.map((row) => ({ id: row.id, ...row.data() }))), () => setProfiles([])), []);
  const profileByUid = useMemo(() => Object.fromEntries(profiles.map((profile) => [profile.uid || profile.id, profile])), [profiles]);
  const daily = useMemo(() => entries.filter((entry) => eventDate(entry) === selectedDate).sort((a, b) => eventTimestampMs(b) - eventTimestampMs(a)), [entries, selectedDate]);
  const dailyStaffLogins = useMemo(() => firstLogins.filter((entry) => entry.day === selectedDate && isStaffProfile(profileByUid[entry.actor?.uid])).sort((a, b) => loginTimestampMs(a) - loginTimestampMs(b)), [firstLogins, profileByUid, selectedDate]);
  const loginByUid = useMemo(() => Object.fromEntries(dailyStaffLogins.map((entry) => [entry.actor?.uid, entry])), [dailyStaffLogins]);
  const panelEntries = (panel) => daily.filter((entry) => entry.panel === panel);
  const toggle = (key) => setOpen((current) => ({ ...current, [key]: !current[key] }));
  const changeDay = (delta) => { const next = asDate(selectedDate); next.setDate(next.getDate() + delta); const key = localDateKey(next); if (key <= today()) setSelectedDate(key); };
  const exportSheet = (XLSX, book, name, panel, rows) => { const columns = columnsFor(panel), values = rows.map((entry) => Object.fromEntries(columns.map(([label, read]) => [label, read(entry)]))), sheet = XLSX.utils.json_to_sheet(values.length ? values : [{ [columns[0][0]]: "No activity for this date." }]); XLSX.utils.book_append_sheet(book, sheet, name); };
  const exportExcel = async () => { const XLSX = await import("xlsx"), book = XLSX.utils.book_new(), challan = panelEntries("challan"); exportSheet(XLSX, book, "Inventory", "inventory", panelEntries("inventory")); STAGES.forEach((stage) => { exportSheet(XLSX, book, `Challan ${stage.replace("Stage ", "S")}`, "challan", challan.filter((entry) => stageForEntry(entry) === stage)); }); exportSheet(XLSX, book, "Purchase", "purchase", panelEntries("purchase")); XLSX.writeFile(book, "activity-log-" + selectedDate + ".xlsx"); };
  const printTable = (panel, rows) => { const columns = columnsFor(panel), body = rows.map((entry) => "<tr>" + columns.map(([, read]) => "<td>" + escapeHtml(read(entry)) + "</td>").join("") + "</tr>").join("") || "<tr><td colspan=\"" + columns.length + "\">No activity for this date.</td></tr>"; return "<table><thead><tr>" + columns.map(([label]) => "<th>" + escapeHtml(label) + "</th>").join("") + "</tr></thead><tbody>" + body + "</tbody></table>"; };
  const printLog = () => { const popup = window.open("", "_blank", "width=1050,height=800"); if (!popup) return; const inventory = panelEntries("inventory"), challan = panelEntries("challan"), purchase = panelEntries("purchase"), challanSections = STAGES.map((stage) => { const rows = challan.filter((entry) => stageForEntry(entry) === stage); return "<h3>" + stage + "</h3>" + printTable("challan", rows); }).join(""); popup.document.write("<!doctype html><html><head><title>Activity Log</title><style>body{font-family:Arial;color:#172033;margin:24px}h1{margin-bottom:4px}h2{border-bottom:2px solid #172033;margin:32px 0 12px;padding-bottom:6px}h3{margin:20px 0 8px}table{border-collapse:collapse;width:100%;margin-bottom:24px}th,td{border:1px solid #94a3b8;padding:8px;text-align:left}th{background:#eef2f7}</style></head><body><h1>Activity Log</h1><p>Date: " + escapeHtml(selectedDate) + "</p><h2>Inventory</h2>" + printTable("inventory", inventory) + "<h2>Challan</h2>" + challanSections + "<h2>Purchase</h2>" + printTable("purchase", purchase) + "</body></html>"); popup.document.close(); popup.focus(); window.setTimeout(() => popup.print(), 250); };
  return <section className="activity-module"><header className="activity-heading"><div><h2>Activity Log</h2><p>Immutable daily history for Inventory, Challan and Purchase</p></div><div className="activity-actions"><button onClick={printLog}><Icon name="print" />Print</button><button onClick={exportExcel}><Icon name="export" />Export</button></div></header>{loading && <p className="activity-empty">Loading activity...</p>}<div className="activity-datebar"><button onClick={() => changeDay(-1)} aria-label="Previous day"><span className="activity-back"><Icon /></span></button><label><input type="date" value={selectedDate} max={today()} onChange={(event) => setSelectedDate(event.target.value)} /></label><button onClick={() => changeDay(1)} disabled={selectedDate >= today()} aria-label="Next day"><Icon /></button><button className="activity-today" onClick={() => setSelectedDate(today())}>Today</button><strong>{asDate(selectedDate).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })}</strong></div><div className="activity-metrics"><article><span>ENTRIES</span><strong>{daily.length}</strong></article></div><div className="activity-panels">{PANELS.map((panel) => panel === "Challan" ? <ChallanPanel key={panel} entries={panelEntries("challan")} profileByUid={profileByUid} loginByUid={loginByUid} open={open} toggle={toggle} /> : <Panel key={panel} title={panel} panel={panel.toLowerCase()} entries={panelEntries(panel.toLowerCase())} profileByUid={profileByUid} loginByUid={loginByUid} open={open[panel]} toggle={() => toggle(panel)} />)}</div></section>;
}
const Icon = ({ name = "chevron" }) => <svg className="activity-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{name === "chevron" && <path d="m9 18 6-6-6-6" />}{name === "print" && <><path d="M7 8V3.5h10V8M7 17H5V10.5h14V17h-2" /><path d="M7 14h10v6.5H7z" /></>}{name === "export" && <><path d="M12 3v12m0 0 4.5-4.5M12 15l-4.5-4.5" /><path d="M5 19.5V21h14v-1.5" /></>}</svg>;
function Panel({ title, panel, entries, profileByUid, loginByUid, open, toggle }) { return <article className="activity-panel"><button className={"activity-panel-head " + (open ? "is-open" : "")} onClick={toggle}><i><Icon /></i>{title}<b>{entries.length}</b></button>{open && <EntryList panel={panel} entries={entries} profileByUid={profileByUid} loginByUid={loginByUid} />}</article>; }
function ChallanPanel({ entries, profileByUid, loginByUid, open, toggle }) { return <article className="activity-panel"><button className={"activity-panel-head " + (open.Challan ? "is-open" : "")} onClick={() => toggle("Challan")}><i><Icon /></i>Challan<b>{entries.length}</b></button>{open.Challan && <div className="activity-stages">{STAGES.map((stage) => { const key = "challan-" + stage, stageEntries = entries.filter((entry) => stageForEntry(entry) === stage); return <div key={stage}><button className={"activity-stage " + (open[key] ? "is-open" : "")} onClick={() => toggle(key)}><i><Icon /></i>{stage}<b>{stageEntries.length}</b></button>{open[key] && <EntryList panel="challan" entries={stageEntries} profileByUid={profileByUid} loginByUid={loginByUid} />}</div>; })}</div>}</article>; }
function EntryList({ panel, entries, profileByUid, loginByUid }) { if (!entries.length) return <p className="activity-empty">No entries for this section on this day.</p>; const columns = columnsFor(panel); return <div className="activity-entries">{groupByActor(entries).map(([key, actorEntries]) => { const entry = actorEntries[0], profile = profileByUid[entry.actor?.uid], staff = isStaffProfile(profile), login = staff ? loginByUid[entry.actor?.uid] : null; return <section className="activity-actor" key={key}><div className="activity-actor-meta"><span>Access ID <b>{actorId(entry)}</b></span><span>Role <b>{roleLabel(entry, profile)}</b></span>{staff && <span>First Login Time <b>{login ? loginTime(login) : "Not recorded"}</b></span>}</div><div className="activity-table-wrap"><table className="activity-table"><thead><tr>{columns.map(([label]) => <th key={label}>{label}</th>)}</tr></thead><tbody>{actorEntries.map((activity) => <tr key={activity.id}>{columns.map(([label, read]) => <td key={label}>{read(activity)}</td>)}</tr>)}</tbody></table></div></section>; })}</div>; }