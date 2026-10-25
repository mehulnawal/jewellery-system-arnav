export const ORDER_PAGE_SIZE = 25;

export function localOrderDate(now = new Date()) {
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

export function validOrderDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const date = new Date(value + "T00:00:00");
  return !Number.isNaN(date.getTime()) && localOrderDate(date) === value;
}

export function orderErrors(form) {
  const errors = {};
  if (!validOrderDate(form.orderDate)) errors.orderDate = "Enter a valid date.";
  if (!form.clientName.trim()) errors.clientName = "Client Name is required.";
  if (!form.staffName.trim()) errors.staffName = "Staff Name is required.";
  if (!form.description.trim() && !form.image && !form.file)
    errors.content = "Add order details or an image.";
  return errors;
}

const timestampMs = (value) => value?.toMillis?.() || 0;
const normal = (value) => String(value || "").toLocaleLowerCase();

export function filterOrders(orders, filters) {
  const query = normal(filters.search).trim();
  const rows = orders.filter((order) => {
    if (
      query &&
      ![order.clientName, order.staffName, order.description].some((value) =>
        normal(value).includes(query),
      )
    )
      return false;
    if (filters.from && order.orderDate < filters.from) return false;
    if (filters.to && order.orderDate > filters.to) return false;
    if (filters.client && order.clientName !== filters.client) return false;
    if (filters.staff && order.staffName !== filters.staff) return false;
    return true;
  });
  return rows.sort((left, right) => {
    if (filters.sort === "oldest") {
      return (
        left.orderDate.localeCompare(right.orderDate) ||
        timestampMs(left.createdAt) - timestampMs(right.createdAt)
      );
    }
    if (filters.sort === "added")
      return (
        timestampMs(right.createdAt) - timestampMs(left.createdAt) ||
        right.orderDate.localeCompare(left.orderDate)
      );
    if (filters.sort === "updated")
      return (
        timestampMs(right.updatedAt) - timestampMs(left.updatedAt) ||
        right.orderDate.localeCompare(left.orderDate)
      );
    return (
      right.orderDate.localeCompare(left.orderDate) ||
      timestampMs(right.createdAt) - timestampMs(left.createdAt)
    );
  });
}

export function formatOrderDate(value) {
  if (!validOrderDate(value)) return value || "-";
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value + "T00:00:00"));
}

export function formatOrderTimestamp(value) {
  const date = value?.toDate?.();
  return date
    ? new Intl.DateTimeFormat("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(date)
    : "-";
}
