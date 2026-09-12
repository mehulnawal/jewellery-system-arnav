import { useEffect, useMemo, useRef, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "../../firebase/config";
import { getAgeingColor, getAgeingDays } from "../../config/ageingConfig";
import {
  DEFAULT_SHAPES,
  formatDecimal,
  inventoryMatchesSearch,
  orderShapes,
} from "../../utils/inventoryRules";
import "./checkInventory.css";
const LEGACY_SHAPES = orderShapes([...DEFAULT_SHAPES, "Pear", "Heart"]),
  AGEING = [
    "Any ageing",
    "Green (1-30 days)",
    "Yellow (31-45 days)",
    "Red (45+ days)",
  ],
  SORT = ["Newest first", "Oldest first", "Heaviest first", "Lightest first"];
const normal = (value) => String(value ?? "").toLowerCase(),
  dateMs = (item) =>
    item.createdAt?.toDate?.().getTime() ?? item.createdAtMs ?? 0;
const SearchIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    aria-hidden="true"
  >
    <circle cx="11" cy="11" r="6" />
    <path d="m16 16 4 4" />
  </svg>
);
const ActionIcon = ({ name }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {name === "export" && (
      <>
        <path d="M12 3v12m0 0 4.5-4.5M12 15l-4.5-4.5" />
        <path d="M5 19.5V21h14v-1.5" />
      </>
    )}
    {name === "print" && (
      <>
        <path d="M7 8V3.5h10V8M7 17H5V10.5h14V17h-2" />
        <path d="M7 14h10v6.5H7z" />
      </>
    )}
  </svg>
);
export default function CheckInventory() {
  const searchRef = useRef(null),
    [items, setItems] = useState([]),
    [loading, setLoading] = useState(true),
    [shapes, setShapes] = useState(LEGACY_SHAPES),
    [input, setInput] = useState(""),
    [search, setSearch] = useState(""),
    [shape, setShape] = useState("All shapes"),
    [type, setType] = useState("All types"),
    [group, setGroup] = useState("All groups"),
    [ageing, setAgeing] = useState("Any ageing"),
    [sort, setSort] = useState("Newest first");
  useEffect(() => {
    const off = onSnapshot(
      query(collection(db, "inventory"), orderBy("createdAt", "desc")),
      (snap) => {
        setItems(snap.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
        setLoading(false);
      },
      () => setLoading(false),
    );
    return off;
  }, []);
  useEffect(() => {
    const off = onSnapshot(collection(db, "shapes"), (snap) =>
      setShapes(
        orderShapes([
          ...LEGACY_SHAPES,
          ...snap.docs.map((entry) => entry.data().value),
        ]),
      ),
    );
    return off;
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => setSearch(input.trim().toLowerCase()), 250);
    return () => clearTimeout(timer);
  }, [input]);
  useEffect(() => {
    const listener = (event) => {
      if (
        event.key === "/" &&
        !["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName)
      ) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
  const groups = useMemo(
      () =>
        [
          ...new Set([
            "Uncategorized",
            ...items.map((item) => item.group || "Uncategorized"),
          ]),
        ].sort(),
      [items],
    ),
    active = Boolean(
      search ||
      shape !== "All shapes" ||
      type !== "All types" ||
      group !== "All groups" ||
      ageing !== "Any ageing" ||
      sort !== "Newest first",
    ),
    result = useMemo(
      () =>
        items
          .filter((item) => {
            const age = getAgeingDays(item.createdAt, item.createdAtMs),
              match = inventoryMatchesSearch(item, search),
              ageMatch =
                ageing === "Any ageing" ||
                (ageing.startsWith("Green") &&
                  getAgeingColor(age) === "green") ||
                (ageing.startsWith("Yellow") &&
                  getAgeingColor(age) === "yellow") ||
                (ageing.startsWith("Red") && getAgeingColor(age) === "red");
            return (
              match &&
              (shape === "All shapes" || item.shape === shape) &&
              (type === "All types" || item.type === type) &&
              (group === "All groups" ||
                (item.group || "Uncategorized") === group) &&
              ageMatch
            );
          })
          .sort((a, b) =>
            sort === "Newest first"
              ? dateMs(b) - dateMs(a)
              : sort === "Oldest first"
                ? dateMs(a) - dateMs(b)
                : sort === "Heaviest first"
                  ? Number(b.weight) - Number(a.weight)
                  : Number(a.weight) - Number(b.weight),
          ),
      [items, search, shape, type, group, ageing, sort],
    ),
    visibleResult = active ? result : [],
    total = visibleResult.reduce(
      (sum, item) => sum + Number(item.weight || 0),
      0,
    );
  const exportResult = async () => {
    const XLSX = await import("xlsx"),
      rows = visibleResult.map((item) => ({
        Shape: item.shape,
        Type: item.type,
        "Weight (ct)": formatDecimal(item.weight),
        "Size (mm)": item.size,
        SKU: item.sku,
        Group: item.group || "Uncategorized",
        Status: "In Stock",
        Ageing: `${getAgeingDays(item.createdAt, item.createdAtMs)}d`,
      })),
      sheet = XLSX.utils.json_to_sheet(rows),
      book = XLSX.utils.book_new(),
      stamp = new Date()
        .toISOString()
        .slice(0, 16)
        .replace("T", "_")
        .replace(":", "-");
    XLSX.utils.book_append_sheet(book, sheet, `Check_Results_${stamp}`);
    XLSX.writeFile(book, `check_inventory_${stamp}.xlsx`);
  };
  return (
    <section className="check-inventory-module">
      <header>
        <div>
          <h2>Check Inventory</h2>
          <p>View-only lookup · weight in carats</p>
        </div>
        <div className="check-actions">
          <button disabled={!visibleResult.length} onClick={exportResult}>
            <ActionIcon name="export" />
            Export Excel
          </button>
          <button
            disabled={!visibleResult.length}
            onClick={() => window.print()}
          >
            <ActionIcon name="print" />
            Print
          </button>
        </div>
      </header>
      {loading && (
        <div className="check-empty check-loading">
          <i />
          Loading inventory...
        </div>
      )}
      <label className="check-search">
        <input
          ref={searchRef}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Search shape, type, weight (ct) or SKU..."
        />
        <kbd>(press /)</kbd>
      </label>
      <div className="check-filters">
        <Filter
          label="Shapes"
          value={shape}
          onChange={setShape}
          options={["All shapes", ...shapes]}
        />
        <Filter
          label="Types"
          value={type}
          onChange={setType}
          options={["All types", "CVD", "HP"]}
        />
        <Filter
          label="Groups"
          value={group}
          onChange={setGroup}
          options={["All groups", ...groups]}
        />
        <Filter
          label="Ageing"
          value={ageing}
          onChange={setAgeing}
          options={AGEING}
        />
        <Filter label="Sort" value={sort} onChange={setSort} options={SORT} />
      </div>
      {!active ? (
        <div className="check-empty check-start">
          <SearchIcon />
          <strong>Start typing to search inventory</strong>
          <span>Or pick a filter above</span>
        </div>
      ) : (
        <>
          {search && (
            <div className="check-matched">
              <span>MATCHED SPEC</span>
              <h3>“{input}”</h3>
            </div>
          )}
          <div className="check-total">
            <small>TOTAL WEIGHT</small>
            <strong>
              {formatDecimal(total)} <i>ct</i>
            </strong>
          </div>
          {visibleResult.length ? (
            <div className="check-cards">
              {visibleResult.map((item) => (
                <Card key={item.id} item={item} />
              ))}
            </div>
          ) : (
            <div className="check-empty">No matching items</div>
          )}
        </>
      )}
      <table className="check-print-table">
        <caption>Check Inventory Results</caption>
        <thead>
          <tr>
            {[
              "Shape",
              "Type",
              "Weight (ct)",
              "Size (mm)",
              "SKU",
              "Group",
              "Ageing",
            ].map((heading) => (
              <th key={heading}>{heading}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visibleResult.map((item) => (
            <tr key={item.id}>
              <td>{item.shape}</td>
              <td>{item.type}</td>
              <td>{formatDecimal(item.weight)}</td>
              <td>{item.size}</td>
              <td>{item.sku}</td>
              <td>{item.group || "Uncategorized"}</td>
              <td>{getAgeingDays(item.createdAt, item.createdAtMs)}d</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
function Filter({ label, value, onChange, options }) {
  return (
    <label className="check-filter">
      <span>{label}</span>
      <div className="check-select-wrap">
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          {options.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </div>
    </label>
  );
}
function Card({ item }) {
  const days = getAgeingDays(item.createdAt, item.createdAtMs);
  return (
    <article className="check-card">
      <div className="check-card-top">
        <h3>{item.shape}</h3>
        <span className={`check-age ${getAgeingColor(days)}`}>
          <i />
          {days}d
        </span>
      </div>
      <span className={`check-type ${normal(item.type)}`}>{item.type}</span>
      <div className="check-card-details">
        <div>
          <strong>
            {formatDecimal(item.weight)} <i>ct</i>
          </strong>
          <p>{item.size} mm</p>
        </div>
        <div className="check-card-meta">
          <span>{item.sku}</span>
          <span>{item.group || "Uncategorized"}</span>
        </div>
      </div>
    </article>
  );
}
