import { fromMillis, weightMillis } from "./challanCalculations.js";
import { dayKey, instant } from "./dashboardAnalytics.js";

const text = (value) => (typeof value === "string" ? value.trim() : "");
export const formatCustomerGoodsWeight = (value) => `${value.toFixed(3)} ct`;

// The editable business issue date takes precedence over creation timestamps.
export function stageOneIssueDate(challan) {
  const date = text(challan.date);
  const parsed = new Date(`${date}T12:00:00Z`);
  if (
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === date
  )
    return date;
  const timestamp =
    instant(challan.stageHistory?.stage1?.enteredAtMs) ||
    instant(challan.createdAt) ||
    instant(challan.createdAtMs);
  return timestamp ? dayKey(timestamp) : "";
}

export function buildGoodsWithCustomers(
  challans,
  { search = "", from = "", to = "", sort = "carat-desc" } = {},
) {
  const groups = new Map();
  let excludedItems = 0;
  let undatedRecords = 0;
  for (const challan of challans) {
    if (challan.stage !== 1 && challan.stage !== "1") continue;
    const date = stageOneIssueDate(challan);
    if (!date) undatedRecords++;
    if ((from && (!date || date < from)) || (to && (!date || date > to)))
      continue;
    for (const item of Array.isArray(challan.items) ? challan.items : []) {
      const sku = text(item?.sku);
      let millis;
      try {
        if (!sku) throw new Error("Missing SKU");
        millis = weightMillis(item.weight);
        fromMillis(millis);
      } catch {
        excludedItems++;
        continue;
      }
      // Physical IDs prevent two distinct Inventory records sharing a label.
      const physicalId = text(item.sourceInventoryId) || text(item.inventoryId);
      const key = JSON.stringify([physicalId || null, sku]);
      if (!groups.has(key))
        groups.set(key, { key, sku, millis: 0n, details: [] });
      const group = groups.get(key);
      try {
        fromMillis(group.millis + millis);
      } catch {
        excludedItems++;
        continue;
      }
      group.millis += millis;
      group.details.push({
        customer: text(challan.party) || "Customer unknown",
        carat: fromMillis(millis),
        date,
        number: String(challan.number ?? "").trim() || "Number unavailable",
      });
    }
  }
  const rows = [...groups.values()]
    .map(({ millis, ...group }) => ({ ...group, carat: fromMillis(millis) }))
    .filter((group) =>
      group.sku.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
    );
  const alphabetical = (a, b) =>
    a.sku.localeCompare(b.sku, "en") || a.key.localeCompare(b.key, "en");
  rows.sort((a, b) => {
    if (sort === "sku-asc") return alphabetical(a, b);
    if (sort === "sku-desc") return -alphabetical(a, b);
    return (
      (sort === "carat-asc" ? a.carat - b.carat : b.carat - a.carat) ||
      alphabetical(a, b)
    );
  });
  return { rows, excludedItems, undatedRecords };
}
