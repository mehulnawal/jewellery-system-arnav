import { useState } from "react";
import { usePageFreeze } from "../../hooks/usePageFreeze";
import {
  stageTwoPricedItems,
  strictMoney,
} from "../../utils/challanCalculations.js";

export default function StageTwoPricesModal({ record, onClose, onConfirm }) {
  usePageFreeze();
  const items = stageTwoPricedItems(record);
  const [rates, setRates] = useState(() =>
    items.map((item) => String(item.amount)),
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    try {
      const prices = Object.fromEntries(
        rates.map((rate, index) => [index, strictMoney(rate, "Price / Carat")]),
      );
      setSaving(true);
      await onConfirm(prices);
    } catch (reason) {
      setError(reason.message);
      setSaving(false);
    }
  };
  return (
    <div
      className="stage-two-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Edit Stage 2 Prices"
    >
      <section className="stage-two-modal stage-two-prices-modal">
        <header>
          <div>
            <h3>Edit Stage 2 Prices</h3>
            <p>
              {record.number} · {record.party}
            </p>
          </div>
          <button
            type="button"
            className="stage-two-close"
            onClick={onClose}
            disabled={saving}
            aria-label="Close"
          >
            ×
          </button>
        </header>
        <p className="stage-two-price-note">
          Rates default to the saved quote. Changes apply to final billing; the
          original Stage 1 quote stays available.
        </p>
        <div className="stage-two-price-fields">
          {items.map((item, index) => (
            <label key={index}>
              <span>{item.sku} — Price / Carat</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={rates[index]}
                onChange={(event) =>
                  setRates((old) =>
                    old.map((value, at) =>
                      at === index ? event.target.value : value,
                    ),
                  )
                }
              />
            </label>
          ))}
        </div>
        {error && (
          <p role="alert" className="stage-two-error">
            {error}
          </p>
        )}
        <footer>
          <button type="button" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            onClick={save}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save Stage 2 Prices"}
          </button>
        </footer>
      </section>
    </div>
  );
}
