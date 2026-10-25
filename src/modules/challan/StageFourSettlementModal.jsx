import { useRef, useState } from "react";
import {
  settlementFor,
  settlementForRecord,
} from "../../utils/challanCalculations.js";
import { usePageFreeze } from "../../hooks/usePageFreeze";

export default function StageFourSettlementModal({
  record,
  onClose,
  onConfirm,
}) {
  usePageFreeze();
  const saved = settlementForRecord(record);
  const [paid, setPaid] = useState(String(saved?.amountPaid ?? ""));
  const [discount, setDiscount] = useState(
    String(saved?.settlementDiscountAmount ?? ""),
  );
  const [party, setParty] = useState(record.party || "");
  const [date, setDate] = useState(record.date || "");
  const [notes, setNotes] = useState(record.notes || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const busyRef = useRef(false),
    correctionId = useRef(crypto.randomUUID());
  let calculation,
    inputError = "";
  try {
    calculation = settlementFor(saved?.finalInvoiceAmount, paid, discount);
    if (calculation.remaining < 0)
      throw Error("Paid plus discount cannot exceed the invoice.");
  } catch (reason) {
    inputError = reason.message;
  }
  const save = async (event) => {
    event.preventDefault();
    if (busyRef.current || inputError) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await onConfirm(paid, discount, correctionId.current, {
        party: party.trim(),
        date,
        notes,
      });
    } catch (reason) {
      setError(reason.message);
      busyRef.current = false;
      setBusy(false);
    }
  };
  return (
    <div
      className="stage-two-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Edit Stage 4 Settlement"
      onMouseDown={busy ? undefined : onClose}
    >
      <section
        className="stage-two-modal settlement-modal stage-four-edit-modal"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <h2>Edit Stage 4 Settlement</h2>
            <p>
              {record.number} · {record.party}
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            disabled={busy}
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <form onSubmit={save}>
          <div className="stage-four-edit-body">
            <p>
              Correct cumulative totals here. Existing receipts stay in Payment
              History; amount changes are recorded separately as corrections.
            </p>
            <div className="stage-four-edit-fields">
              <label>
                Party
                <input
                  required
                  value={party}
                  onChange={(e) => setParty(e.target.value)}
                />
              </label>
              <label>
                Date
                <input
                  required
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </label>
              <label>
                Amount Paid by Customer
                <input
                  required
                  type="number"
                  min="0"
                  step="0.01"
                  value={paid}
                  onChange={(e) => setPaid(e.target.value)}
                />
              </label>
              <label>
                Discount Amount (₹)
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                />
              </label>
            </div>
            <div className="stage-four-edit-balance" role="status">
              Final Invoice: ₹
              {saved?.finalInvoiceAmount?.toFixed(2) ?? "Unavailable"} ·
              Outstanding Amount: ₹
              {calculation && !inputError
                ? calculation.remaining.toFixed(2)
                : "--"}
            </div>
            <label className="stage-two-notes">
              Notes
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>
            {(error || inputError) && (
              <p role="alert" className="stage-two-error">
                {error || inputError}
              </p>
            )}
          </div>
          <footer>
            <button type="button" disabled={busy} onClick={onClose}>
              Cancel
            </button>
            <button
              className="primary"
              type="submit"
              disabled={busy || !!inputError}
            >
              {busy ? "Saving..." : "Save Settlement Changes"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
