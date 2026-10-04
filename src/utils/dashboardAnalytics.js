import { normalizeSize } from "./dimensions.js";
const DAY = 86400000;
const finite = (value) =>
  value !== null &&
  value !== undefined &&
  value !== "" &&
  Number.isFinite(Number(value));
const number = (value) => Number(value);
export const instant = (value) =>
  value?.toMillis?.() ??
  (value instanceof Date ? value.getTime() : finite(value) ? number(value) : 0);
export const dayKey = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const dateMs = (value) =>
  /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))
    ? new Date(`${value}T12:00:00`).getTime()
    : 0;
const inPeriod = (value, from, to) =>
  Boolean(value && value >= from && value <= to);
const groupKey = (row) =>
  [
    row.shape || "Unknown shape",
    normalizeSize(row.size) || "Unknown size",
    row.type || "Unknown type",
  ].join(" | ");
const ratio = (part, total) => (total > 0 ? (part / total) * 100 : null);
const validWeight = (value) => finite(value) && number(value) >= 0;

export function buildDashboardAnalytics({
  inventory = [],
  purchases = [],
  challans = [],
  from,
  to,
  now = Date.now(),
  movementAvailable = true,
}) {
  const today = dayKey(now);
  const periodStart = from || dayKey(now - 29 * DAY);
  const periodEnd = to || today;
  const groups = new Map();
  const stockById = new Map();
  const movementById = new Map();
  const movementTotalsById = new Map();
  const partyMap = new Map();
  const aging = [
    { label: "0-30 days", min: 0, max: 30, weight: 0, count: 0 },
    { label: "31-60 days", min: 31, max: 60, weight: 0, count: 0 },
    { label: "61-90 days", min: 61, max: 90, weight: 0, count: 0 },
    { label: "90+ days", min: 91, max: Infinity, weight: 0, count: 0 },
  ];
  let unknownAgeCount = 0;
  let invalidStockCount = 0;
  const ensureGroup = (key) => {
    if (!groups.has(key))
      groups.set(key, {
        key,
        stock: 0,
        count: 0,
        oldestDays: 0,
        sold: 0,
        returned: 0,
        sent: 0,
      });
    return groups.get(key);
  };
  for (const item of inventory) {
    if (!validWeight(item.weight)) invalidStockCount += 1;
    const stock = validWeight(item.weight) ? number(item.weight) : 0;
    const created = instant(item.createdAt) || instant(item.createdAtMs);
    const ageDays = created
      ? Math.max(0, Math.floor((now - created) / DAY))
      : null;
    const group = ensureGroup(groupKey(item));
    group.stock += stock;
    if (stock > 0) {
      group.count += 1;
      group.oldestDays = Math.max(group.oldestDays, ageDays || 0);
    }
    stockById.set(item.id, { ...item, stock, ageDays, key: group.key });
    if (stock > 0 && ageDays === null) unknownAgeCount += 1;
    else if (stock > 0) {
      const bucket = aging.find(
        (entry) => ageDays >= entry.min && ageDays <= entry.max,
      );
      bucket.weight += stock;
      bucket.count += 1;
    }
  }
  const stage = [1, 2, 3, 4].map((value) => ({
    stage: value,
    count: 0,
    weight: 0,
    sold: 0,
    returned: 0,
    amount: 0,
  }));
  const processed = {
    sent: 0,
    sold: 0,
    returned: 0,
    challans: 0,
    excludedRows: 0,
    undatedRows: 0,
  };
  let completedInPeriod = 0;
  const markMovement = (id, at) => {
    if (id && at > (movementById.get(id) || 0)) movementById.set(id, at);
  };
  const itemIdentity = (item) =>
    item.sourceInventoryId || item.inventoryId || "";
  for (const challan of challans) {
    const currentStage = Math.min(4, Math.max(1, Number(challan.stage) || 1));
    const state = stage[currentStage - 1];
    state.count += 1;
    const created =
      instant(challan.createdAt) ||
      instant(challan.createdAtMs) ||
      instant(challan.stageHistory?.stage1?.enteredAtMs);
    for (const item of challan.items || []) {
      if (currentStage === 1 && validWeight(item.weight))
        state.weight += number(item.weight);
      markMovement(itemIdentity(item), created);
    }
    if (currentStage === 3 && finite(challan.finalInvoice?.finalInvoiceAmount))
      state.amount += number(challan.finalInvoice.finalInvoiceAmount);
    if (currentStage === 3 && !finite(challan.finalInvoice?.finalInvoiceAmount))
      state.missingAmount = (state.missingAmount || 0) + 1;
    if (
      currentStage === 4 &&
      inPeriod(
        dayKey(
          instant(challan.finalSettlement?.completedAtMs) ||
            instant(challan.stageHistory?.stage4?.enteredAtMs),
        ),
        periodStart,
        periodEnd,
      )
    )
      completedInPeriod += 1;
    const transitionAt =
      instant(challan.stage2Return?.transitionedAtMs) ||
      instant(challan.stageHistory?.stage2?.enteredAtMs);
    for (const item of challan.stage2Return?.items || []) {
      markMovement(itemIdentity(item), transitionAt);
      if (currentStage === 2) {
        if (validWeight(item.soldWeight)) state.sold += number(item.soldWeight);
        if (validWeight(item.returnWeight))
          state.returned += number(item.returnWeight);
      }
      if (!transitionAt) {
        processed.undatedRows += 1;
        continue;
      }
      if (!inPeriod(dayKey(transitionAt), periodStart, periodEnd)) continue;
      if (
        ![item.issuedWeight, item.soldWeight, item.returnWeight].every(
          validWeight,
        )
      ) {
        processed.excludedRows += 1;
        continue;
      }
      const sent = number(item.issuedWeight),
        sold = number(item.soldWeight),
        returned = number(item.returnWeight);
      if (Math.abs(sent - sold - returned) > 0.011) {
        processed.excludedRows += 1;
        continue;
      }
      processed.sent += sent;
      processed.sold += sold;
      processed.returned += returned;
      const key = groupKey(item);
      const group = ensureGroup(key);
      group.sent += sent;
      group.sold += sold;
      group.returned += returned;
      const inventoryId = itemIdentity(item);
      if (inventoryId) {
        if (!movementTotalsById.has(inventoryId))
          movementTotalsById.set(inventoryId, {
            sent: 0,
            sold: 0,
            returned: 0,
          });
        const itemTotals = movementTotalsById.get(inventoryId);
        itemTotals.sent += sent;
        itemTotals.sold += sold;
        itemTotals.returned += returned;
      }
      const partyName = String(challan.party || "").trim();
      if (partyName) {
        const partyKey = partyName.toLocaleLowerCase();
        if (!partyMap.has(partyKey))
          partyMap.set(partyKey, {
            name: partyName,
            sent: 0,
            sold: 0,
            returned: 0,
            challanIds: new Set(),
          });
        const party = partyMap.get(partyKey);
        party.sent += sent;
        party.sold += sold;
        party.returned += returned;
        party.challanIds.add(challan.id);
      }
    }
    if (
      inPeriod(dayKey(transitionAt), periodStart, periodEnd) &&
      challan.stage2Return?.items?.length
    )
      processed.challans += 1;
  }
  const allGroups = [...groups.values()]
    .map((entry) => ({
      ...entry,
      conversion: ratio(entry.sold, entry.sent),
      returnRate: ratio(entry.returned, entry.sent),
    }))
    .sort((a, b) => b.sold - a.sold || b.sent - a.sent);
  const performance = allGroups.filter((entry) => entry.sold > 0);
  const parties = [...partyMap.values()].map((party) => ({
    ...party,
    challanCount: party.challanIds.size,
    conversion: ratio(party.sold, party.sent),
    returnRate: ratio(party.returned, party.sent),
  }));
  const rankedParties = parties.filter(
    (party) => party.sent >= 3 && party.challanCount >= 2,
  );
  const strongParties = [...rankedParties]
    .filter((party) => party.conversion >= 60)
    .sort((a, b) => b.conversion - a.conversion || b.sent - a.sent)
    .slice(0, 3);
  const highReturnParties = [...rankedParties]
    .filter((party) => party.returnRate >= 50)
    .sort((a, b) => b.returnRate - a.returnRate || b.sent - a.sent)
    .slice(0, 3);
  const clearFirst = [...stockById.values()]
    .filter((item) => item.stock > 0 && item.ageDays !== null)
    .map((item) => {
      const itemTotals = movementTotalsById.get(item.id) || {
        sent: 0,
        sold: 0,
        returned: 0,
      };
      const lastMovement = movementById.get(item.id) || 0;
      const daysSinceMovement = lastMovement
        ? Math.floor((now - lastMovement) / DAY)
        : null;
      const returnRate = movementAvailable
        ? ratio(itemTotals.returned, itemTotals.sent)
        : null;
      const reasons = [];
      let score = 0;
      if (item.ageDays > 90) {
        score += 3;
        reasons.push("90+ days in stock");
      } else if (item.ageDays > 60) {
        score += 2;
        reasons.push("61+ days in stock");
      }
      if (item.stock >= 10) {
        score += 2;
        reasons.push("10+ ct available");
      } else if (item.stock >= 3) score += 1;
      if (
        movementAvailable &&
        (daysSinceMovement === null || daysSinceMovement >= 30)
      ) {
        score += 2;
        reasons.push("No recent Challan movement");
      }
      if (movementAvailable && itemTotals.sent >= 3 && returnRate >= 50) {
        score += 2;
        reasons.push(`${Math.round(returnRate)}% returned`);
      }
      if (movementAvailable && itemTotals.sent >= 3 && itemTotals.sold === 0) {
        score += 1;
        reasons.push("No sale in period");
      }
      return {
        ...item,
        score,
        lastMovement: movementAvailable ? lastMovement : null,
        sold: movementAvailable ? itemTotals.sold : null,
        returned: movementAvailable ? itemTotals.returned : null,
        returnRate,
        reason: reasons.slice(0, 2).join(" + ") || "Current stock",
      };
    })
    .filter((item) => item.score >= 3)
    .sort(
      (a, b) => b.score - a.score || b.stock - a.stock || b.ageDays - a.ageDays,
    )
    .slice(0, 5);
  const purchaseDue = {
    overdue: { count: 0, amount: 0 },
    today: { count: 0, amount: 0 },
    next7: { count: 0, amount: 0 },
    rows: [],
    unknownAmount: 0,
  };
  const next7 = dayKey(now + 7 * DAY);
  for (const purchase of purchases) {
    const due = purchase.paymentDueDate;
    if (!dateMs(due)) continue;
    const status =
      due < today
        ? "overdue"
        : due === today
          ? "today"
          : due <= next7
            ? "next7"
            : null;
    if (!status) continue;
    purchaseDue[status].count += 1;
    if (finite(purchase.netPayable) && number(purchase.netPayable) >= 0)
      purchaseDue[status].amount += number(purchase.netPayable);
    else purchaseDue.unknownAmount += 1;
    purchaseDue.rows.push({ ...purchase, dueStatus: status });
  }
  purchaseDue.rows.sort((a, b) =>
    a.paymentDueDate.localeCompare(b.paymentDueDate),
  );
  const largestPurchases = purchases
    .filter(
      (purchase) =>
        inPeriod(purchase.date, periodStart, periodEnd) &&
        finite(purchase.totalWeight) &&
        number(purchase.totalWeight) > 0,
    )
    .sort((a, b) => number(b.totalWeight) - number(a.totalWeight))
    .slice(0, 3)
    .map((purchase) => ({
      ...purchase,
      avgCost:
        finite(purchase.netPayable) && number(purchase.netPayable) >= 0
          ? number(purchase.netPayable) / number(purchase.totalWeight)
          : null,
    }));
  const aged90 = aging[3];
  const oldChallans = { h24: 0, h60: 0, d5: 0 };
  for (const challan of challans) {
    if (![1, 2].includes(Number(challan.stage) || 1)) continue;
    const created = instant(challan.createdAt) || instant(challan.createdAtMs);
    if (!created) continue;
    const hours = (now - created) / 3600000;
    if (hours >= 120) oldChallans.d5 += 1;
    else if (hours >= 60) oldChallans.h60 += 1;
    else if (hours >= 24) oldChallans.h24 += 1;
  }
  const atRisk = allGroups
    .filter(
      (group) =>
        group.stock > 0 &&
        (group.oldestDays > 90 || (group.sent >= 3 && group.returnRate >= 50)),
    )
    .sort((a, b) => b.stock - a.stock)
    .slice(0, 2);
  const movingStrongly = performance
    .filter(
      (group) => group.sold > 0 && group.sent >= 3 && group.conversion >= 70,
    )
    .slice(0, 2);
  return {
    periodStart,
    periodEnd,
    aging,
    unknownAgeCount,
    invalidStockCount,
    performance: performance.slice(0, 5),
    parties,
    strongParties,
    highReturnParties,
    processed: {
      ...processed,
      conversion: ratio(processed.sold, processed.sent),
    },
    stage,
    completedInPeriod,
    clearFirst,
    purchaseDue,
    largestPurchases,
    oldChallans,
    aged90,
    atRisk,
    movingStrongly,
    currentStock: [...stockById.values()].reduce(
      (sum, item) => sum + item.stock,
      0,
    ),
  };
}
