import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { useMasterPrices } from "../../hooks/useMasterPrices";
import { useBusinessAvailability } from "../../hooks/useBusinessAvailability.js";
import { DEFAULT_SHAPES } from "../../utils/inventoryRules.js";
import { usePageFreeze } from "../../hooks/usePageFreeze";
import { normalizeSize } from "../../utils/dimensions.js";
import {
  MASTER_PRICE_HEADERS,
  duplicatePriceMessage,
  masterPriceErrors,
  masterPriceKey,
  matchesMasterSearch,
  previewMasterImport,
} from "../../utils/masterPrices.js";
import {
  saveMasterPrice,
  deleteMasterPrice,
  importMasterPrices,
} from "../../utils/masterPriceStore.js";
import {
  exportMasterPrices,
  masterPricePrintHtml,
} from "../../utils/masterPriceFiles.js";
import "./masterPrices.css";
// Copy only: masterPriceErrors remains the single source of validation truth.
const fieldMessage = (key, value, error) => {
  if (!error) return "";
  const label = key[0].toUpperCase() + key.slice(1),
    text = String(value ?? "").trim();
  if (!text) return key === "width" ? "" : label + " is required.";
  if (
    !["height", "width", "price"].includes(key) ||
    /too long|decimal places/.test(error)
  )
    return error;
  const parts = text.split("X");
  if (
    parts.every((part) => /^-?\d+(?:\.\d+)?$/.test(part)) &&
    parts.some((part) => part.startsWith("-") || normalizeSize(part) === "0")
  )
    return label + " must be greater than 0.";
  return "Enter a valid " + label + ".";
};
const empty = { type: "", shape: "", height: "", width: "", price: "" };
const PageIcon = ({ name }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {name === "plus" ? (
      <path d="M12 5v14M5 12h14" />
    ) : name === "search" ? (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 4 4" />
      </>
    ) : name === "notice" ? (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v6m0 4h.01" />
      </>
    ) : (
      <>
        <rect x="4" y="3" width="16" height="18" rx="2" />
        <path d="M8 8h8M8 12h8M8 16h4" />
      </>
    )}
  </svg>
);
export default function MasterPrices() {
  const { user } = useAuth(),
    { rows, loading, error, stale, retry } = useMasterPrices();
  const [form, setForm] = useState(null),
    [previous, setPrevious] = useState(null),
    [candidate, setCandidate] = useState(null);
  const [search, setSearch] = useState(""),
    [filters, setFilters] = useState({
      type: "",
      shape: "",
      height: "",
      width: "",
    });
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [importRows, setImportRows] = useState(null),
    [result, setResult] = useState(null);
  const fileRef = useRef(),
    dialogRef = useRef();
  const [touched, setTouched] = useState({}),
    [submitted, setSubmitted] = useState(false);
  const availability = useBusinessAvailability();
  const unsafe =
    availability.phase !== "ready" || loading || stale || Boolean(error);
  const writeHint = unsafe
    ? "Saving unavailable until connection and access are verified."
    : undefined;
  const formOpen = Boolean(form);
  useEffect(() => {
    if (!formOpen) return;
    const previousFocus = document.activeElement;
    const frame = requestAnimationFrame(() =>
      dialogRef.current?.querySelector("input")?.focus(),
    );
    return () => {
      cancelAnimationFrame(frame);
      previousFocus?.focus?.();
    };
  }, [formOpen]);
  usePageFreeze(Boolean(form || candidate || importRows));
  const preview = useMemo(
    () => (importRows ? previewMasterImport(importRows, rows) : []),
    [importRows, rows],
  );
  const errors = form ? masterPriceErrors(form) : {};
  if (
    form &&
    rows.some(
      (row) =>
        row.id !== previous?.id &&
        masterPriceKey(row) === masterPriceKey(form) &&
        masterPriceKey(form),
    )
  )
    errors.combination = duplicatePriceMessage(form);
  const visibleErrors = Object.fromEntries(
    Object.entries(errors)
      .filter(([key]) => key === "combination" || submitted || touched[key])
      .map(([key, error]) => [key, fieldMessage(key, form?.[key], error)]),
  );
  if (errors.combination) visibleErrors.combination = errors.combination;
  const filtered = useMemo(
    () =>
      rows
        .filter(
          (row) =>
            matchesMasterSearch(row, search) &&
            Object.entries(filters).every(
              ([key, value]) =>
                !value ||
                (["height", "width"].includes(key)
                  ? normalizeSize(row[key]) || "default"
                  : row[key]) === value,
            ),
        )
        .sort(
          (a, b) =>
            a.type.localeCompare(b.type) ||
            a.shape.localeCompare(b.shape) ||
            normalizeSize(a.height).localeCompare(
              normalizeSize(b.height),
              undefined,
              { numeric: true },
            ),
        ),
    [rows, search, filters],
  );
  const run = async (action) => {
    setBusy(true);
    setMessage("");
    try {
      await action();
    } catch (failure) {
      setMessage(
        failure.code
          ? "Unable to save Master Prices. Check your connection and permissions, then retry."
          : failure.message,
      );
    } finally {
      setBusy(false);
    }
  };
  const open = (row) => {
    setTouched({});
    setSubmitted(false);
    setPrevious(row || null);
    setForm(row ? { ...row } : { ...empty });
    setMessage("");
  };
  const readImport = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    await run(async () => {
      const XLSX = await import("xlsx"),
        book = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const sheet = book.Sheets[book.SheetNames[0]],
        matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
      if (!MASTER_PRICE_HEADERS.every((header) => matrix[0]?.includes(header)))
        throw new Error(
          "Template columns must include Type, Shape, Height, Width and Price. Width cells may be blank.",
        );
      setImportRows(
        XLSX.utils.sheet_to_json(sheet, { defval: "", blankrows: true }),
      );
      setResult(null);
    });
  };
  const print = () => {
    const popup = window.open("", "_blank");
    if (!popup) {
      setMessage("Please allow pop-ups to print Master Prices.");
      return;
    }
    popup.document.write(masterPricePrintHtml(filtered));
    popup.document.close();
    popup.focus();
    popup.print();
  };
  if (user?.role !== "superadmin") return null;
  // The shared subscription also serves Challan. Keep its state intact, but
  // describe connection failures in the context of this management page.
  const connectionMessage = error
    ? error.includes("offline")
      ? "You’re offline or still connecting. The price list may not be up to date."
      : error
    : "";
  return (
    <section className="master-prices">
      <header className="master-page-header">
        <div className="master-heading">
          <h2>Master Price List</h2>
          <p>Exact Challan prices by Type, Shape, Height and optional Width.</p>
        </div>
        <div
          className="master-toolbar master-actions"
          aria-label="Price list actions"
        >
          <button
            className="master-primary"
            onClick={() => open(null)}
            disabled={unsafe || busy}
            title={writeHint}
          >
            <PageIcon name="plus" />
            Add Price
          </button>
          <button
            onClick={() => fileRef.current.click()}
            disabled={busy || unsafe}
            title={writeHint}
          >
            Import
          </button>
          <button onClick={() => run(() => exportMasterPrices(filtered))}>
            Export Excel
          </button>
          <button onClick={print}>Print</button>
          <input
            ref={fileRef}
            type="file"
            hidden
            accept=".xlsx,.xls,.csv"
            onChange={readImport}
          />
        </div>
      </header>
      {((error && !loading && availability.phase === "ready") ||
        (message && !form && !candidate && !importRows)) && (
        <div role="alert" className="master-notice">
          <PageIcon name="notice" />
          <div>
            <strong>
              {message
                ? "Action couldn’t be completed"
                : "Price list unavailable"}
            </strong>
            <p>{message || connectionMessage}</p>
            {!message && <button onClick={retry}>Retry price list</button>}
          </div>
        </div>
      )}
      <div className="master-discovery">
        <label className="master-search">
          <span>Search prices</span>
          <div className="master-search-control">
            <PageIcon name="search" />
            <input
              aria-label="Search Master Prices"
              placeholder="Search Type, Shape, Height, Width or Price"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </label>
        {Object.keys(filters).map((key) => (
          <label key={key}>
            <span>{key}</span>
            <select
              aria-label={`Filter ${key}`}
              value={filters[key]}
              onChange={(event) =>
                setFilters({ ...filters, [key]: event.target.value })
              }
            >
              <option value="">All</option>
              {[
                ...new Set(
                  rows.map((row) =>
                    ["height", "width"].includes(key)
                      ? normalizeSize(row[key]) || "default"
                      : row[key],
                  ),
                ),
              ]
                .sort()
                .map((value) => (
                  <option key={value} value={value}>
                    {value === "default" ? "Default" : value}
                  </option>
                ))}
            </select>
          </label>
        ))}
      </div>
      {loading ? (
        <div className="master-state" role="status">
          <span className="master-state-icon">
            <PageIcon />
          </span>
          <h3>Loading Master Prices…</h3>
          <p>Your price list will appear here shortly.</p>
        </div>
      ) : (
        <div className="master-table-wrap">
          <div className="master-table-caption">
            <h3>Prices</h3>
            <span>
              {error && !rows.length
                ? "Connection unavailable"
                : `${error ? "Cached · " : ""}${filtered.length} of ${rows.length} records`}
            </span>
          </div>
          <table className="master-records" aria-label="Master Price records">
            <thead>
              <tr>
                {[...MASTER_PRICE_HEADERS, "Updated at", "Action"].map(
                  (header) => (
                    <th scope="col" key={header}>
                      {header}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.id}>
                  <td>{row.type}</td>
                  <td>{row.shape}</td>
                  <td>{normalizeSize(row.height)}</td>
                  <td>
                    {normalizeSize(row.width) || (
                      <span className="master-default">Default</span>
                    )}
                  </td>
                  <td className="master-money">
                    {Number(row.price).toLocaleString("en-IN", {
                      style: "currency",
                      currency: "INR",
                    })}
                  </td>
                  <td className="master-updated">
                    {row.updatedAt?.toDate?.().toLocaleString() ||
                      "Not recorded"}
                  </td>
                  <td className="master-row-actions">
                    <button
                      disabled={unsafe || busy}
                      title={writeHint}
                      onClick={() => open(row)}
                    >
                      Edit
                    </button>{" "}
                    <button
                      className="master-delete"
                      disabled={unsafe || busy}
                      title={writeHint}
                      onClick={() => setCandidate(row)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filtered.length && (
            <div className="master-state" role="status">
              <span className="master-state-icon">
                <PageIcon name={error ? "notice" : "list"} />
              </span>
              <h3>
                {error
                  ? "Price list is unavailable"
                  : rows.length
                    ? "No Master Prices match these filters."
                    : "No Master Prices added yet."}
              </h3>
              <p>
                {error
                  ? "Records will appear when the connection is restored."
                  : rows.length
                    ? "Try another search or adjust your filters."
                    : "Add your first price or import a spreadsheet to get started."}
              </p>
            </div>
          )}
        </div>
      )}
      {form && (
        <div className="master-overlay">
          <form
            ref={dialogRef}
            noValidate
            className="master-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={previous ? "Edit Master Price" : "Add Master Price"}
            onKeyDown={(event) => {
              if (event.key === "Escape" && !busy) {
                event.preventDefault();
                setForm(null);
              }
              if (event.key === "Tab") {
                const controls = [
                  ...event.currentTarget.querySelectorAll(
                    "input:not(:disabled),button:not(:disabled)",
                  ),
                ];
                const first = controls[0],
                  last = controls.at(-1);
                if (event.shiftKey && document.activeElement === first) {
                  event.preventDefault();
                  last?.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                  event.preventDefault();
                  first?.focus();
                }
              }
            }}
            onSubmit={(event) => {
              event.preventDefault();
              setSubmitted(true);
              if (Object.keys(errors).length) {
                const first = Object.keys(empty).find((key) => errors[key]);
                if (first)
                  event.currentTarget.elements.namedItem(first)?.focus();
                return;
              }
              if (!busy && !unsafe && !Object.keys(errors).length)
                run(async () => {
                  await saveMasterPrice(form, user, previous);
                  setForm(null);
                });
            }}
          >
            <h3>{previous ? "Edit" : "Add"} Master Price</h3>
            <p className="master-dialog-intro">
              Set the price for one exact combination. Width is optional.
            </p>
            <div className="master-fields">
              {Object.keys(empty).map((key) => (
                <label
                  key={key}
                  className={key === "price" ? "master-price-field" : undefined}
                >
                  <span className="master-field-label">
                    {key[0].toUpperCase() + key.slice(1)}
                    {key === "width" ? (
                      <span className="master-optional">Optional</span>
                    ) : (
                      <span className="master-required" aria-hidden="true">
                        *
                      </span>
                    )}
                  </span>
                  <input
                    name={key}
                    disabled={busy}
                    aria-required={key !== "width"}
                    aria-label={key[0].toUpperCase() + key.slice(1)}
                    inputMode={
                      ["height", "width", "price"].includes(key)
                        ? "decimal"
                        : undefined
                    }
                    list={
                      ["type", "shape"].includes(key)
                        ? `master-${key}`
                        : undefined
                    }
                    value={form[key]}
                    aria-invalid={Boolean(visibleErrors[key])}
                    aria-describedby={
                      visibleErrors[key] ? `master-error-${key}` : undefined
                    }
                    onChange={(event) => {
                      setTouched((old) => ({ ...old, [key]: true }));
                      setForm({ ...form, [key]: event.target.value });
                      setMessage("");
                    }}
                    onBlur={() => {
                      setTouched((old) => ({ ...old, [key]: true }));
                      if (["height", "width"].includes(key) && !errors[key])
                        setForm({ ...form, [key]: normalizeSize(form[key]) });
                    }}
                  />
                  {visibleErrors[key] && (
                    <small id={`master-error-${key}`} className="master-error">
                      {visibleErrors[key]}
                    </small>
                  )}
                </label>
              ))}
            </div>
            {["type", "shape"].map((key) => (
              <datalist id={`master-${key}`} key={key}>
                {[
                  ...new Set([
                    ...rows.map((row) => row[key]),
                    ...(key === "type" ? ["CVD", "HP"] : DEFAULT_SHAPES),
                  ]),
                ].map((value) => (
                  <option key={value} value={value} />
                ))}
              </datalist>
            ))}
            {errors.combination && (
              <p className="master-error" role="alert">
                {errors.combination}
              </p>
            )}
            {message && (
              <p role="alert" className="master-error">
                {message}
              </p>
            )}
            <p className="master-form-help">
              Blank Width is a Height-only price. It is never a fallback for an
              entered Width.
            </p>
            <footer className="master-dialog-actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => setForm(null)}
              >
                Cancel
              </button>

              <button
                className="master-primary"
                type="submit"
                disabled={busy || unsafe}
                title={writeHint}
              >
                {busy ? "Saving..." : "Save Price"}
              </button>
            </footer>
          </form>
        </div>
      )}
      {candidate && (
        <div className="master-overlay">
          <section
            className="master-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Delete Master Price"
          >
            <h3>Delete Master Price?</h3>
            <p>
              This deactivates {candidate.type} / {candidate.shape} / H
              {candidate.height} /{" "}
              {candidate.width ? `W${candidate.width}` : "Default"}. Saved
              Challans keep their prices.
            </p>
            {message && <p role="alert">{message}</p>}
            <footer className="master-dialog-actions">
              <button
                className="master-danger"
                disabled={busy || unsafe}
                onClick={() =>
                  run(async () => {
                    await deleteMasterPrice(candidate, user);
                    setCandidate(null);
                  })
                }
              >
                Confirm Delete
              </button>{" "}
              <button disabled={busy} onClick={() => setCandidate(null)}>
                Cancel
              </button>
            </footer>
          </section>
        </div>
      )}
      {importRows && (
        <div className="master-overlay">
          <section
            className="master-dialog master-import"
            role="dialog"
            aria-modal="true"
            aria-label="Import Master Prices"
          >
            <h3>Import Master Prices</h3>
            <p>Existing combinations are rejected, never overwritten.</p>
            {result ? (
              <>
                <p>
                  {result.filter((row) => row.added).length} added;{" "}
                  {result.filter((row) => !row.added).length} rejected.
                </p>
                <pre>
                  {result
                    .filter((row) => !row.added)
                    .map(
                      (row) =>
                        `Row ${row.rowNumber}: ${Object.entries(row.errors)
                          .map(([field, reason]) => `${field}: ${reason}`)
                          .join(" ")}`,
                    )
                    .join("\n")}
                </pre>
              </>
            ) : (
              ["Ready to import", "Needs attention"].map((title, index) => (
                <section key={title}>
                  <h4>
                    {title} (
                    {
                      preview.filter(
                        (row) =>
                          Boolean(Object.keys(row.errors).length) ===
                          Boolean(index),
                      ).length
                    }
                    )
                  </h4>
                  <div className="master-table-wrap">
                    <table>
                      <thead>
                        <tr>
                          {["Row", ...MASTER_PRICE_HEADERS, "Result"].map(
                            (header) => (
                              <th scope="col" key={header}>
                                {header}
                              </th>
                            ),
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {preview
                          .filter(
                            (row) =>
                              Boolean(Object.keys(row.errors).length) ===
                              Boolean(index),
                          )
                          .map((row) => (
                            <tr key={row.rowNumber}>
                              <td>{row.rowNumber}</td>
                              {Object.keys(empty).map((key) => (
                                <td key={key}>
                                  {row[key] === "" && key === "width"
                                    ? "Default"
                                    : String(row[key])}
                                </td>
                              ))}
                              <td>
                                {Object.entries(row.errors)
                                  .map(
                                    ([field, reason]) => `${field}: ${reason}`,
                                  )
                                  .join(" ") || "Ready to import"}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ))
            )}
            {message && <p role="alert">{message}</p>}
            <footer className="master-dialog-actions">
              {!result && (
                <button
                  className="master-primary"
                  disabled={
                    unsafe ||
                    busy ||
                    !preview.some((row) => !Object.keys(row.errors).length)
                  }
                  onClick={() =>
                    run(async () =>
                      setResult(await importMasterPrices(preview, user)),
                    )
                  }
                >
                  Import Ready Rows
                </button>
              )}{" "}
              <button disabled={busy} onClick={() => setImportRows(null)}>
                Close
              </button>
            </footer>
          </section>
        </div>
      )}
    </section>
  );
}
