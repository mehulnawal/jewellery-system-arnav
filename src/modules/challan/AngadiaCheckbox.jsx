export default function AngadiaCheckbox({
  checked,
  disabled,
  saving,
  error,
  onChange,
}) {
  return (
    <div className="challan-angadia-control">
      <label>
        <input
          type="checkbox"
          checked={checked === true}
          disabled={disabled || saving}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>Angadia Service</span>
      </label>
      {saving && (
        <span className="challan-angadia-status" role="status">
          Saving…
        </span>
      )}
      {error && (
        <span className="challan-angadia-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
