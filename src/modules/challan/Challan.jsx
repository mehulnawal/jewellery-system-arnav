import { useInventoryDiscovery } from "../../hooks/useInventoryDiscovery.js";
import { runTransaction, setDoc } from "../../firebase/businessWrites.js";
import InventoryPicker from "./InventoryPicker";
import { inventoryMatchesSearch } from "../../utils/inventoryRules.js";
import { normalizeSize } from "../../utils/dimensions.js";
import { useMasterPrices } from "../../hooks/useMasterPrices";
import {
  refreshItemPrice,
  savedPriceItem,
  widthError,
  priceContext,
} from "../../utils/masterPrices.js";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import "./challan.css";
import {
  collection,
  doc,
  getDocFromServer,
  onSnapshot,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../../firebase/config";
import { useAuth } from "../../auth/AuthContext";
import { writeActivity } from "../../utils/activityLog";
import { isWholePieces, pieceValue } from "../../utils/pieces";
import {
  fromCents,
  fromMillis,
  invoiceFromStageTwo,
  moneyCents,
  movementFor,
  normalizeMoney,
  normalizeWeight,
  priceWeightedItem,
  stageOneFinancials,
  savableStageOneRows,
  WEIGHT_RATE_PRICING,
  settlementFor,
  stageOneTotals,
  stageTwoTotals,
  strictMoney,
  updateReturnRows,
  weightMillis,
  wholePieces,
  unchangedAdvancedStageOne,
  sameStageOneReturnSource,
  sameStageTwoInvoiceSource,
  invoiceReviewRows,
  challanStockRestoration,
} from "../../utils/challanCalculations.js";
import { usePageFreeze } from "../../hooks/usePageFreeze";
import {
  stageOneEditSnapshot,
  sameStageOneEditSnapshot,
} from "../../utils/challanEditSnapshot.js";
import { createStageOneChallan } from "../../utils/challanStageOneCreate.js";
import {
  parseChallanImport,
  validateImportedStageOneRows,
  canImportChallan,
  nextBulkChallanNumber,
  prepareImportedStageOneRecord,
  CHALLAN_IMPORT_HEADERS,
} from "../../utils/challanImport.js";
import { challanAging, timestampMs } from "../../utils/challanAging";
import {
  canEditChallan as editAllowed,
  challanEditRemaining,
} from "../../utils/challanEditWindow.js";
import { uploadChallanImage } from "../../utils/cloudinary";
import {
  CHALLAN_NUMBER_HELP,
  CHALLAN_NUMBER_PATTERN,
  documentNumberError,
} from "../../utils/documentNumbers.js";
import {
  prepareNumberClaim,
  prepareNumberRelease,
} from "../../utils/numberRegistry.js";
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
const pricingFor = (weight, amount, discount) => {
  try {
    return priceWeightedItem(weight, amount, discount);
  } catch {
    return null;
  }
};
const money = (value) => {
  try {
    return normalizeMoney(value);
  } catch {
    return Number.NaN;
  }
};
const isValidMoney = (value) => {
  try {
    strictMoney(value);
    return true;
  } catch {
    return false;
  }
};
const inrFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const hasStoredNumber = (value) =>
  value !== undefined &&
  value !== null &&
  /^\d+(?:\.\d+)?$/.test(String(value).trim()) &&
  Number.isFinite(Number(value));
const exportMoney = (value) => {
  try {
    return normalizeMoney(value);
  } catch {
    return "";
  }
};
const exportWeight = (value) => {
  try {
    return normalizeWeight(value);
  } catch {
    return "";
  }
};
const exportPieces = (value) => {
  try {
    return wholePieces(value);
  } catch {
    return "";
  }
};
const weightText = (value) => {
  try {
    return normalizeWeight(value).toFixed(3);
  } catch {
    return "Unavailable";
  }
};
const moneyText = (value) => {
  const amount = exportMoney(value);
  return amount === "" ? "Unavailable" : amount.toFixed(2);
};
const viewCurrency = (value, fallback = "--") => {
  const amount = exportMoney(value);
  return amount === "" ? fallback : inrFormatter.format(amount);
};
const viewWeight = (value, fallback = "--") => {
  const weight = exportWeight(value);
  return weight === "" ? fallback : weight.toFixed(3) + " ct";
};
const viewPieces = (value, fallback = "--") => {
  const pieces = exportPieces(value);
  return pieces === "" ? fallback : String(pieces);
};
const sumStored = (items, key) => {
  if (!items?.length) return undefined;
  const pieces = /pieces/i.test(key);
  const weight = /weight/i.test(key);
  let total = 0n;
  try {
    for (const item of items) {
      if (pieces) total += BigInt(wholePieces(item[key]));
      else if (weight) total += weightMillis(item[key]);
      else total += moneyCents(item[key]);
    }
    if (pieces && total > BigInt(Number.MAX_SAFE_INTEGER)) return undefined;
    return pieces
      ? Number(total)
      : weight
        ? fromMillis(total)
        : fromCents(total);
  } catch {
    return undefined;
  }
};
const sumStoredBy = (items, read) => {
  if (!items?.length) return undefined;
  try {
    return fromCents(
      items.reduce((sum, item) => sum + moneyCents(read(item)), 0n),
    );
  } catch {
    return undefined;
  }
};
const stageOneGross = (item) =>
  item.pricingVersion === WEIGHT_RATE_PRICING ? item.grossAmount : item.amount;
const hasWeightedPricing = (items) =>
  items.some((item) => item.pricingVersion === WEIGHT_RATE_PRICING);
const stageOneNet = (item) => {
  if (item.pricingVersion === WEIGHT_RATE_PRICING) return item.netAmount;
  try {
    return item.stage1NetAmount ?? stageOneFinancials(item).netAmount;
  } catch {
    return item.netAmount;
  }
};
const viewPercent = (value) =>
  hasStoredNumber(value) ? `${Number(value)}%` : "--";
const soldKeptText = (item) =>
  hasStoredNumber(item.soldPieces) || hasStoredNumber(item.soldWeight)
    ? `${viewPieces(item.soldPieces)} pcs / ${viewWeight(item.soldWeight)}`
    : "--";

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
    width: normalizeSize(item.width),
    weight: Number(item.weight || 0),
    pieces: pieceValue(item.pieces),
    amount: Number(item.amount || 0),
    ...(item.pricingVersion === WEIGHT_RATE_PRICING
      ? { grossAmount: Number(item.grossAmount || 0) }
      : {}),
    discount: Number(item.discount || 0),
    discountAmount: Number(item.discountAmount || 0),
    netAmount: Number(item.netAmount ?? item.amount ?? 0),
  })),
});
const readServerClock = async () => {
  const response = await fetch(window.location.origin, {
    method: "HEAD",
    cache: "no-store",
  });
  const time = Date.parse(response.headers.get("date") || "");
  if (!response.ok || !Number.isFinite(time))
    throw new Error("Server time is unavailable.");
  return time;
};
const anchoredNow = (anchor) =>
  anchor ? anchor.time + performance.now() - anchor.tick : Date.now();
const formatEditCountdown = (milliseconds) => {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return (
    Math.floor(seconds / 60) +
    "m " +
    String(seconds % 60).padStart(2, "0") +
    "s"
  );
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
  width: "",
  priceSource: "master-auto",
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
export const StageTwoModal = ({ record, onClose, onConfirm }) => {
  usePageFreeze();
  const [rows, setRows] = useState(() =>
    record.items.map((item) => ({
      id: item.id || item.sku,
      returnPieces: "",
      returnWeight: "",
    })),
  );
  const rowsRef = useRef(rows);
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const issuedPieces = (item) => pieceValue(item.pieces);
  const issuedWeight = (item) => normalizeWeight(item.weight || 0);
  const update = (id, key, value) => {
    if (key === "returnPieces" && !/^\d*$/.test(value)) return;
    if (key === "returnWeight" && !/^\d*(?:\.\d*)?$/.test(value)) return;
    const item = record.items.find((entry) => (entry.id || entry.sku) === id);
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
    rowsRef.current = updateReturnRows(rowsRef.current, id, key, value);
    setRows((current) => updateReturnRows(current, id, key, value));
    setErrors((current) => ({
      ...current,
      [id + key]: message,
      [id + (key === "returnPieces" ? "returnWeight" : "returnPieces")]: "",
    }));
  };
  const validate = (candidate = rowsRef.current) => {
    const next = {};
    record.items.forEach((item, index) => {
      const row = candidate[index],
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
      if (!next[row.id + "returnPieces"] && !next[row.id + "returnWeight"]) {
        try {
          movementFor(item, rp, rw);
        } catch (error) {
          next[row.id + "returnWeight"] = error.message;
        }
      }
    });
    setErrors(next);
    return !Object.keys(next).length;
  };
  const submit = async () => {
    const candidate = rowsRef.current;
    if (!validate(candidate)) return;
    setSaving(true);
    try {
      await onConfirm(candidate, notes);
    } catch (error) {
      setErrors({
        form:
          error.message || "Could not process this return. Please try again.",
      });
      setSaving(false);
    }
  };
  let totals = null;
  try {
    totals = stageTwoTotals(record.items, rows);
  } catch {
    /* Incomplete return inputs cannot form finalized movement totals. */
  }
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
              <span>
                {hasWeightedPricing(record.items) ? "PRICE / CARAT" : "PRICE"}
              </span>{" "}
              <span>DISCOUNT</span>{" "}
            </div>{" "}
            {record.items.map((item, index) => {
              const row = rows[index],
                pieces = issuedPieces(item),
                weight = issuedWeight(item);
              let movement = null;
              try {
                movement = movementFor(
                  item,
                  row.returnPieces,
                  row.returnWeight,
                );
              } catch {
                /* A draft row is not a sold movement. */
              }
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
                  <span>{movement ? movement.soldPieces : "--"}</span>{" "}
                  <span className="divider">
                    {movement ? weightText(movement.soldWeight) : "--"}
                  </span>{" "}
                  <span>{viewCurrency(item.amount)}</span>{" "}
                  <span>{viewPercent(item.discount)}</span>{" "}
                </div>
              );
            })}{" "}
            <div className="stage-two-totals">
              {" "}
              <span /> <span className="divider" />{" "}
              <strong>
                {" "}
                <small>Total Issued Pieces</small>{" "}
                {totals ? totals.issuedPieces : "--"}{" "}
              </strong>{" "}
              <strong className="divider">
                {" "}
                <small>Total Issued Weight</small>{" "}
                {totals ? weightText(totals.issuedWeight) : "--"}{" "}
              </strong>{" "}
              <strong>
                {" "}
                <small>Total Return Pieces</small>{" "}
                {totals ? totals.returnPieces : "--"}{" "}
              </strong>{" "}
              <strong className="divider">
                {" "}
                <small>Total Return Weight</small>{" "}
                {totals ? weightText(totals.returnWeight) : "--"}{" "}
              </strong>{" "}
              <strong>
                {" "}
                <small>Total Sold Pieces</small>{" "}
                {totals ? totals.soldPieces : "--"}{" "}
              </strong>{" "}
              <strong className="divider">
                {" "}
                <small>Total Sold Weight</small>{" "}
                {totals ? weightText(totals.soldWeight) : "--"}{" "}
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
export const FinalInvoiceModal = ({
  record,
  onClose,
  onConfirm,
  canEnterPartial = false,
}) => {
  usePageFreeze();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [partialAmounts, setPartialAmounts] = useState([]);
  let rows;
  try {
    rows = invoiceReviewRows(record.stage2Return?.items);
  } catch (reason) {
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
          <p className="stage-two-error">{reason.message}</p>
          <footer>
            <button type="button" onClick={onClose}>
              Close
            </button>
          </footer>
        </section>
      </div>
    );
  }
  const hasPartial = rows.some((row) => row.billingMode === "partial-return");
  let invoice = null;
  try {
    invoice = invoiceFromStageTwo(record.stage2Return.items, partialAmounts);
  } catch {
    /* The review remains open until every partial amount is valid. */
  }
  const submit = async () => {
    setError("");
    try {
      if (hasPartial && !canEnterPartial)
        throw new Error(
          "Only Admin can enter a partial-return Final Billed Amount.",
        );
      invoiceFromStageTwo(record.stage2Return.items, partialAmounts);
      setSaving(true);
      await onConfirm(partialAmounts);
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
        className="stage-two-modal final-invoice-modal"
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
              <span>PRICE / CARAT</span>
              <span>STAGE 1 NET AMOUNT</span>
              <span>STAGE 1 DISCOUNT</span>
              <span>STAGE 1 NET AFTER DISCOUNT</span>
              <span>FINAL BILLED AMOUNT</span>
            </div>
            {rows.map((item, index) => (
              <div
                className="stage-two-row"
                key={
                  item.sourceInventoryId ||
                  item.inventoryId ||
                  item.sku ||
                  index
                }
              >
                <b>
                  {item.sku}
                  <small>
                    {item.type || "--"} · {item.shape || "--"} ·{" "}
                    {normalizeSize(item.size) || "--"}
                  </small>
                </b>
                <span>
                  {item.issuedPieces} pcs / {weightText(item.issuedWeight)} ct
                </span>
                <span>
                  {item.returnPieces} pcs / {weightText(item.returnWeight)} ct
                </span>
                <span>
                  {item.soldPieces} pcs / {weightText(item.soldWeight)} ct
                </span>
                <span>₹{moneyText(item.amount)}</span>
                <span>₹{moneyText(item.stage1GrossAmount)}</span>
                <span>
                  {item.stage1DiscountPercent}% (₹
                  {moneyText(item.stage1DiscountAmount)})
                </span>
                <span>₹{moneyText(item.stage1NetAmount)}</span>
                {item.billingMode === "partial-return" ? (
                  canEnterPartial ? (
                    <label>
                      <input
                        type="number"
                        min="0"
                        max={item.stage1NetAmount}
                        step="0.01"
                        aria-label={item.sku + " Final Billed Amount"}
                        value={partialAmounts[index] ?? ""}
                        onChange={(event) => {
                          const value = event.target.value;
                          setPartialAmounts((current) => {
                            const next = [...current];
                            next[index] = value;
                            return next;
                          });
                          setError("");
                        }}
                      />
                      <small>
                        Admin amount, up to ₹{moneyText(item.stage1NetAmount)}
                      </small>
                    </label>
                  ) : (
                    <span>Admin entry required</span>
                  )
                ) : (
                  <span>
                    ₹
                    {item.billingMode === "full-return"
                      ? "0.00"
                      : moneyText(item.stage1NetAmount)}{" "}
                    (locked)
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
        <div className="stage-two-totals">
          <strong>
            <small>Stage 1 Net Amount</small>₹
            {moneyText(invoice?.grossAmount ?? record.amount)}
          </strong>
          <strong>
            <small>Stage 1 Net Amount After Discount</small>₹
            {moneyText(invoice?.stage1NetAmount ?? record.netAmount)}
          </strong>
          <strong>
            <small>Final Invoice Amount</small>
            {invoice
              ? "₹" + invoice.finalInvoiceAmount.toFixed(2)
              : "Pending valid partial amount"}
          </strong>
        </div>
        {hasPartial && !canEnterPartial && (
          <p className="stage-two-error">
            Only Admin can enter partial-return Final Billed Amounts.
          </p>
        )}
        {error && <p className="stage-two-error">{error}</p>}
        <footer>
          <button
            type="button"
            className="primary"
            disabled={saving || (hasPartial && !canEnterPartial)}
            onClick={submit}
          >
            {saving
              ? "Confirming..."
              : "Confirm Final Invoice / Move to Stage 3"}
          </button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </footer>
      </section>
    </div>
  );
};
export const FinalSettlementModal = ({ record, onClose, onConfirm }) => {
  usePageFreeze();
  const [paid, setPaid] = useState(""),
    [discount, setDiscount] = useState(""),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false);
  const finalInvoiceAmount = money(record.finalInvoice?.finalInvoiceAmount);
  let calculation = null;
  let inputError = "";
  try {
    calculation = settlementFor(
      finalInvoiceAmount,
      paid === "" ? "0" : paid,
      discount,
    );
  } catch (reason) {
    inputError = reason.message;
  }
  const remaining = calculation?.remaining ?? finalInvoiceAmount;
  const canComplete = Boolean(
    paid !== "" && calculation && calculation.remaining === 0,
  );
  const submit = async () => {
    if (!canComplete)
      return setError(
        inputError ||
          "Amount Paid plus Discount Amount must equal the Final Invoice Amount exactly.",
      );
    setSaving(true);
    try {
      await onConfirm(paid, discount);
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
        className="stage-two-modal settlement-modal"
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
        <div className="stage-two-info settlement-invoice-row">
          <span>Final Invoice Amount</span>
          <strong>₹{finalInvoiceAmount.toFixed(2)}</strong>
        </div>
        <div className="settlement-input-grid">
          <label className="stage-two-notes">
            Amount Paid by Customer
            <input
              type="number"
              min="0"
              step="0.01"
              value={paid}
              onChange={(event) => {
                setPaid(event.target.value);
                setError("");
              }}
            />
          </label>
          <label className="stage-two-notes">
            Discount Amount (₹)
            <input
              type="number"
              min="0"
              step="0.01"
              value={discount}
              onChange={(event) => {
                setDiscount(event.target.value);
                setError("");
              }}
            />
          </label>
        </div>
        <div className="stage-two-totals settlement-summary-grid">
          <strong>
            <small>Final Invoice</small>₹{finalInvoiceAmount.toFixed(2)}
          </strong>
          <strong>
            <small>Amount Paid</small>₹
            {calculation ? calculation.amountPaid.toFixed(2) : "0.00"}
          </strong>
          <strong>
            <small>Discount Amount</small>₹
            {calculation
              ? calculation.settlementDiscountAmount.toFixed(2)
              : "0.00"}
          </strong>
          <strong>
            <small>Remaining</small>₹{remaining.toFixed(2)}
          </strong>
        </div>
        {(error || inputError) && (
          <p className="stage-two-error">{error || inputError}</p>
        )}
        <footer>
          <button
            type="button"
            className="primary"
            disabled={saving || !canComplete}
            onClick={submit}
          >
            {saving ? "Completing..." : "Record Payment / Complete"}
          </button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </footer>
      </section>
    </div>
  );
};
const LegacyInvoiceUnavailableModal = ({ record, onClose }) => {
  usePageFreeze();
  return (
    <div
      className="stage-two-overlay legacy-invoice-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Final Invoice Unavailable"
      onMouseDown={onClose}
    >
      <section
        className="stage-two-modal legacy-invoice-modal"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <h3>Final Invoice Unavailable</h3>
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
        <div className="legacy-invoice-body">
          <p>
            This historical Challan does not have a saved Final Invoice record.
          </p>
          <p>
            Settlement cannot be completed until valid Final Invoice data is
            available.
          </p>
          <dl>
            <div>
              <dt>Challan</dt>
              <dd>{record.number || "Not recorded"}</dd>
            </div>
            <div>
              <dt>Party</dt>
              <dd>{record.party || "Not recorded"}</dd>
            </div>
          </dl>
        </div>
        <footer>
          <button type="button" className="primary" onClick={onClose}>
            Close
          </button>
        </footer>
      </section>
    </div>
  );
};
export const ChallanDeleteModal = ({ record, onClose, onConfirm }) => {
  usePageFreeze();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);
  useEffect(() => {
    const keys = (event) => {
      if (event.key === "Escape" && !submitting.current) onClose();
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  }, [onClose]);
  let restoration;
  try {
    restoration = challanStockRestoration(record);
  } catch (reason) {
    restoration = { error: reason.message };
  }
  const confirm = async () => {
    if (submitting.current || restoration.error) return;
    submitting.current = true;
    setSaving(true);
    setError("");
    try {
      await onConfirm(record.id);
    } catch (reason) {
      setError(reason.message || "Could not delete this Challan.");
      setSaving(false);
      submitting.current = false;
    }
  };
  return (
    <div
      className="challan-delete-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Delete challan confirmation"
      onMouseDown={saving ? undefined : onClose}
    >
      <div
        className="challan-delete-dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h3>Delete Challan?</h3>
        <p>
          {record.number} for {record.party} · Stage {record.stage} will be
          permanently removed.
        </p>
        <p>
          {Number(record.stage) === 1
            ? "Deleting this Challan will restore the full issued stock to Inventory."
            : "Deleting this Challan will restore only Sold / Kept stock. Returned stock has already been restored."}
        </p>
        {restoration.error ? (
          <p className="stage-two-error">{restoration.error}</p>
        ) : (
          <>
            <p>
              <strong>
                Stock to restore: {restoration.totalPieces} pcs /{" "}
                {weightText(restoration.totalWeight)} ct
              </strong>
            </p>
            {restoration.items.map((item, index) => (
              <p key={item.inventoryId + "-" + index}>
                {item.sku || item.inventoryId}: {item.pieces} pcs /{" "}
                {weightText(item.weight)} ct
              </p>
            ))}
          </>
        )}
        {error && <p className="stage-two-error">{error}</p>}
        <small>Press Esc to cancel.</small>
        <footer>
          <button
            type="button"
            className="challan-delete-confirm"
            disabled={saving || Boolean(restoration.error)}
            onClick={confirm}
          >
            {saving ? "Deleting..." : "Delete Challan"}
          </button>
          <button type="button" disabled={saving} onClick={onClose}>
            Cancel
          </button>
        </footer>
      </div>
    </div>
  );
};
export const StageOneView = ({ items }) => (
  <article className="challan-view-card challan-view-items challan-view-stage-one">
    <h2>Goods Out Details</h2>
    <ViewTable>
      <thead>
        <tr>
          <th>SKU / Item</th>
          <th>Shape</th>
          <th>Size</th>
          <th>Width</th>
          <th>Pieces</th>
          <th>Weight</th>
          <th>{hasWeightedPricing(items) ? "Price / Carat" : "Price"}</th>
          <th>Discount %</th>
          <th>
            {hasWeightedPricing(items) ? "Net Amount" : "Original Amount"}
          </th>
          <th>Net Amount After Discount</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item, index) => (
          <tr key={item.id || item.sku || index}>
            <td>{item.sku || "--"}</td>
            <td>{item.shape || "--"}</td>
            <td>{normalizeSize(item.size) || "--"}</td>
            <td>{normalizeSize(item.width) || "--"}</td>
            <td>{viewPieces(item.pieces)}</td>
            <td>{viewWeight(item.weight)}</td>
            <td>{viewCurrency(item.amount)}</td>
            <td>{viewPercent(item.discount)}</td>
            <td>{viewCurrency(stageOneGross(item))}</td>
            <td>{viewCurrency(stageOneNet(item))}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan="4">
            <strong>Total Items: {items.length}</strong>
          </td>
          <td>
            <strong>{viewPieces(sumStored(items, "pieces"))}</strong>
          </td>
          <td>
            <strong>{viewWeight(sumStored(items, "weight"))}</strong>
          </td>
          <td />
          <td />
          <td>
            <strong>{viewCurrency(sumStoredBy(items, stageOneGross))}</strong>
          </td>
          <td>
            <strong>{viewCurrency(sumStoredBy(items, stageOneNet))}</strong>
          </td>
        </tr>
      </tfoot>
    </ViewTable>
  </article>
);
export const StageTwoView = ({ items }) => (
  <article className="challan-view-card challan-view-items challan-view-stage-two">
    <h2>Return / Sale Details</h2>
    {items.length ? (
      <ViewTable>
        <thead>
          <tr>
            <th>SKU / Item</th>
            <th>Shape</th>
            <th>Size</th>
            <th>Width</th>
            <th>Issued Pieces</th>
            <th>Issued Weight</th>
            <th>Return Pieces</th>
            <th>Return Weight</th>
            <th>Sold / Kept Pieces</th>
            <th>Sold / Kept Weight</th>
            <th>{hasWeightedPricing(items) ? "Price / Carat" : "Price"}</th>
            <th>Discount %</th>
            <th>
              {hasWeightedPricing(items) ? "Net Amount" : "Original Amount"}
            </th>
            <th>Net Amount After Discount</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => (
            <tr key={item.id || item.sku || index}>
              <td>{item.sku || "--"}</td>
              <td>{item.shape || "--"}</td>
              <td>{normalizeSize(item.size) || "--"}</td>
              <td>{normalizeSize(item.width) || "--"}</td>
              <td>{viewPieces(item.issuedPieces)}</td>
              <td>{viewWeight(item.issuedWeight)}</td>
              <td>{viewPieces(item.returnPieces)}</td>
              <td>{viewWeight(item.returnWeight)}</td>
              <td>{viewPieces(item.soldPieces)}</td>
              <td>{viewWeight(item.soldWeight)}</td>
              <td>{viewCurrency(item.amount)}</td>
              <td>{viewPercent(item.discount)}</td>
              <td>{viewCurrency(stageOneGross(item))}</td>
              <td>{viewCurrency(stageOneNet(item))}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan="4">
              <strong>Total Items: {items.length}</strong>
            </td>
            <td>
              <strong>{viewPieces(sumStored(items, "issuedPieces"))}</strong>
            </td>
            <td>
              <strong>{viewWeight(sumStored(items, "issuedWeight"))}</strong>
            </td>
            <td>
              <strong>{viewPieces(sumStored(items, "returnPieces"))}</strong>
            </td>
            <td>
              <strong>{viewWeight(sumStored(items, "returnWeight"))}</strong>
            </td>
            <td>
              <strong>{viewPieces(sumStored(items, "soldPieces"))}</strong>
            </td>
            <td>
              <strong>{viewWeight(sumStored(items, "soldWeight"))}</strong>
            </td>
            <td />
            <td />
            <td>
              <strong>{viewCurrency(sumStoredBy(items, stageOneGross))}</strong>
            </td>
            <td>
              <strong>{viewCurrency(sumStoredBy(items, stageOneNet))}</strong>
            </td>
          </tr>
        </tfoot>
      </ViewTable>
    ) : (
      <p className="challan-view-unavailable">
        Return / Sale details are unavailable for this historical Challan.
      </p>
    )}
  </article>
);
export const StageThreeView = ({ invoice }) => {
  const items = Array.isArray(invoice?.items) ? invoice.items : [];
  return (
    <article className="challan-view-card challan-view-items challan-view-stage-three">
      <h2>Final Invoice</h2>
      {items.length ? (
        <ViewTable>
          <thead>
            <tr>
              <th>SKU / Item</th>
              <th>Shape</th>
              <th>Size</th>
              <th>Width</th>
              <th>Sold / Kept</th>
              <th>
                {hasWeightedPricing(items) ? "Price / Carat" : "Original Price"}
              </th>
              <th>
                {hasWeightedPricing(items)
                  ? "Stage 1 Net Amount"
                  : "Original Stage 1 Amount"}
              </th>
              <th>Stage 1 Net Amount After Discount</th>
              <th>Stage 1 Discount</th>
              <th>Discount Amount</th>
              <th>Final Billed Amount</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              <tr key={item.id || item.sku || index}>
                <td>{item.sku || "--"}</td>
                <td>{item.shape || "--"}</td>
                <td>{normalizeSize(item.size) || "--"}</td>
                <td>{normalizeSize(item.width) || "--"}</td>
                <td>{soldKeptText(item)}</td>
                <td>{viewCurrency(item.amount)}</td>
                <td>{viewCurrency(stageOneGross(item))}</td>
                <td>{viewCurrency(stageOneNet(item))}</td>
                <td>{viewPercent(item.stage1DiscountPercent)}</td>
                <td>{viewCurrency(item.stage1DiscountAmount)}</td>
                <td>{viewCurrency(item.finalAmount)}</td>
              </tr>
            ))}
          </tbody>
        </ViewTable>
      ) : (
        <p className="challan-view-unavailable">
          Final Invoice data is unavailable for this historical Challan.
        </p>
      )}
      <InvoiceSummary invoice={invoice} />
      <p className="challan-view-timestamp">
        Final Invoice confirmed:{" "}
        {invoice?.confirmedAtMs
          ? `${formatStageDate(invoice.confirmedAtMs)}, ${formatStageTime(invoice.confirmedAtMs)}`
          : "--"}
      </p>
    </article>
  );
};
export const StageFourView = ({ items, invoice, settlement }) => (
  <article className="challan-view-card challan-view-items challan-view-stage-four">
    <h2>Complete Challan History</h2>
    {items.length ? (
      <ViewTable>
        <thead>
          <tr>
            <th>SKU / Item</th>
            <th>Shape</th>
            <th>Size</th>
            <th>Width</th>
            <th>Issued Pieces</th>
            <th>Issued Weight</th>
            <th>Return Pieces</th>
            <th>Return Weight</th>
            <th>Sold / Kept Pieces</th>
            <th>Sold / Kept Weight</th>
            <th>
              {hasWeightedPricing(items) ? "Price / Carat" : "Original Price"}
            </th>
            <th>
              {hasWeightedPricing(items)
                ? "Stage 1 Net Amount"
                : "Original Stage 1 Amount"}
            </th>
            <th>Stage 1 Net Amount After Discount</th>
            <th>Stage 1 Discount</th>
            <th>Discount Amount</th>
            <th>Final Billed Amount</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => (
            <tr key={item.id || item.sku || index}>
              <td>{item.sku || "--"}</td>
              <td>{item.shape || "--"}</td>
              <td>{normalizeSize(item.size) || "--"}</td>
              <td>{normalizeSize(item.width) || "--"}</td>
              <td>{viewPieces(item.issuedPieces)}</td>
              <td>{viewWeight(item.issuedWeight)}</td>
              <td>{viewPieces(item.returnPieces)}</td>
              <td>{viewWeight(item.returnWeight)}</td>
              <td>{viewPieces(item.soldPieces)}</td>
              <td>{viewWeight(item.soldWeight)}</td>
              <td>{viewCurrency(item.amount)}</td>
              <td>{viewCurrency(stageOneGross(item))}</td>
              <td>{viewCurrency(stageOneNet(item))}</td>
              <td>
                {viewPercent(item.stage1DiscountPercent ?? item.discount)}
              </td>
              <td>{viewCurrency(item.stage1DiscountAmount)}</td>
              <td>{viewCurrency(item.finalAmount)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan="4">
              <strong>Total Items: {items.length}</strong>
            </td>
            <td>
              <strong>{viewPieces(sumStored(items, "issuedPieces"))}</strong>
            </td>
            <td>
              <strong>{viewWeight(sumStored(items, "issuedWeight"))}</strong>
            </td>
            <td>
              <strong>{viewPieces(sumStored(items, "returnPieces"))}</strong>
            </td>
            <td>
              <strong>{viewWeight(sumStored(items, "returnWeight"))}</strong>
            </td>
            <td>
              <strong>{viewPieces(sumStored(items, "soldPieces"))}</strong>
            </td>
            <td>
              <strong>{viewWeight(sumStored(items, "soldWeight"))}</strong>
            </td>
            <td />
            <td>
              <strong>{viewCurrency(sumStoredBy(items, stageOneGross))}</strong>
            </td>
            <td>
              <strong>{viewCurrency(sumStoredBy(items, stageOneNet))}</strong>
            </td>
            <td />
            <td>
              <strong>
                {viewCurrency(sumStored(items, "stage1DiscountAmount"))}
              </strong>
            </td>
          </tr>
        </tfoot>
      </ViewTable>
    ) : (
      <p className="challan-view-unavailable">
        Complete item history is unavailable for this historical Challan.
      </p>
    )}
    <CompletedFinancialSummary invoice={invoice} settlement={settlement} />
    <p className="challan-view-timestamp">
      Final Invoice confirmed:{" "}
      {invoice?.confirmedAtMs
        ? `${formatStageDate(invoice.confirmedAtMs)}, ${formatStageTime(invoice.confirmedAtMs)}`
        : "--"}
    </p>
    <p className="challan-view-timestamp">
      Completed:{" "}
      {settlement?.completedAtMs
        ? `${formatStageDate(settlement.completedAtMs)}, ${formatStageTime(settlement.completedAtMs)}`
        : "--"}
    </p>
  </article>
);
const ViewTable = ({ children }) => (
  <div className="challan-view-table-wrap">
    <table>{children}</table>
  </div>
);
const InvoiceSummary = ({ invoice }) => (
  <div
    className="challan-financial-summary"
    aria-label="Final Invoice financial summary"
  >
    <div className="challan-financial-cell">
      <span className="challan-financial-label">
        {invoice?.calculationVersion === "manual-partial-v1"
          ? hasWeightedPricing(invoice?.items || [])
            ? "Stage 1 Net Amount"
            : "Original Stage 1 Amount"
          : "Gross Amount"}
      </span>
      <strong className="challan-financial-value">
        {viewCurrency(invoice?.grossAmount, "Unavailable")}
      </strong>
    </div>
    <div className="challan-financial-cell">
      <span className="challan-financial-label">
        {invoice?.calculationVersion === "manual-partial-v1"
          ? "Original Stage 1 Discount"
          : "Stage 1 Discount"}
      </span>
      <strong className="challan-financial-value">
        {hasStoredNumber(invoice?.stage1DiscountAmount)
          ? `− ${viewCurrency(invoice.stage1DiscountAmount)}`
          : "Unavailable"}
      </strong>
    </div>
    <div className="challan-financial-cell final">
      <span className="challan-financial-label">Final Invoice</span>
      <strong className="challan-financial-value">
        {viewCurrency(invoice?.finalInvoiceAmount, "Unavailable")}
      </strong>
    </div>
  </div>
);
const CompletedFinancialSummary = ({ invoice, settlement }) => (
  <div
    className="challan-completed-financials"
    aria-label="Completed Challan financial summary"
  >
    <div className="challan-financial-cell">
      <span className="challan-financial-label">
        {invoice?.calculationVersion === "manual-partial-v1"
          ? hasWeightedPricing(invoice?.items || [])
            ? "Stage 1 Net Amount"
            : "Original Stage 1 Amount"
          : "Gross Amount"}
      </span>
      <strong className="challan-financial-value">
        {viewCurrency(invoice?.grossAmount, "Unavailable")}
      </strong>
    </div>
    <div className="challan-financial-cell">
      <span className="challan-financial-label">
        {invoice?.calculationVersion === "manual-partial-v1"
          ? "Original Stage 1 Discount"
          : "Stage 1 Discount"}
      </span>
      <strong className="challan-financial-value">
        {hasStoredNumber(invoice?.stage1DiscountAmount)
          ? `− ${viewCurrency(invoice.stage1DiscountAmount)}`
          : "Unavailable"}
      </strong>
    </div>
    <div className="challan-financial-cell final">
      <span className="challan-financial-label">Final Invoice</span>
      <strong className="challan-financial-value">
        {viewCurrency(invoice?.finalInvoiceAmount, "Unavailable")}
      </strong>
    </div>
    <div className="challan-financial-cell">
      <span className="challan-financial-label">Amount Paid</span>
      <strong className="challan-financial-value">
        {viewCurrency(settlement?.amountPaid)}
      </strong>
    </div>
    <div className="challan-financial-cell">
      <span className="challan-financial-label">Settlement Discount</span>
      <strong className="challan-financial-value">
        {viewCurrency(settlement?.settlementDiscountAmount)}
      </strong>
    </div>
    <div className="challan-financial-cell">
      <span className="challan-financial-label">Actual Received</span>
      <strong className="challan-financial-value">
        {viewCurrency(settlement?.actualReceivedAmount)}
      </strong>
    </div>
  </div>
);
const ChallanImageSection = ({
  stage,
  images,
  canUpload,
  uploading,
  onUpload,
}) => {
  const fileInput = useRef(null);
  const [preview, setPreview] = useState(null);
  const [uploadStatus, setUploadStatus] = useState("");
  const title = `Stage ${stage} Images`;
  useEffect(() => {
    if (!preview) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setPreview(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [preview]);
  return (
    <>
      <article className="challan-view-card challan-image-section">
        <div className="challan-image-section-heading">
          <div>
            <h2>{title}</h2>
            <p>JPG, PNG or WEBP, up to 10 MB each.</p>
          </div>
          <small>{images.length} uploaded</small>
        </div>
        <div className="challan-image-gallery">
          {!images.length && (
            <p className="challan-image-empty">
              No images uploaded for this stage.
            </p>
          )}
          {images.map((image) => (
            <button
              className="challan-image-thumbnail"
              key={image.publicId || image.secureUrl}
              type="button"
              onClick={() => setPreview(image)}
              aria-label={`Preview ${image.originalFilename || "challan image"}`}
            >
              <img
                src={image.secureUrl}
                alt={image.originalFilename || "Challan image"}
              />
            </button>
          ))}
          {canUpload && (
            <button
              className="challan-image-upload"
              type="button"
              disabled={uploading}
              onClick={() => fileInput.current?.click()}
            >
              <b>{uploading ? "Uploading images..." : "Upload Images"}</b>
              <span>Select multiple JPG, PNG or WEBP images</span>
            </button>
          )}
        </div>
        <input
          ref={fileInput}
          className="challan-image-input"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          disabled={uploading || !canUpload}
          onChange={async (event) => {
            const files = Array.from(event.target.files || []);
            event.target.value = "";
            if (!files.length) return;
            setUploadStatus(
              "Uploading " +
                files.length +
                " image" +
                (files.length === 1 ? "" : "s") +
                "...",
            );
            try {
              const result = await onUpload(files, stage);
              setUploadStatus(
                [
                  result.uploaded
                    ? result.uploaded +
                      " image" +
                      (result.uploaded === 1 ? "" : "s") +
                      " uploaded."
                    : "",
                  ...result.failed,
                ]
                  .filter(Boolean)
                  .join(" "),
              );
            } catch {
              setUploadStatus(
                "Images could not be uploaded. Please try again.",
              );
            }
          }}
        />
        {uploadStatus && (
          <p className="challan-image-status" role="status">
            {uploadStatus}
          </p>
        )}
      </article>
      {preview && (
        <div
          className="challan-image-preview"
          role="dialog"
          aria-modal="true"
          aria-label="Challan image preview"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPreview(null);
          }}
        >
          <div className="challan-image-preview-card">
            <button
              type="button"
              className="challan-image-preview-close"
              onClick={() => setPreview(null)}
              aria-label="Close image preview"
            >
              ×
            </button>
            <img
              src={preview.secureUrl}
              alt={preview.originalFilename || "Challan image preview"}
            />
          </div>
        </div>
      )}
    </>
  );
};

export const ChallanImportReviewModal = ({
  review,
  preview,
  result,
  saving,
  onImport,
  onClose,
}) => {
  const dialogRef = useRef(null);
  const [activeTab, setActiveTab] = useState(
    preview.validCount > 0 ? "VALID" : "INVALID",
  );
  usePageFreeze(true);
  useEffect(() => {
    const previousFocus = document.activeElement;
    const dialog = dialogRef.current;
    dialog?.focus();
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!saving) onClose();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = [
        ...dialog.querySelectorAll(
          'button:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((element) => element.getClientRects().length);
      if (!focusable.length) return;
      const first = focusable[0],
        last = focusable.at(-1);
      if (document.activeElement === dialog) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus?.();
    };
  }, [onClose, saving]);

  const visibleGroups = preview.groups.filter(
    (group) => group.status === activeTab,
  );

  return (
    <div className="challan-bulk-overlay">
      <div
        ref={dialogRef}
        className="challan-bulk-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Import Challans"
        tabIndex={-1}
      >
        <header className="challan-bulk-header">
          <div className="challan-bulk-heading">
            <h2>Import Challans</h2>
            <p>{review.filename}</p>
          </div>
          <button
            type="button"
            className="challan-bulk-close"
            disabled={saving}
            onClick={onClose}
            aria-label="Close Import Challans"
          >
            ×
          </button>
        </header>
        <div className="challan-bulk-summary" aria-label="Import summary">
          <div className="challan-bulk-summary-card">
            <strong>{preview.groups.length}</strong>
            <span>Total Challans</span>
          </div>
          <div className="challan-bulk-summary-card is-valid">
            <strong>{preview.validCount}</strong>
            <span>Valid</span>
          </div>
          <div className="challan-bulk-summary-card is-invalid">
            <strong>{preview.invalidCount}</strong>
            <span>Invalid</span>
          </div>
        </div>
        <div
          className="challan-bulk-tabs"
          role="tablist"
          aria-label="Challan status"
        >
          {["VALID", "INVALID"].map((status) => (
            <button
              key={status}
              type="button"
              role="tab"
              id={"challan-bulk-tab-" + status.toLowerCase()}
              aria-controls="challan-bulk-panel"
              aria-selected={activeTab === status}
              className={
                "challan-bulk-tab is-" +
                status.toLowerCase() +
                (activeTab === status ? " is-active" : "")
              }
              onClick={() => setActiveTab(status)}
            >
              {status === "VALID" ? "Valid Challans" : "Invalid Challans"}
              <span>
                {status === "VALID" ? preview.validCount : preview.invalidCount}
              </span>
            </button>
          ))}
        </div>
        <div
          className="challan-bulk-scroll"
          id="challan-bulk-panel"
          role="tabpanel"
          aria-labelledby={"challan-bulk-tab-" + activeTab.toLowerCase()}
          key={activeTab}
        >
          {visibleGroups.length === 0 ? (
            <p className="challan-bulk-empty">
              No {activeTab.toLowerCase()} Challans.
            </p>
          ) : (
            <div className="challan-bulk-list">
              {visibleGroups.map((group, index) => (
                <details
                  key={group.ref || index}
                  className={"challan-bulk-group is-" + activeTab.toLowerCase()}
                >
                  <summary>
                    <span className="challan-bulk-summary-field challan-bulk-ref">
                      <small>Challan Ref</small>
                      <strong>{group.ref || "Missing Challan Ref"}</strong>
                    </span>
                    <span className="challan-bulk-summary-field">
                      <small>Party</small>
                      <b>{group.party || "Missing"}</b>
                    </span>
                    <span className="challan-bulk-summary-field">
                      <small>Date</small>
                      <b>{group.date || "Missing"}</b>
                    </span>
                    <span className="challan-bulk-summary-field">
                      <small>Items</small>
                      <b>{group.items.length}</b>
                    </span>
                    <span className="challan-bulk-summary-field">
                      <small>Weight</small>
                      <b>
                        {group.totals
                          ? group.totals.weight.toFixed(3) + " ct"
                          : "--"}
                      </b>
                    </span>
                    <span className="challan-bulk-summary-field">
                      <small>Pieces</small>
                      <b>{group.totals?.pieces ?? "--"}</b>
                    </span>
                    <span className="challan-bulk-badge">{activeTab}</span>
                    <span className="challan-bulk-chevron" aria-hidden="true">
                      ⌄
                    </span>
                  </summary>
                  <div className="challan-bulk-group-body">
                    <div className="challan-bulk-items-heading">
                      <h3>Item details</h3>
                      <span>Inventory details resolved from SKU</span>
                    </div>
                    <table className="challan-bulk-items-table">
                      <thead>
                        <tr>
                          <th>SKU</th>
                          <th>Width</th>
                          <th>Shape</th>
                          <th>Size</th>
                          <th>Type</th>
                          <th>Weight / Carat</th>
                          <th>Pieces</th>
                          <th>Price</th>
                          <th>Discount %</th>
                          <th>Net Amount</th>
                          <th>Net Amount After Discount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.items.map((item, itemIndex) => {
                          const priced = pricingFor(
                            item.weight,
                            item.amount,
                            item.discount,
                          );
                          const fields = [
                            ["SKU", item.sku || "--"],
                            ["Width", item.width || "--"],
                            ["Shape", item.shape || "--"],
                            ["Size", item.size || "--"],
                            ["Type", item.type || "--"],
                            ["Weight / Carat", viewWeight(item.weight)],
                            ["Pieces", item.pieces === "" ? "0" : item.pieces],
                            ["Price", viewCurrency(item.amount)],
                            [
                              "Discount %",
                              item.discount === "" ? "0%" : item.discount + "%",
                            ],
                            ["Net Amount", viewCurrency(priced?.grossAmount)],
                            [
                              "Net Amount After Discount",
                              viewCurrency(priced?.netAmount),
                            ],
                          ];
                          return (
                            <tr key={item.importRowNumber || itemIndex}>
                              {fields.map(([label, value]) => (
                                <td key={label} data-label={label}>
                                  {value}
                                </td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {group.reasons.length > 0 && (
                      <div className="challan-bulk-reasons">
                        <strong>Validation issues</strong>
                        <ol>
                          {group.reasons.map((reason, reasonIndex) => (
                            <li key={reasonIndex}>
                              Row {reason.rowNumber}: {reason.message}
                            </li>
                          ))}
                        </ol>
                      </div>
                    )}
                  </div>
                </details>
              ))}
            </div>
          )}
          {result && (
            <div className="challan-bulk-result" role="status">
              <strong>
                {result.successes.length} Challans imported successfully.{" "}
                {result.failures.length + result.skipped} skipped or failed.
              </strong>
              {result.successes.map((entry) => (
                <p key={entry.ref}>
                  {entry.ref} → {entry.number}
                </p>
              ))}
              {result.failures.map((entry, index) => (
                <div key={index}>
                  <strong>{entry.ref} failed:</strong>
                  <ul>
                    {entry.reasons.map((reason, reasonIndex) => (
                      <li key={reasonIndex}>{reason}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
        <footer className="challan-bulk-actions">
          <button
            type="button"
            className="challan-bulk-secondary"
            disabled={saving}
            onClick={onClose}
          >
            {result ? "Close" : "Cancel"}
          </button>
          <button
            type="button"
            className="challan-bulk-primary"
            onClick={onImport}
            disabled={saving || Boolean(result) || preview.validCount === 0}
          >
            {saving
              ? "Importing Challans..."
              : "IMPORT " + preview.validCount + " VALID CHALLANS"}
          </button>
        </footer>
      </div>
    </div>
  );
};
export default function Challan() {
  const { user } = useAuth();
  const {
    prices,
    error: masterPriceError,
    loading: masterPricesLoading,
  } = useMasterPrices();
  const location = useLocation();
  const navigate = useNavigate();
  const hasStagePermission = (stage) =>
    user?.role === "superadmin" ||
    Boolean(user?.permissions?.includes(`challan-stage-${stage}`));
  const isAdmin = user?.role === "superadmin";
  const permittedStages = useMemo(
    () =>
      isAdmin
        ? [1, 2, 3, 4]
        : [1, 2, 3, 4].filter((stage) =>
            user?.permissions?.includes(`challan-stage-${stage}`),
          ),
    [isAdmin, user?.permissions],
  );
  const [records, setRecords] = useState([]);
  const [page, setPage] = useState("list"),
    [viewId, setViewId] = useState(null),
    [tab, setTab] = useState("all"),
    [search, setSearch] = useState("");
  const [dateFilter, setDateFilter] = useState(""),
    [partyFilter, setPartyFilter] = useState(""),
    [agingFilter, setAgingFilter] = useState("all"),
    [dashboardAge, setDashboardAge] = useState(""),
    [sortMode, setSortMode] = useState("newest");
  const [form, setForm] = useState({
    number: "",
    date: today(),
    party: "",
    amount: "",
    discount: "",
    notes: "",
    items: [blank()],
  });
  const {
    rows: inventory,
    error: inventoryError,
    loading: inventoryLoading,
  } = useInventoryDiscovery();
  const [focusSkuId, setFocusSkuId] = useState(null);
  const [formError, setFormError] = useState("");
  const [challanFieldErrors, setChallanFieldErrors] = useState({});
  const [editingId, setEditingId] = useState(null);
  const editOriginal = useRef(null);
  const importFileRef = useRef(null);
  const [importStatus, setImportStatus] = useState("");
  const [importFileError, setImportFileError] = useState("");
  const [bulkReview, setBulkReview] = useState(null);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkResult, setBulkResult] = useState(null);
  const bulkPreview = useMemo(
    () =>
      bulkReview
        ? parseChallanImport(bulkReview.matrix, inventory, prices)
        : null,
    [bulkReview, inventory, prices],
  );
  const importDraftIssues = useMemo(
    () => validateImportedStageOneRows(form.items, inventory),
    [form.items, inventory],
  );
  // Reconcile incoming Firestore snapshots with the open draft, retaining
  // manual/saved prices. Stable dependencies and unchanged-object returns make
  // this a bounded update, never a write-back or subscription loop.
  useEffect(() => {
    if (page !== "create") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- External live snapshots must merge into editable draft state without overwriting user overrides.
    setForm((state) => {
      let changed = false;
      const items = state.items.map((item) => {
        const selected =
          !editingId && inventory.find((row) => row.id === item.inventoryId);
        const sourceChanged =
          selected &&
          (item.type !== selected.type ||
            item.shape !== selected.shape ||
            normalizeSize(item.size) !== normalizeSize(selected.size));
        const next = refreshItemPrice(
          sourceChanged
            ? {
                ...item,
                type: selected.type,
                shape: selected.shape,
                size: normalizeSize(selected.size),
              }
            : item,
          prices,
        );
        if (next !== item) changed = true;
        return next;
      });
      return changed ? { ...state, items } : state;
    });
  }, [inventory, editingId, page, prices]);
  const [saving, setSaving] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const clockAnchor = useRef(null);
  const [partyOptions, setPartyOptions] = useState([]);
  const [deleteCandidate, setDeleteCandidate] = useState(null);
  const [stageTwoCandidate, setStageTwoCandidate] = useState(null);
  const [finalInvoiceCandidate, setFinalInvoiceCandidate] = useState(null);
  const [finalSettlementCandidate, setFinalSettlementCandidate] =
    useState(null);
  const [legacyInvoiceCandidate, setLegacyInvoiceCandidate] = useState(null);
  const [uploadingStage, setUploadingStage] = useState(null);
  const uploadInProgress = useRef(false);
  useEffect(() => {
    let active = true;
    clockAnchor.current = { time: Date.now(), tick: performance.now() };
    const sync = async () => {
      try {
        const time = await readServerClock();
        if (!active) return;
        clockAnchor.current = { time, tick: performance.now() };
        setClock(time);
      } catch {
        // Firestore rules still enforce the server deadline if the host omits Date.
      }
    };
    void sync();
    const timer = window.setInterval(
      () => setClock(anchoredNow(clockAnchor.current)),
      1000,
    );
    const refresh = window.setInterval(() => void sync(), 60000);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.clearInterval(refresh);
    };
  }, []);
  useEffect(() => {
    const action = location.state?.dashboardAction;
    const stage = Number(location.state?.dashboardStage);
    const age = location.state?.dashboardAge;
    if (!action && !stage && !age) return;
    queueMicrotask(() => {
      if (action === "create" && permittedStages.includes(1)) {
        setEditingId(null);
        setFormError("");
        setChallanFieldErrors({});
        setForm({
          number: "",
          date: today(),
          party: "",
          notes: "",
          items: [blank()],
        });
        setPage("create");
      }
      if (stage && permittedStages.includes(stage)) {
        setTab(stage);
        setPage("list");
        setDashboardAge("");
      }
      if (age) {
        setDashboardAge(age);
        setPage("list");
        setTab(isAdmin ? "all" : (permittedStages[0] ?? "all"));
      }
      navigate(location.pathname, { replace: true, state: null });
    });
  }, [location.pathname, location.state, navigate, isAdmin, permittedStages]);
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
          const viewChallanId = location.state?.viewChallanId;
          if (
            viewChallanId &&
            cloudRecords.some((record) => record.id === viewChallanId)
          ) {
            setPage("view");
            setViewId(viewChallanId);
            navigate(location.pathname, { replace: true, state: null });
          }
        },
        (error) =>
          console.warn("Challans could not be loaded from Firestore.", error),
      ),
    [location.pathname, location.state?.viewChallanId, navigate],
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
  useEffect(() => {
    if (!isAdmin && !permittedStages.includes(Number(tab)))
      queueMicrotask(() => setTab(permittedStages[0] ?? "all"));
  }, [isAdmin, permittedStages, tab]);
  const accessibleRecords = useMemo(
    () =>
      isAdmin
        ? records
        : records.filter((record) =>
            permittedStages.includes(Number(record.stage || 1)),
          ),
    [isAdmin, permittedStages, records],
  );
  const count = (stage) =>
    stage === "all"
      ? accessibleRecords.length
      : accessibleRecords.filter((item) => item.stage === Number(stage)).length;
  const stageTabs = isAdmin
    ? [
        ["all", "All Challans"],
        [1, "Stage 1"],
        [2, "Stage 2"],
        [3, "Stage 3"],
        [4, "Stage 4"],
      ]
    : permittedStages.map((stage) => [stage, `Stage ${stage}`]);
  const metrics = isAdmin
    ? [
        ["Total Challans", count("all")],
        ["Goods Out", count(1)],
        ["Payment Pending", count(3)],
        ["Completed", count(4)],
      ]
    : permittedStages.map((stage) => [
        `Stage ${stage} · ${STAGES[stage]}`,
        count(stage),
      ]);
  const parties = useMemo(
    () =>
      [
        ...new Set([
          ...partyOptions,
          ...accessibleRecords.map((item) => item.party),
        ]),
      ].sort((a, b) => a.localeCompare(b)),
    [accessibleRecords, partyOptions],
  );
  const shown = useMemo(
    () =>
      accessibleRecords
        .filter((item) => {
          const matchAge =
            agingFilter === "all" ||
            challanAging(item, clock).status === agingFilter;
          const created =
            timestampMs(item.createdAt) || Number(item.createdAtMs || 0);
          const hours = created ? (clock - created) / 3600000 : 0;
          const matchDashboardAge =
            !dashboardAge ||
            ([1, 2].includes(Number(item.stage) || 1) &&
              (dashboardAge === "5d"
                ? hours >= 120
                : dashboardAge === "60h"
                  ? hours >= 60 && hours < 120
                  : hours >= 24 && hours < 60));
          return (
            (tab === "all" || item.stage === Number(tab)) &&
            (!dateFilter || item.date === dateFilter) &&
            (!partyFilter || item.party === partyFilter) &&
            matchAge &&
            matchDashboardAge &&
            ((
              String(item.number || "") +
              " " +
              String(item.party || "") +
              " " +
              item.items.map((row) => row.sku).join(" ")
            )
              .toLowerCase()
              .includes(search.toLowerCase()) ||
              item.items.some((row) => inventoryMatchesSearch(row, search)))
          );
        })
        .sort((a, b) =>
          sortMode === "newest"
            ? b.createdAt - a.createdAt
            : a.createdAt - b.createdAt,
        ),
    [
      accessibleRecords,
      search,
      tab,
      dateFilter,
      partyFilter,
      agingFilter,
      dashboardAge,
      sortMode,
      clock,
    ],
  );
  const itemChange = (id, key, value) => {
    setForm((state) => {
      const items = state.items.map((item) =>
        item.id === id
          ? refreshItemPrice(
              {
                ...item,
                [key]: value,
                ...(key === "amount"
                  ? { priceSource: "manual", priceContext: priceContext(item) }
                  : {}),
                ...(key === "sku"
                  ? {
                      inventoryId: "",
                      type: "",
                      shape: "",
                      size: "",
                      importIdentityError: "",
                    }
                  : {}),
              },
              prices,
            )
          : item,
      );
      setFormError(stockError(items, inventory));
      return { ...state, items };
    });
  };
  const selectSku = (id, selected) => {
    setForm((state) => {
      const items = state.items.map((item) =>
        item.id === id
          ? refreshItemPrice(
              {
                ...item,
                inventoryId: selected.id || "",
                sku: selected.sku || "",
                importIdentityError: "",
                shape: selected.shape || "",
                size: normalizeSize(selected.size),
                type: selected.type || "",
                weight: "",
                pieces: "",
              },
              prices,
            )
          : item,
      );
      setFormError(stockError(items, inventory));
      return { ...state, items };
    });
  };
  const readChallanImport = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !canImportChallan(page, editingId, hasStagePermission(1)))
      return;
    if (inventoryLoading || inventoryError) {
      setImportFileError(
        "Inventory is not available yet. Try again after it loads.",
      );
      return;
    }
    if (!/\.(xlsx|csv)$/i.test(file.name)) {
      setImportFileError("Choose an .xlsx or .csv file.");
      return;
    }
    try {
      const XLSX = await import("xlsx");
      const book = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const sheet = book.Sheets[book.SheetNames[0]];
      const matrix = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        defval: "",
        blankrows: true,
        raw: true,
      });
      const parsed = parseChallanImport(matrix, inventory, prices);
      setBulkReview({
        filename: file.name,
        matrix,
        initiallyValid: parsed.groups
          .filter((group) => group.status === "VALID")
          .map((group) => group.ref),
      });
      setBulkResult(null);
      setImportFileError("");
    } catch (error) {
      setImportFileError(error.message || "Could not read the import file.");
    }
  };
  const importValidChallans = async () => {
    if (
      bulkSaving ||
      !bulkReview ||
      !canImportChallan(page, editingId, hasStagePermission(1))
    )
      return;
    setBulkSaving(true);
    const successes = [],
      failures = [];
    try {
      // Rebuild the review against the newest live Inventory and Master Price data.
      const latest = parseChallanImport(bulkReview.matrix, inventory, prices);
      const used = new Set(records.map((record) => record.number));
      for (const group of latest.groups) {
        if (group.status !== "VALID") {
          if (bulkReview.initiallyValid.includes(group.ref))
            failures.push({
              ref: group.ref,
              reasons: group.reasons.map(
                (reason) => "Row " + reason.rowNumber + ": " + reason.message,
              ),
            });
          continue;
        }
        let saved = null,
          lastError = null;
        for (let attempt = 0; attempt < 1000; attempt++) {
          const number = nextBulkChallanNumber(used);
          used.add(number);
          const record = prepareImportedStageOneRecord(
            group,
            number,
            user,
            crypto.randomUUID(),
          );
          try {
            // Same atomic number claim, latest Inventory reads, deduction and
            // Challan write used by manual Stage 1 creation.
            saved = await createStageOneChallan(db, record);
            break;
          } catch (error) {
            lastError = error;
            if (!/Challan Number .*already exists/.test(error.message || ""))
              break;
          }
        }
        if (!saved) {
          failures.push({
            ref: group.ref,
            reasons: [lastError?.message || "Could not create this Challan."],
          });
          continue;
        }
        successes.push({ ref: group.ref, number: saved.number });
        void writeActivity({
          panel: "challan",
          stage: "Stage 1",
          action: "created",
          recordId: saved.id,
          snapshot: challanSnapshot(saved),
          user,
        }).catch((error) =>
          console.warn("Challan activity could not be saved.", error),
        );
        const partyExists = parties.some(
          (name) =>
            name.toLocaleLowerCase() === group.party.toLocaleLowerCase(),
        );
        if (!partyExists)
          void saveParty(group.party).catch((error) =>
            console.warn("Party name could not be saved.", error),
          );
      }
      const skipped = latest.groups.filter(
        (group) =>
          group.status !== "VALID" &&
          !bulkReview.initiallyValid.includes(group.ref),
      ).length;
      setBulkResult({ successes, failures, skipped });
      setImportStatus(
        successes.length +
          " Challans imported successfully. " +
          (failures.length + skipped) +
          " Challans skipped or failed.",
      );
    } catch (error) {
      setBulkResult({
        successes,
        failures: [
          ...failures,
          {
            ref: "Batch",
            reasons: [error.message || "Bulk import stopped unexpectedly."],
          },
        ],
        skipped: 0,
      });
    } finally {
      setBulkSaving(false);
    }
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
    if (saving) return;
    setSaving(true);
    try {
      if (!hasStagePermission(1)) {
        setFormError("Your account does not have Challan Stage 1 permission.");
        return;
      }
      if (importDraftIssues.length) {
        setFormError(
          "Resolve every imported row error before creating this Challan.",
        );
        return;
      }
      const items = form.items.filter((item) => item.sku.trim());
      const invalidWidth = items.find((item) => widthError(item.width));
      if (invalidWidth) {
        setFormError(widthError(invalidWidth.width));
        return;
      }
      if (
        items.some(
          (item) =>
            item.amount === "" ||
            item.amount == null ||
            !Number.isFinite(Number(item.amount)) ||
            Number(item.amount) < 0,
        )
      ) {
        setFormError(
          "Enter a valid Price for every item. Missing Master Prices may be entered manually.",
        );
        return;
      }
      const typedParty = form.party.trim();
      const existingParty = parties.find(
        (name) => name.toLocaleLowerCase() === typedParty.toLocaleLowerCase(),
      );
      const party = existingParty || typedParty;
      const fieldErrors = {};
      const originalSnapshot = editOriginal.current?.snapshot;
      const previous =
        editingId === editOriginal.current?.record.id
          ? editOriginal.current.record
          : null;
      if (editingId && !previous)
        throw new Error("This Challan is no longer available.");
      if (!previous || form.number !== previous.number) {
        const numberError = documentNumberError(
          "challan",
          form.number,
          records,
          editingId,
        );
        if (numberError) fieldErrors.number = numberError;
        if (previous && !isAdmin)
          fieldErrors.number = "Only Admin can change the Challan Number.";
      }
      if (!party) fieldErrors.party = "Party Name is required.";
      if (!items.length)
        fieldErrors.items =
          "Add at least one Inventory SKU before creating the Challan.";
      if (Object.keys(fieldErrors).length) {
        setChallanFieldErrors(fieldErrors);
        return;
      }
      const stockIssue = previous ? "" : stockError(items, inventory);
      if (stockIssue) {
        setFormError(stockIssue);
        return;
      }
      setFormError("");
      setChallanFieldErrors({});
      const pricedItems = items.map((item) => {
        const pieces = wholePieces(
          item.pieces === "" ? 0 : item.pieces,
          "Pieces",
        );
        const weight = normalizeWeight(item.weight, "Weight");
        if (weight <= 0)
          throw new Error("Issued Weight must be greater than zero.");
        const cleanItem = { ...item };
        delete cleanItem.importRowNumber;
        delete cleanItem.importIdentityError;
        return {
          ...cleanItem,
          width: normalizeSize(item.width),
          pieces,
          weight,
          ...(previous?.stage > 1
            ? stageOneFinancials(item)
            : priceWeightedItem(weight, item.amount, item.discount)),
        };
      });
      const totals =
        previous?.stage > 1
          ? {
              amount: previous.amount,
              discountAmount: previous.discountAmount,
              netAmount: previous.netAmount,
            }
          : stageOneTotals(pricedItems);
      const pricing = {
        amount: totals.amount,
        discountAmount: totals.discountAmount,
        netAmount: totals.netAmount,
      };
      pricing.discount = pricing.amount
        ? Number(((pricing.discountAmount * 100) / pricing.amount).toFixed(2))
        : 0;
      if (
        previous &&
        !editAllowed(previous, user, anchoredNow(clockAnchor.current))
      ) {
        setFormError("This Challan is no longer editable.");
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
              (item.sourceInventoryId || item.inventoryId) !==
                next.inventoryId ||
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
      if (
        previous &&
        Number(previous.stage) > 1 &&
        !unchangedAdvancedStageOne(previous.items, pricedItems)
      )
        throw new Error(
          "Calculation fields are locked after Stage 1. Reopen the Challan to edit notes or party details.",
        );
      const record = previous
        ? {
            ...previous,
            number: form.number,
            party,
            date: form.date,
            notes: form.notes,
            items: pricedItems,
            ...pricing,
          }
        : {
            id: crypto.randomUUID(),
            number: form.number,
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
        await runTransaction(db, async (tx) => {
          const ref = doc(db, "challans", record.id);
          const snapshot = await tx.get(ref);
          if (!snapshot.exists())
            throw new Error("This Challan is no longer available.");
          const latest = snapshot.data();
          if (!sameStageOneEditSnapshot(originalSnapshot, latest))
            throw new Error(
              "This Challan changed while you were editing. Reopen it and try again.",
            );
          if (!editAllowed(latest, user, anchoredNow(clockAnchor.current)))
            throw new Error("This Challan is no longer editable.");
          const claimNumber =
            record.number !== latest.number
              ? await prepareNumberClaim(
                  tx,
                  db,
                  "challan",
                  record.number,
                  record.id,
                  latest.number,
                )
              : () => {};
          claimNumber();
          // Update only editable fields; retain concurrently uploaded images/history.
          tx.update(ref, {
            number: record.number,
            party,
            date: form.date,
            notes: form.notes,
            items: pricedItems,
            ...pricing,
          });
        });
      } else {
        const saved = await createStageOneChallan(db, record);
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
      editOriginal.current = null;
      setEditingId(null);
      setForm({
        number: "",
        date: today(),
        party: "",
        notes: "",
        items: [blank()],
      });
      setPage("list");
    } catch (error) {
      console.error("Challan could not be saved", error);
      setFormError(
        error?.code === "permission-denied"
          ? "Your account is not permitted to save this Challan. Please contact an administrator."
          : error?.message || "Could not save this Challan. Please try again.",
      );
    } finally {
      setSaving(false);
    }
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
      const rawFinalInvoiceAmount = previous.finalInvoice?.finalInvoiceAmount;
      if (
        rawFinalInvoiceAmount === undefined ||
        rawFinalInvoiceAmount === null ||
        rawFinalInvoiceAmount === "" ||
        !isValidMoney(rawFinalInvoiceAmount)
      ) {
        setLegacyInvoiceCandidate(previous);
        return;
      }
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
      const input = returns[index];
      const movement = movementFor(
        item,
        input.returnPieces,
        input.returnWeight,
      );
      const priced = stageOneFinancials(item);
      return {
        inventoryId: item.sourceInventoryId || item.inventoryId || "",
        sourceInventoryId: item.sourceInventoryId || item.inventoryId || "",
        sku: item.sku || "",
        type: item.type || "",
        shape: item.shape || "",
        size: normalizeSize(item.size),
        width: normalizeSize(item.width),
        ...movement,
        amount: priced.amount,
        discount: priced.discount,
        grossAmount: priced.grossAmount,
        discountAmount: priced.discountAmount,
        netAmount: priced.netAmount,
        ...(priced.pricingVersion
          ? { pricingVersion: priced.pricingVersion }
          : {}),
      };
    });
    const record = { ...previous, stage: 2 };
    const saved = await runTransaction(db, async (tx) => {
      const challanRef = doc(db, "challans", previous.id);
      const latestSnapshot = await tx.get(challanRef);
      if (!latestSnapshot.exists() || Number(latestSnapshot.data().stage) !== 1)
        throw new Error("This Challan is no longer in Stage 1.");
      if (
        !sameStageOneReturnSource(previous.items, latestSnapshot.data().items)
      )
        throw new Error(
          "This Challan changed during return review. Reopen it and try again.",
        );
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
          weight: fromMillis(
            weightMillis(stock.weight || 0) + weightMillis(item.returnWeight),
          ),
          pieces:
            wholePieces(
              stock.pieces ?? stock.quantity ?? stock.qty ?? 0,
              "Inventory Pieces",
            ) + item.returnPieces,
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
          stage2: { enteredAtMs: now, enteredAt: serverTimestamp() },
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
      action: "stage_moved",
      transition: "Stage 1 → Stage 2",
      recordId: record.id,
      snapshot: challanSnapshot(record),
      before: challanSnapshot(previous),
      user,
    }).catch((error) =>
      console.warn("Challan return activity could not be saved.", error),
    );
  };
  const confirmFinalInvoice = async (partialAmounts = []) => {
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
      if (
        !sameStageTwoInvoiceSource(
          previous.stage2Return?.items,
          current.stage2Return?.items,
        )
      )
        throw new Error(
          "Return or pricing data changed during invoice review. Reopen it and try again.",
        );
      const now = Date.now();
      if (
        !isAdmin &&
        invoiceReviewRows(current.stage2Return.items).some(
          (item) => item.billingMode === "partial-return",
        )
      )
        throw new Error(
          "Only Admin can enter a partial-return Final Billed Amount.",
        );
      const invoice = invoiceFromStageTwo(
        current.stage2Return.items,
        partialAmounts,
      );
      const savedRecord = {
        ...current,
        id: previous.id,
        stage: 3,
        finalInvoice: { ...invoice, confirmedAtMs: now },
        stageHistory: {
          ...(current.stageHistory || {}),
          stage3: { enteredAtMs: now, enteredAt: serverTimestamp() },
        },
      };
      tx.set(challanRef, savedRecord);
      return savedRecord;
    });
    setFinalInvoiceCandidate(null);
    void writeActivity({
      panel: "challan",
      stage: "Stage 3",
      action: "stage_moved",
      transition: "Stage 2 → Stage 3",
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
      const rawFinalInvoiceAmount = current.finalInvoice?.finalInvoiceAmount;
      if (
        rawFinalInvoiceAmount === undefined ||
        rawFinalInvoiceAmount === null ||
        rawFinalInvoiceAmount === "" ||
        !isValidMoney(rawFinalInvoiceAmount)
      )
        throw new Error(
          "Final Invoice data is unavailable for this historical Challan. Settlement cannot be completed until the invoice record is available.",
        );
      if (current.finalSettlement)
        throw new Error("This Challan has already been settled.");
      const calculation = settlementFor(
        rawFinalInvoiceAmount,
        amountPaid,
        settlementDiscountAmount,
      );
      if (calculation.remaining !== 0)
        throw new Error(
          "Amount Paid plus Discount Amount must equal the Final Invoice Amount.",
        );
      const now = Date.now();
      const savedRecord = {
        ...current,
        id: previous.id,
        stage: 4,
        finalSettlement: { ...calculation, completedAtMs: now },
        stageHistory: {
          ...(current.stageHistory || {}),
          stage4: { enteredAtMs: now, enteredAt: serverTimestamp() },
        },
      };
      tx.set(challanRef, savedRecord);
      return savedRecord;
    });
    setFinalSettlementCandidate(null);
    void writeActivity({
      panel: "challan",
      stage: "Stage 4",
      action: "stage_moved",
      transition: "Stage 3 → Stage 4",
      recordId: saved.id,
      snapshot: challanSnapshot(saved),
      before: challanSnapshot(previous),
      user,
    }).catch((error) =>
      console.warn("Final settlement activity could not be saved.", error),
    );
  };
  const stageEditRemaining = (record) => challanEditRemaining(record, clock);
  const canEditChallan = (record) => editAllowed(record, user, clock);
  const closeEditor = () => {
    editOriginal.current = null;
    setEditingId(null);
    setForm({
      number: "",
      date: today(),
      party: "",
      notes: "",
      items: [blank()],
    });
    setFormError("");
    setChallanFieldErrors({});
    setPage("list");
  };
  const editChallan = async (record) => {
    if (!canEditChallan(record)) return;
    try {
      const snapshot = await getDocFromServer(doc(db, "challans", record.id));
      const checkedAt = await readServerClock().catch(() =>
        anchoredNow(clockAnchor.current),
      );
      clockAnchor.current = { time: checkedAt, tick: performance.now() };
      if (!snapshot.exists() || !editAllowed(snapshot.data(), user, checkedAt))
        throw new Error("This Challan is no longer editable.");
      record = { id: snapshot.id, ...snapshot.data() };
    } catch (error) {
      window.alert(
        error.message || "This Challan could not be opened for editing.",
      );
      return;
    }
    editOriginal.current = { record, snapshot: stageOneEditSnapshot(record) };
    setEditingId(record.id);
    setImportStatus("");
    setImportFileError("");
    setFormError("");
    setChallanFieldErrors({});
    setForm({
      number: record.number || "",
      date: record.date,
      party: record.party,
      notes: record.notes || "",
      items: record.items.map((item) =>
        savedPriceItem({
          ...item,
          id: item.id || crypto.randomUUID(),
          amount: item.amount ?? "",
          discount: item.discount ?? "",
        }),
      ),
    });
    setPage("create");
  };
  const deleteChallan = async (id) => {
    const record = deleteCandidate;
    if (!record || record.id !== id || !isAdmin)
      throw new Error("Only Admin can delete this Challan.");
    await runTransaction(db, async (tx) => {
      const ref = doc(db, "challans", id);
      const snapshot = await tx.get(ref);
      if (!snapshot.exists())
        throw new Error("This Challan has already been deleted.");
      const latest = snapshot.data();
      const reversal = challanStockRestoration(latest);
      const reviewed = challanStockRestoration(record);
      if (
        Number(latest.stage) !== Number(record.stage) ||
        reversal.items.length !== reviewed.items.length ||
        reversal.items.some(
          (item, index) =>
            item.inventoryId !== reviewed.items[index].inventoryId ||
            item.pieces !== reviewed.items[index].pieces ||
            weightMillis(item.weight) !==
              weightMillis(reviewed.items[index].weight),
        )
      )
        throw new Error(
          "Challan stock movement changed during delete review. Reopen it and try again.",
        );
      const grouped = new Map();
      for (const item of reversal.items) {
        const current = grouped.get(item.inventoryId) || {
          pieces: 0,
          weight: 0n,
          sku: item.sku,
        };
        if (current.sku !== item.sku)
          throw new Error(
            "Challan Inventory identity and SKU disagree; deletion was cancelled.",
          );
        current.pieces += item.pieces;
        current.weight += weightMillis(item.weight);
        if (!Number.isSafeInteger(current.pieces))
          throw new Error("Restored Pieces are too large.");
        grouped.set(item.inventoryId, current);
      }
      const inventorySnapshots = await Promise.all(
        [...grouped.keys()].map(async (inventoryId) => {
          const inventory = await tx.get(doc(db, "inventory", inventoryId));
          if (!inventory.exists())
            throw new Error(
              "Linked Inventory is missing; Challan was not deleted.",
            );
          return inventory;
        }),
      );
      const releaseNumber = await prepareNumberRelease(
        tx,
        db,
        "challan",
        latest.number,
        id,
      );
      for (const inventory of inventorySnapshots) {
        const amount = grouped.get(inventory.id);
        const stock = inventory.data();
        if (stock.sku && amount.sku && stock.sku !== amount.sku)
          throw new Error(
            "Linked Inventory SKU changed; Challan was not deleted.",
          );
        if (amount.pieces === 0 && amount.weight === 0n) continue;
        const pieces =
          wholePieces(
            stock.pieces ?? stock.quantity ?? stock.qty ?? 0,
            "Inventory Pieces",
          ) + amount.pieces;
        if (!Number.isSafeInteger(pieces))
          throw new Error("Inventory Pieces are too large.");
        tx.update(inventory.ref, {
          pieces,
          weight: fromMillis(
            weightMillis(stock.weight ?? 0, "Inventory Weight") + amount.weight,
          ),
          updatedAt: serverTimestamp(),
        });
      }
      releaseNumber();
      tx.delete(ref);
    });
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
  const pricing = stageOneTotals(
    savableStageOneRows(form.items.filter((item) => !widthError(item.width))),
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
        Size: normalizeSize(item.size),
        Width: normalizeSize(item.width),
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
        ...(item.pricingVersion === WEIGHT_RATE_PRICING
          ? {
              "Price / Rate": Number(item.amount || 0),
              "Stage 1 Net Amount": exportMoney(stageOneGross(item)),
              "Stage 1 Net Amount After Discount": exportMoney(
                stageOneNet(item),
              ),
            }
          : { "Original Price": Number(item.amount || 0) }),
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
      setFormError("Please allow pop-ups to print Challans.");
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
      setFormError("Please allow pop-ups to print this Challan.");
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
    const weightedPricing = hasWeightedPricing(items);
    const totalAmount = moneyText(
      weightedPricing
        ? sumStoredBy(items, stageOneGross)
        : sumStored(items, "amount"),
    );
    const sumPiecesForPrint = (key) => sumStored(items, key) ?? "Unavailable";
    const sumWeightForPrint = (key) => weightText(sumStored(items, key));
    const totalDetails =
      stage === 1
        ? "Items: " +
          items.length +
          " &nbsp; Pieces: " +
          sumPiecesForPrint("pieces") +
          " &nbsp; Weight: " +
          sumWeightForPrint("weight") +
          " ct &nbsp; Original Amount: &#8377;" +
          totalAmount
        : isFlowStage
          ? "Items: " +
            items.length +
            " &nbsp; Issued: " +
            sumPiecesForPrint("issuedPieces") +
            " pcs / " +
            sumWeightForPrint("issuedWeight") +
            " ct &nbsp; Returned: " +
            sumPiecesForPrint("returnPieces") +
            " pcs / " +
            sumWeightForPrint("returnWeight") +
            " ct &nbsp; Sold / Kept: " +
            sumPiecesForPrint("soldPieces") +
            " pcs / " +
            sumWeightForPrint("soldWeight") +
            " ct &nbsp; Original Amount: &#8377;" +
            totalAmount
          : "Items: " +
            items.length +
            " &nbsp; Original Amount: &#8377;" +
            totalAmount;
    const headers = ["SKU / Item", "Shape", "Size", "Width"];
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
    headers.push(
      ...(weightedPricing
        ? [
            "Price / Carat",
            "Net Amount",
            "Stage 1 Discount %",
            "Net Amount After Discount",
          ]
        : ["Original Stage 1 Amount", "Stage 1 Discount %"]),
    );
    if (stage >= 3) headers.push("Discount Amount", "Final Billed Amount");
    const itemRows = items
      .map((item) => {
        const cells = [
          escape(item.sku),
          escape(item.shape),
          escape(normalizeSize(item.size)),
          escape(normalizeSize(item.width) || "--"),
        ];
        if (stage === 1)
          cells.push(pieceValue(item.pieces), weightText(item.weight) + " ct");
        if (isFlowStage)
          cells.push(
            pieceValue(item.issuedPieces ?? item.pieces),
            weightText(item.issuedWeight ?? item.weight ?? 0) + " ct",
            item.returnPieces === undefined
              ? "-"
              : pieceValue(item.returnPieces),
            item.returnWeight === undefined
              ? "-"
              : weightText(item.returnWeight) + " ct",
            item.soldPieces === undefined ? "-" : pieceValue(item.soldPieces),
            item.soldWeight === undefined
              ? "-"
              : weightText(item.soldWeight) + " ct",
          );
        if (stage === 3)
          cells.push(
            (item.soldPieces === undefined
              ? "-"
              : pieceValue(item.soldPieces) + " pcs") +
              " / " +
              (item.soldWeight === undefined
                ? "-"
                : weightText(item.soldWeight) + " ct"),
          );
        cells.push(
          "&#8377;" + moneyText(item.amount),
          ...(weightedPricing
            ? ["&#8377;" + moneyText(stageOneGross(item))]
            : []),
          viewPercent(item.stage1DiscountPercent ?? item.discount),
          ...(weightedPricing
            ? ["&#8377;" + moneyText(stageOneNet(item))]
            : []),
        );
        if (stage >= 3)
          cells.push(
            "&#8377;" + moneyText(item.stage1DiscountAmount),
            "&#8377;" + moneyText(item.finalAmount),
          );
        return (
          "<tr>" +
          cells.map((cell) => "<td>" + cell + "</td>").join("") +
          "</tr>"
        );
      })
      .join("");
    const invoiceDetails = invoice
      ? '<p class="total">' +
        (invoice.calculationVersion === "manual-partial-v1"
          ? hasWeightedPricing(items)
            ? "Stage 1 Net Amount"
            : "Original Stage 1 Amount"
          : "Gross Amount") +
        ": &#8377;" +
        moneyText(invoice.grossAmount) +
        (Number(invoice.stage1DiscountAmount)
          ? " &nbsp; Stage 1 Discount: -&#8377;" +
            moneyText(invoice.stage1DiscountAmount)
          : "") +
        " &nbsp; <strong>Final Invoice Amount: &#8377;" +
        moneyText(invoice.finalInvoiceAmount) +
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
          moneyText(settlement.amountPaid) +
          " &nbsp; Settlement Discount: &#8377;" +
          moneyText(settlement.settlementDiscountAmount) +
          " &nbsp; <strong>Actual Received: &#8377;" +
          moneyText(settlement.actualReceivedAmount) +
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
  const exportChallan = async (record) => {
    const XLSX = await import("xlsx");
    const stage = Number(record.stage || 1);
    const invoice = record.finalInvoice;
    const settlement = record.finalSettlement;
    const items = historicalItemsFor(record).map((item) => {
      if (stage !== 4) return item;
      const returnItem = (record.stage2Return?.items || []).find(
        (candidate) =>
          (candidate.sourceInventoryId ||
            candidate.inventoryId ||
            candidate.sku) ===
          (item.sourceInventoryId || item.inventoryId || item.sku),
      );
      return returnItem ? { ...returnItem, ...item } : item;
    });
    const details = [
      ["Field", "Value"],
      ["Challan No.", record.number || ""],
      ["Party", record.party || ""],
      ["Date", record.date || ""],
      ["Stage", "Stage " + stage + " - " + STAGES[stage]],
      ["Notes", record.notes || ""],
      [
        hasWeightedPricing(items) ? "Stage 1 Net Amount" : "Original Amount",
        exportMoney(record.amount),
      ],
      ["Stage 1 Discount Amount", exportMoney(record.discountAmount)],
      [
        hasWeightedPricing(items)
          ? "Stage 1 Net Amount After Discount"
          : "Stage 1 Net Amount",
        exportMoney(record.netAmount),
      ],
    ];
    if (stage >= 3 && invoice)
      details.push(
        [
          invoice.calculationVersion === "manual-partial-v1"
            ? hasWeightedPricing(items)
              ? "Stage 1 Net Amount"
              : "Original Stage 1 Amount"
            : "Gross Amount",
          exportMoney(invoice.grossAmount),
        ],
        [
          invoice.calculationVersion === "manual-partial-v1"
            ? "Original Stage 1 Discount"
            : "Final Invoice Stage 1 Discount",
          exportMoney(invoice.stage1DiscountAmount),
        ],
        ["Final Invoice Amount", exportMoney(invoice.finalInvoiceAmount)],
        [
          "Final Invoice Confirmed",
          invoice.confirmedAtMs
            ? formatStageDate(invoice.confirmedAtMs) +
              ", " +
              formatStageTime(invoice.confirmedAtMs)
            : "",
        ],
      );
    if (stage === 4 && settlement)
      details.push(
        ["Amount Paid", exportMoney(settlement.amountPaid)],
        [
          "Settlement Discount",
          exportMoney(settlement.settlementDiscountAmount),
        ],
        ["Actual Received", exportMoney(settlement.actualReceivedAmount)],
        ["Remaining", exportMoney(settlement.remaining)],
        [
          "Completed",
          settlement.completedAtMs
            ? formatStageDate(settlement.completedAtMs) +
              ", " +
              formatStageTime(settlement.completedAtMs)
            : "",
        ],
      );
    const itemRows = items.map((item) => ({
      SKU: item.sku || "",
      Type: item.type || "",
      Shape: item.shape || "",
      Size: normalizeSize(item.size),
      Width: normalizeSize(item.width),
      "Original Pieces": exportPieces(item.pieces ?? item.issuedPieces),
      "Original Weight": exportWeight(item.weight ?? item.issuedWeight),
      "Issued Pieces":
        stage >= 2 ? exportPieces(item.issuedPieces ?? item.pieces) : "",
      "Issued Weight":
        stage >= 2 ? exportWeight(item.issuedWeight ?? item.weight) : "",
      "Return Pieces": stage >= 2 ? exportPieces(item.returnPieces) : "",
      "Return Weight": stage >= 2 ? exportWeight(item.returnWeight) : "",
      "Sold / Kept Pieces": stage >= 2 ? exportPieces(item.soldPieces) : "",
      "Sold / Kept Weight": stage >= 2 ? exportWeight(item.soldWeight) : "",
      ...(item.pricingVersion === WEIGHT_RATE_PRICING
        ? {
            "Price / Rate": exportMoney(item.amount),
            "Stage 1 Net Amount": exportMoney(stageOneGross(item)),
            "Stage 1 Net Amount After Discount": exportMoney(stageOneNet(item)),
          }
        : {
            "Original Price": exportMoney(item.amount),
            "Original Stage 1 Amount": exportMoney(item.amount),
            "Stage 1 Net Amount":
              stage >= 3 ? exportMoney(item.stage1NetAmount) : "",
          }),
      "Stage 1 Discount %": item.stage1DiscountPercent ?? item.discount ?? "",
      "Billable Gross":
        stage >= 3 && invoice?.calculationVersion !== "manual-partial-v1"
          ? exportMoney(item.grossAmount)
          : "",
      "Stage 1 Discount Amount": exportMoney(
        item.stage1DiscountAmount ?? item.discountAmount,
      ),
      "Final Item Amount": exportMoney(item.finalAmount ?? item.netAmount),
      "Final Billed Amount": stage >= 3 ? exportMoney(item.finalAmount) : "",
    }));
    const images = [1, 2].flatMap((imageStage) =>
      (Array.isArray(record["stage" + imageStage + "Images"])
        ? record["stage" + imageStage + "Images"]
        : []
      ).map((image) => ({
        Stage: "Stage " + imageStage,
        Filename: image.originalFilename || "",
        URL: image.secureUrl || "",
      })),
    );
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.aoa_to_sheet(details),
      "Challan",
    );
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.json_to_sheet(itemRows),
      "Items",
    );
    if (images.length)
      XLSX.utils.book_append_sheet(
        book,
        XLSX.utils.json_to_sheet(images),
        "Images",
      );
    XLSX.writeFile(
      book,
      "challan-" +
        String(record.number || record.id || "record").replace(
          /[\\/:*?"<>|]/g,
          "-",
        ) +
        ".xlsx",
    );
  };
  const viewRecord = viewId
    ? accessibleRecords.find((record) => record.id === viewId)
    : null;
  const uploadImage = async (files, stage) => {
    const result = { uploaded: 0, failed: [] };
    if (uploadInProgress.current) return result;
    if (
      ![1, 2].includes(stage) ||
      !viewRecord ||
      Number(viewRecord.stage) !== stage ||
      !hasStagePermission(stage) ||
      !canEditChallan(viewRecord)
    ) {
      return {
        uploaded: 0,
        failed: ["You are not permitted to upload images for this Challan."],
      };
    }
    const imageField = stage === 1 ? "stage1Images" : "stage2Images";
    uploadInProgress.current = true;
    setUploadingStage(stage);
    try {
      for (const file of files) {
        if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
          result.failed.push(file.name + ": select a JPG, PNG or WEBP image.");
          continue;
        }
        if (file.size > 10 * 1024 * 1024) {
          result.failed.push(file.name + ": image must be 10 MB or smaller.");
          continue;
        }
        try {
          const image = await uploadChallanImage(file);
          await runTransaction(db, async (tx) => {
            const challanRef = doc(db, "challans", viewRecord.id);
            const snapshot = await tx.get(challanRef);
            if (!snapshot.exists() || Number(snapshot.data().stage) !== stage)
              throw new Error("stage-changed");
            const currentImages = Array.isArray(snapshot.data()[imageField])
              ? snapshot.data()[imageField]
              : [];
            tx.update(challanRef, {
              [imageField]: [
                ...currentImages,
                {
                  ...image,
                  uploadedAtMs: Date.now(),
                  uploadedBy: user?.uid || "",
                },
              ],
              updatedAt: serverTimestamp(),
            });
          });
          result.uploaded += 1;
        } catch (error) {
          result.failed.push(
            file.name +
              (error.message === "stage-changed"
                ? ": this Challan has moved to another stage."
                : error.message ===
                    "Image uploads are not configured. Please contact Admin."
                  ? ": image uploads are not configured. Please contact Admin."
                  : ": upload or attachment failed. Please try again or contact Admin."),
          );
        }
      }
    } finally {
      uploadInProgress.current = false;
      setUploadingStage(null);
    }
    return result;
  };
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
    const invoiceItems = Array.isArray(invoice?.items) ? invoice.items : [];
    const stageFourItems = (
      returnItems.length ? returnItems : invoiceItems
    ).map((item) => {
      const invoiceItem = invoiceItems.find(
        (candidate) =>
          (candidate.sourceInventoryId ||
            candidate.inventoryId ||
            candidate.sku) ===
          (item.sourceInventoryId || item.inventoryId || item.sku),
      );
      return invoiceItem ? { ...item, ...invoiceItem } : item;
    });
    // Retained only until historical source cleanup; rendering below uses explicit stage views.
    const items =
      stage >= 3 && invoiceItems.length
        ? invoiceItems
        : stage >= 2 && returnItems.length
          ? returnItems
          : issuedItems;
    const sumNumber = (key) => sumStored(items, key) ?? Number.NaN;
    const sumPieces = (key = "pieces") => sumStored(items, key) ?? Number.NaN;
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
          <button
            type="button"
            className="challan-view-print"
            onClick={() => exportChallan(viewRecord)}
          >
            Export
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
                  <small>
                    {entered ? (
                      <>
                        {formatStageDate(entered)} <br />{" "}
                        {formatStageTime(entered)}
                      </>
                    ) : (
                      "--"
                    )}
                  </small>{" "}
                </div>
              );
            })}{" "}
          </div>{" "}
        </article>{" "}
        {stage === 1 && <StageOneView items={issuedItems} />}
        {stage === 2 && <StageTwoView items={returnItems} />}
        {stage === 3 && <StageThreeView invoice={invoice} />}
        {stage === 4 && (
          <StageFourView
            items={stageFourItems}
            invoice={invoice}
            settlement={settlement}
          />
        )}
        {stage === 0 && (
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
                    <th>Width</th>
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
                    <th>Price</th>
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
                      <td>{normalizeSize(item.size) || "-"}</td>
                      <td>{normalizeSize(item.width) || "--"}</td>
                      {stage === 1 && (
                        <>
                          <td>{pieceValue(item.pieces)}</td>
                          <td>{weightText(item.weight)} ct</td>
                        </>
                      )}
                      {[2, 4].includes(stage) && (
                        <>
                          <td>
                            {pieceValue(item.issuedPieces ?? item.pieces)}
                          </td>
                          <td>
                            {Number(
                              item.issuedWeight ?? item.weight ?? 0,
                            ).toFixed(3)}{" "}
                            ct
                          </td>
                          <td>{pieceValue(item.returnPieces)}</td>
                          <td>{weightText(item.returnWeight)} ct</td>
                          <td>{pieceValue(item.soldPieces)}</td>
                          <td>{weightText(item.soldWeight)} ct</td>
                        </>
                      )}
                      {stage === 3 && (
                        <td>
                          {pieceValue(item.soldPieces)} pcs /{" "}
                          {weightText(item.soldWeight)} ct
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
                    <td colSpan="4">
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
                          <strong>
                            {sumNumber("soldWeight").toFixed(3)} ct
                          </strong>
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
                    Gross Amount:{" "}
                    <b>₹{money(invoice.grossAmount).toFixed(2)}</b>
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
                Final Invoice confirmed:{" "}
                {formatStageDate(invoice.confirmedAtMs)},{" "}
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
                  <b>
                    ₹{money(settlement.settlementDiscountAmount).toFixed(2)}
                  </b>
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
          </article>
        )}
        <article className="challan-view-card challan-view-notes">
          {" "}
          <h2>Comments / Notes</h2>{" "}
          <p>
            {" "}
            {viewRecord.notes?.trim() ||
              "No notes added for this Challan."}{" "}
          </p>{" "}
        </article>{" "}
        {stage >= 1 && (
          <ChallanImageSection
            stage={1}
            images={
              Array.isArray(viewRecord.stage1Images)
                ? viewRecord.stage1Images
                : []
            }
            canUpload={
              stage === 1 && hasStagePermission(1) && canEditChallan(viewRecord)
            }
            uploading={uploadingStage === 1}
            onUpload={uploadImage}
          />
        )}
        {stage >= 2 && (
          <ChallanImageSection
            stage={2}
            images={
              Array.isArray(viewRecord.stage2Images)
                ? viewRecord.stage2Images
                : []
            }
            canUpload={
              stage === 2 && hasStagePermission(2) && canEditChallan(viewRecord)
            }
            uploading={uploadingStage === 2}
            onUpload={uploadImage}
          />
        )}
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
            {canImportChallan(page, editingId, hasStagePermission(1)) && (
              <>
                <input
                  ref={importFileRef}
                  type="file"
                  accept=".xlsx,.csv"
                  className="challan-import-file"
                  aria-label="Choose Challan import file"
                  onChange={readChallanImport}
                />
                <button
                  type="button"
                  disabled={inventoryLoading || Boolean(inventoryError)}
                  onClick={() => importFileRef.current?.click()}
                >
                  Import Challan
                </button>
              </>
            )}{" "}
          </div>{" "}
        </header>{" "}
        {bulkReview && bulkPreview && (
          <ChallanImportReviewModal
            review={bulkReview}
            preview={bulkPreview}
            result={bulkResult}
            saving={bulkSaving}
            onImport={importValidChallans}
            onClose={() => {
              setBulkReview(null);
              setBulkResult(null);
            }}
          />
        )}{" "}
        <form
          onSubmit={create}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.requestSubmit();
            }
          }}
        >
          {" "}
          <datalist id="challan-skus">
            {" "}
            {inventory.map((item) => (
              <option key={item.id} value={item.sku}>
                {" "}
                {item.shape} · {normalizeSize(item.size)} mm · {item.type}{" "}
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
              <label className={challanFieldErrors.number ? "has-error" : ""}>
                Challan Number *
                <input
                  value={form.number || ""}
                  required={
                    !editingId ||
                    form.number !==
                      records.find((record) => record.id === editingId)?.number
                  }
                  pattern={
                    !editingId ||
                    form.number !==
                      records.find((record) => record.id === editingId)?.number
                      ? CHALLAN_NUMBER_PATTERN
                      : undefined
                  }
                  readOnly={Boolean(editingId) && !isAdmin}
                  placeholder="B35/1"
                  aria-describedby="challan-number-help challan-number-error"
                  aria-invalid={Boolean(challanFieldErrors.number)}
                  onChange={(event) => {
                    setFormError("");
                    setChallanFieldErrors((errors) => ({
                      ...errors,
                      number: "",
                    }));
                    setForm({ ...form, number: event.target.value });
                  }}
                />
                <small id="challan-number-help">{CHALLAN_NUMBER_HELP}</small>
                <small id="challan-number-error" role="alert">
                  {challanFieldErrors.number}
                </small>
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
            {canImportChallan(page, editingId, hasStagePermission(1)) && (
              <p className="challan-import-help">
                Import one .xlsx or .csv file containing multiple Stage 1
                Challans. Exact headers: {CHALLAN_IMPORT_HEADERS.join(", ")}.
                Challan Ref groups items; the application assigns real Challan
                numbers.
              </p>
            )}{" "}
            {importStatus && (
              <p className="challan-import-status" role="status">
                {importStatus}
              </p>
            )}
            {importFileError && (
              <p className="challan-form-error" role="alert">
                {importFileError}
              </p>
            )}
            {importDraftIssues.length > 0 && (
              <div className="challan-import-errors" role="alert">
                <strong>Imported rows need attention before save:</strong>
                <ul>
                  {importDraftIssues.map((entry, index) => (
                    <li key={index}>
                      Row {entry.rowNumber}: {entry.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}{" "}
            {(masterPriceError || masterPricesLoading) && (
              <p role="status">
                {masterPriceError ||
                  "Loading Master Prices… You can enter Price manually."}
              </p>
            )}
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
              <span>Width</span>
              <span>Shape</span> <span>Size</span> <span>Type</span>{" "}
              <span>Weight / Carat</span> <span>Pieces</span> <span>Price</span>{" "}
              <span>Discount %</span> <span>Net Amount</span>{" "}
              <span>Net Amount After Discount</span> <span />{" "}
            </div>{" "}
            {form.items.map((item) => (
              <div className="challan-item" key={item.id}>
                {" "}
                <InventoryPicker
                  value={item.sku}
                  inventoryId={item.inventoryId}
                  inventory={inventory}
                  error={inventoryError}
                  onChange={(value) => itemChange(item.id, "sku", value)}
                  onSelect={(selected) => selectSku(item.id, selected)}
                  autoFocus={focusSkuId === item.id}
                />{" "}
                <label className="challan-width">
                  <input
                    aria-label="Width"
                    placeholder="Width (optional)"
                    inputMode="decimal"
                    value={item.width ?? ""}
                    aria-invalid={Boolean(widthError(item.width))}
                    onChange={(event) =>
                      itemChange(item.id, "width", event.target.value)
                    }
                    onBlur={() => {
                      if (!widthError(item.width))
                        itemChange(item.id, "width", normalizeSize(item.width));
                    }}
                  />
                  {widthError(item.width) && (
                    <small role="alert">{widthError(item.width)}</small>
                  )}
                </label>
                {["shape", "size", "type", "weight", "pieces"].map((key) => (
                  <input
                    key={key}
                    type={
                      key === "weight" || key === "pieces" ? "number" : "text"
                    }
                    min={key === "pieces" ? "0" : undefined}
                    step={
                      key === "pieces"
                        ? "1"
                        : key === "weight"
                          ? "any"
                          : undefined
                    }
                    inputMode={key === "pieces" ? "numeric" : undefined}
                    value={
                      key === "size" ? normalizeSize(item[key]) : item[key]
                    }
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
                  required={Boolean(item.sku.trim())}
                  value={item.amount}
                  onChange={(event) =>
                    itemChange(item.id, "amount", event.target.value)
                  }
                  placeholder="Price"
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
                  {viewCurrency(
                    pricingFor(item.weight, item.amount, item.discount)
                      ?.grossAmount,
                  )}
                </span>{" "}
                <span className="item-price-summary">
                  {viewCurrency(
                    pricingFor(item.weight, item.amount, item.discount)
                      ?.netAmount,
                  )}
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
              <strong>Total Items: {pricing.itemCount}</strong>
              <strong>Total Weight: {pricing.weight.toFixed(3)} ct</strong>
              <strong>Total Pieces: {pricing.pieces} pcs</strong>
              <strong>Total Net Amount: {viewCurrency(pricing.amount)}</strong>
              <strong>
                Total Discount Amount: {viewCurrency(pricing.discountAmount)}
              </strong>
              <strong>
                Total Net Amount After Discount:{" "}
                {viewCurrency(pricing.netAmount)}
              </strong>
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
              disabled={saving || (!editingId && !hasStagePermission(1))}
            >
              {" "}
              {saving
                ? "Saving..."
                : editingId
                  ? "Save Changes"
                  : "Create Challan"}{" "}
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
              setImportStatus("");
              setImportFileError("");
              setFormError("");
              setChallanFieldErrors({});
              setForm({
                number: "",
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
        {stageTabs.map(([key, label]) => (
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
      {dashboardAge && (
        <button
          type="button"
          className="business-text-link"
          onClick={() => setDashboardAge("")}
        >
          Age filter:{" "}
          {dashboardAge === "5d"
            ? "5+ days"
            : dashboardAge === "60h"
              ? "60h to 5d"
              : "24h to 60h"}{" "}
          ×
        </button>
      )}
      <div className="metrics">
        {" "}
        {metrics.map(([label, value]) => (
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
              className={`challan-row aging-${Number(row.stage) < 4 ? challanAging(row, clock).status : "complete"} ${tab === "all" ? "" : "stage-column-hidden"}`}
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
              {Number(row.stage) < 4 ? (
                (() => {
                  const age = challanAging(row, clock);
                  return (
                    <span className={`challan-aging-badge ${age.status}`}>
                      {" "}
                      <i /> {age.elapsedLabel}
                    </span>
                  );
                })()
              ) : (
                <span className="challan-aging-empty">--</span>
              )}{" "}
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
                {Number(row.stage) < 4 && (
                  <button
                    className="challan-workflow-button"
                    disabled={!hasStagePermission(Number(row.stage) + 1)}
                    onClick={() => advance(row.id)}
                  >
                    {" "}
                    {stageActionLabel(row.stage)} <Icon name="arrow" />{" "}
                  </button>
                )}{" "}
                <span className="challan-row-actions">
                  {" "}
                  {Number(row.stage) <= 4 &&
                    !(isAdmin && Number(row.stage) === 1) &&
                    (isAdmin ||
                      (row.createdBy === user?.uid &&
                        row.createdByRole !== "superadmin" &&
                        hasStagePermission(Number(row.stage)))) && (
                      <small
                        className={`challan-edit-timer ${stageEditRemaining(row) ? "" : "expired"}`}
                      >
                        {" "}
                        {stageEditRemaining(row)
                          ? `Edit available: ${formatEditCountdown(stageEditRemaining(row))}`
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
            {accessibleRecords.length
              ? "No challans found"
              : "No challans created yet"}{" "}
          </h3>{" "}
          <p>
            {" "}
            {accessibleRecords.length
              ? "Try changing your search or stage filter."
              : "No Challans are available for your assigned stage."}{" "}
          </p>{" "}
          {![2, 3, 4].includes(Number(tab)) && (
            <button
              className="primary"
              disabled={!hasStagePermission(1)}
              onClick={() => {
                setEditingId(null);
                setFormError("");
                setChallanFieldErrors({});
                setForm({
                  number: "",
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
          canEnterPartial={isAdmin}
        />
      )}{" "}
      {finalSettlementCandidate && (
        <FinalSettlementModal
          record={finalSettlementCandidate}
          onClose={() => setFinalSettlementCandidate(null)}
          onConfirm={confirmFinalSettlement}
        />
      )}{" "}
      {legacyInvoiceCandidate && (
        <LegacyInvoiceUnavailableModal
          record={legacyInvoiceCandidate}
          onClose={() => setLegacyInvoiceCandidate(null)}
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
