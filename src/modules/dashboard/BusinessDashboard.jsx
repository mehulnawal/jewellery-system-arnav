import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { useNavigate } from "react-router-dom";
import { useBusinessAvailability } from "../../hooks/useBusinessAvailability.js";
import { useAuth } from "../../auth/AuthContext";
import { db } from "../../firebase/config";
import {
  buildDashboardAnalytics,
  dayKey,
} from "../../utils/dashboardAnalytics";
import "./businessDashboard.css";

const CHALLAN_KEYS = [1, 2, 3, 4];
const EMPTY_RESULT = { rows: [], loading: false, error: "" };
const weight = (value) =>
  `${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 3 })} ct`;
const money = (value) =>
  `₹${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const percent = (value) =>
  value === null || value === undefined ? "No data" : `${Math.round(value)}%`;
const shortDate = (value) =>
  value
    ? new Date(`${value}T12:00:00`).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "Date unknown";

function useDashboardRecords(name, enabled) {
  const [result, setResult] = useState({
    rows: [],
    loading: enabled,
    error: "",
  });
  useEffect(() => {
    if (!enabled) return undefined;
    return onSnapshot(
      collection(db, name),
      (snapshot) => {
        setResult({
          rows: snapshot.docs.map((entry) => ({
            id: entry.id,
            ...entry.data(),
          })),
          loading: false,
          error: "",
        });
      },
      (error) => {
        setResult({
          rows: [],
          loading: false,
          error:
            error.code === "permission-denied"
              ? "Access to this data was denied. Ask an administrator to check your permissions."
              : "This data could not be loaded. Try again shortly.",
        });
      },
    );
  }, [name, enabled]);
  return enabled ? result : EMPTY_RESULT;
}

function Section({ title, subtitle, action, children, className = "" }) {
  return (
    <section className={`business-card ${className}`}>
      <header className="business-card-head">
        <div>
          <h3>{title}</h3>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}
function Empty({ children }) {
  return <p className="business-empty">{children}</p>;
}
function Bar({ value, max, tone = "green" }) {
  return (
    <span className="business-bar-track">
      <span
        className={`business-bar ${tone}`}
        style={{
          width: `${max > 0 && value > 0 ? Math.min(100, (value / max) * 100) : 0}%`,
        }}
      />
    </span>
  );
}
function LinkButton({ children, onClick }) {
  return (
    <button className="business-text-link" type="button" onClick={onClick}>
      {children}
      <span aria-hidden="true"> →</span>
    </button>
  );
}

export default function BusinessDashboard() {
  const { user } = useAuth();
  const availability = useBusinessAvailability();
  const navigate = useNavigate();
  const isAdmin = user?.role === "superadmin";
  const canInventory =
    isAdmin || Boolean(user?.permissions?.includes("inventory"));
  const canPurchase =
    isAdmin || Boolean(user?.permissions?.includes("purchase"));
  const permittedStages = useMemo(
    () =>
      CHALLAN_KEYS.filter(
        (stage) =>
          isAdmin || user?.permissions?.includes(`challan-stage-${stage}`),
      ),
    [isAdmin, user?.permissions],
  );
  const canChallan = permittedStages.length > 0;
  const inventory = useDashboardRecords("inventory", canInventory);
  const purchases = useDashboardRecords("purchases", canPurchase);
  const challans = useDashboardRecords("challans", canChallan);
  const inventoryReady = canInventory && !inventory.loading && !inventory.error;
  const purchaseReady = canPurchase && !purchases.loading && !purchases.error;
  const challanReady = canChallan && !challans.loading && !challans.error;
  const [period, setPeriod] = useState("30");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, []);
  const from =
    period === "custom"
      ? customFrom
      : dayKey(now - (Number(period) - 1) * 86400000);
  const to = period === "custom" ? customTo : dayKey(now);
  const periodValid = Boolean(from && to && from <= to);
  const visibleChallans = useMemo(
    () =>
      isAdmin
        ? challans.rows
        : challans.rows.filter((entry) =>
            permittedStages.includes(Number(entry.stage) || 1),
          ),
    [challans.rows, isAdmin, permittedStages],
  );
  const canChallanHistory = isAdmin || permittedStages.length === 4;
  const historyReady = canChallanHistory && challanReady;
  const movementAvailable = historyReady;
  const analytics = useMemo(
    () =>
      buildDashboardAnalytics({
        inventory: inventory.rows,
        purchases: purchases.rows,
        challans: visibleChallans,
        from: periodValid ? from : "9999-12-31",
        to: periodValid ? to : "9999-12-31",
        now,
        movementAvailable,
      }),
    [
      inventory.rows,
      purchases.rows,
      visibleChallans,
      from,
      to,
      periodValid,
      now,
      movementAvailable,
    ],
  );
  const loading = inventory.loading || purchases.loading || challans.loading;
  const errors = [inventory.error, purchases.error, challans.error].filter(
    Boolean,
  );
  const hasAttention = Boolean(
    (challanReady &&
      (analytics.oldChallans.d5 ||
        analytics.oldChallans.h60 ||
        analytics.oldChallans.h24)) ||
    (challanReady && permittedStages.includes(3) && analytics.stage[2].count) ||
    (purchaseReady && analytics.purchaseDue.overdue.count) ||
    (inventoryReady && analytics.aged90.weight),
  );
  const go = (path, state) => navigate(path, { state });
  const inventoryPath = "/dashboard/inventory",
    purchasePath = "/dashboard/purchase",
    challanPath = "/dashboard/challan";
  const periodLabel = periodValid
    ? `${shortDate(from)} to ${shortDate(to)}`
    : "Choose a valid date range";
  return (
    <div className="business-dashboard">
      <header className="business-hero">
        <div>
          <span className="business-eyebrow">BUSINESS CONTROL CENTER</span>
          <h2>Dashboard</h2>
          <p>Stock movement, Party conversion and work that needs attention.</p>
        </div>
        <div className="business-period">
          <label htmlFor="business-period">Analysis period</label>
          <select
            id="business-period"
            value={period}
            onChange={(event) => setPeriod(event.target.value)}
          >
            <option value="7">7 Days</option>
            <option value="30">30 Days</option>
            <option value="90">90 Days</option>
            <option value="custom">Custom</option>
          </select>
          {period === "custom" && (
            <div className="business-custom">
              <input
                aria-label="Period start"
                type="date"
                value={customFrom}
                onChange={(event) => setCustomFrom(event.target.value)}
              />
              <input
                aria-label="Period end"
                type="date"
                value={customTo}
                onChange={(event) => setCustomTo(event.target.value)}
              />
            </div>
          )}
          <small>{periodLabel}</small>
        </div>
        <div className="business-quick">
          <h3>Quick Actions</h3>
          <div className="business-actions">
            {canInventory && (
              <button
                onClick={() => go(inventoryPath, { dashboardAction: "add" })}
              >
                + Add Inventory
              </button>
            )}
            {canChallan && permittedStages.includes(1) && (
              <button
                onClick={() => go(challanPath, { dashboardAction: "create" })}
              >
                + Create Challan
              </button>
            )}
            {canPurchase && (
              <button
                onClick={() => go(purchasePath, { dashboardAction: "create" })}
              >
                + Create Purchase
              </button>
            )}
            {!canInventory && !canPurchase && !permittedStages.includes(1) && (
              <Empty>No create actions are assigned to this account.</Empty>
            )}
          </div>
        </div>
      </header>
      {loading && (
        <p className="business-notice" role="status">
          Loading current business data...
        </p>
      )}
      {errors.map((error, index) => (
        <p className="business-error" role="alert" key={`${error}-${index}`}>
          {error}
        </p>
      ))}
      {!isAdmin && canChallan && (
        <p className="business-notice">
          Current Challan figures include only your assigned stages. Full sales
          and Party history needs access to all four stages.
        </p>
      )}
      <div className="business-live-strip">
        <span>
          <i className={availability.phase === "ready" && !loading && !errors.length ? "" : "is-stale"} /> {availability.phase === "ready" && !loading && !errors.length ? "Live operational state" : "Operational snapshot"}
        </span>
        {inventoryReady && (
          <strong>{weight(analytics.currentStock)} available stock</strong>
        )}
        {challanReady && permittedStages.includes(3) && (
          <strong>{analytics.stage[2].count} S3 payments pending</strong>
        )}
        {purchaseReady && (
          <strong>{analytics.purchaseDue.overdue.count} past due dates</strong>
        )}
      </div>

      {(historyReady || inventoryReady) && (
        <div
          className={`business-grid ${historyReady && inventoryReady ? "business-primary-grid" : ""}`}
        >
          {historyReady && (
            <Section
              title="Inventory Performance"
              subtitle="Top combinations by actual sold weight in the selected period"
              action={
                <LinkButton onClick={() => go(challanPath)}>
                  View Challans
                </LinkButton>
              }
            >
              <div className="business-chart">
                {analytics.performance.length ? (
                  analytics.performance.map((row) => (
                    <div
                      className="business-bar-row"
                      key={row.key}
                      title={`${row.key}: ${weight(row.sold)} sold, ${weight(row.returned)} returned, ${weight(row.sent)} sent, ${percent(row.conversion)} conversion`}
                    >
                      <div className="business-bar-label">
                        <strong>{row.key}</strong>
                        <span>{weight(row.sold)} sold</span>
                      </div>
                      <Bar
                        value={row.sold}
                        max={analytics.performance[0].sold}
                      />
                      <small>
                        {weight(row.sent)} sent · {weight(row.returned)}{" "}
                        returned · {percent(row.conversion)} conversion
                        {inventoryReady && <> · {weight(row.stock)} in stock</>}
                      </small>
                    </div>
                  ))
                ) : (
                  <Empty>No Challan sales data yet for this period.</Empty>
                )}
              </div>
              {analytics.processed.excludedRows > 0 && (
                <small className="business-footnote">
                  {analytics.processed.excludedRows} historical item rows have
                  incomplete or inconsistent S2 weights and were excluded.
                </small>
              )}
              {analytics.processed.undatedRows > 0 && (
                <small className="business-footnote">
                  {analytics.processed.undatedRows} historical S2 item rows have
                  no transition date and were excluded from period charts.
                </small>
              )}
            </Section>
          )}
          {inventoryReady && (
            <Section
              title="Inventory Aging"
              subtitle="Current available weight by stock age. Unaffected by analysis period."
            >
              <div className="business-aging-chart">
                {analytics.aging.map((bucket) => (
                  <button
                    className={`business-aging-row ${bucket.weight === 0 ? "is-zero" : "has-stock"}`}
                    type="button"
                    key={bucket.label}
                    title={`${bucket.label}: ${weight(bucket.weight)} available across ${bucket.count} SKUs`}
                    onClick={() =>
                      go(inventoryPath, { dashboardAgeBucket: bucket.label })
                    }
                  >
                    <span>{bucket.label}</span>
                    <Bar
                      value={bucket.weight}
                      max={Math.max(
                        ...analytics.aging.map((entry) => entry.weight),
                      )}
                      tone={
                        bucket.min > 90
                          ? "red"
                          : bucket.min > 60
                            ? "amber"
                            : "green"
                      }
                    />
                    <strong>{weight(bucket.weight)}</strong>
                    <small>{bucket.count} SKUs</small>
                  </button>
                ))}
              </div>
              {analytics.unknownAgeCount > 0 && (
                <small className="business-footnote">
                  {analytics.unknownAgeCount} SKUs have no saved creation date,
                  so their age is unknown.
                </small>
              )}
              {analytics.invalidStockCount > 0 && (
                <small className="business-footnote">
                  {analytics.invalidStockCount} Inventory records have invalid
                  saved weight and were excluded from stock totals.
                </small>
              )}
            </Section>
          )}
        </div>
      )}
      {(inventoryReady || purchaseReady || challanReady) && (
        <>
          <Section
            title="Attention Required"
            className="business-attention-card"
            subtitle="Current work and due-date signals"
          >
            <div className="business-attention">
              {challanReady && (
                <>
                  {analytics.oldChallans.d5 > 0 && (
                    <button
                      onClick={() => go(challanPath, { dashboardAge: "5d" })}
                    >
                      <span>Challans 5+ days old</span>
                      <strong>{analytics.oldChallans.d5}</strong>
                      <small>S1/S2 still active</small>
                    </button>
                  )}
                  {analytics.oldChallans.h60 > 0 && (
                    <button
                      onClick={() => go(challanPath, { dashboardAge: "60h" })}
                    >
                      <span>Challans 60h+ old</span>
                      <strong>{analytics.oldChallans.h60}</strong>
                      <small>Under 5 days</small>
                    </button>
                  )}
                  {analytics.oldChallans.h24 > 0 && (
                    <button
                      onClick={() => go(challanPath, { dashboardAge: "24h" })}
                    >
                      <span>Challans 24h+ old</span>
                      <strong>{analytics.oldChallans.h24}</strong>
                      <small>Under 60 hours</small>
                    </button>
                  )}
                  {permittedStages.includes(3) &&
                    analytics.stage[2].count > 0 && (
                      <button
                        onClick={() => go(challanPath, { dashboardStage: 3 })}
                      >
                        <span>S3 payment pending</span>
                        <strong>{analytics.stage[2].count}</strong>
                        <small>
                          {money(analytics.stage[2].amount)} on saved invoices
                        </small>
                      </button>
                    )}
                </>
              )}
              {purchaseReady && analytics.purchaseDue.overdue.count > 0 && (
                <button
                  onClick={() => go(purchasePath, { dashboardDue: "overdue" })}
                >
                  <span>Past Purchase due date</span>
                  <strong>{analytics.purchaseDue.overdue.count}</strong>
                  <small>
                    {money(analytics.purchaseDue.overdue.amount)} scheduled
                  </small>
                </button>
              )}
              {inventoryReady && analytics.aged90.weight > 0 && (
                <button
                  onClick={() =>
                    go(inventoryPath, { dashboardAgeBucket: "90+ days" })
                  }
                >
                  <span>Inventory older than 90 days</span>
                  <strong>{weight(analytics.aged90.weight)}</strong>
                  <small>{analytics.aged90.count} SKUs</small>
                </button>
              )}
            </div>
            {!hasAttention && <Empty>No current items need attention.</Empty>}
          </Section>
          {inventoryReady && (
            <Section
              title="Clear First"
              subtitle={
                movementAvailable
                  ? "Current stock ranked by age, volume, recent Challan movement and returns"
                  : "Current stock ranked by age and volume"
              }
              action={
                <LinkButton onClick={() => go(inventoryPath)}>
                  View Inventory
                </LinkButton>
              }
            >
              {analytics.clearFirst.length > 0 && (
                <div className="business-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Inventory</th>
                        <th>Stock</th>
                        <th>Age</th>
                        <th>Last movement</th>
                        <th>Sold / Returned</th>
                        <th>Return</th>
                        <th>Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analytics.clearFirst.map((row) => (
                        <tr
                          key={row.id}
                          onClick={() =>
                            go(inventoryPath, { dashboardSku: row.sku })
                          }
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              go(inventoryPath, { dashboardSku: row.sku });
                            }
                          }}
                          role="link"
                          tabIndex={0}
                          className="business-click-row"
                        >
                          <td>
                            <strong>{row.sku || row.key}</strong>
                            <small>{row.key}</small>
                          </td>
                          <td>{weight(row.stock)}</td>
                          <td>{row.ageDays} days</td>
                          <td>
                            {row.lastMovement
                              ? new Date(row.lastMovement).toLocaleDateString(
                                  "en-IN",
                                )
                              : movementAvailable
                                ? "No Challan movement"
                                : "Unavailable"}
                          </td>
                          <td>
                            {movementAvailable
                              ? `${weight(row.sold)} / ${weight(row.returned)}`
                              : "Unavailable"}
                          </td>
                          <td>
                            {movementAvailable
                              ? percent(row.returnRate)
                              : "Unavailable"}
                          </td>
                          <td>
                            <div
                              className="business-reason-tags"
                              title={row.reason}
                            >
                              {row.reason.split(" + ").map((reason) => (
                                <span key={reason}>
                                  {/days in stock/.test(reason)
                                    ? "Old stock"
                                    : /ct available/.test(reason)
                                      ? "High stock"
                                      : /movement/.test(reason)
                                        ? "No movement"
                                        : /returned/.test(reason)
                                          ? "High return"
                                          : /No sale/.test(reason)
                                            ? "No sale"
                                            : reason}
                                </span>
                              ))}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {!analytics.clearFirst.length && (
                <Empty>No current inventory meets the priority signals.</Empty>
              )}
            </Section>
          )}
        </>
      )}

      {challanReady && (
        <div
          className={`business-grid ${historyReady ? "business-two-grid" : ""}`}
        >
          {historyReady && (
            <Section
              title="Party Performance"
              subtitle="Processed S2 goods in this period. Strong means 60%+ sell-through; high return means 50%+ returned. Both require 3 ct across 2 Challans."
            >
              {!analytics.strongParties.length &&
              !analytics.highReturnParties.length ? (
                <Empty>
                  More processed Challan history is needed to rank Parties.
                </Empty>
              ) : (
                <div className="business-party-grid">
                  <div>
                    <h4>Strong Parties</h4>
                    {analytics.strongParties.length ? (
                      analytics.strongParties.map((party) => (
                        <div className="business-party" key={party.name}>
                          <strong>{party.name}</strong>
                          <Bar value={party.conversion} max={100} />
                          <small>
                            Sent {weight(party.sent)} · Sold{" "}
                            {weight(party.sold)} · Returned{" "}
                            {weight(party.returned)}
                          </small>
                          <span>
                            Sell-through {percent(party.conversion)} · Return{" "}
                            {percent(party.returnRate)}
                          </span>
                        </div>
                      ))
                    ) : (
                      <Empty>
                        Not enough Party history to rank conversion.
                      </Empty>
                    )}
                  </div>
                  <div>
                    <h4>High Return Parties</h4>
                    {analytics.highReturnParties.length ? (
                      analytics.highReturnParties.map((party) => (
                        <div className="business-party" key={party.name}>
                          <strong>{party.name}</strong>
                          <Bar
                            value={party.returnRate}
                            max={100}
                            tone="amber"
                          />
                          <small>
                            Sent {weight(party.sent)} · Sold{" "}
                            {weight(party.sold)} · Returned{" "}
                            {weight(party.returned)}
                          </small>
                          <span>
                            Return {percent(party.returnRate)} · Sell-through{" "}
                            {percent(party.conversion)}
                          </span>
                        </div>
                      ))
                    ) : (
                      <Empty>Not enough Party history to rank returns.</Empty>
                    )}
                  </div>
                </div>
              )}
            </Section>
          )}
          <Section
            title="Challan Performance"
            subtitle={
              historyReady
                ? "Processed S2 weight in the selected period; stage cards show current state"
                : "Current assigned Challan stages"
            }
          >
            {historyReady && (
              <div className="business-metric-grid">
                <div>
                  <span>Goods sent</span>
                  <strong>
                    {analytics.processed.sent
                      ? weight(analytics.processed.sent)
                      : "No data"}
                  </strong>
                </div>
                <div>
                  <span>Sold</span>
                  <strong>
                    {analytics.processed.sent
                      ? weight(analytics.processed.sold)
                      : "No data"}
                  </strong>
                </div>
                <div>
                  <span>Returned</span>
                  <strong>
                    {analytics.processed.sent
                      ? weight(analytics.processed.returned)
                      : "No data"}
                  </strong>
                </div>
                <div>
                  <span>Sale conversion</span>
                  <strong>{percent(analytics.processed.conversion)}</strong>
                </div>
              </div>
            )}
            <div className="business-stage-grid">
              {[
                "S1 Goods Out",
                "S2 Return / Sale",
                "S3 Payment Pending",
                "S4 Completed",
              ]
                .map((label, index) => ({ label, index }))
                .filter(
                  ({ index }) => isAdmin || permittedStages.includes(index + 1),
                )
                .map(({ label, index }) => (
                  <button
                    type="button"
                    key={label}
                    onClick={() =>
                      go(challanPath, { dashboardStage: index + 1 })
                    }
                    disabled={!isAdmin && !permittedStages.includes(index + 1)}
                  >
                    <span>{label}</span>
                    <strong>{analytics.stage[index].count} Challans</strong>
                    <small>
                      {index === 0
                        ? `${weight(analytics.stage[0].weight)} currently out`
                        : index === 1
                          ? `${weight(analytics.stage[1].sold)} sold · ${weight(analytics.stage[1].returned)} returned`
                          : index === 2
                            ? `${money(analytics.stage[2].amount)} invoiced`
                            : `${analytics.completedInPeriod} completed in period`}
                    </small>
                  </button>
                ))}
            </div>
            {analytics.stage[2].missingAmount > 0 && (
              <small className="business-footnote">
                {analytics.stage[2].missingAmount} S3 Challans have no saved
                final invoice amount.
              </small>
            )}
          </Section>
        </div>
      )}

      {purchaseReady && (
        <div className="business-grid business-two-grid">
          <Section
            title="Purchase Due Overview"
            subtitle="Due-date schedule. Purchase payment settlement is not tracked in saved records."
            action={
              <LinkButton onClick={() => go(purchasePath)}>
                View Purchases
              </LinkButton>
            }
          >
            <div className="business-due-summary">
              {[
                ["overdue", "Past due date"],
                ["today", "Due today"],
                ["next7", "Next 7 days"],
              ].map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => go(purchasePath, { dashboardDue: key })}
                >
                  <span>{label}</span>
                  <strong>{analytics.purchaseDue[key].count} Purchases</strong>
                  <small>
                    {money(analytics.purchaseDue[key].amount)} scheduled
                  </small>
                </button>
              ))}
            </div>
            {analytics.purchaseDue.rows.length > 0 && (
              <div className="business-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Purchase No.</th>
                      <th>Vendor</th>
                      <th>Due date</th>
                      <th>Final payable</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.purchaseDue.rows.slice(0, 5).map((row) => (
                      <tr
                        key={row.id}
                        className="business-click-row"
                        onClick={() =>
                          go(purchasePath, { viewPurchaseId: row.id })
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            go(purchasePath, { viewPurchaseId: row.id });
                          }
                        }}
                        role="link"
                        tabIndex={0}
                      >
                        <td>{row.purchaseId}</td>
                        <td>{row.vendorName}</td>
                        <td>{shortDate(row.paymentDueDate)}</td>
                        <td>
                          {row.netPayable === undefined
                            ? "Unknown"
                            : money(row.netPayable)}
                        </td>
                        <td>
                          {row.dueStatus === "overdue"
                            ? "Past due date"
                            : row.dueStatus === "today"
                              ? "Due today"
                              : "Upcoming"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {!analytics.purchaseDue.rows.length && (
              <Empty>
                No Purchases have a due date within the next 7 days or earlier.
              </Empty>
            )}
            {analytics.purchaseDue.unknownAmount > 0 && (
              <small className="business-footnote">
                {analytics.purchaseDue.unknownAmount} due Purchases have no
                valid payable amount.
              </small>
            )}
          </Section>
          <Section
            title="Largest Purchases"
            subtitle="Top 3 by total Purchase weight in the selected period"
          >
            {analytics.largestPurchases.length ? (
              <div className="business-purchase-list">
                {analytics.largestPurchases.map((row, index) => (
                  <button
                    type="button"
                    key={row.id}
                    onClick={() => go(purchasePath, { viewPurchaseId: row.id })}
                  >
                    <span className="business-rank">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span>
                      <strong>{row.purchaseId || "Purchase"}</strong>
                      <small>
                        {row.vendorName || "Vendor unknown"} ·{" "}
                        {shortDate(row.date)}
                      </small>
                    </span>
                    <span>
                      <strong>{weight(row.totalWeight)}</strong>
                      <small>
                        {row.netPayable === undefined
                          ? "Payable unknown"
                          : money(row.netPayable)}
                        {row.avgCost !== null &&
                          ` · Avg ${money(row.avgCost)} / ct`}
                      </small>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <Empty>No Purchases with valid weight in this period.</Empty>
            )}
          </Section>
        </div>
      )}

      {inventoryReady && historyReady && (
        <Section
          title="Risk & Opportunity"
          subtitle="Factual signals from current stock and processed S2 movement"
        >
          {!analytics.atRisk.length && !analytics.movingStrongly.length ? (
            <Empty>No current risk or strong-movement signals.</Empty>
          ) : (
            <div className="business-risk-grid">
              <div>
                <h4>At Risk</h4>
                {analytics.atRisk.length ? (
                  analytics.atRisk.map((row) => (
                    <div className="business-signal" key={row.key}>
                      <strong>{row.key}</strong>
                      <span>
                        {weight(row.stock)} in stock · Oldest {row.oldestDays}{" "}
                        days
                      </span>
                      <small>
                        {row.sent >= 3
                          ? `${percent(row.returnRate)} of sent weight returned`
                          : "Limited sale history"}
                      </small>
                    </div>
                  ))
                ) : (
                  <Empty>No stock meets the current risk signals.</Empty>
                )}
              </div>
              <div>
                <h4>Moving Strongly</h4>
                {analytics.movingStrongly.length ? (
                  analytics.movingStrongly.map((row) => (
                    <div className="business-signal" key={row.key}>
                      <strong>{row.key}</strong>
                      <span>
                        {weight(row.sold)} sold · {percent(row.conversion)}{" "}
                        sell-through
                      </span>
                      <small>{weight(row.stock)} currently available</small>
                    </div>
                  ))
                ) : (
                  <Empty>
                    No combination has enough sale history for this signal.
                  </Empty>
                )}
              </div>
            </div>
          )}
        </Section>
      )}
    </div>
  );
}
