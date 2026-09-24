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

export const formatWeight = (value) => `${Number(value || 0).toFixed(3)} ct`;

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
export const formatCurrency = (value) => inr.format(Number(value || 0));

export function HistoryDirectory({
  title,
  placeholder,
  query,
  onQuery,
  entries,
  selected,
  onSelect,
}) {
  const normalized = normalizeSearch(query);
  const results = entries.filter((entry) =>
    normalizeSearch(entry).includes(normalized),
  );
  return (
    <aside className="history-directory">
      <label className="history-search-label" htmlFor={`${title}-search`}>
        {title} directory
      </label>
      <input
        id={`${title}-search`}
        value={query}
        onChange={(event) => onQuery(event.target.value)}
        placeholder={placeholder}
        type="search"
      />
      <div className="history-directory-list" aria-label={`${title} results`}>
        {results.length ? (
          results.map((entry) => (
            <button
              key={entry}
              type="button"
              className={selected === entry ? "selected" : ""}
              onClick={() => onSelect(entry)}
            >
              {entry}
            </button>
          ))
        ) : (
          <p>
            No {title.toLocaleLowerCase()} found
            {query.trim() ? ` for “${query.trim()}”` : ""}.
          </p>
        )}
      </div>
    </aside>
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
