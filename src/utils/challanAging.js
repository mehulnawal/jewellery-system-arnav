export const CHALLAN_AGING = {
  green: 24 * 60 * 60 * 1000,
  // Retained for the existing legend; it is not a separate status boundary.
  yellow: 60 * 60 * 60 * 1000,
  red: 5 * 24 * 60 * 60 * 1000,
};

export const timestampMs = (value) =>
  value?.toMillis?.() ??
  (value instanceof Date ? value.getTime() : Number(value) || 0);

export const formatElapsed = (milliseconds) => {
  const minutes = Math.max(0, Math.floor(milliseconds / 60000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  return days
    ? `${days}d ${hours}h`
    : hours
      ? `${hours}h ${mins}m`
      : `${mins}m`;
};

export const challanAging = (record, now = Date.now()) => {
  const elapsed = Math.max(0, now - timestampMs(record.createdAt));
  const status =
    elapsed < CHALLAN_AGING.green
      ? "green"
      : elapsed < CHALLAN_AGING.red
        ? "yellow"
        : "red";
  return {
    status,
    elapsed,
    label: status.toUpperCase(),
    elapsedLabel: formatElapsed(elapsed),
  };
};
