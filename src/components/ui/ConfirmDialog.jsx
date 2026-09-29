import "./confirmDialog.css";

export default function ConfirmDialog({
  title,
  children,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
  onCancel,
}) {
  return (
    <div className="confirm-dialog-backdrop" role="presentation">
      <section
        className="confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
      >
        <h2 id="confirm-dialog-title">{title}</h2>
        <div className="confirm-dialog-body">{children}</div>
        <footer>
          <button
            type="button"
            className={destructive ? "is-destructive" : ""}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
          <button type="button" onClick={onCancel}>
            {cancelLabel}
          </button>
        </footer>
      </section>
    </div>
  );
}
