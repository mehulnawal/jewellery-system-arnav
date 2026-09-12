import { useEffect, useMemo, useState } from "react";
import "./challan.css";
import {
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  deleteDoc,
} from "firebase/firestore";
import { db } from "../../firebase/config";
import { useAuth } from "../../auth/AuthContext";
import { inventoryMatchesSearch } from "../../utils/inventoryRules";
import { writeActivity } from "../../utils/activityLog";
import { isWholePieces, pieceValue } from "../../utils/pieces";
import { usePageFreeze } from "../../hooks/usePageFreeze";

const STAGES = {
  1: "Goods Out",
  2: "Return / Sale",
  3: "Payment Pending",
  4: "Completed",
};
const today = () => new Date().toISOString().slice(0, 10);
const pricingFor = (amount, discount) => {
  const value = Math.max(0, Number(amount) || 0),
    rate = Math.max(0, Number(discount) || 0);
  const discountAmount = Number(((value * rate) / 100).toFixed(2));
  return {
    amount: value,
    discount: rate,
    discountAmount,
    netAmount: Number((value - discountAmount).toFixed(2)),
  };
};
const challanSnapshot = (record) => ({
  challanNo: record.number || "",
  partyName: record.party || "",
  amount: Number(record.amount || 0),
  discount: Number(record.discount || 0),
  discountAmount: Number(record.discountAmount || 0),
  netAmount: Number(record.netAmount ?? record.amount ?? 0),
  stage: Number(record.stage || 1),
  inventoryItems: (record.items || []).map((item) => ({
    sku: item.sku || "",
    weight: Number(item.weight || 0),
    pieces: pieceValue(item.pieces),
    amount: Number(item.amount || 0),
    discount: Number(item.discount || 0),
    discountAmount: Number(item.discountAmount || 0),
    netAmount: Number(item.netAmount ?? item.amount ?? 0),
  })),
});
const STAFF_EDIT_WINDOW_MS = 60 * 60 * 1000;
const CHALLAN_AGING = {
  green: 24 * 60 * 60 * 1000,
  yellow: 60 * 60 * 60 * 1000,
  red: 5 * 24 * 60 * 60 * 1000,
};
const timestampMs = (value) =>
  value?.toMillis?.() ??
  (value instanceof Date ? value.getTime() : Number(value) || 0);
const formatElapsed = (milliseconds) => {
  const minutes = Math.max(0, Math.floor(milliseconds / 60000));
  const days = Math.floor(minutes / 1440),
    hours = Math.floor((minutes % 1440) / 60),
    mins = minutes % 60;
  return days
    ? days + "d " + hours + "h"
    : hours
      ? hours + "h " + mins + "m"
      : mins + "m";
};
const formatEditCountdown = (milliseconds) => {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return (
    Math.floor(seconds / 60) +
    "m " +
    String(seconds % 60).padStart(2, "0") +
    "s"
  );
};
const challanAging = (record, now) => {
  const elapsed = Math.max(0, now - timestampMs(record.createdAt));
  const status =
    elapsed < CHALLAN_AGING.green
      ? "green"
      : elapsed < CHALLAN_AGING.red
        ? "yellow"
        : "red";
  return {
    status,
    elapsed,
    label: status.toUpperCase(),
    elapsedLabel: formatElapsed(elapsed),
  };
};
const stageEnteredAt = (record, stage) =>
  timestampMs(
    record.stageHistory?.["stage" + stage]?.enteredAtMs ??
      (stage === 1
        ? record.createdAt
        : stage === 2
          ? record.stage2Return?.transitionedAtMs
          : 0),
  );
const formatStageDate = (value) =>
  value
    ? new Date(value).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "";
const formatStageTime = (value) =>
  value
    ? new Date(value).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      })
    : "";
const blank = () => ({
  id: crypto.randomUUID(),
  sku: "",
  shape: "",
  size: "",
  type: "",
  weight: "",
  pieces: "",
  amount: "",
  discount: "",
});
const stockPieces = (item) =>
  pieceValue(item?.pieces ?? item?.quantity ?? item?.qty);
const stockError = (items, inventory) => {
  const totals = new Map();
  for (const item of items) {
    if (!item.sku) continue;
    if (item.pieces !== "" && !isWholePieces(item.pieces))
      return "Pieces must be a whole number.";
    const current = totals.get(item.sku) || { weight: 0, pieces: 0 };
    current.weight += Number(item.weight || 0);
    current.pieces += pieceValue(item.pieces);
    totals.set(item.sku, current);
  }
  for (const [sku, requested] of totals) {
    const source = inventory.find((entry) => entry.sku === sku);
    if (!source) continue;
    if (requested.weight > Number(source.weight || 0))
      return `Weight for ${sku} cannot exceed available ${Number(source.weight || 0).toFixed(3)} ct.`;
    if (requested.pieces > stockPieces(source))
      return `Pieces for ${sku} cannot exceed available ${stockPieces(source)} pcs.`;
  }
  return "";
};
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
              : name === "check"
                ? "m5 12 4.2 4.2L19 6.5"
                : "m9 18 6-6-6-6"
      }
    />
    {name === "search" && <circle cx="10.8" cy="10.8" r="6" />}
  </svg>
);
const SkuPicker = ({ value, inventory, onChange, onSelect, autoFocus }) => {
  const [open, setOpen] = useState(false),
    [highlighted, setHighlighted] = useState(0);
  const selected = inventory.find((item) => item.sku === value);
  const matches = inventory
    .filter((item) =>
      (
        String(item.sku) +
        " " +
        String(item.shape) +
        " " +
        String(item.size) +
        " " +
        String(item.type) +
        " " +
        String(item.weight)
      )
        .toLowerCase()
        .includes(value.toLowerCase()),
    )
    .slice(0, 8);
  const choose = (item) => {
    if (!item) return;
    onSelect(item);
    setOpen(false);
  };
  const keys = (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setHighlighted((current) => {
        const count = matches.length || 1;
        return event.key === "ArrowDown"
          ? (current + 1) % count
          : (current - 1 + count) % count;
      });
    }
    if (event.key === "Enter" && open) {
      event.preventDefault();
      choose(matches[highlighted]);
    }
    if (event.key === "Escape") setOpen(false);
  };
  return (
    <div className="sku-picker">
      <input
        value={value}
        onFocus={() => {
          setOpen(true);
          setHighlighted(0);
        }}
        onBlur={() => window.setTimeout(() => setOpen(false), 140)}
        onKeyDown={keys}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
          setHighlighted(0);
        }}
        placeholder="Search SKU..."
        autoFocus={autoFocus}
        autoComplete="off"
        aria-expanded={open}
        aria-controls="challan-sku-options"
      />
      {selected && (
        <small className="stock-availability">
          Avail: {Number(selected.weight || 0).toFixed(3)} ct /{" "}
          {stockPieces(selected)} pcs
        </small>
      )}
      {open && (
        <div className="sku-menu" id="challan-sku-options" role="listbox">
          {matches.length ? (
            matches.map((item, index) => (
              <button
                type="button"
                key={item.id}
                className={index === highlighted ? "keyboard-active" : ""}
                role="option"
                aria-selected={index === highlighted}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setHighlighted(index)}
                onClick={() => choose(item)}
              >
                <b>{item.sku}</b>
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
const PartyPicker = ({ value, parties, onChange }) => {
  const [open, setOpen] = useState(false),
    [highlighted, setHighlighted] = useState(0);
  const matches = parties
    .filter((party) =>
      party.toLocaleLowerCase().includes(value.toLocaleLowerCase()),
    )
    .slice(0, 10);
  const choose = (party) => {
    if (!party) return;
    onChange(party);
    setOpen(false);
  };
  const keys = (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setHighlighted((current) => {
        const count = matches.length || 1;
        return event.key === "ArrowDown"
          ? (current + 1) % count
          : (current - 1 + count) % count;
      });
    }
    if (event.key === "Enter" && open && matches.length) {
      event.preventDefault();
      choose(matches[highlighted]);
    }
    if (event.key === "Escape") setOpen(false);
  };
  return (
    <div className="party-picker">
      <input
        value={value}
        onFocus={() => {
          setOpen(true);
          setHighlighted(0);
        }}
        onBlur={() => window.setTimeout(() => setOpen(false), 140)}
        onKeyDown={keys}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
          setHighlighted(0);
        }}
        placeholder="Search, select or enter a new party..."
        autoComplete="off"
        required
        aria-expanded={open}
        aria-controls="challan-party-options"
      />
      {open && (
        <div className="party-menu" id="challan-party-options" role="listbox">
          {matches.length ? (
            matches.map((party, index) => (
              <button
                type="button"
                key={party}
                className={index === highlighted ? "keyboard-active" : ""}
                role="option"
                aria-selected={index === highlighted}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setHighlighted(index)}
                onClick={() => choose(party)}
              >
                {party}
              </button>
            ))
          ) : (
            <p>New party: {value.trim() || "type a name"}</p>
          )}
        </div>
      )}
    </div>
  );
};
const StageTwoModal = ({ record, onClose, onConfirm }) => {
  usePageFreeze();
  const [rows, setRows] = useState(() =>
    record.items.map((item) => ({
      id: item.id || item.sku,
      returnPieces: "",
      returnWeight: "",
    })),
  );
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const issuedPieces = (item) => pieceValue(item.pieces);
  const issuedWeight = (item) => Number(item.weight || 0);
  const update = (id, key, value) => {
    if (key === "returnPieces" && !/^\d*$/.test(value)) return;
    if (key === "returnWeight" && !/^\d*(?:\.\d*)?$/.test(value)) return;
    const item = record.items.find((entry) => (entry.id || entry.sku) === id);
    const nextRow = {
      ...(rows.find((row) => row.id === id) || {}),
      [key]: value,
    };
    const message =
      key === "returnPieces"
        ? !isWholePieces(value) || pieceValue(value) > issuedPieces(item)
          ? "Return Pieces is required: enter a whole number from 0 to " +
            issuedPieces(item) +
            "."
          : ""
        : value === "" ||
            !Number.isFinite(Number(value)) ||
            Number(value) < 0 ||
            Number(value) > issuedWeight(item)
          ? "Return Weight is required: enter a value from 0 to " +
            issuedWeight(item).toFixed(3) +
            "."
          : "";
    setRows((current) => current.map((row) => (row.id === id ? nextRow : row)));
    setErrors((current) => ({ ...current, [id + key]: message }));
  };
  const validate = () => {
    const next = {};
    record.items.forEach((item, index) => {
      const row = rows[index],
        pieces = issuedPieces(item),
        weight = issuedWeight(item),
        rp = row.returnPieces,
        rw = row.returnWeight;
      if (!isWholePieces(rp) || pieceValue(rp) > pieces)
        next[row.id + "returnPieces"] = "Enter 0 to " + pieces;
      if (
        rw === "" ||
        !Number.isFinite(Number(rw)) ||
        Number(rw) < 0 ||
        Number(rw) > weight
      )
        next[row.id + "returnWeight"] = "Enter 0 to " + weight.toFixed(3);
    });
    setErrors(next);
    return !Object.keys(next).length;
  };
  const submit = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      await onConfirm(rows, notes);
    } catch (error) {
      setErrors({
        form:
          error.message || "Could not process this return. Please try again.",
      });
      setSaving(false);
    }
  };
  const totals = record.items.reduce(
    (sum, item, index) => {
      const row = rows[index],
        rp = pieceValue(row.returnPieces),
        rw = Number(row.returnWeight || 0);
      sum.issuedPieces += issuedPieces(item);
      sum.issuedWeight += issuedWeight(item);
      sum.returnPieces += rp;
      sum.returnWeight += rw;
      sum.soldPieces += issuedPieces(item) - rp;
      sum.soldWeight += issuedWeight(item) - rw;
      return sum;
    },
    {
      issuedPieces: 0,
      issuedWeight: 0,
      returnPieces: 0,
      returnWeight: 0,
      soldPieces: 0,
      soldWeight: 0,
    },
  );
  return (
    <div
      className="stage-two-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Process Return / Move to Stage 2"
      onMouseDown={onClose}
    >
      <section
        className="stage-two-modal"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <h3>Process Return / Move to Stage 2</h3>
          </div>
          <button
            type="button"
            className="stage-two-close"
            onClick={onClose}
            aria-label="Close"
          >
            {"\u00d7"}
          </button>
        </header>
        <div className="stage-two-info">
          <b>i</b>
          <span>
            Enter returned quantities for each item. Enter 0 if nothing was
            returned.
          </span>
        </div>
        <div className="stage-two-table-wrap">
          <div className="stage-two-table">
            <div className="stage-two-head">
              <span>SKU</span>
              <span className="divider">SHAPE</span>
              <span>
                ISSUED
                <br />
                PIECES
              </span>
              <span className="divider">
                ISSUED
                <br />
                WEIGHT
              </span>
              <span>
                RETURN
                <br />
                PIECES *
              </span>
              <span className="divider">
                RETURN
                <br />
                WEIGHT *
              </span>
              <span>
                SOLD
                <br />
                PIECES
              </span>
              <span className="divider">
                SOLD
                <br />
                WEIGHT
              </span>
              <span>AMOUNT</span>
              <span>DISCOUNT</span>
            </div>
            {record.items.map((item, index) => {
              const row = rows[index],
                rp = pieceValue(row.returnPieces),
                rw = Number(row.returnWeight || 0),
                pieces = issuedPieces(item),
                weight = issuedWeight(item);
              return (
                <div className="stage-two-row" key={item.id || item.sku}>
                  <b>{item.sku}</b>
                  <span className="divider">{item.shape || "-"}</span>
                  <span>{pieces}</span>
                  <span className="divider">{weight.toFixed(3)}</span>
                  <label
                    className={
                      errors[row.id + "returnPieces"] ? "has-error" : ""
                    }
                  >
                    <input
                      value={row.returnPieces}
                      inputMode="numeric"
                      onChange={(event) =>
                        update(row.id, "returnPieces", event.target.value)
                      }
                    />
                    {errors[row.id + "returnPieces"] && (
                      <small>{errors[row.id + "returnPieces"]}</small>
                    )}
                  </label>
                  <label
                    className={
                      (errors[row.id + "returnWeight"] ? "has-error " : "") +
                      "divider"
                    }
                  >
                    <input
                      value={row.returnWeight}
                      inputMode="decimal"
                      onChange={(event) =>
                        update(row.id, "returnWeight", event.target.value)
                      }
                    />
                    {errors[row.id + "returnWeight"] && (
                      <small>{errors[row.id + "returnWeight"]}</small>
                    )}
                  </label>
                  <span>{pieces - rp}</span>
                  <span className="divider">{(weight - rw).toFixed(3)}</span>
                  <span>{Number(item.amount || 0).toFixed(2)}</span>
                  <span>{Number(item.discount || 0).toFixed(2)}%</span>
                </div>
              );
            })}
            <div className="stage-two-totals">
              <span />
              <span className="divider" />
              <strong>
                <small>Total Issued Pieces</small>
                {totals.issuedPieces}
              </strong>
              <strong className="divider">
                <small>Total Issued Weight</small>
                {totals.issuedWeight.toFixed(3)}
              </strong>
              <strong>
                <small>Total Return Pieces</small>
                {totals.returnPieces}
              </strong>
              <strong className="divider">
                <small>Total Return Weight</small>
                {totals.returnWeight.toFixed(3)}
              </strong>
              <strong>
                <small>Total Sold Pieces</small>
                {totals.soldPieces}
              </strong>
              <strong className="divider">
                <small>Total Sold Weight</small>
                {totals.soldWeight.toFixed(3)}
              </strong>
              <span />
              <span />
            </div>
          </div>
        </div>
        <label className="stage-two-notes">
          Notes (optional)
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Add any note for this return..."
          />
        </label>
        {errors.form && <p className="stage-two-error">{errors.form}</p>}
        <footer>
          <button
            type="button"
            className="primary"
            disabled={saving}
            onClick={submit}
          >
            {saving ? "Processing..." : <>Move to Stage 2 {"\u2192"}</>}
          </button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </footer>
      </section>
    </div>
  );
};

const ChallanDeleteModal = ({ record, onClose, onConfirm }) => {
  usePageFreeze();
  useEffect(() => {
    const keys = (event) => {
      if (event.key === "Escape") onClose();
      if (event.key === "Enter") onConfirm(record.id);
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  }, [record, onClose, onConfirm]);
  return (
    <div
      className="challan-delete-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Delete challan confirmation"
      onMouseDown={onClose}
    >
      <div
        className="challan-delete-dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h3>Delete Challan?</h3>
        <p>
          {record.number} for {record.party} will be permanently removed.
        </p>
        <small>Esc - Cancel | Enter - Delete</small>
        <footer>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="challan-delete-confirm"
            onClick={() => onConfirm(record.id)}
          >
            Delete Challan
          </button>
        </footer>
      </div>
    </div>
  );
};
export default function Challan() {
  const { user } = useAuth();
  const [records, setRecords] = useState([]);
  const [page, setPage] = useState("list"),
    [viewId, setViewId] = useState(null),
    [tab, setTab] = useState("all"),
    [search, setSearch] = useState("");
  const [dateFilter, setDateFilter] = useState(""),
    [partyFilter, setPartyFilter] = useState(""),
    [agingFilter, setAgingFilter] = useState("all"),
    [sortMode, setSortMode] = useState("newest");
  const [form, setForm] = useState({
    date: today(),
    party: "",
    amount: "",
    discount: "",
    notes: "",
    items: [blank()],
  });
  const [inventory, setInventory] = useState([]);
  const [focusSkuId, setFocusSkuId] = useState(null);
  const [formError, setFormError] = useState("");
  const [challanFieldErrors, setChallanFieldErrors] = useState({});
  const [editingId, setEditingId] = useState(null);
  const [clock, setClock] = useState(() => Date.now());
  const [partyOptions, setPartyOptions] = useState([]);
  const [deleteCandidate, setDeleteCandidate] = useState(null);
  const [stageTwoCandidate, setStageTwoCandidate] = useState(null);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(
    () =>
      onSnapshot(
        collection(db, "challans"),
        (snapshot) => {
          const cloudRecords = snapshot.docs.map((entry) => ({
            id: entry.id,
            ...entry.data(),
          }));
          setRecords(cloudRecords);
        },
        (error) =>
          console.warn("Challans could not be loaded from Firestore.", error),
      ),
    [],
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
          const matchAge =
            agingFilter === "all" ||
            challanAging(item, clock).status === agingFilter;
          return (
            (tab === "all" || item.stage === Number(tab)) &&
            (!dateFilter || item.date === dateFilter) &&
            (!partyFilter || item.party === partyFilter) &&
            matchAge &&
            (
              String(item.number || "") +
              " " +
              String(item.party || "") +
              " " +
              item.items.map((row) => row.sku).join(" ")
            )
              .toLowerCase()
              .includes(search.toLowerCase())
          );
        })
        .sort((a, b) =>
          sortMode === "newest"
            ? b.createdAt - a.createdAt
            : a.createdAt - b.createdAt,
        ),
    [
      records,
      search,
      tab,
      dateFilter,
      partyFilter,
      agingFilter,
      sortMode,
      clock,
    ],
  );
  const itemChange = (id, key, value) => {
    setForm((state) => {
      const items = state.items.map((item) =>
        item.id === id ? { ...item, [key]: value } : item,
      );
      setFormError(stockError(items, inventory));
      return { ...state, items };
    });
  };
  const selectSku = (id, selected) => {
    setForm((state) => {
      const items = state.items.map((item) =>
        item.id === id
          ? {
              ...item,
              sku: selected.sku || "",
              shape: selected.shape || "",
              size: selected.size || "",
              type: selected.type || "",
              weight: "",
              pieces: "",
            }
          : item,
      );
      setFormError(stockError(items, inventory));
      return { ...state, items };
    });
  };
  const saveParty = async (name) => {
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
    const items = form.items.filter((item) => item.sku.trim());
    const typedParty = form.party.trim();
    const existingParty = parties.find(
      (name) => name.toLocaleLowerCase() === typedParty.toLocaleLowerCase(),
    );
    const party = existingParty || typedParty;
    const fieldErrors = {};
    if (!party) fieldErrors.party = "Party Name is required.";
    if (!items.length)
      fieldErrors.items =
        "Add at least one Inventory SKU before creating the Challan.";
    if (Object.keys(fieldErrors).length) {
      setChallanFieldErrors(fieldErrors);
      return;
    }
    const stockIssue = stockError(items, inventory);
    if (stockIssue) {
      setFormError(stockIssue);
      return;
    }
    setFormError("");
    setChallanFieldErrors({});
    const pricedItems = items.map((item) => ({
      ...item,
      pieces: pieceValue(item.pieces),
      ...pricingFor(item.amount, item.discount),
    }));
    const pricing = pricedItems.reduce(
      (total, item) => ({
        amount: total.amount + item.amount,
        discountAmount: total.discountAmount + item.discountAmount,
        netAmount: total.netAmount + item.netAmount,
      }),
      { amount: 0, discountAmount: 0, netAmount: 0 },
    );
    pricing.amount = Number(pricing.amount.toFixed(2));
    pricing.discountAmount = Number(pricing.discountAmount.toFixed(2));
    pricing.netAmount = Number(pricing.netAmount.toFixed(2));
    pricing.discount = pricing.amount
      ? Number(((pricing.discountAmount * 100) / pricing.amount).toFixed(2))
      : 0;
    const previous = editingId
      ? records.find((record) => record.id === editingId)
      : null;
    if (previous && !canEditChallan(previous)) {
      setFormError("Your 60-minute staff edit window has ended.");
      return;
    }
    const record = previous
      ? {
          ...previous,
          party,
          date: form.date,
          notes: form.notes,
          items: pricedItems,
          ...pricing,
        }
      : {
          id: crypto.randomUUID(),
          number:
            "C_" +
            String(new Date().getMonth() + 1).padStart(2, "0") +
            "_" +
            Date.now().toString().slice(-6),
          party,
          date: form.date,
          notes: form.notes,
          items: pricedItems,
          ...pricing,
          stage: 1,
          stageHistory: { stage1: { enteredAtMs: Date.now() } },
          createdAt: Date.now(),
          createdBy: user?.uid || "",
          createdByRole: user?.role || "staff",
        };
    await setDoc(
      doc(db, "challans", record.id),
      previous ? record : { ...record, createdAt: serverTimestamp() },
    );
    setRecords((state) =>
      previous
        ? state.map((entry) => (entry.id === record.id ? record : entry))
        : [record, ...state],
    );
    void writeActivity({
      panel: "challan",
      stage: "Stage " + record.stage,
      action: previous ? "edited" : "created",
      recordId: record.id,
      snapshot: challanSnapshot(record),
      before: previous ? challanSnapshot(previous) : undefined,
      user,
    }).catch((error) =>
      console.warn("Challan activity could not be saved.", error),
    );
    if (!editingId && !existingParty) await saveParty(party);
    setEditingId(null);
    setForm({ date: today(), party: "", notes: "", items: [blank()] });
    setPage("list");
  };
  const addItem = () => {
    const next = blank();
    setForm((state) => ({ ...state, items: [...state.items, next] }));
    setFocusSkuId(next.id);
  };
  const advance = async (id) => {
    const previous = records.find((record) => record.id === id);
    if (!previous || previous.stage >= 4) return;
    if (previous.stage === 1) {
      setStageTwoCandidate(previous);
      return;
    }
    const nextStage = Math.min(4, previous.stage + 1);
    const record = {
      ...previous,
      stage: nextStage,
      stageHistory: {
        ...(previous.stageHistory || {}),
        ["stage" + nextStage]: previous.stageHistory?.["stage" + nextStage] || {
          enteredAtMs: Date.now(),
        },
      },
    };
    await setDoc(doc(db, "challans", record.id), record);
    setRecords((state) =>
      state.map((item) => (item.id === id ? record : item)),
    );
    void writeActivity({
      panel: "challan",
      stage: "Stage " + record.stage,
      action: "stage_changed",
      recordId: record.id,
      snapshot: challanSnapshot(record),
      before: challanSnapshot(previous),
      user,
    }).catch((error) =>
      console.warn("Challan stage activity could not be saved.", error),
    );
  };
  const confirmStageTwo = async (returns, notes) => {
    const previous = stageTwoCandidate;
    if (!previous || previous.stage !== 1)
      throw new Error("This Challan is no longer in Stage 1.");
    const transitionItems = previous.items.map((item, index) => {
      const input = returns[index],
        returnedPieces = pieceValue(input.returnPieces),
        returnedWeight = Number(input.returnWeight);
      return {
        sku: item.sku || "",
        shape: item.shape || "",
        issuedPieces: pieceValue(item.pieces),
        issuedWeight: Number(item.weight || 0),
        returnPieces: returnedPieces,
        returnWeight: returnedWeight,
        soldPieces: pieceValue(item.pieces) - returnedPieces,
        soldWeight: Number(
          (Number(item.weight || 0) - returnedWeight).toFixed(3),
        ),
        amount: Number(item.amount || 0),
        discount: Number(item.discount || 0),
      };
    });
    const record = {
      ...previous,
      stage: 2,
      stageHistory: {
        ...(previous.stageHistory || {}),
        stage2: previous.stageHistory?.stage2 || { enteredAtMs: Date.now() },
      },
      stage2Return: {
        items: transitionItems,
        notes,
        transitionedAtMs: Date.now(),
        actor: {
          uid: user?.uid || "",
          accessId: user?.accessId || "",
          role: user?.role || "employee",
        },
      },
    };
    await setDoc(doc(db, "challans", record.id), record);
    setRecords((state) =>
      state.map((item) => (item.id === record.id ? record : item)),
    );
    setStageTwoCandidate(null);
    void writeActivity({
      panel: "challan",
      stage: "Stage 2",
      action: "return_recorded",
      recordId: record.id,
      snapshot: challanSnapshot(record),
      before: challanSnapshot(previous),
      user,
    }).catch((error) =>
      console.warn("Challan return activity could not be saved.", error),
    );
  };
  const isAdmin = user?.role === "superadmin";
  const staffEditRemaining = (record) =>
    record.createdByRole === "superadmin" || record.createdBy !== user?.uid
      ? 0
      : Math.max(
          0,
          timestampMs(record.createdAt) + STAFF_EDIT_WINDOW_MS - clock,
        );
  const canEditChallan = (record) => isAdmin || staffEditRemaining(record) > 0;
  const closeEditor = () => {
    setEditingId(null);
    setForm({ date: today(), party: "", notes: "", items: [blank()] });
    setPage("list");
  };
  const editChallan = (record) => {
    if (!canEditChallan(record)) return;
    setEditingId(record.id);
    setForm({
      date: record.date,
      party: record.party,
      notes: record.notes || "",
      items: record.items.map((item) => ({
        ...item,
        id: item.id || crypto.randomUUID(),
        amount: item.amount ?? "",
        discount: item.discount ?? "",
      })),
    });
    setPage("create");
  };
  const deleteChallan = async (id) => {
    const record = records.find((entry) => entry.id === id);
    if (!record || !isAdmin) return;
    await deleteDoc(doc(db, "challans", id));
    void writeActivity({
      panel: "challan",
      stage: "Stage " + record.stage,
      action: "deleted",
      recordId: record.id,
      snapshot: challanSnapshot(record),
      user,
    }).catch((error) =>
      console.warn("Challan deletion activity could not be saved.", error),
    );
    setRecords((state) => state.filter((entry) => entry.id !== id));
    setDeleteCandidate(null);
  };
  const pricing = form.items.reduce(
    (total, item) => {
      const itemPricing = pricingFor(item.amount, item.discount);
      return {
        amount: total.amount + itemPricing.amount,
        discountAmount: total.discountAmount + itemPricing.discountAmount,
        netAmount: total.netAmount + itemPricing.netAmount,
      };
    },
    { amount: 0, discountAmount: 0, netAmount: 0 },
  );
  const exportList = async () => {
    const XLSX = await import("xlsx");
    const rows = shown.map((row) => {
      const age = challanAging(row, clock);
      return {
        "Challan No.": row.number,
        Party: row.party,
        Date: row.date,
        Items: row.items.map((item) => item.sku).join(", "),
        Pieces: row.items.reduce(
          (sum, item) => sum + pieceValue(item.pieces),
          0,
        ),
        Stage: "Stage " + row.stage + " - " + STAGES[row.stage],
        Aging: age.label + " \u2022 " + age.elapsedLabel,
        Amount: row.netAmount ?? row.amount ?? 0,
      };
    });
    const sheet = XLSX.utils.json_to_sheet(rows);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Challans");
    XLSX.writeFile(book, "challans-" + today() + ".xlsx");
  };
  const printList = () => {
    const popup = window.open("", "_blank", "width=1200,height=800");
    if (!popup) {
      window.alert("Please allow pop-ups to print Challans.");
      return;
    }
    const escape = (value) =>
      String(value ?? "-").replace(
        /[&<>"\x27]/g,
        (character) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            "\x27": "&#039;",
            '"': "&quot;",
          })[character],
      );
    const body =
      shown
        .map((row) => {
          const age = challanAging(row, clock);
          return (
            "<tr><td>" +
            escape(row.number) +
            "</td><td>" +
            escape(row.party) +
            "</td><td>" +
            escape(row.items.map((item) => item.sku).join(", ")) +
            "</td><td>" +
            escape(row.date) +
            "</td><td>" +
            row.items.reduce((sum, item) => sum + pieceValue(item.pieces), 0) +
            "</td><td>Stage " +
            row.stage +
            " - " +
            escape(STAGES[row.stage]) +
            "</td><td>" +
            age.label +
            " \u2022 " +
            age.elapsedLabel +
            "</td></tr>"
          );
        })
        .join("") ||
      "<tr><td colspan=7>No Challans match the current filters.</td></tr>";
    popup.document.write(
      "<!doctype html><html><head><title>Challan Management</title><style>body{font-family:Arial,sans-serif;color:#172033;margin:28px}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #cbd5e1;padding:9px;text-align:left}th{background:#f1f5f9;font-size:11px;text-transform:uppercase}</style></head><body><h1>Challan Management</h1><p>Filtered list - " +
        shown.length +
        " Challans</p><table><thead><tr><th>Challan No.</th><th>Party</th><th>Items</th><th>Date</th><th>Qty</th><th>Stage</th><th>Aging</th></tr></thead><tbody>" +
        body +
        "</tbody></table></body></html>",
    );
    popup.document.close();
    popup.focus();
    window.setTimeout(() => popup.print(), 250);
  };
  const printChallan = (record) => {
    const popup = window.open("", "_blank", "width=1000,height=800");
    if (!popup) {
      window.alert("Please allow pop-ups to print this Challan.");
      return;
    }
    const escape = (value) =>
      String(value ?? "-").replace(
        /[&<>"']/g,
        (char) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#039;",
          })[char],
      );
    const created = timestampMs(record.createdAt),
      items = (record.items || [])
        .map(
          (item) =>
            "<tr><td>" +
            escape(item.sku) +
            "</td><td>" +
            escape(item.shape) +
            "</td><td>" +
            escape(item.size) +
            "</td><td>" +
            escape(item.type) +
            "</td><td>" +
            Number(item.weight || 0).toFixed(3) +
            " ct</td><td>" +
            pieceValue(item.pieces) +
            "</td><td>Rs. " +
            Number(item.amount || 0).toFixed(2) +
            "</td><td>" +
            Number(item.discount || 0).toFixed(2) +
            "%</td></tr>",
        )
        .join("");
    const totalWeight = (record.items || []).reduce(
        (sum, item) => sum + Number(item.weight || 0),
        0,
      ),
      totalPieces = (record.items || []).reduce(
        (sum, item) => sum + pieceValue(item.pieces),
        0,
      );
    const copy = (label) =>
      '<section class="copy"><header><b>' +
      label +
      '</b><h1>CHALLAN DETAILS</h1></header><div class="details"><p><strong>Challan No:</strong> ' +
      escape(record.number) +
      "</p><p><strong>Party:</strong> " +
      escape(record.party) +
      "</p><p><strong>Created:</strong> " +
      escape(formatStageDate(created) + ", " + formatStageTime(created)) +
      "</p><p><strong>Current Stage:</strong> Stage " +
      record.stage +
      " - " +
      escape(STAGES[record.stage]) +
      "</p></div><table><thead><tr><th>Inventory SKU</th><th>Shape</th><th>Size</th><th>Type</th><th>Weight</th><th>Pieces</th><th>Amount</th><th>Discount</th></tr></thead><tbody>" +
      items +
      '</tbody></table><p class="total">Items: ' +
      (record.items || []).length +
      " Weight: " +
      totalWeight.toFixed(3) +
      " ct Pieces: " +
      totalPieces +
      '</p><p class="notes"><strong>Notes:</strong> ' +
      escape(record.notes || "-") +
      "</p></section>";
    popup.document.write(
      "<!doctype html><html><head><title>" +
        escape(record.number) +
        "</title><style>body{font-family:Arial,sans-serif;color:#172033;margin:20px}.copy{border:1.5px solid #334155;margin:0 0 28px;padding:20px;break-inside:auto;page-break-inside:auto}.copy header{border-bottom:2px solid #334155;display:flex;justify-content:space-between;margin-bottom:16px;padding-bottom:10px}.copy header b{border:1px solid #334155;font-size:12px;letter-spacing:.12em;padding:6px 10px}.copy h1{font-size:21px;margin:0}.details{display:grid;grid-template-columns:repeat(2,1fr);gap:4px 20px}.details p,.notes{font-size:13px;margin:4px 0}table{border-collapse:collapse;width:100%;margin-top:16px;font-size:12px}th,td{border:1px solid #94a3b8;padding:8px;text-align:left}th{background:#eef2f7;font-size:10px;text-transform:uppercase}tr{break-inside:avoid;page-break-inside:avoid}.total{background:#f1f5f9;font-weight:bold;margin:0;padding:10px}@page{margin:12mm}@media print{body{margin:0}}</style></head><body>" +
        copy("ORIGINAL") +
        copy("DUPLICATE") +
        "</body></html>",
    );
    popup.document.close();
    popup.focus();
    window.setTimeout(() => popup.print(), 250);
  };
  const viewRecord = viewId
    ? records.find((record) => record.id === viewId)
    : null;
  const exportDraft = () => {
    const rows = [
      [
        "SKU",
        "Shape",
        "Weight (ct)",
        "Pieces",
        "Amount",
        "Discount (%)",
        "Discount Amount",
        "Net Amount",
      ],
      ...form.items
        .filter((item) => item.sku)
        .map((item) => {
          const value = pricingFor(item.amount, item.discount);
          return [
            item.sku,
            item.shape,
            Number(item.weight || 0),
            pieceValue(item.pieces),
            value.amount,
            value.discount,
            value.discountAmount,
            value.netAmount,
          ];
        }),
    ];
    const csv = rows
      .map((row) => row.map((value) => JSON.stringify(value ?? "")).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "challan-" + (editingId || "draft") + ".csv";
    link.click();
    URL.revokeObjectURL(url);
  };
  const printDraft = () => window.print();
  if (page === "view") {
    if (!viewRecord)
      return (
        <section className="challan-page challan-view">
          <button
            className="back"
            type="button"
            onClick={() => {
              setPage("list");
              setViewId(null);
            }}
          >
            <Icon name="back" /> Back to Challans
          </button>
          <div className="empty">
            <h3>Challan not found</h3>
          </div>
        </section>
      );
    const age = challanAging(viewRecord, clock),
      items = viewRecord.items || [],
      totalWeight = items.reduce(
        (sum, item) => sum + Number(item.weight || 0),
        0,
      ),
      totalPieces = items.reduce(
        (sum, item) => sum + pieceValue(item.pieces),
        0,
      );
    const message = {
      1: "Goods issued and awaiting return details",
      2: "Returned and kept goods recorded",
      3: "Payment due is pending",
      4: "Challan workflow completed",
    }[viewRecord.stage];
    const next =
      viewRecord.stage === 1
        ? "Move to Stage 2"
        : viewRecord.stage === 2
          ? "Create Payment Due"
          : viewRecord.stage === 3
            ? "Complete Challan"
            : "";
    return (
      <section className="challan-page challan-view">
        <div className="challan-view-toolbar">
          <button
            className="back"
            type="button"
            onClick={() => {
              setPage("list");
              setViewId(null);
            }}
          >
            <Icon name="back" /> Back to Challans
          </button>
          <button
            type="button"
            className="challan-view-print"
            onClick={() => printChallan(viewRecord)}
          >
            Print
          </button>
        </div>
        <article className="challan-view-card">
          <div className="challan-view-identity">
            <div>
              <small>CHALLAN NUMBER</small>
              <h1>{viewRecord.number}</h1>
              <h2>{viewRecord.party}</h2>
              <p>
                Created {formatStageDate(timestampMs(viewRecord.createdAt))},{" "}
                {formatStageTime(timestampMs(viewRecord.createdAt))}
              </p>
            </div>
            <div className="challan-view-status">
              <span className={"challan-aging-badge " + age.status}>
                <i />
                {age.label} <b>-</b> {age.elapsedLabel}
              </span>
              <em className={"stage stage-" + viewRecord.stage}>
                Stage {viewRecord.stage} - {STAGES[viewRecord.stage]}
              </em>
            </div>
          </div>
          <div className="challan-view-divider" />
          <div className="challan-view-current">
            <strong>{message}</strong>
            {viewRecord.stage < 4 && (
              <button
                className="primary"
                type="button"
                onClick={() => advance(viewRecord.id)}
              >
                {next} <Icon name="arrow" />
              </button>
            )}
          </div>
          <div className="challan-view-divider" />
          <div className="challan-timeline">
            {[1, 2, 3, 4].map((stage) => {
              const entered = stageEnteredAt(viewRecord, stage),
                reached = stage <= viewRecord.stage,
                current = stage === viewRecord.stage;
              return (
                <div
                  className={
                    "challan-timeline-step " +
                    (reached ? "reached " : "") +
                    (current ? "current" : "")
                  }
                  key={stage}
                >
                  <div className="challan-timeline-dot">
                    {stage < viewRecord.stage ? <Icon name="check" /> : stage}
                  </div>
                  {stage < 4 && <i className="challan-timeline-line" />}
                  <b>Stage {stage}</b>
                  <span>{STAGES[stage]}</span>
                  {entered && (
                    <small>
                      {formatStageDate(entered)}
                      <br />
                      {formatStageTime(entered)}
                    </small>
                  )}
                </div>
              );
            })}
          </div>
        </article>
        <article className="challan-view-card challan-view-items">
          <h2>Items Issued</h2>
          <div className="challan-view-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Inventory SKU</th>
                  <th>Shape</th>
                  <th>Size</th>
                  <th>Type</th>
                  <th>Weight</th>
                  <th>Pieces</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, index) => (
                  <tr key={item.id || item.sku || index}>
                    <td>{item.sku || "-"}</td>
                    <td>{item.shape || "-"}</td>
                    <td>{item.size || "-"}</td>
                    <td>{item.type || "-"}</td>
                    <td>{Number(item.weight || 0).toFixed(3)} ct</td>
                    <td>{pieceValue(item.pieces)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="challan-view-summary">
            <span>
              Items: <b>{items.length}</b>
            </span>
            <span>
              Weight: <b>{totalWeight.toFixed(3)} ct</b>
            </span>
            <span>
              Pieces: <b>{totalPieces}</b>
            </span>
          </div>
        </article>
        <article className="challan-view-card challan-view-notes">
          <h2>Comments / Notes</h2>
          <p>
            {viewRecord.notes?.trim() || "No notes added for this Challan."}
          </p>
        </article>
        {stageTwoCandidate && (
          <StageTwoModal
            record={stageTwoCandidate}
            onClose={() => setStageTwoCandidate(null)}
            onConfirm={confirmStageTwo}
          />
        )}
      </section>
    );
  }
  if (page === "create")
    return (
      <section className="challan-page challan-create">
        <button
          className="back"
          type="button"
          onClick={closeEditor}
          aria-label="Back to Challans"
        >
          <Icon name="back" /> Back to Challans
        </button>
        <header>
          <h2>{editingId ? "Edit Challan" : "Create Challan"}</h2>
          <div className="challan-create-actions">
            <span>
              {editingId ? "Update challan details" : "Stage 1 - Goods Out"}
            </span>
            <button type="button" onClick={exportDraft}>
              Export
            </button>
            <button type="button" onClick={printDraft}>
              Print
            </button>
          </div>
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
                  onChange={(event) => {
                    setFormError("");
                    setForm({ ...form, date: event.target.value });
                  }}
                />
              </label>
              <label>
                Challan No.
                <input disabled value="Auto-generated" />
              </label>
              <label className={challanFieldErrors.party ? "has-error" : ""}>
                Party Name *
                <PartyPicker
                  value={form.party}
                  parties={parties}
                  onChange={(value) => {
                    setFormError("");
                    setChallanFieldErrors((current) => ({
                      ...current,
                      party: value.trim() ? "" : "Party Name is required.",
                    }));
                    setForm({ ...form, party: value });
                  }}
                />
                {challanFieldErrors.party && (
                  <small className="challan-field-error">
                    {challanFieldErrors.party}
                  </small>
                )}
                <small className="party-help">
                  {user?.role === "superadmin"
                    ? "New names are saved once and appear here next time."
                    : "Select an existing party or enter a new party name."}
                </small>
              </label>
            </div>
          </article>
          <datalist id="challan-discounts">
            <option value="6" />
            <option value="7" />
            <option value="8" />
          </datalist>
          <article>
            <h3>Inventory Items</h3>
            {challanFieldErrors.items && (
              <p className="challan-form-error" role="alert">
                {challanFieldErrors.items}
              </p>
            )}
            {formError && (
              <p className="challan-form-error" role="alert">
                {formError}
              </p>
            )}
            <div className="item-head">
              <span>
                Inventory SKU *{" "}
                <em className="live-weight-label">live weight</em>
              </span>
              <span>Shape</span>
              <span>Size</span>
              <span>Type</span>
              <span>Weight / Carat</span>
              <span>Pieces</span>
              <span>Amount</span>
              <span>Discount %</span>
              <span>Discount / Net</span>
              <span />
            </div>
            {form.items.map((item) => (
              <div className="challan-item" key={item.id}>
                <SkuPicker
                  value={item.sku}
                  inventory={inventory}
                  onChange={(value) => itemChange(item.id, "sku", value)}
                  onSelect={(selected) => selectSku(item.id, selected)}
                  autoFocus={focusSkuId === item.id}
                />
                {["shape", "size", "type", "weight", "pieces"].map((key) => (
                  <input
                    key={key}
                    type={
                      key === "weight" || key === "pieces" ? "number" : "text"
                    }
                    min={key === "pieces" ? "0" : undefined}
                    step={key === "pieces" ? "1" : undefined}
                    inputMode={key === "pieces" ? "numeric" : undefined}
                    value={item[key]}
                    readOnly={["shape", "size", "type"].includes(key)}
                    aria-invalid={
                      key === "pieces" &&
                      Boolean(formError && /Pieces/.test(formError))
                    }
                    onChange={(event) => {
                      if (
                        key !== "pieces" ||
                        /^\d*$/.test(event.target.value)
                      ) {
                        itemChange(item.id, key, event.target.value);
                        if (
                          key === "pieces" &&
                          /^\d*$/.test(event.target.value)
                        )
                          setFormError("");
                      }
                    }}
                    placeholder={key === "weight" ? "Weight (ct)" : key}
                  />
                ))}
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={item.amount}
                  onChange={(event) =>
                    itemChange(item.id, "amount", event.target.value)
                  }
                  placeholder="Amount"
                />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  list="challan-discounts"
                  value={item.discount}
                  onChange={(event) =>
                    itemChange(item.id, "discount", event.target.value)
                  }
                  placeholder="Discount %"
                />
                <span className="item-price-summary">
                  ₹
                  {pricingFor(
                    item.amount,
                    item.discount,
                  ).discountAmount.toFixed(2)}{" "}
                  / ₹
                  {pricingFor(item.amount, item.discount).netAmount.toFixed(2)}
                </span>
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
            <div
              className="challan-item-totals"
              aria-label="Challan item totals"
            >
              <strong>
                Total Items:{" "}
                {form.items.filter((item) => item.sku.trim()).length}
              </strong>
              <span />
              <span />
              <span />
              <strong>
                Total:{" "}
                {form.items
                  .reduce((sum, item) => sum + Number(item.weight || 0), 0)
                  .toFixed(3)}{" "}
                ct
              </strong>
              <strong>
                Total:{" "}
                {form.items.reduce(
                  (sum, item) => sum + pieceValue(item.pieces),
                  0,
                )}{" "}
                pcs
              </strong>
              <strong>Discount: ₹{pricing.discountAmount.toFixed(2)}</strong>
              <strong>Net: ₹{pricing.netAmount.toFixed(2)}</strong>
              <span />
            </div>
            <button type="button" className="add" onClick={addItem}>
              <Icon name="plus" /> Add Another Item
            </button>
          </article>
          <article>
            <h3>Comments / Notes</h3>
            <textarea
              rows="3"
              value={form.notes}
              onChange={(event) => {
                setFormError("");
                setForm({ ...form, notes: event.target.value });
              }}
              placeholder="Add any note for this challan..."
            />
          </article>
          <footer>
            <button className="primary">
              {editingId ? "Save Changes" : "Create Challan"}
            </button>
            <button type="button" onClick={closeEditor}>
              Cancel
            </button>
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
        <div className="challan-list-actions">
          <button
            className="primary"
            onClick={() => {
              setEditingId(null);
              setForm({
                date: today(),
                party: "",
                notes: "",
                items: [blank()],
              });
              setPage("create");
            }}
          >
            <Icon name="plus" /> Create Challan
          </button>
          <button type="button" onClick={exportList}>
            Export
          </button>
          <button type="button" onClick={printList}>
            Print
          </button>
        </div>
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
            <span className="challan-tab-main">
              {label} <small>{count(key)}</small>
            </span>
            {key !== "all" && (
              <span className="challan-tab-subtitle">{STAGES[key]}</span>
            )}
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
        <aside
          className="challan-aging-legend"
          aria-label="Challan aging milestones"
        >
          {[
            ["green", "Green", "24 hours"],
            ["yellow", "Yellow", "60 hours"],
            ["red", "Red", "5 days"],
          ].map(([status, label, timing]) => (
            <div key={status} className={status}>
              <span>
                <i />
                {label}
              </span>
              <small>{timing}</small>
            </div>
          ))}
        </aside>
      </div>
      <p className="showing">Showing {shown.length} Challans</p>
      {shown.length ? (
        <div className="challan-list">
          <div className="list-head">
            <span>Challan / Party</span>
            <span>Items</span>
            <span>Date</span>
            <span>Total Pcs</span>
            <span>Stage</span>
            <span>Aging</span>
            <span>Actions</span>
          </div>
          {shown.map((row) => (
            <div
              className={`challan-row aging-${challanAging(row, clock).status}`}
              key={row.id}
            >
              <div>
                <button
                  type="button"
                  className="challan-view-link"
                  onClick={() => {
                    setViewId(row.id);
                    setPage("view");
                  }}
                >
                  {row.number}
                </button>
                <small>{row.party}</small>
              </div>
              <span>{row.items.map((item) => item.sku).join(", ")}</span>
              <time>{row.date}</time>
              <b>
                {row.items.reduce(
                  (sum, item) => sum + pieceValue(item.pieces),
                  0,
                )}
              </b>
              <em className={`stage stage-${row.stage}`}>
                Stage {row.stage} - {STAGES[row.stage]}
              </em>
              {(() => {
                const age = challanAging(row, clock);
                return (
                  <span className={`challan-aging-badge ${age.status}`}>
                    <i />
                    {age.label} <b>-</b> {age.elapsedLabel}
                  </span>
                );
              })()}
              <span className="challan-actions">
                <button
                  type="button"
                  className="challan-view-button"
                  onClick={() => {
                    setViewId(row.id);
                    setPage("view");
                  }}
                >
                  View
                </button>
                <button
                  disabled={row.stage === 4}
                  onClick={() => advance(row.id)}
                >
                  {row.stage === 4 ? "Completed" : STAGES[row.stage + 1]}{" "}
                  <Icon name="arrow" />
                </button>
                <span className="challan-row-actions">
                  {!isAdmin &&
                    row.createdBy === user?.uid &&
                    row.createdByRole !== "superadmin" && (
                      <small
                        className={`challan-edit-timer ${staffEditRemaining(row) ? "" : "expired"}`}
                      >
                        {staffEditRemaining(row)
                          ? `Edit available: ${formatEditCountdown(staffEditRemaining(row))}`
                          : "Edit time ended"}
                      </small>
                    )}
                  {canEditChallan(row) && (
                    <button
                      type="button"
                      className="challan-edit"
                      onClick={() => editChallan(row)}
                    >
                      Edit
                    </button>
                  )}
                  {isAdmin && (
                    <button
                      type="button"
                      className="challan-delete"
                      onClick={() => setDeleteCandidate(row)}
                    >
                      Delete
                    </button>
                  )}
                </span>
              </span>
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
          {![2, 3, 4].includes(Number(tab)) && (
            <button
              className="primary"
              onClick={() => {
                setEditingId(null);
                setForm({
                  date: today(),
                  party: "",
                  notes: "",
                  items: [blank()],
                });
                setPage("create");
              }}
            >
              <Icon name="plus" /> Create First Challan
            </button>
          )}
        </div>
      )}{" "}
      {stageTwoCandidate && (
        <StageTwoModal
          record={stageTwoCandidate}
          onClose={() => setStageTwoCandidate(null)}
          onConfirm={confirmStageTwo}
        />
      )}{" "}
      {deleteCandidate && (
        <ChallanDeleteModal
          record={deleteCandidate}
          onClose={() => setDeleteCandidate(null)}
          onConfirm={deleteChallan}
        />
      )}
    </section>
  );
}
