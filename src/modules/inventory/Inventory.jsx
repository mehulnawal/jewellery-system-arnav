import { useEffect, useMemo, useRef, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "../../firebase/config";
import { useAuth } from "../../auth/AuthContext";
import { useToast } from "../../ui/ToastContext";
import { getAgeingColor, getAgeingDays } from "../../config/ageingConfig";
import { writeInventoryActivity } from "../../utils/activityLog";
import { usePageFreeze } from "../../hooks/usePageFreeze";
import {
  DEFAULT_SHAPES,
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
  LEGACY_SHAPES = orderShapes([...DEFAULT_SHAPES, "Pear", "Heart"]),
  SETTINGS = doc(db, "settings", "inventory");
export const SIZE_TO_GROUP_MAP = [];
const norm = (value) => String(value ?? "").trim();
const title = (value) =>
  norm(value).replace(/\b\w/g, (character) => character.toUpperCase());
const age = (item) => getAgeingDays(item.createdAt, item.createdAtMs);
const group = (size) =>
  SIZE_TO_GROUP_MAP.find(
    (item) =>
      sizeSortValue(size) >= item.min && sizeSortValue(size) <= item.max,
  )?.group ?? "Uncategorized";
const sku = ({ size, shape, type }) =>
  size && shape && type ? `${size}_${shape}_${type}` : "--";
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
      "Size (mm)": item.size,
      SKU: item.sku,
      Group: item.group,
      Status: "In Stock",
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
function Picker({ label, value, options, onChange, error }) {
  return (
    <label className={`inventory-field wide ${error ? "has-error" : ""}`}>
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Select {label.toLowerCase()}</option>
        {options.map((option) => (
          <option key={option}>{option}</option>
        ))}
      </select>
      {error && <small className="inventory-field-error">{error}</small>}
    </label>
  );
}
function AddModal({
  item,
  shapes,
  existingItems,
  allowDimensions,
  onClose,
  onSaved,
}) {
  usePageFreeze();
  const { user } = useAuth();
  const [form, setForm] = useState({
    shape: item?.shape ?? "",
    type: item?.type ?? "",
    weight: item?.weight ?? "",
    size: item?.size ?? "",
  });
  const [errors, setErrors] = useState({}),
    [saving, setSaving] = useState(false);
  const validateField = (key, value) => {
    if (key === "shape") return value ? "" : "Select a shape.";
    if (key === "type")
      return ["CVD", "HP"].includes(value) ? "" : "Select CVD or HP.";
    if (key === "weight")
      return value === ""
        ? "Weight is required."
        : Number(value) > 0
          ? ""
          : "Weight must be greater than 0.";
    if (key === "size")
      return value === ""
        ? "Size is required."
        : isValidSize(value, allowDimensions)
          ? ""
          : allowDimensions
            ? "Use a positive size or uppercase X format, e.g. 4.3X2.0."
            : "Enter a positive numeric size.";
    return "";
  };
  const update = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: validateField(key, value) }));
  };
  const numericInput = (key, value, dimensions = false) => {
    const allowed = dimensions
      ? allowDimensions
        ? /^\d*(?:\.\d*)?(?:X\d*(?:\.\d*)?)?$/
        : /^\d*(?:\.\d*)?$/
      : /^\d*(?:\.\d*)?$/;
    if (allowed.test(value)) update(key, value);
  };
  const save = async () => {
    const normalized = {
      ...form,
      shape: title(form.shape),
      type: norm(form.type).toUpperCase(),
      size: normalizeSize(form.size),
    };
    const nextErrors = Object.fromEntries(
      Object.keys(normalized)
        .map((key) => [key, validateField(key, normalized[key])])
        .filter(([, message]) => message),
    );
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    const weight = Number(normalized.weight),
      duplicate = existingItems.some(
        (entry) =>
          entry.id !== item?.id &&
          entry.shape === normalized.shape &&
          entry.type === normalized.type &&
          String(entry.size) === normalized.size,
      );
    if (duplicate) {
      setErrors((current) => ({
        ...current,
        size: `This Size already exists for ${normalized.shape} ${normalized.type}.`,
      }));
      return;
    }
    setSaving(true);
    try {
      const payload = {
        shape: normalized.shape,
        type: normalized.type,
        size: normalized.size,
        weight,
        group: group(normalized.size),
        sku: sku(normalized),
        updatedAt: serverTimestamp(),
      };
      if (item) {
        const updated = { ...item, ...payload };
        await updateDoc(doc(db, INVENTORY, item.id), payload);
        await writeInventoryActivity("edited", updated, { before: item, user });
        onSaved(updated);
      } else {
        const created = {
          ...payload,
          origin: "Manual",
          createdBy: user?.uid ?? "pending-auth",
          createdAt: serverTimestamp(),
          createdAtMs: Date.now(),
        };
        const ref = await addDoc(collection(db, INVENTORY), created);
        await writeInventoryActivity(
          "created",
          { id: ref.id, ...created },
          { origin: "Manual", user },
        );
        onSaved({ id: ref.id, ...created });
      }
    } catch {
      setErrors((current) => ({
        ...current,
        form: "Could not save this item. Please try again.",
      }));
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="inventory-modal">
      <div className="inventory-modal-card">
        <button className="inventory-modal-close" onClick={onClose}>
          <Icon n="close" />
        </button>
        <h3>{item ? "Edit item" : "Add item"}</h3>
        <p>
          SKU is generated automatically. Box can be added after the item is
          created.
        </p>
        <div className="inventory-form">
          <Picker
            label="Shape"
            value={form.shape}
            options={shapes}
            onChange={(value) => update("shape", value)}
            error={errors.shape}
          />
          <Picker
            label="Type"
            value={form.type}
            options={["CVD", "HP"]}
            onChange={(value) => update("type", value)}
            error={errors.type}
          />
          <label
            className={`inventory-field ${errors.weight ? "has-error" : ""}`}
          >
            <span>Weight (ct)</span>
            <input
              type="text"
              inputMode="decimal"
              value={form.weight}
              onChange={(event) => numericInput("weight", event.target.value)}
            />
            {errors.weight && (
              <small className="inventory-field-error">{errors.weight}</small>
            )}
          </label>
          <label
            className={`inventory-field ${errors.size ? "has-error" : ""}`}
          >
            <span>Size (mm)</span>
            <input
              type="text"
              inputMode="decimal"
              value={form.size}
              onChange={(event) =>
                numericInput("size", event.target.value, true)
              }
              placeholder={allowDimensions ? "4.3 or 4.3X2.0" : "4.3"}
            />
            {errors.size && (
              <small className="inventory-field-error">{errors.size}</small>
            )}
          </label>
          <div className="inventory-sku-field">
            <span>SKU</span>
            <b>{sku({ ...form, size: normalizeSize(form.size) })}</b>
          </div>
        </div>
        {errors.form && <p className="inventory-error">{errors.form}</p>}
        <footer>
          <button
            className="inventory-button inventory-secondary"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="inventory-button inventory-primary"
            disabled={saving}
            onClick={save}
          >
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
  return editing ? (
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
              <td>{row.size}</td>
              <td>{row.sku}</td>
              <td>{row.box || "--"}</td>
              <td>{row.errors.join(" / ") || "Ready to import"}</td>
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
            className="inventory-button inventory-secondary"
            onClick={onClose}
          >
            Cancel
          </button>
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
            className="inventory-button inventory-secondary"
            disabled={deleting}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="inventory-button inventory-delete"
            disabled={deleting}
            onClick={remove}
          >
            {deleting ? "Deleting..." : "Delete"}
          </button>
        </footer>
      </div>
    </div>
  );
}
export default function Inventory() {
  const { user } = useAuth(),
    toast = useToast(),
    searchRef = useRef(),
    importRef = useRef();
  const [items, setItems] = useState([]),
    [shapes, setShapes] = useState(LEGACY_SHAPES),
    [allowDimensions, setAllowDimensions] = useState(false),
    [input, setInput] = useState(""),
    [find, setFind] = useState(""),
    [filter, setFilter] = useState("All Groups"),
    [open, setOpen] = useState({}),
    [selected, setSelected] = useState([]),
    [adding, setAdding] = useState(false),
    [editing, setEditing] = useState(null),
    [preview, setPreview] = useState(null),
    [deleteItems, setDeleteItems] = useState(null),
    [printMode, setPrintMode] = useState("all"),
    [menu, setMenu] = useState(false),
    [loading, setLoading] = useState(true),
    [clock, setClock] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(
    () =>
      onSnapshot(
        query(collection(db, INVENTORY), orderBy("createdAt", "desc")),
        (snap) => {
          setItems(
            snap.docs.map((entry) => ({ id: entry.id, ...entry.data() })),
          );
          setLoading(false);
        },
        () => setLoading(false),
      ),
    [],
  );
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
          inventoryMatchesSearch(item, find),
      ),
    [items, filter, find],
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
    average = items.length
      ? Math.round(
          items.reduce((sum, item) => sum + age(item), 0) / items.length,
        )
      : 0,
    all =
      filtered.length > 0 &&
      filtered.every((item) => selected.includes(item.id));
  const canManageItem = (item) =>
    user?.role === "superadmin" ||
    (item.createdBy === user?.uid &&
      Date.now() -
        Number(item.createdAtMs || item.createdAt?.toMillis?.() || 0) <
        60 * 60 * 1000);
  const toggle = (ids) =>
    setSelected((current) =>
      ids.every((id) => current.includes(id))
        ? current.filter((id) => !ids.includes(id))
        : [...new Set([...current, ...ids])],
    );
  const requestDelete = (targets) => {
    const allowed = targets.filter(canManageItem);
    if (allowed.length) setDeleteItems(allowed);
  };
  const confirmDelete = async (targets) => {
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
      seen = new Set(items.map((item) => item.sku));
    setPreview(
      rows.map((row, index) => {
        const shape = title(row.Shape),
          type = norm(row.Type).toUpperCase(),
          size = normalizeSize(row["Size (mm)"]),
          weight = Number(row["Weight (ct)"]),
          box = normalizeBox(row.BOX ?? row.Box),
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
  const importRows = (rows) => {
    rows.forEach((row) => {
      const item = {
        ...row,
        origin: "Import",
        createdBy: user?.uid ?? "pending-auth",
        createdAt: serverTimestamp(),
        createdAtMs: Date.now(),
      };
      delete item.index;
      delete item.errors;
      void addDoc(collection(db, INVENTORY), item)
        .then((ref) =>
          writeInventoryActivity(
            "created",
            { id: ref.id, ...item },
            { origin: "Import", user },
          ),
        )
        .catch(() => toast(`Could not import ${row.sku}.`, "error"));
    });
    toast(`${rows.length} item${rows.length === 1 ? "" : "s"} imported`);
  };
  return (
    <section className="inventory-module">
      <header className="inventory-heading">
        <h2>Inventory</h2>
        <p>{formatDecimal(weight)} ct in stock</p>
      </header>
      <div className="inventory-metrics">
        {[
          ["NUMBER OF SKUs", items.length],
          ["WEIGHT IN STOCK", formatDecimal(weight), "ct"],
          ["WEIGHT SOLD (THIS MONTH)", "0.000", "ct"],
          ["AVG AGEING", average, "days"],
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
                "SHAPE",
                "TYPE",
                "WEIGHT (CT)",
                "SIZE (MM)",
                "SKU",
                "GROUP",
                "STATUS",
                "AGEING",
                "BOX",
                "ACTIONS",
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
                canManage={canManageItem}
              />
            ))}
            {loading && (
              <tr className="inventory-empty-row">
                <td colSpan="11">Loading inventory...</td>
              </tr>
            )}
            {!loading && !parents.length && (
              <tr className="inventory-empty-row">
                <td colSpan="11">No items match your search or filter.</td>
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
              "Shape",
              "Type",
              "Weight (ct)",
              "Size (mm)",
              "SKU",
              "Group",
              "Status",
              "Ageing",
              "BOX",
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
                <td>{item.shape}</td>
                <td>{item.type}</td>
                <td>{formatDecimal(item.weight)}</td>
                <td>{item.size}</td>
                <td>{item.sku}</td>
                <td>{item.group}</td>
                <td>In Stock</td>
                <td>{age(item)}d</td>
                <td>{item.box || ""}</td>
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
  canManage,
}) {
  const ids = parent.items.map((item) => item.id),
    total = parent.items.reduce(
      (sum, item) => sum + Number(item.weight || 0),
      0,
    );
  return (
    <>
      {
        <tr className={`inventory-group inventory-tint-${index % 6}`}>
          <td>
            <Check
              checked={ids.every((id) => selected.includes(id))}
              onChange={() => toggle(ids)}
              label={`Select ${parent.shape}`}
            />
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
          <td>
            <Type value={parent.type} />
          </td>
          <td>
            <b>{formatDecimal(total)} ct</b>
          </td>
          <td>--</td>
          <td>--</td>
          <td>{parent.items.length} items</td>
          <td>--</td>
          <td>--</td>
          <td>--</td>
          <td>--</td>
        </tr>
      }
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
            <td>{item.shape}</td>
            <td>
              <Type value={item.type} />
            </td>
            <td>
              <b>{formatDecimal(item.weight)} ct</b>
            </td>
            <td>{item.size} mm</td>
            <td>{item.sku}</td>
            <td>{item.group || "Uncategorized"}</td>
            <td>
              <span className="inventory-stock">In Stock</span>
            </td>
            <td>
              <Age item={item} />
            </td>
            <td>
              <BoxCell
                item={item}
                notify={toast}
                user={user}
                canEdit={canManage(item)}
              />
            </td>
            <td className="inventory-row-actions">
              <button
                disabled={!canManage(item)}
                onClick={() => edit(item)}
                aria-label={`Edit ${item.sku}`}
              >
                <Icon n="edit" />
              </button>
              <button
                className="inventory-row-delete"
                disabled={!canManage(item)}
                onClick={() => requestDelete([item])}
                aria-label={`Delete ${item.sku}`}
              >
                <Icon n="trash" />
              </button>
            </td>
          </tr>
        ))}
    </>
  );
}
