import { useEffect, useRef, useState } from "react";
import { usePageFreeze } from "../../hooks/usePageFreeze";
import { localOrderDate, orderErrors } from "./orderListModel";

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const IMAGE_LIMIT = 10 * 1024 * 1024;

export function OrderModal({
  title,
  onClose,
  children,
  busy = false,
  className = "",
}) {
  const dialogRef = useRef(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  usePageFreeze();
  useEffect(() => {
    const previous = document.activeElement;
    const dialog = dialogRef.current;
    dialog?.focus();
    const onKey = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = [
        ...dialog.querySelectorAll(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]',
        ),
      ];
      if (!focusable.length) return;
      const first = focusable[0],
        last = focusable[focusable.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === dialog)
      ) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, []);
  return (
    <div
      className="order-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={"order-dialog " + className}
      >
        <header className="order-dialog-head">
          <h2>{title}</h2>
          <button
            type="button"
            className="order-icon-button"
            aria-label={"Close " + title}
            disabled={busy}
            onClick={onClose}
          >
            ×
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

export default function OrderForm({ record, onClose, onSave }) {
  const [form, setForm] = useState(() => ({
    orderDate: record?.orderDate || localOrderDate(),
    clientName: record?.clientName || "",
    staffName: record?.staffName || "",
    description: record?.description || "",
    image: record?.image || null,
    file: null,
  }));
  const [touched, setTouched] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [imageError, setImageError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const previewRef = useRef(null);
  const [previewUrl, setPreviewUrl] = useState("");
  useEffect(
    () => () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    },
    [],
  );
  const errors = orderErrors(form);
  const showError = (field) => submitted || touched[field];
  const update = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
    setSaveError("");
  };
  const chooseFile = (file) => {
    if (!file) return;
    if (!IMAGE_TYPES.includes(file.type)) {
      setImageError("Select a JPG, PNG or WEBP image.");
      return;
    }
    if (file.size > IMAGE_LIMIT) {
      setImageError("Image must be 10 MB or smaller.");
      return;
    }
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    const url = URL.createObjectURL(file);
    previewRef.current = url;
    setPreviewUrl(url);
    setForm((current) => ({ ...current, image: null, file }));
    setImageError("");
    setSaveError("");
    setTouched((current) => ({ ...current, content: true }));
  };
  const removeImage = () => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = null;
    setPreviewUrl("");
    setForm((current) => ({ ...current, image: null, file: null }));
    setImageError("");
    setTouched((current) => ({ ...current, content: true }));
  };
  const pasteImage = (event) => {
    const file = [...(event.clipboardData?.items || [])]
      .find((item) => item.kind === "file" && item.type.startsWith("image/"))
      ?.getAsFile();
    if (file) {
      event.preventDefault();
      chooseFile(file);
    }
  };
  const save = async (event) => {
    event.preventDefault();
    if (busyRef.current) return;
    setSubmitted(true);
    if (Object.keys(orderErrors(form)).length || imageError) return;
    busyRef.current = true;
    setBusy(true);
    setSaveError("");
    try {
      await onSave(form);
    } catch (error) {
      setSaveError(
        error?.message ===
          "Image uploads are not configured. Please contact Admin."
          ? error.message
          : "Order could not be saved. Please try again.",
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const title = record ? "Edit Order" : "Add Order";
  return (
    <OrderModal
      title={title}
      onClose={busy ? () => {} : onClose}
      busy={busy}
      className="order-form-dialog"
    >
      <form
        onSubmit={save}
        onPaste={(event) => {
          if (!["INPUT", "TEXTAREA"].includes(event.target.tagName))
            pasteImage(event);
        }}
      >
        <div className="order-dialog-body">
          <div className="order-form-grid">
            <label className="order-field">
              <span>
                Date <span className="order-required">*</span>
              </span>
              <input
                type="date"
                value={form.orderDate}
                aria-invalid={Boolean(
                  showError("orderDate") && errors.orderDate,
                )}
                onChange={(event) => update("orderDate", event.target.value)}
                onBlur={() =>
                  setTouched((current) => ({ ...current, orderDate: true }))
                }
              />
              {showError("orderDate") && errors.orderDate && (
                <small className="order-error">{errors.orderDate}</small>
              )}
            </label>
            <label className="order-field">
              <span>
                Client Name <span className="order-required">*</span>
              </span>
              <input
                value={form.clientName}
                placeholder="Enter client name"
                aria-invalid={Boolean(
                  showError("clientName") && errors.clientName,
                )}
                onChange={(event) => update("clientName", event.target.value)}
                onBlur={() =>
                  setTouched((current) => ({ ...current, clientName: true }))
                }
              />
              {showError("clientName") && errors.clientName && (
                <small className="order-error">{errors.clientName}</small>
              )}
            </label>
            <label className="order-field">
              <span>
                Staff Name <span className="order-required">*</span>
              </span>
              <input
                value={form.staffName}
                placeholder="Enter staff name"
                aria-invalid={Boolean(
                  showError("staffName") && errors.staffName,
                )}
                onChange={(event) => update("staffName", event.target.value)}
                onBlur={() =>
                  setTouched((current) => ({ ...current, staffName: true }))
                }
              />
              {showError("staffName") && errors.staffName && (
                <small className="order-error">{errors.staffName}</small>
              )}
            </label>
          </div>
          <label className="order-field order-details-field">
            <span>
              Order Details{" "}
              <span className="order-optional">
                (optional if an image is added)
              </span>
            </span>
            <textarea
              rows="5"
              value={form.description}
              placeholder="Paste or type order instructions here..."
              onChange={(event) => update("description", event.target.value)}
              onBlur={() =>
                setTouched((current) => ({ ...current, content: true }))
              }
            />
          </label>
          <div className="order-field">
            <span>
              Order Image{" "}
              <span className="order-optional">
                (optional if details are added)
              </span>
            </span>
            <div
              className="order-drop"
              tabIndex={0}
              onPaste={(event) => {
                event.stopPropagation();
                pasteImage(event);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                chooseFile(event.dataTransfer.files[0]);
              }}
            >
              {form.file || form.image ? (
                <div className="order-image-selection">
                  <img
                    src={previewUrl || form.image?.secureUrl}
                    alt={
                      form.file?.name ||
                      form.image?.filename ||
                      "Selected order"
                    }
                  />
                  <div>
                    <span>
                      {form.file?.name || form.image?.filename || "Order image"}
                    </span>
                    <div className="order-image-controls">
                      <label className="order-button order-secondary">
                        Replace Image
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          hidden
                          onChange={(event) => {
                            chooseFile(event.target.files[0]);
                            event.target.value = "";
                          }}
                        />
                      </label>
                      <button
                        type="button"
                        className="order-button order-secondary"
                        onClick={removeImage}
                      >
                        Remove Image
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <label className="order-upload-label">
                  <strong>Choose an image</strong> or paste / drop one here
                  <small>JPG, PNG or WEBP, up to 10 MB</small>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    hidden
                    onChange={(event) => {
                      chooseFile(event.target.files[0]);
                      event.target.value = "";
                    }}
                  />
                </label>
              )}
            </div>
            {imageError && (
              <small className="order-error" role="alert">
                {imageError}
              </small>
            )}
            {showError("content") && errors.content && (
              <small className="order-error" role="alert">
                {errors.content}
              </small>
            )}
            <small className="order-hint">
              Provide order details, an image, or both.
            </small>
          </div>
          {saveError && (
            <p className="order-feedback order-feedback-error" role="alert">
              {saveError}
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
            type="submit"
            className="order-button order-primary"
            disabled={busy}
          >
            {busy ? "Saving..." : record ? "Save Changes" : "Add Order"}
          </button>
        </footer>
      </form>
    </OrderModal>
  );
}
