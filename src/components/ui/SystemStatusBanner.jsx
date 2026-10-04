export default function SystemStatusBanner({ phase, code, retry }) {
  const title =
    phase === "loading"
      ? "Checking system status"
      : phase === "error"
        ? "System status configuration error"
        : "Connection issue";
  const description =
    phase === "loading"
      ? "Saving will be available after verification."
      : phase === "error"
        ? code === "permission-denied"
          ? "System status access was denied. Check the signed-in account and Firebase rules. Records remain viewable; saving is paused."
          : "System status could not be verified. Check Firebase configuration and the status marker. Saving is paused."
        : "Some live updates and saving may be temporarily unavailable.";
  return (
    <aside
      className="availability-banner"
      role={phase === "loading" ? "status" : "alert"}
    >
      <span className="availability-icon" aria-hidden="true">
        {phase === "loading" ? "↻" : "⚠"}
      </span>
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
      <button type="button" onClick={retry}>
        Retry connection
      </button>
    </aside>
  );
}
