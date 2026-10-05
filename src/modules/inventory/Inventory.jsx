import { useInventoryDiscovery } from '../../hooks/useInventoryDiscovery.js';
import { deleteDoc, updateDoc } from "../../firebase/businessWrites.js";
import { canonicalSku, canonicalInventoryIdentity } from "../../utils/dimensions.js";
import { saveInventoryIdentity } from "../../utils/inventoryIdentity.js";
import { auditDimensions } from "../../utils/dimensionAudit.js";
import { useEffect, useMemo, useRef, useState } from "react";
import { collection, doc, getDocFromServer, onSnapshot, serverTimestamp } from "firebase/firestore";
import { useLocation, useNavigate } from "react-router-dom";
import { db } from "../../firebase/config";
import { useAuth } from "../../auth/AuthContext";
import { useToast } from "../../ui/ToastContext";
import { getAgeingColor, getAgeingDays } from "../../config/ageingConfig";
import { writeInventoryActivity } from "../../utils/activityLog";
import { inventoryFieldError, inventorySaveErrorMessage } from "../../utils/inventoryForm.js";
import { usePageFreeze } from "../../hooks/usePageFreeze";
import {
  DEFAULT_SHAPES,
  INVENTORY_SHAPES,
  INVENTORY_IMPORT_FIELD_HEADERS,
  formatDecimal,
  inventoryMatchesSearch,
  isValidBox,
  isValidSize,
  normalizeBox,
  normalizeSize,
  orderShapes,
  sizeSortValue,
} from "../../utils/inventoryRules";
import "./inventory.css";

const INVENTORY = "inventory",
  SHAPES = "shapes",
  LEGACY_SHAPES = INVENTORY_SHAPES,
  SETTINGS = doc(db, "settings", "inventory");
export const SIZE_TO_GROUP_MAP = [];
const STAFF_EDIT_WINDOW_MS = 2 * 60 * 1000;
const norm = (value) => String(value ?? "").trim();
const title = (value) =>
  norm(value).replace(/\b\w/g, (character) => character.toUpperCase());
const age = (item) => getAgeingDays(item.createdAt, item.createdAtMs);
const createdAtMs = (item) => item.createdAt?.toMillis?.() ?? 0;
const editTimeRemaining = (item, clock) =>
  Math.max(0, createdAtMs(item) + STAFF_EDIT_WINDOW_MS - clock);
const formatEditTime = (milliseconds) => {
  const seconds = Math.ceil(milliseconds / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(
    seconds % 60,
  ).padStart(2, "0")}`;
};
const group = (size) =>
  SIZE_TO_GROUP_MAP.find(
    (item) =>
      sizeSortValue(size) >= item.min && sizeSortValue(size) <= item.max,
  )?.group ?? "Uncategorized";
const sku = canonicalSku;
const Icon = ({ n }) => (
  <svg
    className="inventory-svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {n === "search" && (
      <>
        <circle cx="10.8" cy="10.8" r="6.2" />
        <path d="m16 16 4 4" />
      </>
    )}
    {n === "upload" && (
      <>
        <path d="M12 15V3m0 0L7.5 7.5M12 3l4.5 4.5" />
        <path d="M5 14.5V20h14v-5.5" />
      </>
    )}
    {n === "download" && (
      <>
        <path d="M12 3v12m0 0 4.5-4.5M12 15l-4.5-4.5" />
        <path d="M5 19.5V21h14v-1.5" />
      </>
    )}
    {n === "print" && (
      <>
        <path d="M7 8V3.5h10V8M7 17H5V10.5h14V17h-2" />
        <path d="M7 14h10v6.5H7z" />
      </>
    )}
    {n === "plus" && <path d="M12 5v14M5 12h14" />}
    {n === "down" && <path d="m6 9 6 6 6-6" />}
    {n === "right" && <path d="m9 6 6 6-6 6" />}
    {n === "check" && <path d="m5 12 4.2 4.2L19 6.8" />}
    {n === "close" && <path d="m6 6 12 12M18 6 6 18" />}
    {n === "edit" && (
      <>
        <path d="m14.5 4.5 5 5" />
        <path d="M4 20l4.3-1 10.9-10.9a2.1 2.1 0 0 0-3-3L5.3 16 4 20Z" />
      </>
    )}
    {n === "trash" && (
      <>
        <path d="M4 7h16M10 11v5M14 11v5M9 7l1-3h4l1 3M6 7l1 13h10l1-13" />
      </>
    )}
  </svg>
);
const Check = ({ checked, onChange, label }) => (
  <input
    className="inventory-check"
    type="checkbox"
    checked={checked}
    onChange={onChange}
    aria-label={label}
  />
);
const Type = ({ value }) => (
  <span className={`inventory-type ${value === "CVD" ? "cvd" : "hp"}`}>
    {value}
  </span>
);
const Age = ({ item }) => {
  const days = age(item),
    color = getAgeingColor(days);
  return (
    <span className={`inventory-age ${color}`}>
      <i />
      {days}d
    </span>
  );
};
async function excel(rows) {
  const XLSX = await import("xlsx");
  const sheet = XLSX.utils.json_to_sheet(
    rows.map((item) => ({
      Shape: item.shape,
      Type: item.type,
      "Weight (ct)": formatDecimal(item.weight),
      "Size (mm)": normalizeSize(item.size),
      SKU: item.sku,
      Group: item.group,
      Ageing: `${age(item)}d`,
      BOX: item.box || "",
    })),
  );
  const book = XLSX.utils.book_new(),
    stamp = new Date()
      .toISOString()
      .slice(0, 16)
      .replace("T", "_")
      .replace(":", "-");
  XLSX.utils.book_append_sheet(book, sheet, `Inventory_${stamp}`);
  XLSX.writeFile(book, `inventory_${stamp}.xlsx`);
}
function Picker({ label, value, options, onChange, onBlur, error, required = false }) {
  return (
    <label className={`inventory-field ${error ? "has-error" : ""}`}>
      <span>{label} {required && <b className="inventory-required-star">*</b>}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} onBlur={onBlur}>
        <option value="">Select {label.toLowerCase()}</option>
        {options.map((option) => (
          <option key={option}>{option}</option>
        ))}
      </select>
      {error && <small className="inventory-field-error">{error}</small>}
    </label>
  );
}
export function AddModal({
  item,
  shapes,
  existingItems,
  allowDimensions,
  onClose,
  onSaved,
}) {
  usePageFreeze();
  const { user, hasPermission } = useAuth();
  const [form, setForm] = useState({
    type: item?.type ?? "",
    shape: item?.shape ?? "",
    size: normalizeSize(item?.size),
    weight: item?.weight ?? "",
    box: item?.box ?? "",
  });
  const [touched, setTouched] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [systemError, setSystemError] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedWithoutActivity, setSavedWithoutActivity] = useState(false);
  const savingRef = useRef(false);
  const normalized = {
    ...form,
    type: norm(form.type).toUpperCase(),
    shape: title(form.shape),
    size: normalizeSize(form.size),
    box: normalizeBox(form.box),
  };
  const candidateSku = canonicalSku(normalized);
  const duplicate = candidateSku !== "--" &&
    existingItems.some((entry) =>
      entry.id !== item?.id &&
      canonicalInventoryIdentity(entry) === candidateSku &&
      (!item || canonicalInventoryIdentity(item) !== candidateSku));
  const fieldErrors = Object.fromEntries(
    ["type", "shape", "size", "weight", "box"].map((key) =>
      [key, inventoryFieldError(key, normalized[key], allowDimensions)]),
  );
  if (!fieldErrors.size && duplicate)
    fieldErrors.size = "This Type, Shape and Size already exists in Inventory.";
  const visibleError = (key) => (submitted || touched[key] ? fieldErrors[key] : "");
  const touch = (key) => setTouched((current) => ({ ...current, [key]: true }));
  const update = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
    setSystemError("");
  };
  const save = async () => {
    if (savingRef.current || savedWithoutActivity) return;
    setSubmitted(true);
    if (Object.values(fieldErrors).some(Boolean)) return;
    const allowed = hasPermission("inventory");
    if (!allowed) {
      setSystemError(inventorySaveErrorMessage(null, false));
      return;
    }
    savingRef.current = true;
    setSaving(true);
    const ref = item ? doc(db, INVENTORY, item.id) : doc(collection(db, INVENTORY));
    let operation = "Inventory and identity transaction", stockSaved = false;
    try {
      const payload = {
        shape: normalized.shape,
        type: normalized.type,
        size: normalized.size,
        weight: Number(normalized.weight),
        box: normalized.box,
        group: group(normalized.size),
        sku: candidateSku,
        updatedAt: serverTimestamp(),
      };
      const created = item ? payload : {
        ...payload,
        origin: "Manual",
        createdBy: user.uid,
        createdAt: serverTimestamp(),
      };
      await saveInventoryIdentity(db, ref, created, Boolean(item));
      stockSaved = true;
      operation = "Inventory server read";
      const saved = await getDocFromServer(ref);
      const savedItem = { ...saved.data(), id: ref.id };
      operation = "Activity Log create";
      await writeInventoryActivity(item ? "edited" : "created", savedItem,
        { before: item, origin: "Manual", user });
      if (import.meta.env.DEV) console.info("[Inventory save success]", {
        uid: user?.uid, role: user?.role, inventoryPermission: allowed,
        operation: item ? "update" : "create", inventoryPath: ref.path,
        identityPath: `inventoryIdentities/${candidateSku}`,
      });
      onSaved(savedItem);
    } catch (error) {
      if (import.meta.env.DEV) console.info("[Inventory save failure]", {
        uid: user?.uid, role: user?.role, inventoryPermission: allowed,
        operation, inventoryPath: ref.path, identityPath: candidateSku === "--"
          ? null : `inventoryIdentities/${candidateSku}`,
        code: error?.code, message: error?.message,
      });
      if (stockSaved) {
        setSavedWithoutActivity(true);
        setSystemError("Inventory was saved, but a follow-up read or Activity Log write failed. Do not save it again; contact an administrator.");
      } else {
        setSystemError(inventorySaveErrorMessage(error, allowed));
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  return (
    <div className="inventory-modal">
      <div className="inventory-modal-card" role="dialog" aria-modal="true" aria-label={item ? "Edit Inventory" : "Add Inventory"}>
        <button type="button" className="inventory-modal-close" aria-label="Close Inventory form" onClick={onClose}>
          <Icon n="close" />
        </button>
        <h3>{item ? "Edit item" : "Add item"}</h3>
        <p>Enter the stock details. SKU is generated automatically.</p>
        <div className="inventory-form">
          <Picker label="Type" required value={form.type} options={["CVD", "HP"]}
            onChange={(value) => update("type", value)} onBlur={() => touch("type")}
            error={visibleError("type")} />
          <Picker label="Shape" required value={form.shape} options={shapes}
            onChange={(value) => update("shape", value)} onBlur={() => touch("shape")}
            error={visibleError("shape")} />
          <label className={`inventory-field ${visibleError("size") ? "has-error" : ""}`}>
            <span>Size (mm) <b className="inventory-required-star">*</b></span>
            <input type="text" inputMode="decimal" value={form.size}
              onBlur={() => { touch("size"); if (isValidSize(form.size, allowDimensions)) update("size", normalizeSize(form.size)); }}
              onChange={(event) => update("size", event.target.value)}
              placeholder={allowDimensions ? "4.3 or 4.3X2.0" : "4.3"} />
            {visibleError("size") && <small className="inventory-field-error">{visibleError("size")}</small>}
          </label>
          <label className={`inventory-field ${visibleError("weight") ? "has-error" : ""}`}>
            <span>Weight (ct) <b className="inventory-required-star">*</b></span>
            <input type="text" inputMode="decimal" value={form.weight}
              onBlur={() => touch("weight")}
              onChange={(event) => update("weight", event.target.value)} />
            {visibleError("weight") && <small className="inventory-field-error">{visibleError("weight")}</small>}
          </label>
          <label className={`inventory-field ${visibleError("box") ? "has-error" : ""}`}>
            <span>Box <small className="inventory-optional-label">Optional</small></span>
            <input type="text" value={form.box} placeholder="B29"
              onBlur={() => touch("box")}
              onChange={(event) => update("box", normalizeBox(event.target.value))} />
            {visibleError("box") && <small className="inventory-field-error">{visibleError("box")}</small>}
          </label>
          <div className="inventory-sku-field" aria-live="polite">
            <span>SKU · Generated automatically</span>
            <b>{candidateSku}</b>
          </div>
        </div>
        {systemError && <p className="inventory-error inventory-system-error" role="alert">{systemError}</p>}
        <footer>
          <button type="button" className="inventory-button inventory-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className="inventory-button inventory-primary"
            disabled={saving || savedWithoutActivity} aria-busy={saving} onClick={save}>
            {saving ? "Saving..." : item ? "Save changes" : "Add item"}
          </button>
        </footer>
      </div>
    </div>
  );
}
function BoxCell({ item, notify, user, canEdit = true }) {
  const [value, setValue] = useState(item.box || ""),
    [editing, setEditing] = useState(false),
    [error, setError] = useState("");
  const validate = (next) =>
    next && !/^[A-Z]+\d+$/.test(next)
      ? "Use letters then numbers, e.g. AB29."
      : "";
  const save = async () => {
    const box = normalizeBox(value),
      message = validate(box);
    if (message || !isValidBox(box)) {
      setError(message || "Use letters then numbers, e.g. AB29.");
      return;
    }
    try {
      const updated = { ...item, box };
      await updateDoc(doc(db, INVENTORY, item.id), {
        box,
        updatedAt: serverTimestamp(),
      });
      await writeInventoryActivity("edited", updated, { before: item, user });
      setValue(box);
      setError("");
      setEditing(false);
    } catch {
      notify("Could not save Box.", "error");
    }
  };
  const change = (raw) => {
    const next = raw.toUpperCase();
    if (!/^[A-Z0-9]*$/.test(next)) return;
    setValue(next);
    setError(validate(next));
  };
  return editing && canEdit ? (
    <div className="inventory-box-editor">
      <input
        className={`inventory-box-input ${error ? "has-error" : ""}`}
        autoFocus
        value={value}
        onChange={(event) => change(event.target.value)}
        onBlur={save}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            setValue(item.box || "");
            setError("");
            setEditing(false);
          }
        }}
        aria-label={`Box for ${item.sku}`}
      />
      {error && <small>{error}</small>}
    </div>
  ) : (
    <button
      className="inventory-box-value"
      disabled={!canEdit}
      onClick={() => setEditing(true)}
    >
      {item.box || "Add box"}
    </button>
  );
}
function ImportPreview({ rows, onClose, onImport }) {
  usePageFreeze();
  const valid = rows.filter((row) => !row.errors.length),
    invalid = rows.filter((row) => row.errors.length);
  const table = (entries) => (
    <div className="inventory-import-table-wrap">
      <table className="inventory-import-table">
        <thead>
          <tr>
            {[
              "Shape",
              "Type",
              "Weight (ct)",
              "Size (mm)",
              "SKU",
              "BOX",
              "Result",
            ].map((label) => (
              <th key={label}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {entries.map((row) => (
            <tr key={row.index}>
              <td>{row.shape}</td>
              <td>{row.type}</td>
              <td>{row.weight}</td>
              <td>{normalizeSize(row.size)}</td>
              <td>{row.sku}</td>
              <td className={row.box ? undefined : "inventory-import-placeholder"}>{row.box || "--"}</td>
              <td className={row.errors.length ? "inventory-import-result-error" : "inventory-import-result-ready"}>{row.errors.join(" / ") || "Ready to import"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  return (
    <div className="inventory-modal">
      <div className="inventory-modal-card inventory-import-card">
        <button className="inventory-modal-close" onClick={onClose}>
          <Icon n="close" />
        </button>
        <h3>Import preview</h3>
        <p>Box is optional; supplied values must follow the Box format.</p>
        <section className="inventory-import-section">
          <header>
            <b>Ready to import</b>
            <span>{valid.length} items</span>
          </header>
          {table(valid)}
        </section>
        <section className="inventory-import-section">
          <header>
            <b>Needs attention</b>
            <span>{invalid.length} items</span>
          </header>
          {table(invalid)}
        </section>
        <footer>
          <button
            className="inventory-button inventory-primary"
            disabled={!valid.length}
            onClick={() => {
              onImport(valid);
              onClose();
            }}
          >
            Import {valid.length} valid items
          </button>
          <button
            className="inventory-button inventory-secondary"
            onClick={onClose}
          >
            Cancel
          </button>
        </footer>
      </div>
    </div>
  );
}
function DeleteModal({ items, onClose, onConfirm }) {
  usePageFreeze();
  const [deleting, setDeleting] = useState(false),
    [error, setError] = useState("");
  const remove = async () => {
    setDeleting(true);
    setError("");
    try {
      await onConfirm(items);
      onClose();
    } catch {
      setError("Could not delete the selected item(s). Please try again.");
      setDeleting(false);
    }
  };
  return (
    <div
      className="inventory-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Delete confirmation"
    >
      <div className="inventory-modal-card inventory-delete-modal">
        <button
          className="inventory-modal-close"
          onClick={onClose}
          aria-label="Close"
        >
          <Icon n="close" />
        </button>
        <h3>Delete {items.length === 1 ? "item" : "items"}?</h3>
        <p>
          {items.length === 1
            ? `This will permanently remove ${items[0].sku}.`
            : `This will permanently remove ${items.length} selected items.`}{" "}
          This action cannot be undone.
        </p>
        {error && <p className="inventory-error">{error}</p>}
        <footer>
          <button
            className="inventory-button inventory-delete"
            disabled={deleting}
            onClick={remove}
          >
            {deleting ? "Deleting..." : "Delete"}
          </button>
          <button
            className="inventory-button inventory-secondary"
            disabled={deleting}
            onClick={onClose}
          >
            Cancel
          </button>
        </footer>
      </div>
    </div>
  );
}
export default function Inventory() {
  const { user } = useAuth(),
    toast = useToast(),
    location = useLocation(),
    navigate = useNavigate(),
    searchRef = useRef(),
    importRef = useRef();
  const [shapes, setShapes] = useState(LEGACY_SHAPES),
    [allowDimensions, setAllowDimensions] = useState(false),
    [input, setInput] = useState(""),
    [find, setFind] = useState(""),
    [filter, setFilter] = useState("All Groups"),
    [dashboardAgeBucket, setDashboardAgeBucket] = useState(""),
    [open, setOpen] = useState({}),
    [selected, setSelected] = useState([]),
    [adding, setAdding] = useState(false),
    [editing, setEditing] = useState(null),
    [preview, setPreview] = useState(null),
    [deleteItems, setDeleteItems] = useState(null),
    [printMode, setPrintMode] = useState("all"),
    [menu, setMenu] = useState(false),
    [clock, setClock] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const { rows: items, loading, error: inventoryError } = useInventoryDiscovery();
  useEffect(
    () =>
      onSnapshot(collection(db, SHAPES), (snap) =>
        setShapes(
          orderShapes([
            ...LEGACY_SHAPES,
            ...snap.docs.map((entry) => entry.data().value),
          ]),
        ),
      ),
    [],
  );
  useEffect(
    () =>
      onSnapshot(SETTINGS, (snap) =>
        setAllowDimensions(Boolean(snap.data()?.allowDimensionSizes)),
      ),
    [],
  );
  useEffect(() => {
    const timer = setTimeout(() => setFind(input.trim()), 200);
    return () => clearTimeout(timer);
  }, [input]);
  useEffect(() => {
    const action = location.state?.dashboardAction;
    const sku = location.state?.dashboardSku;
    const age = location.state?.dashboardAgeBucket;
    if (!action && !sku && !age) return;
    queueMicrotask(() => {
      if (action === "add") setAdding(true);
      if (sku) { setInput(sku); setDashboardAgeBucket(""); }
      if (age) { setInput(""); setDashboardAgeBucket(age); }
      navigate(location.pathname, { replace: true, state: null });
    });
  }, [location.pathname, location.state, navigate]);
  useEffect(() => {
    const handler = (event) => {
      const typing =
        ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName) ||
        event.target.isContentEditable;
      if (event.key === "/" && !typing) {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === "Escape") {
        setAdding(false);
        setEditing(null);
        setPreview(null);
        setDeleteItems(null);
        setMenu(false);
      }
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key === "Enter" &&
        (adding || editing)
      ) {
        event.preventDefault();
        document
          .querySelector(".inventory-modal-card .inventory-primary")
          ?.click();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [adding, editing]);
  const filtered = useMemo(
    () =>
      items.filter(
        (item) =>
          (filter === "All Groups" ||
            (item.group || "Uncategorized") === filter) &&
          (!dashboardAgeBucket || (() => {
            if (!item.createdAt && !item.createdAtMs) return false;
            const days = getAgeingDays(item.createdAt, item.createdAtMs);
            return dashboardAgeBucket === "0-30 days" ? days <= 30 : dashboardAgeBucket === "31-60 days" ? days >= 31 && days <= 60 : dashboardAgeBucket === "61-90 days" ? days >= 61 && days <= 90 : days > 90;
          })()) &&
          inventoryMatchesSearch(item, find),
      ),
    [items, filter, find, dashboardAgeBucket],
  );
  const parents = useMemo(
    () =>
      Object.values(
        filtered.reduce((all, item) => {
          const key = `${item.shape}__${item.type}`;
          (all[key] ??= {
            key,
            shape: item.shape,
            type: item.type,
            items: [],
          }).items.push(item);
          return all;
        }, {}),
      )
        .map((parent) => ({
          ...parent,
          items: [...parent.items].sort(
            (a, b) => sizeSortValue(a.size) - sizeSortValue(b.size),
          ),
        }))
        .sort(
          (a, b) =>
            orderShapes([a.shape, b.shape]).indexOf(a.shape) -
              orderShapes([a.shape, b.shape]).indexOf(b.shape) ||
            a.type.localeCompare(b.type),
        ),
    [filtered],
  );
  const groups = useMemo(
      () =>
        [...new Set(items.map((item) => item.group || "Uncategorized"))].sort(),
      [items],
    ),
    weight = items.reduce((sum, item) => sum + Number(item.weight || 0), 0),
    averageAge = items.length
      ? items.reduce((sum, item) => sum + age(item), 0) / items.length
      : 0,
    all =
      filtered.length > 0 &&
      filtered.every((item) => selected.includes(item.id));
  const collisionAudit = useMemo(() => auditDimensions({ inventory: items }), [items]);
  const isAdmin = user?.role === "superadmin";
  const canEditItem = (item) =>
    isAdmin ||
    (item.createdBy === user?.uid &&
      editTimeRemaining(item, clock || createdAtMs(item)) > 0);
  const canDeleteItem = () => isAdmin;
  const toggle = (ids) =>
    setSelected((current) =>
      ids.every((id) => current.includes(id))
        ? current.filter((id) => !ids.includes(id))
        : [...new Set([...current, ...ids])],
    );
  const requestDelete = (targets) => {
    const allowed = targets.filter(canDeleteItem);
    if (allowed.length) setDeleteItems(allowed);
  };
  const confirmDelete = async (targets) => {
    if (!isAdmin) return;
    await Promise.all(
      targets.map(async (item) => {
        await deleteDoc(doc(db, INVENTORY, item.id));
        await writeInventoryActivity("deleted", item, { user });
      }),
    );
    setSelected((current) =>
      current.filter((id) => !targets.some((item) => item.id === id)),
    );
    toast(`${targets.length} item${targets.length === 1 ? "" : "s"} deleted`);
  };
  const importFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const XLSX = await import("xlsx"),
      book = XLSX.read(await file.arrayBuffer()),
      rows = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]]),
      seen = new Set(items.map(canonicalInventoryIdentity));
    setPreview(
      rows.map((row, index) => {
        const shape = title(row[INVENTORY_IMPORT_FIELD_HEADERS.shape]),
          type = norm(row[INVENTORY_IMPORT_FIELD_HEADERS.type]).toUpperCase(),
          size = normalizeSize(row[INVENTORY_IMPORT_FIELD_HEADERS.size]),
          weight = Number(row[INVENTORY_IMPORT_FIELD_HEADERS.weight]),
          box = normalizeBox(
            row[INVENTORY_IMPORT_FIELD_HEADERS.box] ?? row.Box,
          ),
          errors = [];
        if (!shape) errors.push("Shape is required");
        if (!["CVD", "HP"].includes(type))
          errors.push("Type must be CVD or HP");
        if (!isValidSize(size, allowDimensions)) errors.push("Invalid size");
        if (!Number.isFinite(weight) || weight <= 0)
          errors.push("Invalid weight");
        if (!isValidBox(box)) errors.push("Invalid Box");
        const generatedSku = sku({ shape, type, size });
        if (seen.has(generatedSku)) errors.push("Duplicate SKU");
        else seen.add(generatedSku);
        return {
          index,
          shape,
          type,
          size,
          weight,
          box,
          group: group(size),
          sku: generatedSku,
          errors,
        };
      }),
    );
    event.target.value = "";
  };
  const importRows = async (rows) => {
    let imported = 0;
    for (const row of rows) {
      const { index, errors, ...data } = row;
      void index; void errors;
      const item = { ...data, origin: "Import", createdBy: user?.uid ?? "pending-auth", createdAt: serverTimestamp() };
      try {
        const ref = await saveInventoryIdentity(db, doc(collection(db, INVENTORY)), item);
        imported++;
        await writeInventoryActivity("created", { id: ref.id, ...item }, { origin: "Import", user });
      } catch (error) { toast(error.message || `Could not import ${row.sku}.`, "error"); }
    }
    toast(`${imported} of ${rows.length} items imported`, imported === rows.length ? "success" : "error");
  };
  return (
    <section className="inventory-module">
      {inventoryError && <p role="alert">{inventoryError}</p>}
      <header className="inventory-heading">
        <h2>Inventory</h2>
        <p>{formatDecimal(weight)} ct in stock</p>
      </header>
      {collisionAudit.collisions.length > 0 && <details className="inventory-error"><summary>{collisionAudit.collisions.length} legacy canonical Size collision(s). Stock records remain separate.</summary>{collisionAudit.collisions.map((collision) => <p key={collision.canonicalSku}>{collision.canonicalSku}: {collision.records.map((record) => `${record.id} (${record.currentSku}, raw Size ${record.rawSize}, ${record.weight ?? "?"} ct)`).join("; ")}</p>)}</details>}
      <div className="inventory-metrics">
        {[
          ["TOTAL INVENTORY", items.length],
          ["AVERAGE AGING", `${averageAge.toFixed(1)} days`],
          ["TOTAL CVD", items.filter((item) => item.type === "CVD").length],
          ["TOTAL HP", items.filter((item) => item.type === "HP").length],
        ].map(([label, value, unit]) => (
          <article key={label}>
            <span>{label}</span>
            <strong>
              {value} {unit && <i>{unit}</i>}
            </strong>
          </article>
        ))}
      </div>
      <div className="inventory-toolbar">
        {dashboardAgeBucket && <button type="button" className="inventory-button inventory-secondary" onClick={() => setDashboardAgeBucket("")}>Age: {dashboardAgeBucket} ×</button>}
        <label className="inventory-search">
          <Icon n="search" />
          <input
            ref={searchRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Search; use 5.3mm for Size only"
          />
          <kbd>(press /)</kbd>
        </label>
        <label className="inventory-filter">
          <span>FILTER</span>
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          >
            <option>All Groups</option>
            {groups.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <div className="inventory-toolbar-buttons">
          <button
            className="inventory-button inventory-secondary"
            onClick={() => importRef.current?.click()}
          >
            <Icon n="upload" />
            Import
          </button>
          <input
            ref={importRef}
            hidden
            type="file"
            accept=".xlsx"
            onChange={importFile}
          />
          <div className="inventory-export">
            <button
              className="inventory-button inventory-secondary"
              onClick={() => setMenu(!menu)}
            >
              <Icon n="download" />
              Export
            </button>
            {menu && (
              <div className="inventory-export-menu">
                <button
                  onClick={() => {
                    excel(parents.flatMap((parent) => parent.items));
                    setMenu(false);
                  }}
                >
                  Export as Excel
                </button>
                <button onClick={() => window.print()}>Export as PDF</button>
              </div>
            )}
          </div>
          <button
            className="inventory-button inventory-secondary"
            onClick={() => {
              setPrintMode("all");
              setTimeout(() => window.print(), 0);
            }}
          >
            <Icon n="print" />
            Print
          </button>
          <button
            className="inventory-button inventory-primary"
            onClick={() => setAdding(true)}
          >
            <Icon n="plus" />
            Add Item
          </button>
        </div>
      </div>
      {selected.length > 0 && (
        <div className="inventory-selection">
          <b>{selected.length} selected</b>
          <div>
            <button
              className="inventory-button inventory-secondary"
              onClick={() =>
                excel(items.filter((item) => selected.includes(item.id)))
              }
            >
              <Icon n="download" />
              Export
            </button>
            <button
              className="inventory-button inventory-secondary"
              onClick={() => {
                setPrintMode("selected");
                setTimeout(() => window.print(), 0);
              }}
            >
              <Icon n="print" />
              Print
            </button>
            {isAdmin && (
              <button
                className="inventory-button inventory-delete"
                onClick={() =>
                  requestDelete(
                    items.filter((item) => selected.includes(item.id)),
                  )
                }
              >
                Delete
              </button>
            )}
          </div>
        </div>
      )}
      <div className="inventory-table-wrap">
        <table className="inventory-table">
          <thead>
            <tr>
              <th>
                <Check
                  checked={all}
                  onChange={() => toggle(filtered.map((item) => item.id))}
                  label="Select all"
                />
              </th>
              {[
                "TYPE",
                "SHAPE",
                "SIZE (MM)",
                "WEIGHT (CT)",
                "AGEING",
                "BOX",
                "SKU",
                "GROUP",
                "ACTION",
              ].map((label) => (
                <th key={label}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {parents.map((parent, index) => (
              <Group
                key={parent.key}
                parent={parent}
                index={index}
                open={open[parent.key]}
                setOpen={setOpen}
                selected={selected}
                toggle={toggle}
                edit={setEditing}
                toast={toast}
                requestDelete={requestDelete}
                user={user}
                canEdit={canEditItem}
                canDelete={canDeleteItem}
                clock={clock}
                isAdmin={isAdmin}
              />
            ))}
            {loading && (
              <tr className="inventory-empty-row">
                <td colSpan="10">Loading inventory...</td>
              </tr>
            )}
            {!loading && !parents.length && (
              <tr className="inventory-empty-row">
                <td colSpan="10">No items match your search or filter.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <table className="inventory-print-table">
        <caption>Inventory Report</caption>
        <thead>
          <tr>
            {[
              "Type",
              "Shape",
              "Size (mm)",
              "Weight (ct)",
              "Ageing",
              "BOX",
              "SKU",
              "Group",
            ].map((label) => (
              <th key={label}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {parents
            .flatMap((parent) => parent.items)
            .filter((item) =>
              printMode === "selected" ? selected.includes(item.id) : true,
            )
            .map((item) => (
              <tr key={item.id}>
                <td>{item.type}</td>
                <td>{item.shape}</td>
                <td>{normalizeSize(item.size)}</td>
                <td>{formatDecimal(item.weight)}</td>
                <td>{age(item)}d</td>
                <td>{item.box || ""}</td>
                <td>{item.sku}</td>
                <td>{item.group}</td>
              </tr>
            ))}
        </tbody>
      </table>
      {deleteItems && (
        <DeleteModal
          items={deleteItems}
          onClose={() => setDeleteItems(null)}
          onConfirm={confirmDelete}
        />
      )}{" "}
      {preview && (
        <ImportPreview
          rows={preview}
          onClose={() => setPreview(null)}
          onImport={importRows}
        />
      )}{" "}
      {editing && (
        <AddModal
          item={editing}
          shapes={shapes}
          existingItems={items}
          allowDimensions={allowDimensions}
          onClose={() => setEditing(null)}
          onSaved={() => setEditing(null)}
        />
      )}{" "}
      {adding && (
        <AddModal
          shapes={shapes}
          existingItems={items}
          allowDimensions={allowDimensions}
          onClose={() => setAdding(false)}
          onSaved={() => setAdding(false)}
        />
      )}
    </section>
  );
}
function Group({
  parent,
  index,
  open,
  setOpen,
  selected,
  toggle,
  edit,
  toast,
  requestDelete,
  user,
  canEdit,
  canDelete,
  clock,
  isAdmin,
}) {
  const ids = parent.items.map((item) => item.id),
    total = parent.items.reduce(
      (sum, item) => sum + Number(item.weight || 0),
      0,
    );
  return (
    <>
      <tr className={`inventory-group inventory-tint-${index % 6}`}>
        <td>
          <Check
            checked={ids.every((id) => selected.includes(id))}
            onChange={() => toggle(ids)}
            label={`Select ${parent.shape}`}
          />
        </td>
        <td>
          <Type value={parent.type} />
        </td>
        <td>
          <button
            className="inventory-chevron"
            onClick={() =>
              setOpen((state) => ({ ...state, [parent.key]: !open }))
            }
          >
            <Icon n={open ? "down" : "right"} />
          </button>
          <b>{parent.shape}</b>
        </td>
        <td>--</td>
        <td>
          <b>{formatDecimal(total)} ct</b>
        </td>
        <td>--</td>
        <td>--</td>
        <td>{parent.items.length} items</td>
        <td>--</td>
        <td>--</td>
      </tr>
      {open &&
        parent.items.map((item) => (
          <tr className="inventory-item" key={item.id}>
            <td>
              <Check
                checked={selected.includes(item.id)}
                onChange={() => toggle([item.id])}
                label={`Select ${item.sku}`}
              />
            </td>
            <td>
              <Type value={item.type} />
            </td>
            <td>{item.shape}</td>
            <td>{normalizeSize(item.size)} mm</td>
            <td>
              <b>{formatDecimal(item.weight)} ct</b>
            </td>
            <td>
              <Age item={item} />
            </td>
            <td>
              <BoxCell
                item={item}
                notify={toast}
                user={user}
                canEdit={canEdit(item)}
              />
            </td>
            <td>{item.sku}</td>
            <td>{item.group || "Uncategorized"}</td>
            <td className="inventory-row-actions">
              {canEdit(item) && (
                <button
                  onClick={() => edit(item)}
                  aria-label={`Edit ${item.sku}`}
                >
                  <Icon n="edit" />
                </button>
              )}
              {!isAdmin && item.createdBy === user?.uid && (
                <span className="inventory-edit-timer">
                  {editTimeRemaining(item, clock || createdAtMs(item)) > 0
                    ? `Edit allowed for: ${formatEditTime(
                        editTimeRemaining(item, clock || createdAtMs(item)),
                      )}`
                    : "Edit window expired"}
                </span>
              )}
              {isAdmin && (
                <button
                  className="inventory-row-delete"
                  disabled={!canDelete(item)}
                  onClick={() => requestDelete([item])}
                  aria-label={`Delete ${item.sku}`}
                >
                  <Icon n="trash" />
                </button>
              )}
            </td>
          </tr>
        ))}
    </>
  );
}
