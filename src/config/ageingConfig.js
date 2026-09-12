export const AGEING_GREEN_MAX_DAYS = 30;
export const AGEING_YELLOW_MAX_DAYS = 45;
export function getAgeingDays(createdAt, createdAtMs) {
  const date = createdAt?.toDate?.() ?? new Date(createdAtMs ?? Date.now());
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000));
}
export function getAgeingColor(days) {
  return days <= AGEING_GREEN_MAX_DAYS
    ? "green"
    : days <= AGEING_YELLOW_MAX_DAYS
      ? "yellow"
      : "red";
}
