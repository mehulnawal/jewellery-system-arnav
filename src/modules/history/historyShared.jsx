import { useState } from "react";

export const normalizeSearch = (value) =>
  String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase();

export const formatDate = (value) => {
  if (!value) return "—";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
};

export const formatWeight = (value) =>
  value === undefined || value === null || value === "" || !Number.isFinite(Number(value))
    ? "—"
    : `${Number(value).toFixed(3)} ct`;

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
export const formatCurrency = (value) =>
  value === undefined || value === null || value === "" || !Number.isFinite(Number(value))
    ? "—"
    : inr.format(Number(value));

export function HistoryDirectory({
  title,
  placeholder,
  query,
  onQuery,
  entries,
  selected,
  onSelect,
}) {
  const [open, setOpen] = useState(false);
  const normalized = normalizeSearch(query);
  const results = entries.filter((entry) => normalizeSearch(entry).includes(normalized));
  return (
    <div className="history-selector">
      <label className="history-search-label" htmlFor={`${title}-search`}>{title}</label>
      <div className="history-selector-input">
        <input id={`${title}-search`} value={query} onFocus={() => setOpen(true)} onChange={(event) => { onQuery(event.target.value); setOpen(true); }} placeholder={placeholder} type="search" />
        {selected && <button type="button" onClick={() => { onSelect(""); onQuery(""); setOpen(true); }}>Change</button>}
      </div>
      {open && <div className="history-directory-list" aria-label={`${title} results`}>
        {results.length ? (
          results.map((entry) => (
            <button
              key={entry}
              type="button"
              className={selected === entry ? "selected" : ""}
              onClick={() => { onSelect(entry); onQuery(entry); setOpen(false); }}
            >
              {entry}
            </button>
          ))
        ) : (
          <p>No {title.toLocaleLowerCase()} found{query.trim() ? ` for “${query.trim()}”` : ""}.</p>
        )}
      </div>}
    </div>
  );
}

export function HistorySummary({ cards }) {
  return (
    <div className="history-summary">
      {cards.map((card) => (
        <article key={card.label}>
          <span>{card.label}</span>
          <strong>{card.value}</strong>
        </article>
      ))}
    </div>
  );
}
