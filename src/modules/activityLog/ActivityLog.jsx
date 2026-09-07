import { useEffect, useMemo, useState } from 'react'
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore'
import { db } from '../../firebase/config'
import { formatDecimal } from '../../utils/inventoryRules'
import './activityLog.css'

const PANELS = ['Inventory', 'Challan', 'Purchase']
const STAGES = ['Stage 1', 'Stage 2', 'Stage 3', 'Stage 4']
const localDateKey = value => { const date = value?.toDate?.() ?? (value instanceof Date ? value : new Date(value ?? Date.now())); const offset = date.getTimezoneOffset(); return Number.isNaN(date.getTime()) ? '' : new Date(date.getTime() - offset * 60000).toISOString().slice(0, 10) }
const today = () => localDateKey(new Date())
const asDate = iso => new Date(`${iso}T00:00:00`)
const eventDate = entry => localDateKey(entry.eventAtMs ?? entry.createdAtMs ?? entry.createdAt)
const dateOf = entry => new Date(entry.eventAtMs ?? entry.createdAtMs ?? entry.createdAt?.toMillis?.() ?? 0)
const time = entry => dateOf(entry).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })
const firstLoginTime = entry => new Date(entry.firstLoginAtMs ?? entry.eventAtMs ?? entry.createdAtMs ?? 0).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })
const money = value => `?${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
const Icon = ({ name = 'chevron' }) => <svg className="activity-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{name === 'chevron' && <path d="m9 18 6-6-6-6"/>}{name === 'print' && <><path d="M7 8V3.5h10V8M7 17H5V10.5h14V17h-2"/><path d="M7 14h10v6.5H7z"/></>}{name === 'export' && <><path d="M12 3v12m0 0 4.5-4.5M12 15l-4.5-4.5"/><path d="M5 19.5V21h14v-1.5"/></>}</svg>

export default function ActivityLog() {
  const [selectedDate, setSelectedDate] = useState(today), [entries, setEntries] = useState([]), [loading, setLoading] = useState(true), [open, setOpen] = useState({})
  useEffect(() => onSnapshot(query(collection(db, 'activityLog'), orderBy('createdAt', 'desc')), snap => { setEntries(snap.docs.map(row => ({ id: row.id, ...row.data() }))); setLoading(false) }, () => setLoading(false)), [])
  const daily = useMemo(() => entries.filter(entry => eventDate(entry) === selectedDate).sort((a, b) => dateOf(b) - dateOf(a)), [entries, selectedDate])
  const toggle = key => setOpen(current => ({ ...current, [key]: !current[key] }))
  const exportExcel = async () => {
    const XLSX = await import('xlsx')
    const rows = daily.map(entry => {
      const snap = entry.snapshot || entry
      const changes = (entry.changes || []).map(change => `${change.field}: ${change.oldValue || '—'} → ${change.newValue || '—'}`).join(' | ')
      return {
        Date: selectedDate,
        'Panel / Head': entry.panel === 'challan' ? 'Challan' : entry.panel === 'purchase' ? 'Purchase' : 'Inventory',
        'Challan Stage': entry.stage || '—',
        Timestamp: time(entry),
        'Access ID': entry.accessIdSnapshot || entry.actor?.accessId || 'Unavailable',
        'First Login Time': firstLoginTime(entry),
        'Activity State': entry.action === 'deleted' ? 'Deleted' : entry.action === 'edited' ? 'Edited' : 'Normal',
        'Shape (Type)': entry.panel === 'inventory' ? `${snap.shape || ''} (${snap.type || ''})` : '—',
        'Weight (ct)': snap.weight ?? '—',
        SKU: snap.sku || '—',
        Tag: snap.origin || '—',
        'Challan No.': snap.challanNo || '—',
        'Party Name': snap.partyName || '—',
        Amount: snap.amount ?? '—',
        'Record ID': entry.recordId || '—',
        'Edit History (Old → New)': changes || '—',
      }
    })
    const sheet = XLSX.utils.json_to_sheet(rows)
    sheet['!cols'] = [14, 18, 18, 14, 20, 20, 16, 22, 14, 18, 14, 18, 20, 16, 42].map(wch => ({ wch }))
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, sheet, 'Activity Log')
    XLSX.writeFile(book, `activity-log-${selectedDate}.xlsx`)
  }
const printLog = () => {
    const printWindow = window.open('', '_blank', 'width=1100,height=800')
    if (!printWindow) { window.alert('Please allow pop-ups to print the Activity Log.'); return }
    const escape = value => String(value ?? '—').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character]))
    const body = daily.map(entry => {
      const snap = entry.snapshot || entry
      const panel = entry.panel === 'challan' ? 'Challan' : entry.panel === 'purchase' ? 'Purchase' : 'Inventory'
      const detail = entry.panel === 'inventory' ? `${snap.shape || ''} (${snap.type || ''}) · ${formatDecimal(snap.weight)} ct · ${snap.sku || '—'} · ${snap.origin || 'Manual'}` : entry.panel === 'purchase' ? `${snap.partyName || '—'} · ${money(snap.amount)} · ${formatDecimal(snap.weight)} ct · ${entry.recordId || '—'}` : `${snap.challanNo || '—'} · ${snap.partyName || '—'} · ${money(snap.amount)}`
      const history = (entry.changes || []).map(change => `${change.field}: ${change.oldValue || '—'} → ${change.newValue || '—'}`).join('<br>') || '—'
      return `<tr><td>${escape(panel)}</td><td>${escape(entry.stage || '—')}</td><td>${escape(time(entry))}</td><td>${escape(entry.accessIdSnapshot || entry.actor?.accessId || 'Unavailable')}</td><td>${escape(firstLoginTime(entry))}</td><td>${escape(entry.action === 'deleted' ? 'Deleted' : entry.action === 'edited' ? 'Edited' : 'Normal')}</td><td>${escape(detail)}</td><td>${history}</td></tr>`
    }).join('') || '<tr><td colspan="8">No Activity Log entries for this date.</td></tr>'
    printWindow.document.write(`<!doctype html><html><head><title>Activity Log - ${selectedDate}</title><style>body{font-family:Arial,sans-serif;color:#111827;margin:28px}h1{margin:0;font-size:25px}p{color:#4b5563;margin:7px 0 22px}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #cbd5e1;padding:9px;text-align:left;vertical-align:top}th{background:#eaf7f1;color:#065f46;font-size:11px;text-transform:uppercase}tr:nth-child(even){background:#f8fafc}@page{margin:14mm}@media print{body{margin:0}}</style></head><body><h1>Activity Log</h1><p>Date: ${selectedDate} · Complete selected-day report</p><table><thead><tr><th>Panel / Head</th><th>Stage</th><th>Timestamp</th><th>Access ID</th><th>First Login</th><th>State</th><th>Activity Details</th><th>Edit History</th></tr></thead><tbody>${body}</tbody></table></body></html>`)
    printWindow.document.close()
    printWindow.focus()
    window.setTimeout(() => printWindow.print(), 250)
  }
  const changeDay = delta => { const next = asDate(selectedDate); next.setDate(next.getDate() + delta); const key = localDateKey(next); if (key <= today()) setSelectedDate(key) }
  return <section className="activity-module"><header className="activity-heading"><div><h2>Activity Log</h2><p>Immutable daily history for Inventory, Challan and Purchase</p></div><div className="activity-actions"><button onClick={printLog}><Icon name="print"/>Print</button><button onClick={exportExcel}><Icon name="export"/>Export</button></div></header>{loading && <p className="activity-empty">Loading activity...</p>}<div className="activity-datebar"><button onClick={() => changeDay(-1)} aria-label="Previous day"><span className="activity-back"><Icon/></span></button><label><input type="date" value={selectedDate} max={today()} onChange={event => setSelectedDate(event.target.value)}/></label><button onClick={() => changeDay(1)} disabled={selectedDate >= today()} aria-label="Next day"><Icon/></button><button className="activity-today" onClick={() => setSelectedDate(today())}>Today</button><strong>{asDate(selectedDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</strong></div><div className="activity-metrics"><article><span>ENTRIES</span><strong>{daily.length}</strong></article></div><div className="activity-panels">{PANELS.map(panel => panel === 'Challan' ? <Challan key={panel} entries={daily.filter(entry => entry.panel === 'challan')} open={open} toggle={toggle}/> : <Panel key={panel} title={panel} entries={daily.filter(entry => entry.panel === panel.toLowerCase())} open={open[panel]} toggle={() => toggle(panel)}/>)}</div></section>
}
function Panel({ title, entries, open, toggle }) { return <article className="activity-panel"><button className={`activity-panel-head ${open ? 'is-open' : ''}`} onClick={toggle}><i><Icon/></i>{title}<b>{entries.length}</b></button>{open && <EntryList panel={title.toLowerCase()} entries={entries}/>}</article> }
function Challan({ entries, open, toggle }) { return <article className="activity-panel"><button className={`activity-panel-head ${open.Challan ? 'is-open' : ''}`} onClick={() => toggle('Challan')}><i><Icon/></i>Challan<b>{entries.length}</b></button>{open.Challan && <div className="activity-stages">{STAGES.map(stage => { const key = `challan-${stage}`, stageEntries = entries.filter(entry => entry.stage === stage || entry.stage === stage.replace('Stage ', '')); return <div key={stage}><button className={`activity-stage ${open[key] ? 'is-open' : ''}`} onClick={() => toggle(key)}><i><Icon/></i>{stage}<b>{stageEntries.length}</b></button>{open[key] && <EntryList panel="challan" entries={stageEntries}/>}</div> })}</div>}</article> }
function EntryList({ panel, entries }) {
  if (!entries.length) return <p className="activity-empty">No entries for this section on this day.</p>
  const groups = entries.reduce((all, entry) => { const key = `${entry.actor?.uid || entry.accessIdSnapshot || 'legacy'}_${entry.firstLoginAtMs || 0}`; (all[key] ||= []).push(entry); return all }, {})
  return <div className="activity-entries">{Object.values(groups).map(group => <section className="activity-actor" key={group[0].id}><div className="activity-actor-meta"><span>Access ID <b>{group[0].accessIdSnapshot || group[0].actor?.accessId || 'Unavailable'}</b></span><span>First Login Time <b>{firstLoginTime(group[0])}</b></span></div><div className="activity-table-wrap"><table className="activity-table"><thead><tr>{headers(panel).map(header => <th key={header}>{header}</th>)}</tr></thead><tbody>{group.map(entry => <ActivityRow key={entry.id} panel={panel} entry={entry}/>)}</tbody></table></div></section>)}</div>
}
const headers = panel => panel === 'inventory' ? ['Timestamp', 'Shape (Type)', 'Weight', 'SKU', 'Tag'] : panel === 'purchase' ? ['Timestamp', 'Party Name', 'Amount', 'Weight', 'ID'] : ['Timestamp', 'Challan No.', 'Party Name', 'Amount']
function ActivityRow({ panel, entry }) { const snap = entry.snapshot || entry; const values = panel === 'inventory' ? [time(entry), `${snap.shape || ''} (${snap.type || ''})`, `${formatDecimal(snap.weight)} ct`, snap.sku || '', snap.origin || 'Manual'] : panel === 'purchase' ? [time(entry), snap.partyName || '', money(snap.amount), `${formatDecimal(snap.weight)} ct`, entry.recordId || entry.id] : [time(entry), snap.challanNo || '', snap.partyName || '', money(snap.amount)]; return <><tr className={entry.action === 'deleted' ? 'is-deleted' : entry.action === 'edited' ? 'is-edited' : ''}>{values.map((value, index) => <td key={index}>{value}{index === 0 && entry.action !== 'created' && <span className={`activity-badge ${entry.action}`}>{entry.action === 'deleted' ? 'Deleted' : 'Edited'}</span>}</td>)}</tr>{entry.action === 'edited' && <tr className="activity-change-row"><td colSpan={values.length}><EditHistory changes={entry.changes || []}/></td></tr>}</> }
function EditHistory({ changes }) { return <div className="activity-changes">{changes.map(change => <div className="activity-change" key={change.field}><span><small>{change.field}</small>{String(change.oldValue || '—')}</span><i/><b><small>{change.field}</small>{String(change.newValue || '—')}</b></div>)}</div> }