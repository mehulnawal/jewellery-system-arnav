import { useEffect, useMemo, useState } from "react";
import "./challan.css";
import {
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { db } from "../../firebase/config";
import { useAuth } from "../../auth/AuthContext";
import { inventoryMatchesSearch } from "../../utils/inventoryRules";

const STAGES = {
  1: "Goods Out",
  2: "Return / Sale",
  3: "Payment Pending",
  4: "Completed",
};
const today = () => new Date().toISOString().slice(0, 10);
const blank = () => ({
  id: crypto.randomUUID(),
  sku: "",
  shape: "",
  size: "",
  type: "",
  weight: "",
  pieces: "",
});
const matchesChallanSearch = (challan, query) =>
  !query.trim() ||
  (String(challan.number || "") + " " + String(challan.party || ""))
    .toLowerCase()
    .includes(query.trim().toLowerCase()) ||
  challan.items.some((item) => inventoryMatchesSearch(item, query));
const Icon = ({ name }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.9"
    strokeLinecap="round"
  >
    <path
      d={
        name === "plus"
          ? "M12 5v14M5 12h14"
          : name === "search"
            ? "M16 16l4 4"
            : name === "back"
              ? "m15 18-6-6 6-6"
              : "m9 18 6-6-6-6"
      }
    />
    {name === "search" && <circle cx="10.8" cy="10.8" r="6" />}
  </svg>
);
const SkuPicker = ({ value, inventory, onChange, onSelect }) => {
  const [open, setOpen] = useState(false);
  const matches = inventory
    .filter((item) =>
      `${item.sku} ${item.shape} ${item.size} ${item.type} ${item.weight}`
        .toLowerCase()
        .includes(value.toLowerCase()),
    )
    .slice(0, 8);
  return (
    <div className="sku-picker">
      <input
        value={value}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 140)}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
        }}
        placeholder="Search SKU..."
        autoComplete="off"
      />
      {open && (
        <div className="sku-menu" role="listbox">
          {matches.length ? (
            matches.map((item) => (
              <button
                type="button"
                key={item.id}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onSelect(item);
                  setOpen(false);
                }}
              >
                <b>{item.sku}</b>
                <span>{Number(item.weight || 0).toFixed(3)} ct</span>
                <small>{item.shape} · {item.size} mm · {item.type}</small>
              </button>
            ))
          ) : (
            <p>No matching SKU found.</p>
          )}
        </div>
      )}
    </div>
  );
};
export default function Challan() {
  const { user } = useAuth();
  const [records, setRecords] = useState(() =>
    JSON.parse(localStorage.getItem("challans") || "[]"),
  );
  const [page, setPage] = useState("list"),
    [tab, setTab] = useState("all"),
    [search, setSearch] = useState("");
  const [dateFilter, setDateFilter] = useState(""),
    [partyFilter, setPartyFilter] = useState(""),
    [agingFilter, setAgingFilter] = useState("all"),
    [sortMode, setSortMode] = useState("newest");
  const [form, setForm] = useState({
    date: today(),
    party: "",
    notes: "",
    items: [blank()],
  });
  const [inventory, setInventory] = useState([]);
  const [partyOptions, setPartyOptions] = useState([]);
  useEffect(
    () => localStorage.setItem("challans", JSON.stringify(records)),
    [records],
  );
  useEffect(
    () =>
      onSnapshot(
        collection(db, "inventory"),
        (snapshot) =>
          setInventory(
            snapshot.docs.map((item) => ({ id: item.id, ...item.data() })),
          ),
        () => setInventory([]),
      ),
    [],
  );
  useEffect(
    () =>
      onSnapshot(
        collection(db, "parties"),
        (snapshot) =>
          setPartyOptions(
            snapshot.docs
              .map((item) => item.data()?.name)
              .filter(Boolean)
              .sort((a, b) => a.localeCompare(b)),
          ),
        () => setPartyOptions([]),
      ),
    [],
  );
  const count = (stage) =>
    stage === "all"
      ? records.length
      : records.filter((item) => item.stage === Number(stage)).length;
  const parties = useMemo(
    () =>
      [
        ...new Set([...partyOptions, ...records.map((item) => item.party)]),
      ].sort((a, b) => a.localeCompare(b)),
    [records, partyOptions],
  );
  const shown = useMemo(
    () =>
      records
        .filter((item) => {
          const age = Math.floor((Date.now() - item.createdAt) / 86400000),
            matchAge =
              agingFilter === "all" ||
              (agingFilter === "green" && age <= 7) ||
              (agingFilter === "yellow" && age > 7 && age <= 30) ||
              (agingFilter === "red" && age > 30);
          return (
            (tab === "all" || item.stage === Number(tab)) &&
            (!dateFilter || item.date === dateFilter) &&
            (!partyFilter || item.party === partyFilter) &&
            matchAge &&
            `${item.number} ${item.party} ${item.items.map((row) => row.sku).join(" ")}`
              .toLowerCase()
              .includes(search.toLowerCase())
          );
        })
        .sort((a, b) =>
          sortMode === "newest"
            ? b.createdAt - a.createdAt
            : a.createdAt - b.createdAt,
        ),
    [records, search, tab, dateFilter, partyFilter, agingFilter, sortMode],
  );
  const itemChange = (id, key, value) =>
    setForm((state) => ({
      ...state,
      items: state.items.map((item) =>
        item.id === id ? { ...item, [key]: value } : item,
      ),
    }));
  const selectSku = (id, selected) =>
    setForm((state) => ({
      ...state,
      items: state.items.map((item) =>
        item.id === id
          ? {
              ...item,
              sku: selected.sku || "",
              shape: selected.shape || "",
              size: selected.size || "",
              type: selected.type || "",
              weight: selected.weight ?? "",
            }
          : item,
      ),
    }));
  const saveParty = async (name) => {
    if (user?.role !== "superadmin") return;
    const partyName = name.trim();
    if (!partyName) return;
    const normalized = partyName.toLocaleLowerCase();
    await setDoc(
      doc(db, "parties", encodeURIComponent(normalized)),
      {
        name: partyName,
        normalized,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  };
  const create = async (event) => {
    event.preventDefault();
    const items = form.items.filter((item) => item.sku.trim()),
      party =
        parties.find(
          (name) =>
            name.toLocaleLowerCase() === form.party.trim().toLocaleLowerCase(),
        ) || form.party.trim();
    if (!party || !items.length) return;
    await saveParty(party);
    setRecords((state) => [
      {
        id: crypto.randomUUID(),
        number: `C_${String(new Date().getMonth() + 1).padStart(2, "0")}_${Date.now().toString().slice(-6)}`,
        party,
        date: form.date,
        notes: form.notes,
        items,
        stage: 1,
        createdAt: Date.now(),
      },
      ...state,
    ]);
    setForm({ date: today(), party: "", notes: "", items: [blank()] });
    setPage("list");
  };
  const advance = (id) =>
    setRecords((state) =>
      state.map((item) =>
        item.id === id ? { ...item, stage: Math.min(4, item.stage + 1) } : item,
      ),
    );
  if (page === "create")
    return (
      <section className="challan-page challan-create">
        <button
          className="back"
          type="button"
          onClick={() => setPage("list")}
          aria-label="Back to Challans"
        >
          <Icon name="back" /> Back to Challans
        </button>
        <header>
          <h2>Create Challan</h2>
          <span>Stage 1 - Goods Out</span>
        </header>
        <form onSubmit={create}>
          <datalist id="challan-skus">
            {inventory.map((item) => (
              <option key={item.id} value={item.sku}>
                {item.shape} · {item.size} mm · {item.type}
              </option>
            ))}
          </datalist>
          <datalist id="challan-parties">
            {parties.map((party) => (
              <option key={party} value={party} />
            ))}
          </datalist>
          <article>
            <h3>Challan Details</h3>
            <div className="challan-fields">
              <label>
                Date
                <input
                  type="date"
                  value={form.date}
                  onChange={(event) =>
                    setForm({ ...form, date: event.target.value })
                  }
                />
              </label>
              <label>
                Challan No.
                <input disabled value="Auto-generated" />
              </label>
              <label>
                Party Name *
                <input
                  list="challan-parties"
                  value={form.party}
                  onChange={(event) =>
                    setForm({ ...form, party: event.target.value })
                  }
                  placeholder="Search or select a party..."
                  required
                />
                <small className="party-help">
                  {user?.role === "superadmin"
                    ? "New names are saved once and appear here next time."
                    : "Select an existing party from the list."}
                </small>
              </label>
            </div>
          </article>
          <article>
            <h3>Inventory Items</h3>
            <div className="item-head">
              <span>Inventory SKU * <em className="live-weight-label">live weight</em></span>
              <span>Shape</span>
              <span>Size</span>
              <span>Type</span>
              <span>Weight / Carat</span>
              <span>Pieces</span>
              <span />
            </div>
            {form.items.map((item) => (
              <div className="challan-item" key={item.id}>
                <SkuPicker
                  value={item.sku}
                  inventory={inventory}
                  onChange={(value) => itemChange(item.id, "sku", value)}
                  onSelect={(selected) => selectSku(item.id, selected)}
                />
                {["shape", "size", "type", "weight", "pieces"].map((key) => (
                  <input
                    key={key}
                    type={key === "weight" || key === "pieces" ? "number" : "text"}
                    value={item[key]}
                    readOnly={["shape", "size", "type"].includes(key)}
                    onChange={(event) => itemChange(item.id, key, event.target.value)}
                    placeholder={key === "weight" ? "Weight (ct)" : key}
                  />
                ))}
                <button
                  className="remove-item"
                  type="button"
                  disabled={form.items.length === 1}
                  onClick={() =>
                    setForm((state) => ({
                      ...state,
                      items: state.items.filter((row) => row.id !== item.id),
                    }))
                  }
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              className="add"
              onClick={() =>
                setForm((state) => ({
                  ...state,
                  items: [...state.items, blank()],
                }))
              }
            >
              <Icon name="plus" /> Add Another Item
            </button>
          </article>
          <article>
            <h3>Comments / Notes</h3>
            <textarea
              rows="3"
              value={form.notes}
              onChange={(event) =>
                setForm({ ...form, notes: event.target.value })
              }
              placeholder="Add any note for this challan..."
            />
          </article>
          <footer>
            <button type="button" onClick={() => setPage("list")}>
              Cancel
            </button>
            <button className="primary">Create Challan</button>
          </footer>
        </form>
      </section>
    );
  return (
    <section className="challan-page">
      <header className="challan-heading">
        <div>
          <h2>Challan Management</h2>
          <p>Manage goods out, returns, payments and completed challans.</p>
        </div>
        <button className="primary" onClick={() => setPage("create")}>
          <Icon name="plus" /> Create Challan
        </button>
      </header>
      <label className="search">
        <Icon name="search" />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search Challan No., Party, Inventory SKU, Shape, Size or Type..."
        />
      </label>
      <nav>
        {[
          ["all", "All Challans"],
          [1, "Stage 1"],
          [2, "Stage 2"],
          [3, "Stage 3"],
          [4, "Stage 4"],
        ].map(([key, label]) => (
          <button
            key={key}
            className={String(tab) === String(key) ? "active" : ""}
            onClick={() => setTab(key)}
          >
            {label} <small>{count(key)}</small>
          </button>
        ))}
      </nav>
      <div className="metrics">
        {[
          ["Total Challans", count("all")],
          ["Goods Out", count(1)],
          ["Payment Pending", count(3)],
          ["Completed", count(4)],
        ].map(([label, value]) => (
          <article key={label}>
            <span>{label}</span>
            <b>{value}</b>
          </article>
        ))}
      </div>
      <div className="challan-filters">
        <label>
          Date
          <input
            type="date"
            value={dateFilter}
            onChange={(event) => setDateFilter(event.target.value)}
          />
        </label>
        <label>
          Party
          <select
            value={partyFilter}
            onChange={(event) => setPartyFilter(event.target.value)}
          >
            <option value="">All parties</option>
            {parties.map((party) => (
              <option key={party}>{party}</option>
            ))}
          </select>
        </label>
        <label>
          Aging
          <select
            value={agingFilter}
            onChange={(event) => setAgingFilter(event.target.value)}
          >
            <option value="all">All</option>
            <option value="green">Green</option>
            <option value="yellow">Yellow</option>
            <option value="red">Red</option>
          </select>
        </label>
        <label>
          Sort
          <select
            value={sortMode}
            onChange={(event) => setSortMode(event.target.value)}
          >
            <option value="newest">Newest First</option>
            <option value="oldest">Oldest First</option>
          </select>
        </label>
      </div>
      <p className="showing">Showing {shown.length} Challans</p>
      {shown.length ? (
        <div className="challan-list">
          <div className="list-head">
            <span>Challan / Party</span>
            <span>Items</span>
            <span>Date</span>
            <span>Qty</span>
            <span>Stage</span>
            <span>Actions</span>
          </div>
          {shown.map((row) => (
            <div className="challan-row" key={row.id}>
              <div>
                <b>{row.number}</b>
                <small>{row.party}</small>
              </div>
              <span>{row.items.map((item) => item.sku).join(", ")}</span>
              <time>{row.date}</time>
              <b>
                {row.items.reduce(
                  (sum, item) => sum + Number(item.pieces || 0),
                  0,
                )}
              </b>
              <em className={`stage stage-${row.stage}`}>
                Stage {row.stage} — {STAGES[row.stage]}
              </em>
              <button
                disabled={row.stage === 4}
                onClick={() => advance(row.id)}
              >
                {row.stage === 4 ? "Completed" : STAGES[row.stage + 1]}{" "}
                <Icon name="arrow" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty">
          <h3>
            {records.length ? "No challans found" : "No challans created yet"}
          </h3>
          <p>
            {records.length
              ? "Try changing your search or stage filter."
              : "Create your first Stage 1 challan to get started."}
          </p>
          <button className="primary" onClick={() => setPage("create")}>
            <Icon name="plus" /> Create First Challan
          </button>
        </div>
      )}
    </section>
  );
}


