import { normalizeSize } from "../../utils/dimensions.js";
import { useEffect } from "react";
import {
  StageFourView,
  StageOneView,
  StageThreeView,
  StageTwoView,
} from "../challan/Challan";
import { formatCurrency, formatDate, formatWeight } from "./historyShared";

export function HistoryOverlay({ title, subtitle, children, onClose }) {
  useEffect(() => {
    const closeOnEscape = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  return (
    <div className="history-overlay" role="presentation" onMouseDown={onClose}>
      <section
        className="history-detail-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="history-detail-header">
          <div>
            <small>{title}</small>
            <h2>{subtitle}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <div className="history-detail-body">{children}</div>
      </section>
    </div>
  );
}

export function PurchaseHistoryDetails({ record, onClose }) {
  const pieces = (record.items || []).reduce(
    (total, item) => total + Number(item.pieces || 0),
    0,
  );
  return (
    <HistoryOverlay
      title="Purchase Details"
      subtitle={record.purchaseId || "Purchase"}
      onClose={onClose}
    >
      <div className="history-detail-grid">
        <Detail label="Date" value={formatDate(record.date)} />
        <Detail label="Vendor" value={record.vendorName || "--"} />
        <Detail label="Broker" value={record.brokerName || "--"} />
        <Detail
          label="Total Purchase Weight"
          value={formatWeight(record.totalWeight)}
        />
        <Detail label="Amount" value={formatCurrency(record.amount)} />
        <Detail label="Discount" value={`${Number(record.discount || 0)}%`} />
        <Detail
          label="Discount Amount"
          value={formatCurrency(record.discountAmount)}
        />
        <Detail label="Net Payable" value={formatCurrency(record.netPayable)} />
        <Detail label="Payment Due Days" value={record.paymentDueDays ?? "--"} />
        <Detail label="Due Date" value={formatDate(record.paymentDueDate)} />
      </div>
      <section className="history-detail-section">
        <h3>Purchase Items</h3>
        <div className="history-detail-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>Shape</th>
                <th>Size</th>
                <th>Weight</th>
                <th>Pieces</th>
                <th>Box</th>
              </tr>
            </thead>
            <tbody>
              {(record.items || []).map((item, index) => (
                <tr key={item.id || index}>
                  <td>{item.type || "--"}</td>
                  <td>{item.shape || "--"}</td>
                  <td>{normalizeSize(item.size) || "--"}</td>
                  <td>{formatWeight(item.weight)}</td>
                  <td>{item.pieces ?? "--"}</td>
                  <td>{item.box || "--"}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan="3">Total Items: {(record.items || []).length}</td>
                <td>{formatWeight(record.totalWeight)}</td>
                <td>{pieces}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    </HistoryOverlay>
  );
}

export function ChallanHistoryDetails({ record, onClose }) {
  const stage = Number(record.stage || 1);
  const returnItems = record.stage2Return?.items || [];
  const invoice = record.finalInvoice;
  const invoiceItems = Array.isArray(invoice?.items) ? invoice.items : [];
  const stageFourItems = (returnItems.length ? returnItems : invoiceItems).map(
    (item) => {
      const invoiceItem = invoiceItems.find(
        (candidate) =>
          (candidate.sourceInventoryId ||
            candidate.inventoryId ||
            candidate.sku) ===
          (item.sourceInventoryId || item.inventoryId || item.sku),
      );
      return invoiceItem ? { ...item, ...invoiceItem } : item;
    },
  );
  const type =
    [
      ...new Set((record.items || []).map((item) => item.type).filter(Boolean)),
    ].join(", ") || "--";
  return (
    <HistoryOverlay
      title="Challan Details"
      subtitle={record.number || "Challan"}
      onClose={onClose}
    >
      <div className="history-detail-grid">
        <Detail label="Party" value={record.party || "--"} />
        <Detail label="Date" value={formatDate(record.date)} />
        <Detail label="Type / CVD / HP" value={type} />
        <Detail label="Current Stage" value={`Stage ${stage}`} />
      </div>
      {stage === 1 && <StageOneView items={record.items || []} />}
      {stage === 2 && <StageTwoView items={returnItems} />}
      {stage === 3 && <StageThreeView invoice={invoice} />}
      {stage === 4 && (
        <StageFourView
          items={stageFourItems}
          invoice={invoice}
          settlement={record.finalSettlement}
        />
      )}
      <section className="history-detail-notes">
        <h3>Comments / Notes</h3>
        <p>{record.notes?.trim() || "No notes added for this Challan."}</p>
      </section>
    </HistoryOverlay>
  );
}

const Detail = ({ label, value }) => (
  <div>
    <small>{label}</small>
    <strong>{value}</strong>
  </div>
);
