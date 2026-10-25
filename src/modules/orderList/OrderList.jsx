import { addDoc, updateDoc, deleteDoc } from "../../firebase/businessWrites.js";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../../firebase/config";
import { useAuth } from "../../auth/AuthContext";
import { useToast } from "../../ui/ToastContext";
import { uploadChallanImage } from "../../utils/cloudinary";
import OrderForm, { OrderModal } from "./OrderForm";
import {
  ORDER_PAGE_SIZE,
  filterOrders,
  formatOrderDate,
  formatOrderTimestamp,
} from "./orderListModel";
import "./orderList.css";

const EMPTY_FILTERS = {
  search: "",
  from: "",
  to: "",
  client: "",
  staff: "",
  sort: "newest",
};

function ViewOrder({ record, onClose, onEdit }) {
  return (
    <OrderModal
      title="Order Details"
      onClose={onClose}
      className="order-view-dialog"
    >
      <div className="order-dialog-body">
        <dl className="order-view-summary">
          <div>
            <dt>Date</dt>
            <dd>{formatOrderDate(record.orderDate)}</dd>
          </div>
          <div>
            <dt>Client Name</dt>
            <dd>{record.clientName}</dd>
          </div>
          <div>
            <dt>Staff Name</dt>
            <dd>{record.staffName}</dd>
          </div>
        </dl>
        {record.description && (
          <section className="order-view-section">
            <h3>Order Text</h3>
            <div className="order-full-text">{record.description}</div>
          </section>
        )}
        {record.image?.secureUrl && (
          <section className="order-view-section">
            <h3>Order Image</h3>
            <a
              href={record.image.secureUrl}
              target="_blank"
              rel="noreferrer"
              aria-label="Open full order image"
            >
              <img
                className="order-view-image"
                src={record.image.secureUrl}
                alt={record.image.filename || "Order image"}
              />
            </a>
          </section>
        )}
        <div className="order-view-meta">
          <span>
            Added by{" "}
            {record.createdBy?.name || record.createdBy?.uid || "Unknown"} ·{" "}
            {formatOrderTimestamp(record.createdAt)}
          </span>
          {record.updatedBy && (
            <span>
              Updated by {record.updatedBy.name || record.updatedBy.uid} ·{" "}
              {formatOrderTimestamp(record.updatedAt)}
            </span>
          )}
        </div>
      </div>
      <footer className="order-dialog-footer">
        <button
          type="button"
          className="order-button order-secondary"
          onClick={onClose}
        >
          Close
        </button>
        <button
          type="button"
          className="order-button order-primary"
          onClick={onEdit}
        >
          Edit
        </button>
      </footer>
    </OrderModal>
  );
}

function DeleteOrder({ record, onClose, onDelete }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const busyRef = useRef(false);
  const confirm = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await onDelete(record);
    } catch {
      setError("Order could not be deleted. Please try again.");
      setBusy(false);
      busyRef.current = false;
    }
  };
  return (
    <OrderModal
      title="Delete Order?"
      onClose={busy ? () => {} : onClose}
      busy={busy}
      className="order-delete-dialog"
    >
      <div className="order-dialog-body">
        <dl className="order-view-summary">
          <div>
            <dt>Client</dt>
            <dd>{record.clientName}</dd>
          </div>
          <div>
            <dt>Date</dt>
            <dd>{formatOrderDate(record.orderDate)}</dd>
          </div>
          <div>
            <dt>Staff</dt>
            <dd>{record.staffName}</dd>
          </div>
        </dl>
        <p>This will permanently remove this Order List entry.</p>
        {error && (
          <p className="order-feedback order-feedback-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <footer className="order-dialog-footer">
        <button
          type="button"
          className="order-button order-secondary"
          disabled={busy}
          onClick={onClose}
        >
          Cancel
        </button>
        <button
          type="button"
          className="order-button order-danger"
          disabled={busy}
          onClick={confirm}
        >
          {busy ? "Deleting..." : "Delete Order"}
        </button>
      </footer>
    </OrderModal>
  );
}

function OrderActions({ record, onView, onEdit, onDelete }) {
  return (
    <div className="order-actions">
      <button
        type="button"
        onClick={() => onView(record)}
        aria-label={"View order for " + record.clientName}
      >
        View
      </button>
      <button
        type="button"
        onClick={() => onEdit(record)}
        aria-label={"Edit order for " + record.clientName}
      >
        Edit
      </button>
      <button
        type="button"
        className="order-delete-action"
        onClick={() => onDelete(record)}
        aria-label={"Delete order for " + record.clientName}
      >
        Delete
      </button>
    </div>
  );
}

function OrderUpdated({ value }) {
  const [date, time] = formatOrderTimestamp(value).split(", ");
  return (
    <span className="order-updated">
      <span>{date}</span>
      {time && <span className="order-updated-time">{time.toUpperCase()}</span>}
    </span>
  );
}

function OrderImage({ record, onView }) {
  return record.image?.secureUrl ? (
    <button
      type="button"
      className="order-thumb-button"
      aria-label={"View image order for " + record.clientName}
      onClick={() => onView(record)}
    >
      <img src={record.image.secureUrl} alt="" />
    </button>
  ) : (
    <span className="order-muted">No image</span>
  );
}

export default function OrderList() {
  const { user } = useAuth();
  const toast = useToast();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [readError, setReadError] = useState("");
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState(null);
  useEffect(
    () =>
      onSnapshot(
        collection(db, "orderList"),
        (snapshot) => {
          setOrders(
            snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })),
          );
          setLoading(false);
          setReadError("");
        },
        () => {
          setLoading(false);
          setReadError(
            "Orders could not be loaded. Check your connection and try again.",
          );
        },
      ),
    [],
  );
  const clients = useMemo(
    () =>
      [...new Set(orders.map((row) => row.clientName).filter(Boolean))].sort(
        (a, b) => a.localeCompare(b),
      ),
    [orders],
  );
  const staff = useMemo(
    () =>
      [...new Set(orders.map((row) => row.staffName).filter(Boolean))].sort(
        (a, b) => a.localeCompare(b),
      ),
    [orders],
  );
  const filtered = useMemo(
    () => filterOrders(orders, filters),
    [orders, filters],
  );
  const pageCount = Math.max(1, Math.ceil(filtered.length / ORDER_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visible = filtered.slice(
    (currentPage - 1) * ORDER_PAGE_SIZE,
    currentPage * ORDER_PAGE_SIZE,
  );
  const activeFilters = Object.entries(filters).some(([key, value]) =>
    key === "sort" ? value !== "newest" : Boolean(value),
  );
  const setFilter = (key, value) => {
    setFilters((old) => ({ ...old, [key]: value }));
    setPage(1);
  };
  const clearFilters = () => {
    setFilters(EMPTY_FILTERS);
    setPage(1);
  };
  const actor = {
    uid: user.uid,
    name: user.displayName || user.name || user.accessId || "",
    role: user.role || "",
  };
  const save = async (form) => {
    const uploaded = form.file
      ? await uploadChallanImage(form.file)
      : form.image;
    const image = uploaded
      ? {
          secureUrl: uploaded.secureUrl,
          publicId: uploaded.publicId,
          filename:
            uploaded.filename ||
            uploaded.originalFilename ||
            form.file?.name ||
            "",
        }
      : null;
    const fields = {
      orderDate: form.orderDate,
      clientName: form.clientName.trim(),
      staffName: form.staffName.trim(),
      description: form.description,
      image,
      updatedAt: serverTimestamp(),
    };
    if (modal?.record) {
      await updateDoc(doc(db, "orderList", modal.record.id), {
        ...fields,
        updatedBy: actor,
      });
      toast("Order updated.");
    } else {
      await addDoc(collection(db, "orderList"), {
        ...fields,
        createdAt: serverTimestamp(),
        createdBy: actor,
        updatedBy: null,
      });
      toast("Order added.");
    }
    setModal(null);
  };
  const remove = async (record) => {
    await deleteDoc(doc(db, "orderList", record.id));
    setModal(null);
    toast("Order deleted.");
  };
  const open = (type, record = null) => setModal({ type, record });
  const actionProps = {
    onView: (row) => open("view", row),
    onEdit: (row) => open("edit", row),
    onDelete: (row) => open("delete", row),
  };
  return (
    <section className="order-page">
      <header className="order-page-head">
        <div>
          <h1>Order List</h1>
          <p>Track and manage received orders.</p>
        </div>
        <button
          type="button"
          className="order-button order-primary"
          onClick={() => open("add")}
        >
          + Add Order
        </button>
      </header>
      <div className="order-toolbar">
        <label className="order-search">
          Search
          <input
            type="search"
            value={filters.search}
            placeholder="Client, staff or order details"
            onChange={(event) => setFilter("search", event.target.value)}
          />
        </label>
        <label>
          From Date
          <input
            type="date"
            value={filters.from}
            onChange={(event) => setFilter("from", event.target.value)}
          />
        </label>
        <label>
          To Date
          <input
            type="date"
            value={filters.to}
            onChange={(event) => setFilter("to", event.target.value)}
          />
        </label>
        <label>
          Client
          <select
            aria-label="Client"
            value={filters.client}
            onChange={(event) => setFilter("client", event.target.value)}
          >
            <option value="">All clients</option>
            {clients.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Staff
          <select
            aria-label="Staff"
            value={filters.staff}
            onChange={(event) => setFilter("staff", event.target.value)}
          >
            <option value="">All staff</option>
            {staff.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <div className="order-sort-group">
          <label>
            Sort
            <select
              aria-label="Sort"
              value={filters.sort}
              onChange={(event) => setFilter("sort", event.target.value)}
            >
              <option value="newest">Newest Date First</option>
              <option value="oldest">Oldest Date First</option>
              <option value="added">Recently Added</option>
              <option value="updated">Recently Updated</option>
            </select>
          </label>
          {activeFilters && (
            <button
              type="button"
              className="order-button order-secondary"
              onClick={clearFilters}
            >
              Clear Filters
            </button>
          )}
        </div>
      </div>
      {loading ? (
        <div className="order-state" role="status">
          Loading orders...
        </div>
      ) : readError ? (
        <div className="order-state order-feedback-error" role="alert">
          {readError}
        </div>
      ) : !orders.length ? (
        <div className="order-state">
          <h2>No orders added yet.</h2>
          <button
            type="button"
            className="order-button order-primary"
            onClick={() => open("add")}
          >
            Add Order
          </button>
        </div>
      ) : !filtered.length ? (
        <div className="order-state">
          <h2>No orders match the current filters.</h2>
          <button
            type="button"
            className="order-button order-secondary"
            onClick={clearFilters}
          >
            Clear Filters
          </button>
        </div>
      ) : (
        <>
          <div className="order-table-wrap">
            <table className="order-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Client</th>
                  <th>Staff</th>
                  <th>Order Details</th>
                  <th>Image</th>
                  <th>Updated</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr key={row.id}>
                    <td>{formatOrderDate(row.orderDate)}</td>
                    <td className="order-name" title={row.clientName}>
                      {row.clientName}
                    </td>
                    <td className="order-name" title={row.staffName}>
                      {row.staffName}
                    </td>
                    <td>
                      <div className="order-preview">
                        {row.description?.trim()
                          ? row.description
                          : "Image order"}
                      </div>
                    </td>
                    <td>
                      <OrderImage record={row} onView={actionProps.onView} />
                    </td>
                    <td>
                      <OrderUpdated value={row.updatedAt} />
                    </td>
                    <td>
                      <OrderActions record={row} {...actionProps} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="order-cards">
            {visible.map((row) => (
              <article className="order-card" key={row.id}>
                <div className="order-card-top">
                  <strong title={row.clientName}>{row.clientName}</strong>
                  <time>{formatOrderDate(row.orderDate)}</time>
                </div>
                <p className="order-card-staff">Staff: {row.staffName}</p>
                <div className="order-card-content">
                  <div className="order-preview">
                    {row.description?.trim() ? row.description : "Image order"}
                  </div>
                  <OrderImage record={row} onView={actionProps.onView} />
                </div>
                <div className="order-card-updated">
                  Updated <OrderUpdated value={row.updatedAt} />
                </div>
                <OrderActions record={row} {...actionProps} />
              </article>
            ))}
          </div>
          <footer className="order-list-footer">
            <span>
              Showing {(currentPage - 1) * ORDER_PAGE_SIZE + 1}-
              {Math.min(currentPage * ORDER_PAGE_SIZE, filtered.length)} of{" "}
              {filtered.length} orders
            </span>
            {pageCount > 1 && (
              <div className="order-pagination">
                <button
                  type="button"
                  className="order-button order-secondary"
                  disabled={currentPage === 1}
                  onClick={() => setPage(currentPage - 1)}
                >
                  Previous
                </button>
                <span>
                  Page {currentPage} of {pageCount}
                </span>
                <button
                  type="button"
                  className="order-button order-secondary"
                  disabled={currentPage === pageCount}
                  onClick={() => setPage(currentPage + 1)}
                >
                  Next
                </button>
              </div>
            )}
          </footer>
        </>
      )}
      {modal?.type === "add" && (
        <OrderForm onClose={() => setModal(null)} onSave={save} />
      )}
      {modal?.type === "edit" && (
        <OrderForm
          record={modal.record}
          onClose={() => setModal(null)}
          onSave={save}
        />
      )}
      {modal?.type === "view" && (
        <ViewOrder
          record={modal.record}
          onClose={() => setModal(null)}
          onEdit={() => open("edit", modal.record)}
        />
      )}
      {modal?.type === "delete" && (
        <DeleteOrder
          record={modal.record}
          onClose={() => setModal(null)}
          onDelete={remove}
        />
      )}
    </section>
  );
}
