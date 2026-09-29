import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { db } from "../../firebase/config";
import { useAuth } from "../../auth/AuthContext";
import { useToast } from "../../ui/ToastContext";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
import { DEFAULT_SHAPES, formatDecimal } from "../../utils/inventoryRules";
import {
  deletePurchase,
  datePlusDays,
  pricingFor,
  purchaseLockedByChallan,
  savePurchase,
  validatePurchaseItem,
} from "../../utils/purchase";
import "./purchase.css";
import PurchaseForm from "./PurchaseForm";
import { documentNumberError } from "../../utils/documentNumbers.js";

const time = (value) => value?.toMillis?.() ?? Number(value || 0);
const labelDate = (value) =>
  value
    ? new Date(`${value}T00:00:00`).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "--";
const currencyFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const currency = (value) => currencyFormatter.format(Number(value || 0));
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
function viewHtml(record) {
  const rows = (record.items || [])
    .map(
      (item) =>
        `<tr><td>${escape(item.type)}</td><td>${escape(item.shape)}</td><td>${escape(item.size)}</td><td>${formatDecimal(item.weight)}</td><td>${item.pieces}</td><td>${escape(item.box)}</td><td>${escape(item.sku)}</td></tr>`,
    )
    .join("");
  return `<section class="purchase-print"><h1>Purchase ${escape(record.purchaseId)}</h1><p><b>Date:</b> ${escape(labelDate(record.date))} &nbsp; <b>Vendor:</b> ${escape(record.vendorName)} &nbsp; <b>Broker:</b> ${escape(record.brokerName || "--")}</p><p><b>Total Weight:</b> ${formatDecimal(record.totalWeight)} ct &nbsp; <b>Gross:</b> ${currency(record.amount)} &nbsp; <b>Discount:</b> ${record.discount}% (${currency(record.discountAmount)}) &nbsp; <b>Net Payable:</b> ${currency(record.netPayable)}</p><p><b>Payment Due:</b> ${record.paymentDueDays} days -- ${escape(labelDate(record.paymentDueDate))}</p><table><thead><tr><th>Type</th><th>Shape</th><th>Size</th><th>Weight</th><th>Pieces</th><th>BOX</th><th>SKU</th></tr></thead><tbody>${rows}</tbody></table></section>`;
}
function exportPurchases(records, filename = "purchases.xlsx") {
  import("xlsx").then((XLSX) => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.json_to_sheet(
        records.map((r) => ({
          "Purchase ID": r.purchaseId,
          Date: r.date,
          "Vendor Name": r.vendorName,
          "Broker Name": r.brokerName || "",
          "Total Purchase Weight (ct)": r.totalWeight,
          Amount: r.amount,
          "Discount %": r.discount,
          "Discount Amount": r.discountAmount,
          "Net Payable": r.netPayable,
          "Payment Due Days": r.paymentDueDays,
          "Payment Due Date": r.paymentDueDate,
        })),
      ),
      "Purchases",
    );
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.json_to_sheet(
        records.flatMap((r) =>
          (r.items || []).map((item) => ({
            "Purchase ID": r.purchaseId,
            Type: item.type,
            Shape: item.shape,
            "Size (mm)": item.size,
            "Weight (ct)": item.weight,
            Pieces: item.pieces,
            BOX: item.box,
            "Generated SKU": item.sku,
          })),
        ),
      ),
      "Items",
    );
    XLSX.writeFile(book, filename);
  });
}
function ImportPreview({ rows, onClose, onImport }) {
  const valid = rows.filter((row) => !row.errors.length),
    invalid = rows.filter((row) => row.errors.length);
  return (
    <div className="purchase-modal">
      <div className="purchase-modal-card purchase-import-card">
        <button className="purchase-close" onClick={onClose}>
          ×
        </button>
        <h2>Purchase import review</h2>
        <p>
          {rows.length} Purchases found - {valid.length} valid -{" "}
          {invalid.length} invalid
        </p>
        {[
          ["Valid Purchases", valid],
          ["Invalid Purchases", invalid],
        ].map(([title, entries]) => (
          <section className="purchase-review" key={title}>
            <h3>
              {title} <small>{entries.length}</small>
            </h3>
            {entries.length ? (
              entries.map((row) => (
                <div key={row.ref}>
                  <b>{row.ref}</b>
                  <span>{row.purchase.vendorName || "Unnamed Vendor"}</span>
                  {row.errors.map((error) => (
                    <p key={error}>- {error}</p>
                  ))}
                </div>
              ))
            ) : (
              <p>None.</p>
            )}
          </section>
        ))}
        <footer>
          <button
            className="purchase-button primary"
            disabled={!valid.length}
            onClick={() => onImport(valid)}
          >
            Import {valid.length} valid Purchases
          </button>
          <button className="purchase-button secondary" onClick={onClose}>
            Cancel
          </button>
        </footer>
      </div>
    </div>
  );
}
export default function Purchase() {
  const { user } = useAuth(),
    toast = useToast(),
    location = useLocation(),
    navigate = useNavigate(),
    inputRef = useRef();
  const [purchases, setPurchases] = useState([]),
    [vendors, setVendors] = useState([]),
    [brokers, setBrokers] = useState([]),
    [inventory, setInventory] = useState([]),
    [challans, setChallans] = useState([]),
    [shapes, setShapes] = useState(DEFAULT_SHAPES),
    [allowDimensions, setAllowDimensions] = useState(false),
    [modal, setModal] = useState(null),
    [filters, setFilters] = useState({
      search: "",
      vendor: "",
      broker: "",
      from: "",
      to: "",
      dueFrom: "",
      dueTo: "",
    }),
    [clock, setClock] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(
    () =>
      onSnapshot(
        query(collection(db, "purchases"), orderBy("createdAt", "desc")),
        (s) => {
          const records = s.docs.map((d) => ({ id: d.id, ...d.data() }));
          setPurchases(records);
          const viewPurchaseId = location.state?.viewPurchaseId;
          const record = records.find(
            (purchase) => purchase.id === viewPurchaseId,
          );
          if (record) {
            setModal({ type: "view", record });
            navigate(location.pathname, { replace: true, state: null });
          }
        },
        (error) => {
          console.error("Purchase list listener failed", {
            code: error.code,
            message: error.message,
          });
          const message =
            error.code === "permission-denied"
              ? "Purchase data is unavailable for this account. Please contact an administrator."
              : error.code === "failed-precondition"
                ? "Purchase data needs a database index. Please contact an administrator."
                : error.code === "unavailable"
                  ? "Purchase data could not be reached. Check your connection and try again."
                  : "Purchase data could not be loaded. Please try again.";
          toast(message, "error");
        },
      ),
    [location.pathname, location.state?.viewPurchaseId, navigate, toast],
  );
  useEffect(
    () =>
      onSnapshot(collection(db, "vendors"), (snapshot) =>
        setVendors(
          snapshot.docs
            .map((row) => row.data().name)
            .filter(Boolean)
            .sort(),
        ),
      ),
    [],
  );
  useEffect(
    () =>
      onSnapshot(collection(db, "brokers"), (snapshot) =>
        setBrokers(
          snapshot.docs
            .map((row) => row.data().name)
            .filter(Boolean)
            .sort(),
        ),
      ),
    [],
  );
  useEffect(
    () =>
      onSnapshot(collection(db, "inventory"), (snapshot) =>
        setInventory(
          snapshot.docs.map((row) => ({ id: row.id, ...row.data() })),
        ),
      ),
    [],
  );
  useEffect(
    () =>
      onSnapshot(collection(db, "challans"), (snapshot) =>
        setChallans(snapshot.docs.map((row) => row.data())),
      ),
    [],
  );
  useEffect(
    () =>
      onSnapshot(collection(db, "shapes"), (snapshot) =>
        setShapes([
          ...new Set([
            ...DEFAULT_SHAPES,
            ...snapshot.docs.map((row) => row.data().value).filter(Boolean),
          ]),
        ]),
      ),
    [],
  );
  useEffect(
    () =>
      onSnapshot(doc(db, "settings", "inventory"), (snapshot) =>
        setAllowDimensions(Boolean(snapshot.data()?.allowDimensionSizes)),
      ),
    [],
  );
  const filtered = useMemo(
    () =>
      purchases.filter((r) => {
        const search = filters.search.toLowerCase(),
          hit =
            !search ||
            [r.purchaseId, r.vendorName, r.brokerName].some((v) =>
              String(v || "")
                .toLowerCase()
                .includes(search),
            );
        return (
          hit &&
          (!filters.vendor || r.vendorName === filters.vendor) &&
          (!filters.broker || r.brokerName === filters.broker) &&
          (!filters.from || r.date >= filters.from) &&
          (!filters.to || r.date <= filters.to) &&
          (!filters.dueFrom || r.paymentDueDate >= filters.dueFrom) &&
          (!filters.dueTo || r.paymentDueDate <= filters.dueTo)
        );
      }),
    [purchases, filters],
  );
  const totals = useMemo(
    () => ({
      count: filtered.length,
      weight: filtered.reduce((s, r) => s + Number(r.totalWeight || 0), 0),
      gross: filtered.reduce((s, r) => s + Number(r.amount || 0), 0),
      net: filtered.reduce((s, r) => s + Number(r.netPayable || 0), 0),
    }),
    [filtered],
  );
  const canEdit = (r) =>
    user?.role === "superadmin" ||
    (r.createdBy === user?.uid && clock < time(r.createdAt) + 600000);
  const doDelete = async (record) => {
    if (purchaseLockedByChallan(record, inventory, challans))
      return toast(
        "This Purchase cannot be deleted because its Inventory stock is already linked to a Challan.",
        "error",
      );
    try {
      await deletePurchase({ purchaseId: record.id, user });
      toast(
        "Purchase and its untouched Inventory entries were deleted.",
        "success",
      );
    } catch (e) {
      toast(e.message || "Could not delete this Purchase.", "error");
    } finally {
      setModal(null);
    }
  };
  const importFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const XLSX = await import("xlsx"),
        wb = XLSX.read(await file.arrayBuffer(), { type: "array" }),
        purchaseRows = XLSX.utils.sheet_to_json(
          wb.Sheets.Purchases || wb.Sheets.purchases || {},
        ),
        itemRows = XLSX.utils.sheet_to_json(
          wb.Sheets.Items || wb.Sheets.items || {},
        );
      const refs = new Map(),
        unmatchedItemRows = [];
      purchaseRows.forEach((row, index) => {
        const ref =
          String(row["Import Ref"] || "").trim() || `Row ${index + 2}`;
        refs.set(ref, {
          ref,
          purchase: {
            purchaseId: String(row["Purchase Number"] ?? row["Purchase ID"] ?? ""),
            date: String(row.Date || "").slice(0, 10),
            vendorName: String(row["Vendor Name"] || "").trim(),
            brokerName: String(row["Broker Name"] || "").trim(),
            totalWeight: Number(row["Total Purchase Weight (ct)"]),
            amount: Number(row.Amount),
            discount: Number(row.Discount),
            paymentDueDays: Number(row["Payment Due Days"]),
            items: [],
          },
          errors: [],
        });
      });
      itemRows.forEach((row, index) => {
        const ref = String(row["Import Ref"] || "").trim(),
          group = refs.get(ref);
        if (!group) {
          unmatchedItemRows.push({
            ref: `Item Row ${index + 2}`,
            purchase: { vendorName: "", items: [] },
            errors: [
              `Unknown Import Ref "${ref || "(blank)"}". No matching Purchase row.`,
            ],
          });
          return;
        }
        const check = validatePurchaseItem(
          {
            type: row.Type,
            shape: row.Shape,
            size: row["Size (mm)"],
            weight: row["Weight (ct)"],
            pieces: row.Pieces,
            box: row.BOX,
          },
          allowDimensions,
        );
        if (check.errors.length)
          group.errors.push(`Item Row ${index + 2}: ${check.errors.join(" ")}`);
        group.purchase.items.push(check.item);
      });
      const rows = [...refs.values()].map((group) => {
        const p = group.purchase,
          total = p.items.reduce((s, item) => s + item.weight, 0);
        const numberError = documentNumberError("purchase", p.purchaseId, purchases);
        if (numberError) group.errors.push(numberError);
        if ([...refs.values()].filter((entry) => entry.purchase.purchaseId === p.purchaseId).length > 1)
          group.errors.push(`Purchase Number ${p.purchaseId} appears more than once in this file.`);
        if (!p.date || Number.isNaN(new Date(`${p.date}T00:00:00`).getTime()))
          group.errors.push("Date is missing or invalid.");
        if (!p.vendorName) group.errors.push("Vendor Name is missing.");
        if (!(p.totalWeight > 0))
          group.errors.push("Total Purchase Weight must be greater than 0.");
        if (!(p.amount > 0))
          group.errors.push("Amount must be greater than 0.");
        if (!(p.discount >= 0 && p.discount <= 100))
          group.errors.push("Discount must be between 0% and 100%.");
        if (!Number.isInteger(p.paymentDueDays) || p.paymentDueDays < 0)
          group.errors.push(
            "Payment Due Days must be a whole number of 0 or more.",
          );
        if (!p.items.length)
          group.errors.push("At least one matching Item row is required.");
        if (Math.abs(total - p.totalWeight) > 0.0005)
          group.errors.push(
            `Total Purchase Weight is ${formatDecimal(p.totalWeight)} ct but Item Weight total is ${formatDecimal(total)} ct.`,
          );
        p.paymentDueDate = datePlusDays(p.date, p.paymentDueDays);
        Object.assign(p, pricingFor(p.amount, p.discount));
        return group;
      });
      rows.push(...unmatchedItemRows);
      setModal({ type: "import", rows });
    } catch {
      toast(
        "Could not read this Excel file. Use the Purchase two-sheet template.",
        "error",
      );
    }
  };
  const commitImport = async (rows) => {
    try {
      for (const row of rows) {
        await savePurchase({
          purchase: { ...row.purchase, origin: "Import" },
          items: row.purchase.items,
          user,
          existingInventory: inventory,
          allowDimensions,
        });
        await setDoc(
          doc(
            db,
            "vendors",
            encodeURIComponent(row.purchase.vendorName.toLowerCase()),
          ),
          {
            name: row.purchase.vendorName,
            normalized: row.purchase.vendorName.toLowerCase(),
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );
        if (row.purchase.brokerName)
          await setDoc(
            doc(
              db,
              "brokers",
              encodeURIComponent(row.purchase.brokerName.toLowerCase()),
            ),
            {
              name: row.purchase.brokerName,
              normalized: row.purchase.brokerName.toLowerCase(),
              updatedAt: serverTimestamp(),
            },
            { merge: true },
          );
      }
      toast(`${rows.length} Purchases imported.`, "success");
      setModal(null);
    } catch (e) {
      toast(
        e.message || "Import stopped because a Purchase could not be saved.",
        "error",
      );
    }
  };
  const printRecords = (rows) => {
    const win = window.open("", "_blank", "width=1100,height=800");
    if (!win) return toast("Please allow pop-ups to print Purchases.", "error");
    win.document.write(
      `<!doctype html><html><head><title>Purchases</title><style>body{font:14px Arial;color:#182230;margin:28px}.purchase-print{break-after:page;margin-bottom:32px}h1{font-size:22px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #b8c0c9;padding:7px;text-align:left}th{background:#eef3f5}</style></head><body>${rows.map(viewHtml).join("")}</body></html>`,
    );
    win.document.close();
    setTimeout(() => win.print(), 250);
  };
  return (
    <section className="purchase-module">
      <header className="purchase-heading">
        <div>
          <h2>Purchase</h2>
          <p>
            Incoming stock, supplier records and Purchase-to-Inventory
            traceability.
          </p>
        </div>
        <div className="purchase-actions">
          <button
            className="purchase-button secondary"
            onClick={() => inputRef.current?.click()}
          >
            Import
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx"
            hidden
            onChange={importFile}
          />
          <button
            className="purchase-button secondary"
            onClick={() => exportPurchases(filtered)}
          >
            Export
          </button>
          <button
            className="purchase-button secondary"
            onClick={() => printRecords(filtered)}
          >
            Print
          </button>
          <button
            className="purchase-button primary"
            onClick={() => setModal({ type: "form" })}
          >
            + Create Purchase
          </button>
        </div>
      </header>
      <div className="purchase-metrics">
        {[
          ["Total Purchases", totals.count],
          ["Total Purchase Weight", `${formatDecimal(totals.weight)} ct`],
          ["Total Gross Amount", currency(totals.gross)],
          ["Total Net Payable", currency(totals.net)],
        ].map(([label, value]) => (
          <article key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </article>
        ))}
      </div>
      <div className="purchase-filters">
        <input
          placeholder="Search Purchase ID, Vendor or Broker"
          value={filters.search}
          onChange={(e) =>
            setFilters((f) => ({ ...f, search: e.target.value }))
          }
        />
        <select
          value={filters.vendor}
          onChange={(e) =>
            setFilters((f) => ({ ...f, vendor: e.target.value }))
          }
        >
          <option value="">All Vendors</option>
          {vendors.map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
        <select
          value={filters.broker}
          onChange={(e) =>
            setFilters((f) => ({ ...f, broker: e.target.value }))
          }
        >
          <option value="">All Brokers</option>
          {brokers.map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
        <label>
          Purchase date{" "}
          <input
            type="date"
            value={filters.from}
            onChange={(e) =>
              setFilters((f) => ({ ...f, from: e.target.value }))
            }
          />
        </label>
        <label>
          to{" "}
          <input
            type="date"
            value={filters.to}
            onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))}
          />
        </label>
        <label>
          Due date{" "}
          <input
            type="date"
            value={filters.dueFrom}
            onChange={(e) =>
              setFilters((f) => ({ ...f, dueFrom: e.target.value }))
            }
          />
        </label>
        <label>
          to{" "}
          <input
            type="date"
            value={filters.dueTo}
            onChange={(e) =>
              setFilters((f) => ({ ...f, dueTo: e.target.value }))
            }
          />
        </label>
      </div>
      <div className="purchase-table-wrap">
        <table className="purchase-table">
          <thead>
            <tr>
              <th>Purchase ID</th>
              <th>Date</th>
              <th>Vendor Name</th>
              <th>Broker Name</th>
              <th>Total Weight</th>
              <th>Amount</th>
              <th>Payment Due</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const locked = purchaseLockedByChallan(r, inventory, challans),
                remaining = Math.max(0, time(r.createdAt) + 600000 - clock);
              return (
                <tr key={r.id}>
                  <td>
                    <b>{r.purchaseId}</b>
                    <small>{r.itemCount || r.items?.length || 0} items</small>
                  </td>
                  <td>{labelDate(r.date)}</td>
                  <td>{r.vendorName}</td>
                  <td>{r.brokerName || "--"}</td>
                  <td>{formatDecimal(r.totalWeight)} ct</td>
                  <td>
                    <b>{currency(r.amount)}</b>
                    <small>Net: {currency(r.netPayable)}</small>
                    <small>{r.discount}% discount</small>
                  </td>
                  <td>
                    {r.paymentDueDays} days
                    <small>Due: {labelDate(r.paymentDueDate)}</small>
                  </td>
                  <td>
                    <div className="purchase-row-actions">
                      <button
                        onClick={() => setModal({ type: "view", record: r })}
                      >
                        View
                      </button>
                      {canEdit(r) && !locked && (
                        <button
                          onClick={() => setModal({ type: "form", record: r })}
                        >
                          Edit
                        </button>
                      )}
                      {user?.role !== "superadmin" &&
                        r.createdBy === user?.uid &&
                        !locked && (
                          <small>
                            Edit allowed:{" "}
                            {String(Math.ceil(remaining / 60000)).padStart(
                              2,
                              "0",
                            )}
                            :
                            {String(Math.ceil(remaining / 1000) % 60).padStart(
                              2,
                              "0",
                            )}
                          </small>
                        )}
                      {user?.role === "superadmin" && (
                        <button
                          className="danger"
                          onClick={() =>
                            locked
                              ? toast(
                                  "This Purchase cannot be deleted because its Inventory stock is already linked to a Challan.",
                                  "error",
                                )
                              : setModal({ type: "delete", record: r })
                          }
                        >
                          Delete
                        </button>
                      )}
                      {locked && (
                        <small className="locked">
                          Locked by Challan usage
                        </small>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {!filtered.length && (
              <tr>
                <td colSpan="8" className="purchase-empty">
                  {purchases.length
                    ? "No Purchases match these filters."
                    : "No Purchases found."}
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan="4">Total Purchases: {totals.count}</td>
              <td>{formatDecimal(totals.weight)} ct</td>
              <td>{currency(totals.gross)}</td>
              <td colSpan="2" />
            </tr>
          </tfoot>
        </table>
      </div>
      {modal?.type === "form" && (
        <PurchaseForm
          record={modal.record}
          purchases={purchases}
          onClose={() => setModal(null)}
          vendors={vendors}
          brokers={brokers}
          shapes={shapes}
          allowDimensions={allowDimensions}
          inventory={inventory}
          challans={challans}
        />
      )}
      {modal?.type === "view" && (
        <div className="purchase-modal">
          <div className="purchase-modal-card purchase-view">
            <button className="purchase-close" onClick={() => setModal(null)}>
              ×
            </button>
            <div className="purchase-view-head">
              <div>
                <span>Purchase ID</span>
                <h2>{modal.record.purchaseId}</h2>
              </div>
              <div>
                <button
                  className="purchase-button secondary"
                  onClick={() =>
                    exportPurchases(
                      [modal.record],
                      `${modal.record.purchaseId}.xlsx`,
                    )
                  }
                >
                  Export
                </button>
                <button
                  className="purchase-button secondary"
                  onClick={() => printRecords([modal.record])}
                >
                  Print
                </button>
              </div>
            </div>
            <div className="purchase-view-grid">
              <p>
                <span>Basic Details</span>Date:{" "}
                <b>{labelDate(modal.record.date)}</b>
                <br />
                Vendor: <b>{modal.record.vendorName}</b>
                <br />
                Broker: <b>{modal.record.brokerName || "--"}</b>
              </p>
              <p>
                <span>Financial Details</span>Gross:{" "}
                <b>{currency(modal.record.amount)}</b>
                <br />
                Discount:{" "}
                <b>
                  {modal.record.discount}% -{" "}
                  {currency(modal.record.discountAmount)}
                </b>
                <br />
                Net Payable: <b>{currency(modal.record.netPayable)}</b>
              </p>
              <p>
                <span>Due Date</span>
                {modal.record.paymentDueDays} days
                <br />
                <b>{labelDate(modal.record.paymentDueDate)}</b>
              </p>
              <p>
                <span>Total Weight</span>
                <b>{formatDecimal(modal.record.totalWeight)} ct</b>
                <br />
                {modal.record.items?.length || 0} Items
              </p>
            </div>
            <div className="purchase-items">
              <div className="purchase-items-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th>Shape</th>
                      <th>Size</th>
                      <th>Weight</th>
                      <th>Pieces</th>
                      <th>BOX</th>
                      <th>SKU</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(modal.record.items || []).map((i) => (
                      <tr key={i.id}>
                        <td>{i.type}</td>
                        <td>{i.shape}</td>
                        <td>{i.size}</td>
                        <td>{formatDecimal(i.weight)} ct</td>
                        <td>{i.pieces}</td>
                        <td>{i.box || "--"}</td>
                        <td>{i.sku}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
      {modal?.type === "import" && (
        <ImportPreview
          rows={modal.rows}
          onClose={() => setModal(null)}
          onImport={commitImport}
        />
      )}
      {modal?.type === "delete" && (
        <ConfirmDialog
          title="Delete Purchase?"
          confirmLabel="Delete Purchase"
          destructive
          onCancel={() => setModal(null)}
          onConfirm={() => doDelete(modal.record)}
        >
          <p>
            This will permanently delete {modal.record.purchaseId} and its
            untouched Inventory entries. This action cannot be undone.
          </p>
        </ConfirmDialog>
      )}
    </section>
  );
}
