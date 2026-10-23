import { useEffect, useMemo, useRef, useState } from "react";
import { dayKey } from "../../utils/dashboardAnalytics.js";
import {
  buildGoodsWithCustomers,
  formatCustomerGoodsWeight as weight,
} from "../../utils/goodsWithCustomers.js";

const dateLabel = (date) =>
  date
    ? new Date(`${date}T12:00:00`).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "Date unknown";

export default function GoodsWithCustomers({ records, loading, error }) {
  const [search, setSearch] = useState("");
  const [defaultFrom, setDefaultFrom] = useState(() => dayKey(Date.now()));
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState("");
  const [sort, setSort] = useState("carat-desc");
  const [selected, setSelected] = useState(null);
  const dialog = useRef(null);
  const result = useMemo(
    () => buildGoodsWithCustomers(records, { search, from, to, sort }),
    [records, search, from, to, sort],
  );
  const active = result.rows.find((row) => row.key === selected);
  const invalidRange = Boolean(from && to && from > to);
  const changed =
    search || from !== defaultFrom || to || sort !== "carat-desc";
  useEffect(() => {
    if (selected) dialog.current?.showModal();
    else dialog.current?.close();
  }, [selected]);
  const clear = () => {
    setSearch("");
    const today = dayKey(Date.now());
    setDefaultFrom(today);
    setFrom(today);
    setTo("");
    setSort("carat-desc");
  };
  return (
    <section
      className="business-card customer-goods"
      aria-labelledby="customer-goods-title"
    >
      <header className="business-card-head">
        <div>
          <h3 id="customer-goods-title">Goods With Customers</h3>
          <p>Current Stage 1 goods pending customer decision.</p>
        </div>
      </header>
      <div className="customer-goods-controls">
        <label>
          Search SKU
          <input
            placeholder="Search SKU"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label>
          From Date
          <input
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
        </label>
        <label>
          To Date
          <input
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
        </label>
        <label>
          Sort
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value)}
          >
            <option value="carat-desc">Total Carat: High to Low</option>
            <option value="carat-asc">Total Carat: Low to High</option>
            <option value="sku-asc">SKU: A to Z</option>
            <option value="sku-desc">SKU: Z to A</option>
          </select>
        </label>
        {changed && (
          <button type="button" className="business-text-link" onClick={clear}>
            Clear Filters
          </button>
        )}
      </div>
      {loading ? (
        <p className="business-empty" role="status">
          Loading goods with customers…
        </p>
      ) : error ? (
        <p className="business-empty" role="alert">
          Goods with customers could not be loaded. Try again shortly.
        </p>
      ) : invalidRange ? (
        <p className="business-empty" role="alert">
          From Date must be on or before To Date.
        </p>
      ) : (
        <>
          {result.excludedItems > 0 && (
            <p className="business-footnote" role="status">
              {result.excludedItems} item(s) omitted because SKU or issued
              weight is unavailable or invalid.
            </p>
          )}
          {result.undatedRecords > 0 && (
            <p className="business-footnote">
              {result.undatedRecords} Stage 1 record(s) have an unknown issue
              date and are excluded when date filters are active.
            </p>
          )}
          {result.rows.length ? (
            <table className="customer-goods-table">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Total Carat</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row) => (
                  <tr key={row.key}>
                    <td data-label="SKU">{row.sku}</td>
                    <td data-label="Total Carat">{weight(row.carat)}</td>
                    <td>
                      <button
                        type="button"
                        className="business-text-link"
                        aria-label={`View Details for ${row.sku}`}
                        onClick={() => setSelected(row.key)}
                      >
                        View Details
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="business-empty">
              {search || from || to
                ? "No Stage 1 goods match the current filters."
                : "No goods are currently pending with customers in Stage 1."}
            </p>
          )}
        </>
      )}
      <dialog
        ref={dialog}
        className="customer-goods-dialog"
        aria-labelledby="customer-goods-detail-title"
        onClose={() => setSelected(null)}
      >
        <header className="business-card-head">
          <h3 id="customer-goods-detail-title">
            Goods With Customers — {active?.sku || "Stage 1 Details"}
          </h3>
          <button
            type="button"
            className="business-text-link"
            onClick={() => setSelected(null)}
          >
            Close
          </button>
        </header>
        {loading ? (
          <p role="status">Loading goods with customers…</p>
        ) : error ? (
          <p role="alert">Goods with customers could not be loaded.</p>
        ) : active ? (
          <>
            <p>
              Currently With Customers: <strong>{weight(active.carat)}</strong>
            </p>
            <table className="customer-goods-table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Carat</th>
                  <th>Date Issued</th>
                  <th>Challan No.</th>
                </tr>
              </thead>
              <tbody>
                {active.details.map((row, index) => (
                  <tr key={index}>
                    <td data-label="Customer">{row.customer}</td>
                    <td data-label="Carat">{weight(row.carat)}</td>
                    <td data-label="Date Issued">{dateLabel(row.date)}</td>
                    <td data-label="Challan No.">{row.number}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <p>No Stage 1 goods match this SKU in the current filters.</p>
        )}
      </dialog>
    </section>
  );
}
