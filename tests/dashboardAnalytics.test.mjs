import assert from "node:assert/strict";
import test from "node:test";
import { buildDashboardAnalytics } from "../src/utils/dashboardAnalytics.js";

const now = new Date("2026-09-29T12:00:00").getTime();
const daysAgo = (days) => now - days * 86400000;
const inventory = [
  {
    id: "i1",
    sku: "ROUND-1",
    shape: "Round",
    size: "1.2",
    type: "CVD",
    weight: 8,
    createdAtMs: daysAgo(95),
  },
  {
    id: "i2",
    sku: "MARQUISE-1",
    shape: "Marquise",
    size: "2",
    type: "HP",
    weight: 1,
    createdAtMs: daysAgo(5),
  },
];
const challans = [
  {
    id: "c1",
    party: "Party A",
    stage: 3,
    createdAtMs: daysAgo(10),
    finalInvoice: { finalInvoiceAmount: 1200 },
    stage2Return: {
      transitionedAtMs: daysAgo(2),
      items: [
        {
          inventoryId: "i1",
          shape: "Round",
          size: "1.2",
          type: "CVD",
          issuedWeight: 5,
          soldWeight: 4,
          returnWeight: 1,
        },
      ],
    },
  },
  {
    id: "c2",
    party: "Party A",
    stage: 4,
    createdAtMs: daysAgo(8),
    finalSettlement: { completedAtMs: daysAgo(1) },
    stage2Return: {
      transitionedAtMs: daysAgo(1),
      items: [
        {
          inventoryId: "i1",
          shape: "Round",
          size: "1.2",
          type: "CVD",
          issuedWeight: 5,
          soldWeight: 3,
          returnWeight: 2,
        },
      ],
    },
  },
  {
    id: "c3",
    party: "Party B",
    stage: 2,
    createdAtMs: daysAgo(6),
    stage2Return: {
      transitionedAtMs: daysAgo(1),
      items: [
        {
          inventoryId: "i2",
          shape: "Marquise",
          size: "2",
          type: "HP",
          issuedWeight: 10,
          soldWeight: 1,
          returnWeight: 9,
        },
      ],
    },
  },
  {
    id: "c4",
    party: "Legacy",
    stage: 2,
    createdAtMs: daysAgo(4),
    stage2Return: {
      transitionedAtMs: daysAgo(2),
      items: [
        {
          shape: "Pear",
          size: "3",
          type: "HP",
          issuedWeight: 2,
          returnWeight: 1,
        },
      ],
    },
  },
  {
    id: "c5",
    party: "Legacy",
    stage: 2,
    createdAtMs: daysAgo(20),
    stage2Return: {
      items: [
        {
          shape: "Pear",
          size: "3",
          type: "HP",
          issuedWeight: 1,
          soldWeight: 1,
          returnWeight: 0,
        },
      ],
    },
  },
];
const purchases = [
  {
    id: "p1",
    purchaseId: "PR-A1-1",
    date: "2026-09-28",
    paymentDueDate: "2026-09-28",
    totalWeight: 20,
    netPayable: 40000,
  },
  {
    id: "p2",
    purchaseId: "PR-A1-2",
    date: "2026-09-25",
    paymentDueDate: "2026-09-29",
    totalWeight: 30,
    netPayable: 90000,
  },
  {
    id: "p3",
    purchaseId: "PR-A1-3",
    date: "2026-08-01",
    paymentDueDate: "2026-10-02",
    totalWeight: 40,
    netPayable: 80000,
  },
];
const analyze = (overrides = {}) =>
  buildDashboardAnalytics({
    inventory,
    challans,
    purchases,
    from: "2026-09-01",
    to: "2026-09-29",
    now,
    ...overrides,
  });

test("actual S2 sold and returned weights drive conversion and Party ranking", () => {
  const result = analyze();
  assert.equal(result.processed.sent, 20);
  assert.equal(result.processed.sold, 8);
  assert.equal(result.processed.returned, 12);
  assert.equal(result.processed.conversion, 40);
  assert.equal(result.processed.excludedRows, 1);
  assert.equal(result.processed.undatedRows, 1);
  assert.equal(result.completedInPeriod, 1);
  assert.equal(result.performance[0].key, "Round | 1.2 | CVD");
  assert.equal(result.strongParties[0].name, "Party A");
  assert.equal(result.strongParties[0].conversion, 70);
  assert.equal(result.clearFirst[0].sku, "ROUND-1");
  assert.equal(result.clearFirst[0].sold, 7);
  assert.equal(result.clearFirst[0].returned, 3);
});

test("historical period changes do not reset current stock, aging, stages or due schedule", () => {
  const current = analyze();
  const past = analyze({ from: "2026-07-01", to: "2026-07-31" });
  assert.equal(past.processed.sent, 0);
  assert.equal(past.processed.conversion, null);
  assert.equal(past.currentStock, current.currentStock);
  assert.deepEqual(past.aging, current.aging);
  assert.equal(past.stage[2].amount, 1200);
  assert.deepEqual(past.purchaseDue, current.purchaseDue);
});

test("Purchase due groups, largest weight and average payable cost use saved fields", () => {
  const result = analyze();
  assert.equal(result.purchaseDue.overdue.count, 1);
  assert.equal(result.purchaseDue.today.count, 1);
  assert.equal(result.purchaseDue.next7.count, 1);
  assert.equal(result.largestPurchases[0].purchaseId, "PR-A1-2");
  assert.equal(result.largestPurchases[0].avgCost, 3000);
  assert.equal(result.aging[3].weight, 8);
  assert.equal(result.aging[3].count, 1);
});

test("missing Challan permission does not invent movement signals", () => {
  const result = analyze({ challans: [], movementAvailable: false });
  assert.equal(result.clearFirst[0].sold, null);
  assert.equal(result.clearFirst[0].returned, null);
  assert.ok(!result.clearFirst[0].reason.includes("Challan"));
});

test("high-return ranking requires meaningful Party volume and repeated Challans", () => {
  const result = analyze({
    challans: [
      ...challans,
      {
        id: "c6",
        party: "Party B",
        stage: 2,
        createdAtMs: daysAgo(3),
        stage2Return: {
          transitionedAtMs: daysAgo(1),
          items: [
            {
              inventoryId: "i2",
              shape: "Marquise",
              size: "2",
              type: "HP",
              issuedWeight: 5,
              soldWeight: 0,
              returnWeight: 5,
            },
          ],
        },
      },
    ],
  });
  assert.equal(result.highReturnParties[0].name, "Party B");
  assert.equal(result.highReturnParties[0].sent, 15);
  assert.equal(result.strongParties[0].name, "Party A");
  assert.ok(
    result.highReturnParties.every((party) => party.name !== "Party A"),
  );
});
