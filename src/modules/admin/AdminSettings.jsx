import { useEffect, useState } from "react";
import { collection, doc, onSnapshot, setDoc, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "../../firebase/config";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
import { createEmployee, generateAccessId, generatePassword, PERMISSIONS } from "../../utils/accessAccounts";
import { INVENTORY_IMPORT_HEADERS } from "../../utils/inventoryRules";
import "./adminSettings.css";

const SETTINGS = doc(db, "settings", "inventory");
const isAdminAccount = (account) => account.role === "superadmin" || account.role === "admin";
const permissionLabels = (account) => PERMISSIONS.filter(([key]) => account.permissions?.includes(key));
const timestampMs = (value) => value?.toMillis?.() ?? (Number(value) || 0);
const formatAccountDate = (value) => {
  const timestamp = timestampMs(value);
  return timestamp ? new Date(timestamp).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "Not recorded";
};

export default function AdminSettings() {
  const [tab, setTab] = useState("access"), [accounts, setAccounts] = useState([]), [accessId, setAccessId] = useState(""), [password, setPassword] = useState(""), [showPassword, setShowPassword] = useState(false), [permissions, setPermissions] = useState([]), [error, setError] = useState(""), [saving, setSaving] = useState(false), [allowDimensionSizes, setAllowDimensionSizes] = useState(false), [createdCredentials, setCreatedCredentials] = useState(null), [copied, setCopied] = useState(""), [deactivateTarget, setDeactivateTarget] = useState(null);
  useEffect(() => onSnapshot(collection(db, "employeeProfiles"), (snapshot) => setAccounts(snapshot.docs.map((row) => row.data()).sort((a, b) => (a.accessId || "").localeCompare(b.accessId || "")))), []);
  useEffect(() => onSnapshot(SETTINGS, (snapshot) => setAllowDimensionSizes(Boolean(snapshot.data()?.allowDimensionSizes))), []);
  const admins = accounts.filter(isAdminAccount), staff = accounts.filter((account) => !isAdminAccount(account)), activeStaff = staff.filter((account) => account.active), inactiveStaff = staff.filter((account) => !account.active).sort((a, b) => timestampMs(b.deactivatedAt || b.accessRevokedAt) - timestampMs(a.deactivatedAt || a.accessRevokedAt));
  const permissionOwner = (key) => activeStaff.find((account) => account.permissions?.includes(key));
  const toggle = (key) => { setError(""); setPermissions((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]); };
  const copy = async (value, key) => { await navigator.clipboard.writeText(value); setCopied(key); window.setTimeout(() => setCopied(""), 1800); };
  const create = async (event) => { event.preventDefault(); setError(""); if (!permissions.length) { setError("Select at least one permission."); return; } setSaving(true); setCreatedCredentials(null); try { const result = await createEmployee({ accessId, password, permissions }); setCreatedCredentials({ accessId: result.accessId, password }); setAccessId(""); setPassword(""); setPermissions([]); setShowPassword(false); } catch (reason) { setError(reason.message || "Could not create employee."); } finally { setSaving(false); } };
  const deactivate = async () => { if (!deactivateTarget) return; await updateDoc(doc(db, "employeeProfiles", deactivateTarget.uid), { active: false, accessRevokedAt: serverTimestamp(), deactivatedAt: serverTimestamp(), updatedAt: serverTimestamp() }); setDeactivateTarget(null); };
  const downloadInventoryTemplate = async () => {
    const XLSX = await import("xlsx"), sheet = XLSX.utils.aoa_to_sheet([INVENTORY_IMPORT_HEADERS]), book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Inventory");
    XLSX.writeFile(book, "inventory-import-template.xlsx");
  };
  return <section className="admin-settings"><header><h2>Settings</h2><p>Access control and Inventory format settings.</p></header><nav className="settings-tabs"><button className={tab === "access" ? "active" : ""} onClick={() => setTab("access")}>Access Management</button><button className={tab === "sku" ? "active" : ""} onClick={() => setTab("sku")}>Inventory SKU Format</button><button className={tab === "templates" ? "active" : ""} onClick={() => setTab("templates")}>Import Templates</button></nav>{tab === "access" ? <><article className="access-create"><h3>Create employee Access ID</h3><p>Create one staff account with at least one assigned permission.</p><form onSubmit={create} autoComplete="off"><div className="credential-fields"><label>Access ID<input name="staff-access-id" autoComplete="off" value={accessId} onChange={(event) => { setError(""); setAccessId(event.target.value); }} placeholder="e.g. rohan01" required /><button type="button" onClick={() => { setError(""); setAccessId(generateAccessId()); }}>Auto generate ID</button></label><label>Password<span className="password-control"><input name="staff-new-password" type={showPassword ? "text" : "password"} autoComplete="new-password" value={password} onChange={(event) => { setError(""); setPassword(event.target.value); }} required /><button className="password-toggle" type="button" onClick={() => setShowPassword((current) => !current)}>{showPassword ? "Hide" : "Show"}</button></span><button type="button" onClick={() => { setError(""); setPassword(generatePassword()); }}>Auto generate password</button></label></div><fieldset><legend>Permissions</legend>{PERMISSIONS.filter(([key]) => !permissionOwner(key)).map(([key, label]) => <label key={key}><input type="checkbox" checked={permissions.includes(key)} onChange={() => toggle(key)} />{label}</label>)}</fieldset>{error && <p className="settings-error">{error}</p>}<button className="settings-primary" disabled={saving}>{saving ? "Creating..." : "Create Access ID"}</button></form></article><AccountSection title="Active Staff Accounts" empty="No active staff accounts yet.">{activeStaff.map((account) => <EmployeeCard key={account.uid} account={account} createdCredentials={createdCredentials} copied={copied} onCopy={copy} onDeactivate={() => setDeactivateTarget(account)} />)}</AccountSection><article className="access-list admin-account-list"><h3>Admin Account</h3>{admins.map((account) => <div className="access-account superadmin-account" key={account.uid}><header><div><b>{account.accessId}</b><small>Administrator</small></div><span>All access</span></header><p>This account always has every permission.</p><div className="permission-list">{PERMISSIONS.map(([, label]) => <span className="permission-chip" key={label}>{label}</span>)}</div></div>)}</article><AccountSection title="Past / Inactive Staff Accounts" empty="No inactive staff account history.">{inactiveStaff.map((account) => <EmployeeCard key={account.uid} account={account} historical />)}</AccountSection></> : tab === "templates" ? <ImportTemplates onDownload={downloadInventoryTemplate} /> : <article className="sku-settings"><div><h3>Dimension-style Inventory SKU format</h3><p>Allow Inventory sizes such as 4.3X2.0. This uses the existing Inventory setting.</p></div><label className="admin-toggle"><input type="checkbox" checked={allowDimensionSizes} onChange={(event) => setDoc(SETTINGS, { allowDimensionSizes: event.target.checked }, { merge: true })} /><span>{allowDimensionSizes ? "Enabled" : "Disabled"}</span></label></article>}{deactivateTarget && <ConfirmDialog title="Deactivate Account?" confirmLabel="Deactivate Account" destructive onConfirm={deactivate} onCancel={() => setDeactivateTarget(null)}><p>You are about to deactivate:</p><b>{deactivateTarget.accessId}</b><p>This staff member will have 2 minutes to save their current work before they are automatically logged out.</p></ConfirmDialog>}</section>;
}
function AccountSection({ title, children, empty }) { const hasAccounts = Boolean(children?.length); return <article className="access-list account-section"><h3>{title}</h3>{hasAccounts ? children : <p>{empty}</p>}</article>; }
function EmployeeCard({ account, createdCredentials, copied, onCopy, onDeactivate, historical = false }) {
  const isNew = createdCredentials?.accessId === account.accessId, [showPassword, setShowPassword] = useState(false), assigned = permissionLabels(account), password = isNew ? createdCredentials.password : "", deactivatedAt = account.deactivatedAt || account.accessRevokedAt;
  return <div className={"access-account staff-account" + (historical ? " inactive" : "")}><header><div><b>{account.accessId}</b><small>Staff account</small></div><span>{historical ? "Inactive" : "Active"}</span></header><div className="account-dates"><span>Created <b>{formatAccountDate(account.createdAt)}</b></span>{historical && <span>Deactivated <b>{formatAccountDate(deactivatedAt)}</b></span>}</div>{!historical && <section className="staff-credentials"><small>Login credentials</small><div className="credential-row"><span><small>Staff ID</small><b>{account.accessId}</b></span><button type="button" onClick={() => onCopy(account.accessId, "id-" + account.uid)}>{copied === "id-" + account.uid ? "Copied" : "Copy"}</button></div><div className="credential-row"><span><small>Password</small>{password ? <b className="credential-password">{showPassword ? password : "••••••••"}</b> : <em>Password is available only when this account is created.</em>}</span>{password && <div><button type="button" onClick={() => setShowPassword((current) => !current)}>{showPassword ? "Hide" : "Show"}</button><button type="button" onClick={() => onCopy(password, "password-" + account.uid)}>{copied === "password-" + account.uid ? "Copied" : "Copy"}</button></div>}</div></section>}<div className="staff-permissions"><small>Assigned permissions</small>{assigned.length ? <div className="permission-chips">{assigned.map(([, label]) => <span className="permission-chip" key={label}>{label}</span>)}</div> : <p className="permission-empty">No permissions assigned</p>}</div>{!historical && <button className="settings-delete" onClick={onDeactivate}>Deactivate account</button>}</div>;
}
function ImportTemplates({ onDownload }) {
  const [inventoryOpen, setInventoryOpen] = useState(true);
  return (
    <article className="import-templates">
      <h3>Import Templates</h3>
      <p>
        Download the blank Excel template, fill it from row 2, then upload it
        using Inventory’s existing Import action.
      </p>
      <section className={`import-template-card ${inventoryOpen ? "is-open" : ""}`}>
        <button
          type="button"
          className="import-template-toggle"
          aria-expanded={inventoryOpen}
          aria-controls="inventory-import-template-content"
          onClick={() => setInventoryOpen((open) => !open)}
        >
          <span>
            <h4>Inventory</h4>
            <p>Blank workbook with the exact headers used by Inventory Import.</p>
          </span>
          <span className="import-template-chevron" aria-hidden="true" />
        </button>
        {inventoryOpen && <div id="inventory-import-template-content" className="import-template-content">
          <button type="button" className="settings-primary" onClick={onDownload}>
            Download Sample Excel
          </button>
          <div className="import-template-rules">
          <RuleSection title="Excel Columns">
            <div className="import-header-chips">
              {INVENTORY_IMPORT_HEADERS.map((header) => <span key={header}>{header}</span>)}
            </div>
            <p className="import-rule-note">Keep these column names exactly as shown. Keep the same order for easiest use.</p>
          </RuleSection>
          <RuleSection title="Required Fields">
            <ul>
              <li><b>Shape</b> — Enter a shape. This field cannot be blank.</li>
              <li><b>Type</b> — Enter only <b>CVD</b> or <b>HP</b>.</li>
              <li><b>Size (mm)</b> — Enter the stone size in millimetres.</li>
              <li><b>Weight (ct)</b> — Enter the weight in carats. It must be greater than 0.</li>
            </ul>
          </RuleSection>
          <RuleSection title="Optional Field">
            <ul><li><b>BOX</b> — Leave it blank if not needed, or enter a box code such as <b>AB29</b>.</li></ul>
          </RuleSection>
          <RuleSection title="Size Format">
            <ul>
              <li>For a normal size, enter a positive value such as <b>2.3</b>.</li>
              <li>Dimension sizes such as <b>4.3X2.0</b> can be used only when enabled in <b>Inventory SKU Format</b>.</li>
              <li>Use an uppercase <b>X</b> with no spaces for dimension sizes.</li>
            </ul>
          </RuleSection>
          <RuleSection title="Weight Format">
            <ul><li>Enter numbers only. Weight must be greater than <b>0</b>; do not add <b>ct</b> inside the Excel cell.</li></ul>
          </RuleSection>
          <RuleSection title="Automatically Generated">
            <ul><li><b>SKU</b> is generated automatically.</li><li><b>Group</b> is generated automatically.</li><li>Do not add SKU or Group columns to the template.</li></ul>
          </RuleSection>
          <RuleSection title="Duplicate Records">
            <ul><li>Rows that generate a duplicate SKU are rejected, including duplicates in the same Excel file.</li></ul>
          </RuleSection>
          <RuleSection title="Before You Upload" className="before-upload">
            <ul>
              <li>Do not change the Excel column names.</li>
              <li>Make sure all required fields are filled.</li>
              <li>Use only CVD or HP for Type.</li>
              <li>Check Size and Weight values before uploading.</li>
              <li>Remove duplicate rows and save the file as <b>.xlsx</b>.</li>
            </ul>
          </RuleSection>
          </div>
        </div>}
      </section>
    </article>
  );
}
function RuleSection({ title, className = "", children }) {
  return <section className={`import-rule-section ${className}`}><h5>{title}</h5>{children}</section>;
}


