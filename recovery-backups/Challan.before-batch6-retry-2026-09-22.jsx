import { useEffect, useMemo, useState } from "react";
import "./challan.css";
import {
  collection,
  doc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
  deleteDoc,
} from "firebase/firestore";
import { db } from "../../firebase/config";
import { useAuth } from "../../auth/AuthContext";
import { writeActivity } from "../../utils/activityLog";
import { isWholePieces, pieceValue } from "../../utils/pieces";
import { usePageFreeze } from "../../hooks/usePageFreeze";
const STAGES = {
  1: "Goods Out",
  2: "Return / Sale",
  3: "Final Invoice / Payment Pending",
  4: "Completed",
};
const stageActionLabel = (stage) =>
  ({
    1: "Process Return / Move to Stage 2",
    2: "Generate Final Invoice",
    3: "Record Payment / Complete",
    4: "Completed",
  })[stage] || "";
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
const money = (value) => Number((Number(value) || 0).toFixed(2));
const invoiceSnapshotFor = (record) => {
  const stageTwoItems = record.stage2Return?.items;
  if (!Array.isArray(stageTwoItems) || !stageTwoItems.length)
    throw new Error("This Stage 2 Challan has no return/sale item history.");
  const items = stageTwoItems.map((item) => {
    if (item.amount === "" || item.amount === null || item.amount === undefined)
      throw new Error(`Item ${item.sku || ""} has no quoted Amount.`);
    const grossAmount = money(item.amount);
    const stage1DiscountPercent = money(item.discount);
    const stage1DiscountAmount = money(
      (grossAmount * stage1DiscountPercent) / 100,
    );
    return {
      ...item,
      grossAmount,
      stage1DiscountPercent,
      stage1DiscountAmount,
      finalAmount: money(grossAmount - stage1DiscountAmount),
    };
  });
  const grossAmount = money(
    items.reduce((sum, item) => sum + item.grossAmount, 0),
  );
  const stage1DiscountAmount = money(
    items.reduce((sum, item) => sum + item.stage1DiscountAmount, 0),
  );
  return {
    items,
    grossAmount,
    stage1DiscountAmount,
    finalInvoiceAmount: money(grossAmount - stage1DiscountAmount),
  };
};
const historicalItemsFor = (record) => {
  const stage = Number(record.stage || 1);
  if (stage >= 3 && Array.isArray(record.finalInvoice?.items))
    return record.finalInvoice.items;
  if (stage >= 2 && Array.isArray(record.stage2Return?.items))
    return record.stage2Return.items;
  return record.items || [];
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
  inventoryId: "",
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
    const key = item.inventoryId || item.sku;
    const current = totals.get(key) || { weight: 0, pieces: 0 };
    current.weight += Number(item.weight || 0);
    current.pieces += pieceValue(item.pieces);
    totals.set(key, current);
  }
  for (const [inventoryId, requested] of totals) {
    const source = inventory.find(
      (entry) => entry.id === inventoryId || entry.sku === inventoryId,
    );
    if (!source) continue;
    if (requested.weight > Number(source.weight || 0))
      return `Weight for ${source.sku} cannot exceed available ${Number(source.weight || 0).toFixed(3)} ct.`;
    if (requested.pieces > stockPieces(source))
      return `Pieces for ${source.sku} cannot exceed available ${stockPieces(source)} pcs.`;
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
    {" "}
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
    />{" "}
    {name === "search" && <circle cx="10.8" cy="10.8" r="6" />}{" "}
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
      {" "}
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
      />{" "}
      {selected && (
        <small className="stock-availability">
          {" "}
          Avail: {Number(selected.weight || 0).toFixed(3)} ct /{" "}
          {stockPieces(selected)} pcs{" "}
        </small>
      )}{" "}
      {open && (
        <div className="sku-menu" id="challan-sku-options" role="listbox">
          {" "}
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
                {" "}
                <b>{item.sku}</b>{" "}
              </button>
            ))
          ) : (
            <p>No matching SKU found.</p>
          )}{" "}
        </div>
      )}{" "}
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
      {" "}
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
      />{" "}
      {open && (
        <div className="party-menu" id="challan-party-options" role="listbox">
          {" "}
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
                {" "}
                {party}{" "}
              </button>
            ))
          ) : (
            <p>New party: {value.trim() || "type a name"}</p>
          )}{" "}
        </div>
      )}{" "}
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
      {" "}
      <section
        className="stage-two-modal"
        onMouseDown={(event) => event.stopPropagation()}
      >
        {" "}
        <header>
          {" "}
          <div>
            {" "}
            <h3>Process Return / Move to Stage 2</h3>{" "}
          </div>{" "}
          <button
            type="button"
            className="stage-two-close"
            onClick={onClose}
            aria-label="Close"
          >
            {" "}
            {"\u00d7"}{" "}
          </button>{" "}
        </header>{" "}
        <div className="stage-two-info">
          {" "}
          <b>i</b>{" "}
          <span>
            {" "}
            Enter returned quantities for each item. Enter 0 if nothing was
            returned.{" "}
          </span>{" "}
        </div>{" "}
        <div className="stage-two-table-wrap">
          {" "}
          <div className="stage-two-table">
            {" "}
            <div className="stage-two-head">
              {" "}
              <span>SKU</span> <span className="divider">SHAPE</span>{" "}
              <span>
                {" "}
                ISSUED <br /> PIECES{" "}
              </span>{" "}
              <span className="divider">
                {" "}
                ISSUED <br /> WEIGHT{" "}
              </span>{" "}
              <span>
                {" "}
                RETURN <br /> PIECES *{" "}
              </span>{" "}
              <span className="divider">
                {" "}
                RETURN <br /> WEIGHT *{" "}
              </span>{" "}
              <span>
                {" "}
                SOLD <br /> PIECES{" "}
              </span>{" "}
              <span className="divider">
                {" "}
                SOLD <br /> WEIGHT{" "}
              </span>{" "}
              <span>AMOUNT</span> <span>DISCOUNT</span>{" "}
            </div>{" "}
            {record.items.map((item, index) => {
              const row = rows[index],
                rp = pieceValue(row.returnPieces),
                rw = Number(row.returnWeight || 0),
                pieces = issuedPieces(item),
                weight = issuedWeight(item);
              return (
                <div className="stage-two-row" key={item.id || item.sku}>
                  {" "}
                  <b>{item.sku}</b>{" "}
                  <span className="divider">{item.shape || "-"}</span>{" "}
                  <span>{pieces}</span>{" "}
                  <span className="divider">{weight.toFixed(3)}</span>{" "}
                  <label
                    className={
                      errors[row.id + "returnPieces"] ? "has-error" : ""
                    }
                  >
                    {" "}
                    <input
                      value={row.returnPieces}
                      inputMode="numeric"
                      onChange={(event) =>
                        update(row.id, "returnPieces", event.target.value)
                      }
                    />{" "}
                    {errors[row.id + "returnPieces"] && (
                      <small>{errors[row.id + "returnPieces"]}</small>
                    )}{" "}
                  </label>{" "}
                  <label
                    className={
                      (errors[row.id + "returnWeight"] ? "has-error " : "") +
                      "divider"
                    }
                  >
                    {" "}
                    <input
                      value={row.returnWeight}
                      inputMode="decimal"
                      onChange={(event) =>
                        update(row.id, "returnWeight", event.target.value)
                      }
                    />{" "}
                    {errors[row.id + "returnWeight"] && (
                      <small>{errors[row.id + "returnWeight"]}</small>
                    )}{" "}
                  </label>{" "}
                  <span>{pieces - rp}</span>{" "}
                  <span className="divider">{(weight - rw).toFixed(3)}</span>{" "}
                  <span>{Number(item.amount || 0).toFixed(2)}</span>{" "}
                  <span>{Number(item.discount || 0).toFixed(2)}%</span>{" "}
                </div>
              );
            })}{" "}
            <div className="stage-two-totals">
              {" "}
              <span /> <span className="divider" />{" "}
              <strong>
                {" "}
                <small>Total Issued Pieces</small> {totals.issuedPieces}{" "}
              </strong>{" "}
              <strong className="divider">
                {" "}
                <small>Total Issued Weight</small>{" "}
                {totals.issuedWeight.toFixed(3)}{" "}
              </strong>{" "}
              <strong>
                {" "}
                <small>Total Return Pieces</small> {totals.returnPieces}{" "}
              </strong>{" "}
              <strong className="divider">
                {" "}
                <small>Total Return Weight</small>{" "}
                {totals.returnWeight.toFixed(3)}{" "}
              </strong>{" "}
              <strong>
                {" "}
                <small>Total Sold Pieces</small> {totals.soldPieces}{" "}
              </strong>{" "}
              <strong className="divider">
                {" "}
                <small>Total Sold Weight</small>{" "}
                {totals.soldWeight.toFixed(3)}{" "}
              </strong>{" "}
              <span /> <span />{" "}
            </div>{" "}
          </div>{" "}
        </div>{" "}
        <label className="stage-two-notes">
          {" "}
          Notes (optional){" "}
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Add any note for this return..."
          />{" "}
        </label>{" "}
        {errors.form && <p className="stage-two-error">{errors.form}</p>}{" "}
        <footer>
          {" "}
          <button
            type="button"
            className="primary"
            disabled={saving}
            onClick={submit}
          >
            {" "}
            {saving ? "Processing..." : <>Move to Stage 2 {"\u2192"}</>}{" "}
          </button>{" "}
          <button type="button" onClick={onClose}>
            {" "}
            Cancel{" "}
          </button>{" "}
        </footer>{" "}
      </section>{" "}
    </div>
  );
};
const FinalInvoiceModal = ({ record, onClose, onConfirm }) => {
  usePageFreeze();
  const [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  let invoice;
  try {
    invoice = invoiceSnapshotFor(record);
  } catch (error) {
    return (
      <div className="stage-two-overlay" role="dialog" aria-modal="true">
        <section className="stage-two-modal">
          <header>
            <h3>Final Invoice Review</h3>
            <button
              type="button"
              className="stage-two-close"
              onClick={onClose}
              aria-label="Close"
            >
              ×
            </button>
          </header>
          <p className="stage-two-error">{error.message}</p>
          <footer>
            <button type="button" onClick={onClose}>
              Close
            </button>
          </footer>
        </section>
      </div>
    );
  }
  const submit = async () => {
    setSaving(true);
    try {
      await onConfirm();
    } catch (reason) {
      setError(reason.message || "Could not confirm the Final Invoice.");
      setSaving(false);
    }
  };
  return (
    <div
      className="stage-two-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Final Invoice Review"
      onMouseDown={onClose}
    >
      <section
        className="stage-two-modal"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <h3>Final Invoice Review</h3>
            <small>
              {record.number} · {record.date} · {record.party}
            </small>
          </div>
          <button
            type="button"
            className="stage-two-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </header>
        <div className="stage-two-table-wrap">
          <div className="stage-two-table">
            <div className="stage-two-head">
              <span>SKU / TYPE</span>
              <span>ISSUED</span>
              <span>RETURN</span>
              <span>SOLD / KEPT</span>
              <span>AMOUNT</span>
              <span>STAGE 1 DISCOUNT</span>
            </div>
            {invoice.items.map((item) => (
              <div
                className="stage-two-row"
                key={item.sourceInventoryId || item.inventoryId || item.sku}
              >
                <b>
                  {item.sku}
                  <small>
                    {item.type || "—"} · {item.shape || "—"} ·{" "}
                    {item.size || "—"}
                  </small>
                </b>
                <span>
                  {item.issuedPieces} pcs /{" "}
                  {Number(item.issuedWeight || 0).toFixed(3)} ct
                </span>
                <span>
                  {item.returnPieces} pcs /{" "}
                  {Number(item.returnWeight || 0).toFixed(3)} ct
                </span>
                <span>
                  {item.soldPieces} pcs /{" "}
                  {Number(item.soldWeight || 0).toFixed(3)} ct
                </span>
                <span>₹{item.grossAmount.toFixed(2)}</span>
                <span>
                  {item.stage1DiscountPercent}% (₹
                  {item.stage1DiscountAmount.toFixed(2)})
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="stage-two-totals">
          <strong>
            <small>Gross Amount</small>₹{invoice.grossAmount.toFixed(2)}
          </strong>
          <strong>
            <small>Stage 1 Discount</small>- ₹
            {invoice.stage1DiscountAmount.toFixed(2)}
          </strong>
          <strong>
            <small>Final Invoice Amount</small>₹
            {invoice.finalInvoiceAmount.toFixed(2)}
          </strong>
        </div>
        {error && <p className="stage-two-error">{error}</p>}
        <footer>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            disabled={saving}
            onClick={submit}
          >
            {saving
              ? "Confirming..."
              : "Confirm Final Invoice / Move to Stage 3"}
          </button>
        </footer>
      </section>
    </div>
  );
};
const FinalSettlementModal = ({ record, onClose, onConfirm }) => {
  usePageFreeze();
  const [paid, setPaid] = useState(""),
    [discount, setDiscount] = useState(""),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false);
  const finalInvoiceAmount = money(record.finalInvoice?.finalInvoiceAmount);
  const paidValue = Number(paid),
    discountValue = Number(discount);
  const validNumbers =
    paid !== "" &&
    discount !== "" &&
    Number.isFinite(paidValue) &&
    Number.isFinite(discountValue) &&
    paidValue >= 0 &&
    discountValue >= 0;
  const remaining = validNumbers
    ? money(finalInvoiceAmount - paidValue - discountValue)
    : finalInvoiceAmount;
  const canComplete = validNumbers && remaining === 0;
  const submit = async () => {
    if (!canComplete)
      return setError(
        "Amount Paid plus Discount Amount must equal the Final Invoice Amount exactly.",
      );
    setSaving(true);
    try {
      await onConfirm(money(paidValue), money(discountValue));
    } catch (reason) {
      setError(reason.message || "Could not complete settlement.");
      setSaving(false);
    }
  };
  return (
    <div
      className="stage-two-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Final Settlement"
      onMouseDown={onClose}
    >
      <section
        className="stage-two-modal"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <h3>Final Settlement</h3>
            <small>
              {record.number} · {record.party}
            </small>
          </div>
          <button
            type="button"
            className="stage-two-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </header>
        <div className="stage-two-info">
          <span>
            Final Invoice Amount: <b>₹{finalInvoiceAmount.toFixed(2)}</b>
          </span>
        </div>
        <label className="stage-two-notes">
          Amount Paid by Customer
          <input
            type="number"
            min="0"
            step="0.01"
            value={paid}
            onChange={(event) => setPaid(event.target.value)}
          />
        </label>
        <label className="stage-two-notes">
          Discount Amount (₹)
          <input
            type="number"
            min="0"
            step="0.01"
            value={discount}
            onChange={(event) => setDiscount(event.target.value)}
          />
        </label>
        <div className="stage-two-totals">
          <strong>
            <small>Final Invoice</small>₹{finalInvoiceAmount.toFixed(2)}
          </strong>
          <strong>
            <small>Amount Paid</small>₹
            {Number.isFinite(paidValue) ? money(paidValue).toFixed(2) : "0.00"}
          </strong>
          <strong>
            <small>Discount Amount</small>₹
            {Number.isFinite(discountValue)
              ? money(discountValue).toFixed(2)
              : "0.00"}
          </strong>
          <strong>
            <small>Remaining</small>₹{remaining.toFixed(2)}
          </strong>
        </div>
        {error && <p className="stage-two-error">{error}</p>}
        <footer>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            disabled={saving || !canComplete}
            onClick={submit}
          >
            {saving ? "Completing..." : "Record Payment / Complete"}
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
      {" "}
      <div
        className="challan-delete-dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        {" "}
        <h3>Delete Challan?</h3>{" "}
        <p>
          {" "}
          {record.number} for {record.party} will be permanently removed.{" "}
        </p>{" "}
        <small>Esc - Cancel | Enter - Delete</small>{" "}
        <footer>
          {" "}
          <button type="button" onClick={onClose}>
            {" "}
            Cancel{" "}
          </button>{" "}
          <button
            type="button"
            className="challan-delete-confirm"
            onClick={() => onConfirm(record.id)}
          >
            {" "}
            Delete Challan{" "}
          </button>{" "}
        </footer>{" "}
      </div>{" "}
    </div>
  );
};
export default function Challan() {
  const { user } = useAuth();
  const hasStagePermission = (stage) =>
    user?.role === "superadmin" ||
    Boolean(user?.permissions?.includes(`challan-stage-${stage}`));
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
  const [finalInvoiceCandidate, setFinalInvoiceCandidate] = useState(null);
  const [finalSettlementCandidate, setFinalSettlementCandidate] =
    useState(null);
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
              inventoryId: selected.id || "",
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
    if (!hasStagePermission(1)) {
      setFormError("Your account does not have Challan Stage 1 permission.");
      return;
    }
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
    if (
      previous?.items?.some(
        (item) => item.sourceInventoryId || item.inventoryId,
      ) &&
      (previous.items.length !== pricedItems.length ||
        previous.items.some((item, index) => {
          const next = pricedItems[index];
          return (
            (item.sourceInventoryId || item.inventoryId) !== next.inventoryId ||
            Number(item.weight || 0) !== Number(next.weight || 0) ||
            pieceValue(item.pieces) !== pieceValue(next.pieces)
          );
        }))
    ) {
      setFormError(
        "Issued Inventory quantities cannot be changed after a Challan is created. Edit party, date, comments, or pricing only.",
      );
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
          party,
          date: form.date,
          notes: form.notes,
          items: pricedItems,
          ...pricing,
          stage: 1,
          createdBy: user?.uid || "",
          createdByRole: user?.role || "staff",
        };
    if (previous) {
      await setDoc(doc(db, "challans", record.id), record);
    } else {
      const saved = await runTransaction(db, async (tx) => {
        const now = Date.now();
        const counterRef = doc(db, "counters", "challan");
        const counter = await tx.get(counterRef);
        const current = counter.exists() ? counter.data() : {};
        const series = Math.max(35, Number(current.series || 35));
        const previousNumber =
          Number(current.series || 0) < 35 ? 0 : Number(current.number || 0);
        const next =
          previousNumber >= 100
            ? { series: series + 1, number: 1 }
            : { series, number: previousNumber + 1 };
        const inventorySnapshots = await Promise.all(
          pricedItems.map((item) => {
            if (!item.inventoryId)
              throw new Error(`Select an Inventory item for ${item.sku}.`);
            return tx.get(doc(db, "inventory", item.inventoryId));
          }),
        );
        if (
          new Set(pricedItems.map((item) => item.inventoryId)).size !==
          pricedItems.length
        )
          throw new Error(
            "Each Challan line must use a different Inventory item. Combine quantities for the same item into one line.",
          );
        const issuedItems = [];
        for (const [index, item] of pricedItems.entries()) {
          const inventoryRef = doc(db, "inventory", item.inventoryId);
          const inventorySnapshot = inventorySnapshots[index];
          if (!inventorySnapshot.exists())
            throw new Error(
              `Inventory item ${item.sku} is no longer available.`,
            );
          const stock = inventorySnapshot.data();
          const requestedWeight = Number(item.weight || 0);
          const requestedPieces = pieceValue(item.pieces);
          if (
            requestedWeight < 0 ||
            requestedPieces < 0 ||
            requestedWeight > Number(stock.weight || 0) ||
            requestedPieces > stockPieces(stock)
          )
            throw new Error(`Insufficient available stock for ${item.sku}.`);
          tx.update(inventoryRef, {
            weight: Number(
              (Number(stock.weight || 0) - requestedWeight).toFixed(3),
            ),
            pieces: stockPieces(stock) - requestedPieces,
            updatedAt: serverTimestamp(),
          });
          issuedItems.push({ ...item, sourceInventoryId: item.inventoryId });
        }
        const savedRecord = {
          ...record,
          number: `A${next.series}/${next.number}`,
          items: issuedItems,
          createdAt: serverTimestamp(),
          createdAtMs: now,
          stageHistory: { stage1: { enteredAtMs: now } },
        };
        tx.set(counterRef, next, { merge: true });
        tx.set(doc(db, "challans", record.id), savedRecord);
        return { ...savedRecord, createdAt: now };
      });
      Object.assign(record, saved);
    }
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
    const requiredStage = Number(previous.stage) + 1;
    if (!hasStagePermission(requiredStage)) return;
    if (previous.stage === 1) {
      setStageTwoCandidate(previous);
      return;
    }
    if (previous.stage === 2) {
      setFinalInvoiceCandidate(previous);
      return;
    }
    if (previous.stage === 3) {
      setFinalSettlementCandidate(previous);
      return;
    }
  };
  const confirmStageTwo = async (returns, notes) => {
    const previous = stageTwoCandidate;
    if (!previous || previous.stage !== 1)
      throw new Error("This Challan is no longer in Stage 1.");
    if (!hasStagePermission(2))
      throw new Error("Your account does not have Challan Stage 2 permission.");
    const transitionItems = previous.items.map((item, index) => {
      const input = returns[index],
        returnedPieces = pieceValue(input.returnPieces),
        returnedWeight = Number(input.returnWeight);
      return {
        inventoryId: item.sourceInventoryId || item.inventoryId || "",
        sourceInventoryId: item.sourceInventoryId || item.inventoryId || "",
        sku: item.sku || "",
        type: item.type || "",
        shape: item.shape || "",
        size: item.size || "",
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
    const record = { ...previous, stage: 2 };
    const saved = await runTransaction(db, async (tx) => {
      const challanRef = doc(db, "challans", previous.id);
      const latestSnapshot = await tx.get(challanRef);
      if (!latestSnapshot.exists() || Number(latestSnapshot.data().stage) !== 1)
        throw new Error("This Challan is no longer in Stage 1.");
      const inventorySnapshots = await Promise.all(
        transitionItems.map((item) => {
          if (!item.sourceInventoryId)
            throw new Error(
              `Cannot return ${item.sku}: this historical Challan has no Inventory record identity.`,
            );
          return tx.get(doc(db, "inventory", item.sourceInventoryId));
        }),
      );
      const now = Date.now();
      transitionItems.forEach((item, index) => {
        const inventorySnapshot = inventorySnapshots[index];
        if (!inventorySnapshot.exists())
          throw new Error(`Inventory item ${item.sku} is no longer available.`);
        const stock = inventorySnapshot.data();
        tx.update(inventorySnapshot.ref, {
          weight: Number(
            (
              Number(stock.weight || 0) + Number(item.returnWeight || 0)
            ).toFixed(3),
          ),
          pieces: stockPieces(stock) + pieceValue(item.returnPieces),
          updatedAt: serverTimestamp(),
        });
      });
      const current = latestSnapshot.data();
      const savedRecord = {
        ...current,
        id: previous.id,
        stage: 2,
        stageHistory: {
          ...(current.stageHistory || {}),
          stage2: current.stageHistory?.stage2 || { enteredAtMs: now },
        },
        stage2Return: {
          items: transitionItems,
          notes,
          transitionedAtMs: now,
          actor: {
            uid: user?.uid || "",
            accessId: user?.accessId || "",
            role: user?.role || "employee",
          },
        },
      };
      tx.set(challanRef, savedRecord);
      return savedRecord;
    });
    Object.assign(record, saved);
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
  const confirmFinalInvoice = async () => {
    const previous = finalInvoiceCandidate;
    if (!previous) throw new Error("This Challan is no longer available.");
    if (!hasStagePermission(3))
      throw new Error("Your account does not have Challan Stage 3 permission.");
    const saved = await runTransaction(db, async (tx) => {
      const challanRef = doc(db, "challans", previous.id);
      const snapshot = await tx.get(challanRef);
      if (!snapshot.exists() || Number(snapshot.data().stage) !== 2)
        throw new Error("This Challan is no longer in Stage 2.");
      const current = snapshot.data();
      if (current.finalInvoice)
        throw new Error("Final Invoice has already been confirmed.");
      const now = Date.now();
      const invoice = invoiceSnapshotFor(current);
      const savedRecord = {
        ...current,
        id: previous.id,
        stage: 3,
        finalInvoice: { ...invoice, confirmedAtMs: now },
        stageHistory: {
          ...(current.stageHistory || {}),
          stage3: current.stageHistory?.stage3 || { enteredAtMs: now },
        },
      };
      tx.set(challanRef, savedRecord);
      return savedRecord;
    });
    setFinalInvoiceCandidate(null);
    void writeActivity({
      panel: "challan",
      stage: "Stage 3",
      action: "final_invoice_confirmed",
      recordId: saved.id,
      snapshot: challanSnapshot(saved),
      before: challanSnapshot(previous),
      user,
    }).catch((error) =>
      console.warn("Final Invoice activity could not be saved.", error),
    );
  };
  const confirmFinalSettlement = async (
    amountPaid,
    settlementDiscountAmount,
  ) => {
    const previous = finalSettlementCandidate;
    if (!previous) throw new Error("This Challan is no longer available.");
    if (!hasStagePermission(4))
      throw new Error("Your account does not have Challan Stage 4 permission.");
    const saved = await runTransaction(db, async (tx) => {
      const challanRef = doc(db, "challans", previous.id);
      const snapshot = await tx.get(challanRef);
      if (!snapshot.exists() || Number(snapshot.data().stage) !== 3)
        throw new Error("This Challan is no longer in Stage 3.");
      const current = snapshot.data();
      if (!current.finalInvoice)
        throw new Error("A Final Invoice is required before settlement.");
      if (current.finalSettlement)
        throw new Error("This Challan has already been settled.");
      if (
        !Number.isFinite(Number(amountPaid)) ||
        !Number.isFinite(Number(settlementDiscountAmount))
      )
        throw new Error(
          "Amount Paid and Discount Amount must be valid numbers.",
        );
      const finalInvoiceAmount = money(current.finalInvoice.finalInvoiceAmount);
      const paid = money(amountPaid),
        discount = money(settlementDiscountAmount);
      const remaining = money(finalInvoiceAmount - paid - discount);
      if (paid < 0 || discount < 0 || remaining !== 0)
        throw new Error(
          "Amount Paid plus Discount Amount must equal the Final Invoice Amount.",
        );
      const now = Date.now();
      const savedRecord = {
        ...current,
        id: previous.id,
        stage: 4,
        finalSettlement: {
          finalInvoiceAmount,
          amountPaid: paid,
          settlementDiscountAmount: discount,
          remaining,
          actualReceivedAmount: paid,
          completedAtMs: now,
        },
        stageHistory: {
          ...(current.stageHistory || {}),
          stage4: current.stageHistory?.stage4 || { enteredAtMs: now },
        },
      };
      tx.set(challanRef, savedRecord);
      return savedRecord;
    });
    setFinalSettlementCandidate(null);
    void writeActivity({
      panel: "challan",
      stage: "Stage 4",
      action: "final_settlement_completed",
      recordId: saved.id,
      snapshot: challanSnapshot(saved),
      before: challanSnapshot(previous),
      user,
    }).catch((error) =>
      console.warn("Final settlement activity could not be saved.", error),
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
  const canEditChallan = (record) =>
    isAdmin ||
    (hasStagePermission(record.stage) && staffEditRemaining(record) > 0);
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
    const rows = shown.map((row) => ({
      "Challan No.": row.number,
      Party: row.party,
      Date: row.date,
      Type: (row.items || [])
        .map((item) => item.type)
        .filter(Boolean)
        .join(", "),
      Items: historicalItemsFor(row)
        .map((item) => item.sku)
        .join(", "),
      Pieces: (row.items || []).reduce(
        (sum, item) => sum + pieceValue(item.pieces),
        0,
      ),
      Stage: "Stage " + row.stage + " - " + STAGES[row.stage],
      "Gross Amount": row.finalInvoice?.grossAmount ?? "",
      "Stage 1 Discount Amount": row.finalInvoice?.stage1DiscountAmount ?? "",
      "Final Invoice Amount": row.finalInvoice?.finalInvoiceAmount ?? "",
      "Final Invoice Confirmed": row.finalInvoice?.confirmedAtMs
        ? formatStageDate(row.finalInvoice.confirmedAtMs) +
          ", " +
          formatStageTime(row.finalInvoice.confirmedAtMs)
        : "",
      "Amount Paid": row.finalSettlement?.amountPaid ?? "",
      "Settlement Discount":
        row.finalSettlement?.settlementDiscountAmount ?? "",
      "Actual Received": row.finalSettlement?.actualReceivedAmount ?? "",
      Completed: row.finalSettlement?.completedAtMs
        ? formatStageDate(row.finalSettlement.completedAtMs) +
          ", " +
          formatStageTime(row.finalSettlement.completedAtMs)
        : "",
    }));
    const itemRows = shown.flatMap((row) =>
      historicalItemsFor(row).map((item) => ({
        "Challan No.": row.number,
        Stage: "Stage " + row.stage,
        SKU: item.sku || "",
        Shape: item.shape || "",
        Size: item.size || "",
        Type: item.type || "",
        "Original Pieces": pieceValue(item.pieces ?? item.issuedPieces),
        "Original Weight": Number(item.weight ?? item.issuedWeight ?? 0),
        "Issued Pieces":
          row.stage >= 2 ? pieceValue(item.issuedPieces ?? item.pieces) : "",
        "Issued Weight":
          row.stage >= 2 ? Number(item.issuedWeight ?? item.weight ?? 0) : "",
        "Return Pieces":
          row.stage >= 2 && item.returnPieces !== undefined
            ? pieceValue(item.returnPieces)
            : "",
        "Return Weight":
          row.stage >= 2 && item.returnWeight !== undefined
            ? Number(item.returnWeight)
            : "",
        "Sold / Kept Pieces":
          row.stage >= 2 && item.soldPieces !== undefined
            ? pieceValue(item.soldPieces)
            : "",
        "Sold / Kept Weight":
          row.stage >= 2 && item.soldWeight !== undefined
            ? Number(item.soldWeight)
            : "",
        "Original Amount": Number(item.amount || 0),
        "Stage 1 Discount %": Number(
          item.stage1DiscountPercent ?? item.discount ?? 0,
        ),
        "Stage 1 Discount Amount": item.stage1DiscountAmount ?? "",
        "Final Item Amount": item.finalAmount ?? "",
      })),
    );
    const sheet = XLSX.utils.json_to_sheet(rows);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Challans");
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.json_to_sheet(itemRows),
      "Items",
    );
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
            "</td></tr>"
          );
        })
        .join("") ||
      "<tr><td colspan=6>No Challans match the current filters.</td></tr>";
    popup.document.write(
      "<!doctype html><html><head><title>Challan Management</title><style>body{font-family:Arial,sans-serif;color:#172033;margin:28px}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #cbd5e1;padding:9px;text-align:left}th{background:#f1f5f9;font-size:11px;text-transform:uppercase}</style></head><body><h1>Challan Management</h1><p>Filtered list - " +
        shown.length +
        " Challans</p><table><thead><tr><th>Challan No.</th><th>Party</th><th>Items</th><th>Date</th><th>Qty</th><th>Stage</th></tr></thead><tbody>" +
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
    const stage = Number(record.stage || 1);
    const items = historicalItemsFor(record);
    const invoice = record.finalInvoice;
    const settlement = record.finalSettlement;
    const isFlowStage = stage === 2 || stage === 4;
    const types = (record.items || [])
      .map((item) => item.type)
      .filter(Boolean)
      .join(", ");
    const totalAmount = money(
      items.reduce((sum, item) => sum + Number(item.amount || 0), 0),
    );
    const sumPiecesForPrint = (key) =>
      items.reduce((sum, item) => sum + pieceValue(item[key]), 0);
    const sumWeightForPrint = (key) =>
      items.reduce((sum, item) => sum + Number(item[key] || 0), 0);
    const totalDetails =
      stage === 1
        ? "Items: " +
          items.length +
          " &nbsp; Pieces: " +
          sumPiecesForPrint("pieces") +
          " &nbsp; Weight: " +
          sumWeightForPrint("weight").toFixed(3) +
          " ct &nbsp; Original Amount: &#8377;" +
          totalAmount.toFixed(2)
        : isFlowStage
          ? "Items: " +
            items.length +
            " &nbsp; Issued: " +
            sumPiecesForPrint("issuedPieces") +
            " pcs / " +
            sumWeightForPrint("issuedWeight").toFixed(3) +
            " ct &nbsp; Returned: " +
            sumPiecesForPrint("returnPieces") +
            " pcs / " +
            sumWeightForPrint("returnWeight").toFixed(3) +
            " ct &nbsp; Sold / Kept: " +
            sumPiecesForPrint("soldPieces") +
            " pcs / " +
            sumWeightForPrint("soldWeight").toFixed(3) +
            " ct &nbsp; Original Amount: &#8377;" +
            totalAmount.toFixed(2)
          : "Items: " +
            items.length +
            " &nbsp; Original Amount: &#8377;" +
            totalAmount.toFixed(2);
    const headers = ["SKU / Item", "Shape", "Size"];
    if (stage === 1) headers.push("Pieces", "Weight");
    if (isFlowStage)
      headers.push(
        "Issued Pieces",
        "Issued Weight",
        "Return Pieces",
        "Return Weight",
        "Sold / Kept Pieces",
        "Sold / Kept Weight",
      );
    if (stage === 3) headers.push("Sold / Kept");
    headers.push("Original Amount", "Stage 1 Discount %");
    const itemRows = items
      .map((item) => {
        const cells = [escape(item.sku), escape(item.shape), escape(item.size)];
        if (stage === 1)
          cells.push(
            pieceValue(item.pieces),
            Number(item.weight || 0).toFixed(3) + " ct",
          );
        if (isFlowStage)
          cells.push(
            pieceValue(item.issuedPieces ?? item.pieces),
            Number(item.issuedWeight ?? item.weight ?? 0).toFixed(3) + " ct",
            item.returnPieces === undefined
              ? "-"
              : pieceValue(item.returnPieces),
            item.returnWeight === undefined
              ? "-"
              : Number(item.returnWeight).toFixed(3) + " ct",
            item.soldPieces === undefined ? "-" : pieceValue(item.soldPieces),
            item.soldWeight === undefined
              ? "-"
              : Number(item.soldWeight).toFixed(3) + " ct",
          );
        if (stage === 3)
          cells.push(
            (item.soldPieces === undefined
              ? "-"
              : pieceValue(item.soldPieces) + " pcs") +
              " / " +
              (item.soldWeight === undefined
                ? "-"
                : Number(item.soldWeight).toFixed(3) + " ct"),
          );
        cells.push(
          "&#8377;" + money(item.amount).toFixed(2),
          money(item.stage1DiscountPercent ?? item.discount).toFixed(2) + "%",
        );
        return (
          "<tr>" +
          cells.map((cell) => "<td>" + cell + "</td>").join("") +
          "</tr>"
        );
      })
      .join("");
    const invoiceDetails = invoice
      ? '<p class="total">Gross Amount: &#8377;' +
        money(invoice.grossAmount).toFixed(2) +
        (Number(invoice.stage1DiscountAmount)
          ? " &nbsp; Stage 1 Discount: -&#8377;" +
            money(invoice.stage1DiscountAmount).toFixed(2)
          : "") +
        " &nbsp; <strong>Final Invoice Amount: &#8377;" +
        money(invoice.finalInvoiceAmount).toFixed(2) +
        "</strong></p>" +
        (invoice.confirmedAtMs
          ? "<p>Final Invoice confirmed: " +
            escape(
              formatStageDate(invoice.confirmedAtMs) +
                ", " +
                formatStageTime(invoice.confirmedAtMs),
            ) +
            "</p>"
          : "")
      : "";
    const settlementDetails =
      stage === 4 && settlement
        ? '<p class="total">Amount Paid by Customer: &#8377;' +
          money(settlement.amountPaid).toFixed(2) +
          " &nbsp; Settlement Discount: &#8377;" +
          money(settlement.settlementDiscountAmount).toFixed(2) +
          " &nbsp; <strong>Actual Received: &#8377;" +
          money(settlement.actualReceivedAmount).toFixed(2) +
          "</strong></p>" +
          (settlement.completedAtMs
            ? "<p>Completed: " +
              escape(
                formatStageDate(settlement.completedAtMs) +
                  ", " +
                  formatStageTime(settlement.completedAtMs),
              ) +
              "</p>"
            : "")
        : "";
    const copy = (label) =>
      '<section class="copy"><header><b>' +
      label +
      '</b><h1>CHALLAN DETAILS</h1></header><div class="details"><p><strong>Challan No:</strong> ' +
      escape(record.number) +
      "</p><p><strong>Party:</strong> " +
      escape(record.party) +
      "</p><p><strong>Date:</strong> " +
      escape(record.date || formatStageDate(stageEnteredAt(record, 1)) || "-") +
      "</p><p><strong>Type / CVD / HP:</strong> " +
      escape(types || "-") +
      "</p><p><strong>Current Stage:</strong> Stage " +
      record.stage +
      " - " +
      escape(STAGES[record.stage]) +
      "</p></div><table><thead><tr>" +
      headers.map((header) => "<th>" + header + "</th>").join("") +
      "</tr></thead><tbody>" +
      itemRows +
      '</tbody></table><p class="total">' +
      totalDetails +
      "</p>" +
      invoiceDetails +
      settlementDetails +
      '<p class="notes"><strong>Notes:</strong> ' +
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
          {" "}
          <button
            className="back"
            type="button"
            onClick={() => {
              setPage("list");
              setViewId(null);
            }}
          >
            {" "}
            <Icon name="back" /> Back to Challans{" "}
          </button>{" "}
          <div className="empty">
            {" "}
            <h3>Challan not found</h3>{" "}
          </div>{" "}
        </section>
      );
    const stage = Number(viewRecord.stage || 1);
    const issuedItems = viewRecord.items || [];
    const returnItems = viewRecord.stage2Return?.items || [];
    const invoice = viewRecord.finalInvoice;
    const settlement = viewRecord.finalSettlement;
    const items =
      stage >= 3 && Array.isArray(invoice?.items) && invoice.items.length
        ? invoice.items
        : stage >= 2 && returnItems.length
          ? returnItems
          : issuedItems;
    const sumNumber = (key) =>
      items.reduce((total, item) => total + Number(item[key] || 0), 0);
    const sumPieces = (key = "pieces") =>
      items.reduce((total, item) => total + pieceValue(item[key]), 0);
    const originalAmount = money(sumNumber("amount"));
    const types = [
      ...new Set(issuedItems.map((item) => item.type).filter(Boolean)),
    ];
    const age = challanAging(viewRecord, clock);
    const message = {
      1: "Goods issued and awaiting return details",
      2: "Returned and kept goods recorded",
      3: "Payment due is pending",
      4: "Challan workflow completed",
    }[viewRecord.stage];
    return (
      <section className="challan-page challan-view">
        {" "}
        <div className="challan-view-toolbar">
          {" "}
          <button
            className="back"
            type="button"
            onClick={() => {
              setPage("list");
              setViewId(null);
            }}
          >
            {" "}
            <Icon name="back" /> Back to Challans{" "}
          </button>{" "}
          <button
            type="button"
            className="challan-view-print"
            onClick={() => printChallan(viewRecord)}
          >
            {" "}
            Print{" "}
          </button>{" "}
        </div>{" "}
        <article className="challan-view-card">
          {" "}
          <div className="challan-view-identity">
            {" "}
            <div>
              {" "}
              <small>CHALLAN NUMBER</small> <h1>{viewRecord.number}</h1>{" "}
              <h2>{viewRecord.party}</h2>{" "}
              <p>
                {" "}
                Date:{" "}
                {viewRecord.date ||
                  formatStageDate(stageEnteredAt(viewRecord, 1)) ||
                  "-"}
                {types.length
                  ? ` · Type / CVD / HP: ${types.join(", ")}`
                  : ""}{" "}
              </p>{" "}
            </div>{" "}
            <div className="challan-view-status">
              {" "}
              {stage < 4 && (
                <span className={"challan-aging-badge " + age.status}>
                  <i /> {age.label} <b>-</b> {age.elapsedLabel}
                </span>
              )}{" "}
              <em className={"stage stage-" + viewRecord.stage}>
                {" "}
                Stage {viewRecord.stage} - {STAGES[viewRecord.stage]}{" "}
              </em>{" "}
            </div>{" "}
          </div>{" "}
          <div className="challan-view-divider" />{" "}
          <div className="challan-view-current">
            {" "}
            <strong>{message}</strong>{" "}
          </div>{" "}
          <div className="challan-view-divider" />{" "}
          <div className="challan-timeline">
            {" "}
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
                  {" "}
                  <div className="challan-timeline-dot">
                    {" "}
                    {stage < viewRecord.stage ? (
                      <Icon name="check" />
                    ) : (
                      stage
                    )}{" "}
                  </div>{" "}
                  {stage < 4 && <i className="challan-timeline-line" />}{" "}
                  <b>Stage {stage}</b> <span>{STAGES[stage]}</span>{" "}
                  {entered && (
                    <small>
                      {" "}
                      {formatStageDate(entered)} <br />{" "}
                      {formatStageTime(entered)}{" "}
                    </small>
                  )}{" "}
                </div>
              );
            })}{" "}
          </div>{" "}
        </article>{" "}
        <article className="challan-view-card challan-view-items">
          {" "}
          <h2>
            {stage === 1
              ? "Original Goods Out"
              : stage === 2
                ? "Return / Sale Outcome"
                : stage === 3
                  ? "Final Invoice"
                  : "Complete Challan History"}
          </h2>{" "}
          <div className="challan-view-table-wrap">
            {" "}
            <table>
              {" "}
              <thead>
                {" "}
                <tr>
                  <th>SKU / Item</th>
                  <th>Shape</th>
                  <th>Size</th>
                  {stage === 1 && (
                    <>
                      <th>Pieces</th>
                      <th>Weight</th>
                    </>
                  )}
                  {[2, 4].includes(stage) && (
                    <>
                      <th>Issued Pieces</th>
                      <th>Issued Weight</th>
                      <th>Return Pieces</th>
                      <th>Return Weight</th>
                      <th>Sold / Kept Pieces</th>
                      <th>Sold / Kept Weight</th>
                    </>
                  )}
                  {stage === 3 && <th>Sold / Kept</th>}
                  <th>Amount</th>
                  <th>Stage 1 Discount</th>
                  {stage >= 3 && <th>Discount Amount</th>}
                </tr>{" "}
              </thead>{" "}
              <tbody>
                {" "}
                {items.map((item, index) => (
                  <tr key={item.id || item.sku || index}>
                    <td>{item.sku || "-"}</td>
                    <td>{item.shape || "-"}</td>
                    <td>{item.size || "-"}</td>
                    {stage === 1 && (
                      <>
                        <td>{pieceValue(item.pieces)}</td>
                        <td>{Number(item.weight || 0).toFixed(3)} ct</td>
                      </>
                    )}
                    {[2, 4].includes(stage) && (
                      <>
                        <td>{pieceValue(item.issuedPieces ?? item.pieces)}</td>
                        <td>
                          {Number(
                            item.issuedWeight ?? item.weight ?? 0,
                          ).toFixed(3)}{" "}
                          ct
                        </td>
                        <td>{pieceValue(item.returnPieces)}</td>
                        <td>{Number(item.returnWeight || 0).toFixed(3)} ct</td>
                        <td>{pieceValue(item.soldPieces)}</td>
                        <td>{Number(item.soldWeight || 0).toFixed(3)} ct</td>
                      </>
                    )}
                    {stage === 3 && (
                      <td>
                        {pieceValue(item.soldPieces)} pcs /{" "}
                        {Number(item.soldWeight || 0).toFixed(3)} ct
                      </td>
                    )}
                    <td>₹{money(item.amount).toFixed(2)}</td>
                    <td>
                      {money(
                        item.stage1DiscountPercent ?? item.discount,
                      ).toFixed(2)}
                      %
                    </td>
                    {stage >= 3 && (
                      <td>
                        ₹
                        {money(
                          item.stage1DiscountAmount ??
                            (money(item.amount) * money(item.discount)) / 100,
                        ).toFixed(2)}
                      </td>
                    )}
                  </tr>
                ))}{" "}
              </tbody>{" "}
              <tfoot>
                <tr>
                  <td colSpan="3">
                    <strong>Total Items: {items.length}</strong>
                  </td>
                  {stage === 1 && (
                    <>
                      <td>
                        <strong>{sumPieces()}</strong>
                      </td>
                      <td>
                        <strong>{sumNumber("weight").toFixed(3)} ct</strong>
                      </td>
                    </>
                  )}
                  {[2, 4].includes(stage) && (
                    <>
                      <td>
                        <strong>{sumPieces("issuedPieces")}</strong>
                      </td>
                      <td>
                        <strong>
                          {sumNumber("issuedWeight").toFixed(3)} ct
                        </strong>
                      </td>
                      <td>
                        <strong>{sumPieces("returnPieces")}</strong>
                      </td>
                      <td>
                        <strong>
                          {sumNumber("returnWeight").toFixed(3)} ct
                        </strong>
                      </td>
                      <td>
                        <strong>{sumPieces("soldPieces")}</strong>
                      </td>
                      <td>
                        <strong>{sumNumber("soldWeight").toFixed(3)} ct</strong>
                      </td>
                    </>
                  )}
                  {stage === 3 && <td />}
                  <td>
                    <strong>₹{originalAmount.toFixed(2)}</strong>
                  </td>
                  <td />
                  {stage >= 3 && <td />}
                </tr>
              </tfoot>
            </table>{" "}
          </div>{" "}
          <div className="challan-view-summary">
            <span>
              Total Amount: <b>₹{originalAmount.toFixed(2)}</b>
            </span>
            {stage >= 3 && invoice && (
              <>
                <span>
                  Gross Amount: <b>₹{money(invoice.grossAmount).toFixed(2)}</b>
                </span>
                <span>
                  Stage 1 Discount Amount:{" "}
                  <b>- ₹{money(invoice.stage1DiscountAmount).toFixed(2)}</b>
                </span>
              </>
            )}
          </div>{" "}
          {stage >= 3 && invoice && (
            <div className="challan-view-payable">
              <small>FINAL INVOICE AMOUNT / TOTAL AMOUNT PAYABLE</small>
              <strong>₹{money(invoice.finalInvoiceAmount).toFixed(2)}</strong>
            </div>
          )}
          {stage >= 3 && invoice?.confirmedAtMs && (
            <p>
              Final Invoice confirmed: {formatStageDate(invoice.confirmedAtMs)},{" "}
              {formatStageTime(invoice.confirmedAtMs)}
            </p>
          )}
          {stage === 4 && settlement && (
            <div className="challan-view-summary">
              <span>
                Amount Paid by Customer:{" "}
                <b>₹{money(settlement.amountPaid).toFixed(2)}</b>
              </span>
              <span>
                Settlement Discount:{" "}
                <b>₹{money(settlement.settlementDiscountAmount).toFixed(2)}</b>
              </span>
              <span>
                Actual Received:{" "}
                <b>₹{money(settlement.actualReceivedAmount).toFixed(2)}</b>
              </span>
              <span>
                Remaining: <b>₹{money(settlement.remaining).toFixed(2)}</b>
              </span>
            </div>
          )}
          {stage === 4 && settlement?.completedAtMs && (
            <p>
              Completed: {formatStageDate(settlement.completedAtMs)},{" "}
              {formatStageTime(settlement.completedAtMs)}
            </p>
          )}
        </article>{" "}
        <article className="challan-view-card challan-view-notes">
          {" "}
          <h2>Comments / Notes</h2>{" "}
          <p>
            {" "}
            {viewRecord.notes?.trim() ||
              "No notes added for this Challan."}{" "}
          </p>{" "}
          {Number(viewRecord.stage) <= 2 && (
            <section
              className="challan-image-placeholder"
              aria-label="Image upload placeholder"
            >
              {" "}
              <b>Image Upload</b>{" "}
              <span>
                Images can be attached to this Challan here in a future update.
              </span>{" "}
              <button type="button" disabled aria-disabled="true">
                Upload Image
              </button>{" "}
            </section>
          )}{" "}
        </article>{" "}
      </section>
    );
  }
  if (page === "create")
    return (
      <section className="challan-page challan-create">
        {" "}
        <button
          className="back"
          type="button"
          onClick={closeEditor}
          aria-label="Back to Challans"
        >
          {" "}
          <Icon name="back" /> Back to Challans{" "}
        </button>{" "}
        <header>
          {" "}
          <h2>{editingId ? "Edit Challan" : "Create Challan"}</h2>{" "}
          <div className="challan-create-actions">
            {" "}
            <span>
              {" "}
              {editingId
                ? "Update challan details"
                : "Stage 1 - Goods Out"}{" "}
            </span>{" "}
            <button type="button" onClick={exportDraft}>
              {" "}
              Export{" "}
            </button>{" "}
            <button type="button" onClick={printDraft}>
              {" "}
              Print{" "}
            </button>{" "}
          </div>{" "}
        </header>{" "}
        <form onSubmit={create}>
          {" "}
          <datalist id="challan-skus">
            {" "}
            {inventory.map((item) => (
              <option key={item.id} value={item.sku}>
                {" "}
                {item.shape} · {item.size} mm · {item.type}{" "}
              </option>
            ))}{" "}
          </datalist>{" "}
          <datalist id="challan-parties">
            {" "}
            {parties.map((party) => (
              <option key={party} value={party} />
            ))}{" "}
          </datalist>{" "}
          <article>
            {" "}
            <h3>Challan Details</h3>{" "}
            <div className="challan-fields">
              {" "}
              <label>
                {" "}
                Date{" "}
                <input
                  type="date"
                  value={form.date}
                  onChange={(event) => {
                    setFormError("");
                    setForm({ ...form, date: event.target.value });
                  }}
                />{" "}
              </label>{" "}
              <label>
                {" "}
                Challan No. <input disabled value="Auto-generated" />{" "}
              </label>{" "}
              <label className={challanFieldErrors.party ? "has-error" : ""}>
                {" "}
                Party Name *{" "}
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
                />{" "}
                {challanFieldErrors.party && (
                  <small className="challan-field-error">
                    {" "}
                    {challanFieldErrors.party}{" "}
                  </small>
                )}{" "}
                <small className="party-help">
                  {" "}
                  {user?.role === "superadmin"
                    ? "New names are saved once and appear here next time."
                    : "Select an existing party or enter a new party name."}{" "}
                </small>{" "}
              </label>{" "}
            </div>{" "}
          </article>{" "}
          <datalist id="challan-discounts">
            {" "}
            <option value="6" /> <option value="7" /> <option value="8" />{" "}
          </datalist>{" "}
          <article>
            {" "}
            <h3>Inventory Items</h3>{" "}
            {challanFieldErrors.items && (
              <p className="challan-form-error" role="alert">
                {" "}
                {challanFieldErrors.items}{" "}
              </p>
            )}{" "}
            {formError && (
              <p className="challan-form-error" role="alert">
                {" "}
                {formError}{" "}
              </p>
            )}{" "}
            <div className="item-head">
              {" "}
              <span>
                {" "}
                Inventory SKU *{" "}
                <em className="live-weight-label">live weight</em>{" "}
              </span>{" "}
              <span>Shape</span> <span>Size</span> <span>Type</span>{" "}
              <span>Weight / Carat</span> <span>Pieces</span>{" "}
              <span>Amount</span> <span>Discount %</span>{" "}
              <span>Discount / Net</span> <span />{" "}
            </div>{" "}
            {form.items.map((item) => (
              <div className="challan-item" key={item.id}>
                {" "}
                <SkuPicker
                  value={item.sku}
                  inventory={inventory}
                  onChange={(value) => itemChange(item.id, "sku", value)}
                  onSelect={(selected) => selectSku(item.id, selected)}
                  autoFocus={focusSkuId === item.id}
                />{" "}
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
                ))}{" "}
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={item.amount}
                  onChange={(event) =>
                    itemChange(item.id, "amount", event.target.value)
                  }
                  placeholder="Amount"
                />{" "}
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
                />{" "}
                <span className="item-price-summary">
                  {" "}
                  ₹{" "}
                  {pricingFor(
                    item.amount,
                    item.discount,
                  ).discountAmount.toFixed(2)}{" "}
                  / ₹{" "}
                  {pricingFor(item.amount, item.discount).netAmount.toFixed(
                    2,
                  )}{" "}
                </span>{" "}
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
                  {" "}
                  Remove{" "}
                </button>{" "}
              </div>
            ))}{" "}
            <div
              className="challan-item-totals"
              aria-label="Challan item totals"
            >
              {" "}
              <strong>
                {" "}
                Total Items:{" "}
                {form.items.filter((item) => item.sku.trim()).length}{" "}
              </strong>{" "}
              <span /> <span /> <span />{" "}
              <strong>
                {" "}
                Total:{" "}
                {form.items
                  .reduce((sum, item) => sum + Number(item.weight || 0), 0)
                  .toFixed(3)}{" "}
                ct{" "}
              </strong>{" "}
              <strong>
                {" "}
                Total:{" "}
                {form.items.reduce(
                  (sum, item) => sum + pieceValue(item.pieces),
                  0,
                )}{" "}
                pcs{" "}
              </strong>{" "}
              <strong>Discount: ₹{pricing.discountAmount.toFixed(2)}</strong>{" "}
              <strong>Net: ₹{pricing.netAmount.toFixed(2)}</strong>{" "}
              <span />{" "}
            </div>{" "}
            <button type="button" className="add" onClick={addItem}>
              {" "}
              <Icon name="plus" /> Add Another Item{" "}
            </button>{" "}
          </article>{" "}
          <article>
            {" "}
            <h3>Comments / Notes</h3>{" "}
            <textarea
              rows="3"
              value={form.notes}
              onChange={(event) => {
                setFormError("");
                setForm({ ...form, notes: event.target.value });
              }}
              placeholder="Add any note for this challan..."
            />{" "}
          </article>{" "}
          <footer>
            {" "}
            <button
              className="primary"
              disabled={!editingId && !hasStagePermission(1)}
            >
              {" "}
              {editingId ? "Save Changes" : "Create Challan"}{" "}
            </button>{" "}
            <button type="button" onClick={closeEditor}>
              {" "}
              Cancel{" "}
            </button>{" "}
          </footer>{" "}
        </form>{" "}
      </section>
    );
  return (
    <section className="challan-page">
      {" "}
      <header className="challan-heading">
        {" "}
        <div>
          {" "}
          <h2>Challan Management</h2>{" "}
          <p>
            Manage goods out, returns, payments and completed challans.
          </p>{" "}
        </div>{" "}
        <div className="challan-list-actions">
          {" "}
          <button
            className="primary"
            disabled={!hasStagePermission(1)}
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
            {" "}
            <Icon name="plus" /> Create Challan{" "}
          </button>{" "}
          <button type="button" onClick={exportList}>
            {" "}
            Export{" "}
          </button>{" "}
          <button type="button" onClick={printList}>
            {" "}
            Print{" "}
          </button>{" "}
        </div>{" "}
      </header>{" "}
      <label className="search">
        {" "}
        <Icon name="search" />{" "}
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search Challan No., Party, Inventory SKU, Shape, Size or Type..."
        />{" "}
      </label>{" "}
      <nav>
        {" "}
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
            {" "}
            <span className="challan-tab-main">
              {" "}
              {label} <small>{count(key)}</small>{" "}
            </span>{" "}
            {key !== "all" && (
              <span className="challan-tab-subtitle">{STAGES[key]}</span>
            )}{" "}
          </button>
        ))}{" "}
      </nav>{" "}
      <div className="metrics">
        {" "}
        {[
          ["Total Challans", count("all")],
          ["Goods Out", count(1)],
          ["Payment Pending", count(3)],
          ["Completed", count(4)],
        ].map(([label, value]) => (
          <article key={label}>
            {" "}
            <span>{label}</span> <b>{value}</b>{" "}
          </article>
        ))}{" "}
      </div>{" "}
      <div className="challan-filters">
        {" "}
        <label>
          {" "}
          Date{" "}
          <input
            type="date"
            value={dateFilter}
            onChange={(event) => setDateFilter(event.target.value)}
          />{" "}
        </label>{" "}
        <label>
          {" "}
          Party{" "}
          <select
            value={partyFilter}
            onChange={(event) => setPartyFilter(event.target.value)}
          >
            {" "}
            <option value="">All parties</option>{" "}
            {parties.map((party) => (
              <option key={party}>{party}</option>
            ))}{" "}
          </select>{" "}
        </label>{" "}
        <label>
          {" "}
          Aging{" "}
          <select
            value={agingFilter}
            onChange={(event) => setAgingFilter(event.target.value)}
          >
            {" "}
            <option value="all">All</option>{" "}
            <option value="green">Green</option>{" "}
            <option value="yellow">Yellow</option>{" "}
            <option value="red">Red</option>{" "}
          </select>{" "}
        </label>{" "}
        <label>
          {" "}
          Sort{" "}
          <select
            value={sortMode}
            onChange={(event) => setSortMode(event.target.value)}
          >
            {" "}
            <option value="newest">Newest First</option>{" "}
            <option value="oldest">Oldest First</option>{" "}
          </select>{" "}
        </label>{" "}
        <aside
          className="challan-aging-legend"
          aria-label="Challan aging milestones"
        >
          {" "}
          {[
            ["green", "Green", "24 hours"],
            ["yellow", "Yellow", "60 hours"],
            ["red", "Red", "5 days"],
          ].map(([status, label, timing]) => (
            <div key={status} className={status}>
              {" "}
              <span>
                {" "}
                <i /> {label}{" "}
              </span>{" "}
              <small>{timing}</small>{" "}
            </div>
          ))}{" "}
        </aside>{" "}
      </div>{" "}
      <p className="showing">Showing {shown.length} Challans</p>{" "}
      {shown.length ? (
        <div className="challan-list">
          {" "}
          <div
            className={`list-head ${tab === "all" ? "" : "stage-column-hidden"}`}
          >
            {" "}
            <span>Challan / Party</span> <span>Items</span> <span>Date</span>{" "}
            <span>Total Pcs</span> {tab === "all" && <span>Stage</span>}{" "}
            <span>Aging</span> <span>Actions</span>{" "}
          </div>{" "}
          {shown.map((row) => (
            <div
              className={`challan-row aging-${challanAging(row, clock).status} ${tab === "all" ? "" : "stage-column-hidden"}`}
              key={row.id}
            >
              {" "}
              <div>
                {" "}
                <button
                  type="button"
                  className="challan-view-link"
                  onClick={() => {
                    setViewId(row.id);
                    setPage("view");
                  }}
                >
                  {" "}
                  {row.number}{" "}
                </button>{" "}
                <small>{row.party}</small>{" "}
              </div>{" "}
              <span>{row.items.map((item) => item.sku).join(", ")}</span>{" "}
              <time>{row.date}</time>{" "}
              <b>
                {" "}
                {row.items.reduce(
                  (sum, item) => sum + pieceValue(item.pieces),
                  0,
                )}{" "}
              </b>{" "}
              {tab === "all" && (
                <em className={`stage stage-${row.stage}`}>
                  Stage {row.stage} - {STAGES[row.stage]}
                </em>
              )}{" "}
              {(() => {
                const age = challanAging(row, clock);
                return (
                  <span className={`challan-aging-badge ${age.status}`}>
                    {" "}
                    <i /> {age.label} <b>-</b> {age.elapsedLabel}{" "}
                  </span>
                );
              })()}{" "}
              <span className="challan-actions">
                {" "}
                <button
                  type="button"
                  className="challan-view-button"
                  onClick={() => {
                    setViewId(row.id);
                    setPage("view");
                  }}
                >
                  {" "}
                  View{" "}
                </button>{" "}
                <button
                  className="challan-workflow-button"
                  disabled={
                    row.stage === 4 ||
                    !hasStagePermission(Number(row.stage) + 1)
                  }
                  onClick={() => advance(row.id)}
                >
                  {" "}
                  {stageActionLabel(row.stage)} <Icon name="arrow" />{" "}
                </button>{" "}
                <span className="challan-row-actions">
                  {" "}
                  {!isAdmin &&
                    row.createdBy === user?.uid &&
                    row.createdByRole !== "superadmin" && (
                      <small
                        className={`challan-edit-timer ${staffEditRemaining(row) ? "" : "expired"}`}
                      >
                        {" "}
                        {staffEditRemaining(row)
                          ? `Edit available: ${formatEditCountdown(staffEditRemaining(row))}`
                          : "Edit time ended"}{" "}
                      </small>
                    )}{" "}
                  {canEditChallan(row) && (
                    <button
                      type="button"
                      className="challan-edit"
                      onClick={() => editChallan(row)}
                    >
                      {" "}
                      Edit{" "}
                    </button>
                  )}{" "}
                  {isAdmin && (
                    <button
                      type="button"
                      className="challan-delete"
                      onClick={() => setDeleteCandidate(row)}
                    >
                      {" "}
                      Delete{" "}
                    </button>
                  )}{" "}
                </span>{" "}
              </span>{" "}
            </div>
          ))}{" "}
        </div>
      ) : (
        <div className="empty">
          {" "}
          <h3>
            {" "}
            {records.length
              ? "No challans found"
              : "No challans created yet"}{" "}
          </h3>{" "}
          <p>
            {" "}
            {records.length
              ? "Try changing your search or stage filter."
              : "Create your first Stage 1 challan to get started."}{" "}
          </p>{" "}
          {![2, 3, 4].includes(Number(tab)) && (
            <button
              className="primary"
              disabled={!hasStagePermission(1)}
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
              {" "}
              <Icon name="plus" /> Create First Challan{" "}
            </button>
          )}{" "}
        </div>
      )}{" "}
      {stageTwoCandidate && (
        <StageTwoModal
          record={stageTwoCandidate}
          onClose={() => setStageTwoCandidate(null)}
          onConfirm={confirmStageTwo}
        />
      )}{" "}
      {finalInvoiceCandidate && (
        <FinalInvoiceModal
          record={finalInvoiceCandidate}
          onClose={() => setFinalInvoiceCandidate(null)}
          onConfirm={confirmFinalInvoice}
        />
      )}{" "}
      {finalSettlementCandidate && (
        <FinalSettlementModal
          record={finalSettlementCandidate}
          onClose={() => setFinalSettlementCandidate(null)}
          onConfirm={confirmFinalSettlement}
        />
      )}{" "}
      {deleteCandidate && (
        <ChallanDeleteModal
          record={deleteCandidate}
          onClose={() => setDeleteCandidate(null)}
          onConfirm={deleteChallan}
        />
      )}{" "}
    </section>
  );
}
