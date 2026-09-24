import { collection, onSnapshot, query, where } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { db } from "../../firebase/config";
import { useToast } from "../../ui/ToastContext";
import {
  formatCurrency,
  formatDate,
  formatWeight,
  HistoryDirectory,
  HistorySummary,
} from "./historyShared";
import "./history.css";

export default function VendorPurchaseHistory() {
  const toast = useToast();
  const navigate = useNavigate();
  const [vendors, setVendors] = useState([]);
  const [queryText, setQueryText] = useState("");
  const [selectedVendor, setSelectedVendor] = useState("");
  const [purchases, setPurchases] = useState([]);
  const [loadedVendor, setLoadedVendor] = useState("");

  useEffect(
    () =>
      onSnapshot(
        collection(db, "vendors"),
        (snapshot) =>
          setVendors(
            snapshot.docs
              .map((entry) => String(entry.data()?.name || "").trim())
              .filter(Boolean)
              .sort((left, right) => left.localeCompare(right)),
          ),
        () => toast("Vendor directory could not be loaded.", "error"),
      ),
    [toast],
  );

  useEffect(() => {
    if (!selectedVendor) return undefined;
    return onSnapshot(
      query(
        collection(db, "purchases"),
        where("vendorName", "==", selectedVendor),
      ),
      (snapshot) => {
        setPurchases(
          snapshot.docs
            .map((entry) => ({ id: entry.id, ...entry.data() }))
            .sort((left, right) =>
              String(right.date || "").localeCompare(String(left.date || "")),
            ),
        );
        setLoadedVendor(selectedVendor);
      },
      () => {
        setPurchases([]);
        setLoadedVendor(selectedVendor);
        toast("Purchase history could not be loaded for this vendor.", "error");
      },
    );
  }, [selectedVendor, toast]);

  const visiblePurchases = useMemo(
    () => (loadedVendor === selectedVendor ? purchases : []),
    [loadedVendor, purchases, selectedVendor],
  );
  const summary = useMemo(() => {
    const amount = visiblePurchases.reduce(
      (total, purchase) =>
        total +
        (Number.isFinite(Number(purchase.amount))
          ? Number(purchase.amount)
          : 0),
      0,
    );
    const weight = visiblePurchases.reduce(
      (total, purchase) =>
        total +
        (Number.isFinite(Number(purchase.totalWeight))
          ? Number(purchase.totalWeight)
          : 0),
      0,
    );
    return [
      { label: "Total Purchases", value: visiblePurchases.length },
      { label: "Total Purchase Amount", value: formatCurrency(amount) },
      { label: "Total Purchase Weight", value: formatWeight(weight) },
    ];
  }, [visiblePurchases]);

  return (
    <section className="history-page">
      <header className="history-page-header">
        <h2>Vendor Purchase History</h2>
        <p>Search a vendor to view all purchases and purchase details.</p>
      </header>
      <div className="history-layout">
        <HistoryDirectory
          title="Vendor"
          placeholder="Search vendor name"
          query={queryText}
          onQuery={setQueryText}
          entries={vendors}
          selected={selectedVendor}
          onSelect={setSelectedVendor}
        />
        <main className="history-main">
          {!selectedVendor ? (
            <div className="history-empty">
              Select a vendor to view purchase history.
            </div>
          ) : (
            <>
              <header className="history-selected-header">
                <small>VENDOR</small>
                <h3>{selectedVendor}</h3>
              </header>
              <HistorySummary cards={summary} />
              <section className="history-table-section">
                <div className="history-section-heading">
                  <h3>Purchase History</h3>
                  <span>Newest first</span>
                </div>
                {loadedVendor !== selectedVendor ? (
                  <div className="history-empty">Loading purchase history…</div>
                ) : visiblePurchases.length ? (
                  <div className="history-table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Purchase ID</th>
                          <th>Date</th>
                          <th>Broker</th>
                          <th>Total Weight</th>
                          <th>Amount</th>
                          <th>Discount</th>
                          <th>Net Payable</th>
                          <th>Due Date</th>
                          <th>Details</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visiblePurchases.map((purchase) => (
                          <tr key={purchase.id}>
                            <td>
                              <strong>{purchase.purchaseId || "—"}</strong>
                            </td>
                            <td>{formatDate(purchase.date)}</td>
                            <td>{purchase.brokerName || "—"}</td>
                            <td>{formatWeight(purchase.totalWeight)}</td>
                            <td>{formatCurrency(purchase.amount)}</td>
                            <td>{Number(purchase.discount || 0)}%</td>
                            <td>{formatCurrency(purchase.netPayable)}</td>
                            <td>{formatDate(purchase.paymentDueDate)}</td>
                            <td>
                              <button
                                type="button"
                                onClick={() =>
                                  navigate("/dashboard/purchase", {
                                    state: { viewPurchaseId: purchase.id },
                                  })
                                }
                              >
                                Details
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="history-empty">
                    No purchases found for this vendor.
                  </div>
                )}
              </section>
            </>
          )}
        </main>
      </div>
    </section>
  );
}
