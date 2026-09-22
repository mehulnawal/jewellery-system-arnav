import { collection, onSnapshot, query, where } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { db } from "../../firebase/config";
import { useToast } from "../../ui/ToastContext";
import { PurchaseHistoryDetails } from "./HistoryDetails";
import {
  formatCurrency,
  formatDate,
  formatWeight,
  HistoryDirectory,
  HistorySummary,
} from "./historyShared";
import "./history.css";

const todayKey = () => new Date().toLocaleDateString("en-CA");
const daysAgo = (days) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toLocaleDateString("en-CA");
};
const inDateRange = (value, filter) => {
  if (!value || filter.date === "all") return true;
  const key = String(value).slice(0, 10);
  if (filter.date === "today") return key === todayKey();
  if (filter.date === "7") return key >= daysAgo(6) && key <= todayKey();
  if (filter.date === "30") return key >= daysAgo(29) && key <= todayKey();
  return (!filter.from || key >= filter.from) && (!filter.to || key <= filter.to);
};
const defaultFilters = { search: "", date: "all", from: "", to: "", broker: "all", discount: "all", sort: "newest" };

export default function VendorPurchaseHistory() {
  const toast = useToast();
  const [vendors, setVendors] = useState([]);
  const [queryText, setQueryText] = useState("");
  const [selectedVendor, setSelectedVendor] = useState("");
  const [purchases, setPurchases] = useState([]);
  const [loadedVendor, setLoadedVendor] = useState("");
  const [filters, setFilters] = useState(defaultFilters);
  const [selectedPurchase, setSelectedPurchase] = useState(null);

  useEffect(
    () => onSnapshot(collection(db, "vendors"), (snapshot) => setVendors(snapshot.docs
      .map((entry) => String(entry.data()?.name || "").trim()).filter(Boolean)
      .sort((left, right) => left.localeCompare(right))), () => toast("Vendor directory could not be loaded.", "error")),
    [toast],
  );
  useEffect(() => {
    if (!selectedVendor) {
      return undefined;
    }
    return onSnapshot(query(collection(db, "purchases"), where("vendorName", "==", selectedVendor)), (snapshot) => {
      setPurchases(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
      setLoadedVendor(selectedVendor);
    }, () => {
      setPurchases([]); setLoadedVendor(selectedVendor);
      toast("Purchase history could not be loaded for this vendor.", "error");
    });
  }, [selectedVendor, toast]);

  const sourcePurchases = useMemo(() => (loadedVendor === selectedVendor ? purchases : []), [loadedVendor, purchases, selectedVendor]);
  const brokers = useMemo(() => [...new Set(sourcePurchases.map((purchase) => String(purchase.brokerName || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [sourcePurchases]);
  const visiblePurchases = useMemo(() => sourcePurchases.filter((purchase) => {
    const needle = filters.search.trim().toLocaleLowerCase();
    const matchesText = !needle || `${purchase.purchaseId || ""} ${purchase.brokerName || ""}`.toLocaleLowerCase().includes(needle);
    const discount = Number(purchase.discount || 0);
    return matchesText && inDateRange(purchase.date, filters)
      && (filters.broker === "all" || purchase.brokerName === filters.broker)
      && (filters.discount === "all" || (filters.discount === "none" ? discount === 0 : discount > 0));
  }).sort((left, right) => {
    const dateDiff = String(right.date || "").localeCompare(String(left.date || ""));
    if (filters.sort === "oldest") return -dateDiff;
    if (filters.sort === "amount-high") return Number(right.amount || 0) - Number(left.amount || 0);
    if (filters.sort === "amount-low") return Number(left.amount || 0) - Number(right.amount || 0);
    if (filters.sort === "weight-high") return Number(right.totalWeight || 0) - Number(left.totalWeight || 0);
    if (filters.sort === "weight-low") return Number(left.totalWeight || 0) - Number(right.totalWeight || 0);
    return dateDiff;
  }), [filters, sourcePurchases]);
  const summary = useMemo(() => {
    const amount = sourcePurchases.reduce((total, purchase) => total + (Number.isFinite(Number(purchase.amount)) ? Number(purchase.amount) : 0), 0);
    const weight = sourcePurchases.reduce((total, purchase) => total + (Number.isFinite(Number(purchase.totalWeight)) ? Number(purchase.totalWeight) : 0), 0);
    return [{ label: "Total Purchases", value: sourcePurchases.length }, { label: "Total Purchase Amount", value: formatCurrency(amount) }, { label: "Total Purchase Weight", value: formatWeight(weight) }];
  }, [sourcePurchases]);
  const filtersActive = Object.entries(filters).some(([key, value]) => key !== "sort" && value !== defaultFilters[key]) || filters.sort !== "newest";

  return <section className="history-page">
    <header className="history-page-header"><h2>Vendor Purchase History</h2><p>Search a vendor to view all purchases and purchase details.</p></header>
    <HistoryDirectory title="Vendor" placeholder="Search vendor name" query={queryText} onQuery={setQueryText} entries={vendors} selected={selectedVendor} onSelect={(vendor) => { setSelectedVendor(vendor); setFilters(defaultFilters); }} />
    {!selectedVendor ? <EmptyState title="No vendor selected" text="Search and select a vendor to view purchase history." /> : <main className="history-main">
      <header className="history-selected-header"><div><small>VENDOR</small><h3>{selectedVendor}</h3></div><button type="button" onClick={() => setSelectedVendor("")}>Change vendor</button></header>
      <HistorySummary cards={summary} />
      {loadedVendor !== selectedVendor ? <EmptyState title="Loading purchase history" text="Please wait while purchases are loaded." /> : <>
        <VendorFilters filters={filters} setFilters={setFilters} brokers={brokers} showReset={filtersActive} />
        <section className="history-table-section"><div className="history-section-heading"><h3>Purchase History</h3><span>{visiblePurchases.length} of {sourcePurchases.length} purchases</span></div>
          {visiblePurchases.length ? <PurchaseTable rows={visiblePurchases} onDetails={setSelectedPurchase} /> : <FilteredEmpty onReset={() => setFilters(defaultFilters)} filtered={filtersActive} />}
        </section>
      </>}
    </main>}
    {selectedPurchase && <PurchaseHistoryDetails record={selectedPurchase} onClose={() => setSelectedPurchase(null)} />}
  </section>;
}

function VendorFilters({ filters, setFilters, brokers, showReset }) {
  const update = (key) => (event) => setFilters((current) => ({ ...current, [key]: event.target.value }));
  return <section className="history-filters" aria-label="Purchase history filters">
    <input value={filters.search} onChange={update("search")} placeholder="Search Purchase ID / Broker" type="search" />
    <select value={filters.date} onChange={update("date")}><option value="all">All dates</option><option value="today">Today</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="custom">Custom date range</option></select>
    {filters.date === "custom" && <><input aria-label="From date" value={filters.from} onChange={update("from")} type="date" /><input aria-label="To date" value={filters.to} onChange={update("to")} type="date" /></>}
    <select value={filters.broker} onChange={update("broker")}><option value="all">All brokers</option>{brokers.map((broker) => <option key={broker} value={broker}>{broker}</option>)}</select>
    <select value={filters.discount} onChange={update("discount")}><option value="all">All discounts</option><option value="none">No discount</option><option value="with">With discount</option></select>
    <select value={filters.sort} onChange={update("sort")}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="amount-high">Amount: high to low</option><option value="amount-low">Amount: low to high</option><option value="weight-high">Weight: high to low</option><option value="weight-low">Weight: low to high</option></select>
    {showReset && <button type="button" className="history-reset" onClick={() => setFilters(defaultFilters)}>Reset</button>}
  </section>;
}

function PurchaseTable({ rows, onDetails }) { return <div className="history-table-wrap"><table><thead><tr><th>Purchase ID</th><th>Date</th><th>Broker</th><th>Total Weight</th><th>Amount</th><th>Discount</th><th>Net Payable</th><th>Due Date</th><th>Details</th></tr></thead><tbody>{rows.map((purchase) => <tr key={purchase.id}><td><strong>{purchase.purchaseId || "—"}</strong></td><td>{formatDate(purchase.date)}</td><td>{purchase.brokerName || "—"}</td><td>{formatWeight(purchase.totalWeight)}</td><td>{formatCurrency(purchase.amount)}</td><td>{Number(purchase.discount || 0)}%</td><td>{formatCurrency(purchase.netPayable)}</td><td>{formatDate(purchase.paymentDueDate)}</td><td><button type="button" onClick={() => onDetails(purchase)}>Details</button></td></tr>)}</tbody></table></div>; }
function EmptyState({ title, text }) { return <div className="history-empty"><strong>{title}</strong><p>{text}</p></div>; }
function FilteredEmpty({ filtered, onReset }) { return <div className="history-empty"><strong>{filtered ? "No purchases match the selected filters." : "No purchases found for this vendor."}</strong>{filtered && <button type="button" onClick={onReset}>Clear filters</button>}</div>; }
