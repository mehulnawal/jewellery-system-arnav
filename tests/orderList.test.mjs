import { test } from "node:test";
import assert from "node:assert/strict";
import {
  filterOrders,
  orderErrors,
  validOrderDate,
} from "../src/modules/orderList/orderListModel.js";

const base = {
  orderDate: "2026-10-21",
  clientName: " Client ",
  staffName: " Staff ",
  description: "Ring order\nSize 12\n\nRose gold",
  image: null,
  file: null,
};
const errors = (changes) => orderErrors({ ...base, ...changes });
const stamp = (ms) => ({ toMillis: () => ms });
const rows = [
  {
    id: "a",
    orderDate: "2026-10-20",
    clientName: "Alpha",
    staffName: "Sana",
    description: "Ring",
    createdAt: stamp(10),
    updatedAt: stamp(40),
  },
  {
    id: "b",
    orderDate: "2026-10-21",
    clientName: "Beta",
    staffName: "John",
    description: "Pendant",
    createdAt: stamp(20),
    updatedAt: stamp(30),
  },
  {
    id: "c",
    orderDate: "2026-10-21",
    clientName: "Alpha",
    staffName: "John",
    description: "Rose gold",
    createdAt: stamp(30),
    updatedAt: stamp(20),
  },
];
const filters = {
  search: "",
  from: "",
  to: "",
  client: "",
  staff: "",
  sort: "newest",
};

test("required fields and content combinations", () => {
  assert.deepEqual(errors({}), {});
  assert.deepEqual(errors({ description: "", image: { secureUrl: "x" } }), {});
  assert.deepEqual(errors({ description: "", file: { name: "x.png" } }), {});
  assert.equal(
    errors({ description: "  \n  " }).content,
    "Add order details or an image.",
  );
  assert.equal(
    errors({ clientName: "  " }).clientName,
    "Client Name is required.",
  );
  assert.equal(
    errors({ staffName: "\t" }).staffName,
    "Staff Name is required.",
  );
  assert.ok(errors({ orderDate: "" }).orderDate);
  assert.equal(validOrderDate("2026-10-21"), true);
  assert.equal(validOrderDate("2026-02-30"), false);
  assert.equal(base.description, "Ring order\nSize 12\n\nRose gold");
});
test("search, date, client and staff filters and all sort modes", () => {
  assert.deepEqual(
    filterOrders(rows, filters).map((row) => row.id),
    ["c", "b", "a"],
  );
  assert.deepEqual(
    filterOrders(rows, { ...filters, sort: "oldest" }).map((row) => row.id),
    ["a", "b", "c"],
  );
  assert.deepEqual(
    filterOrders(rows, { ...filters, sort: "added" }).map((row) => row.id),
    ["c", "b", "a"],
  );
  assert.deepEqual(
    filterOrders(rows, { ...filters, sort: "updated" }).map((row) => row.id),
    ["a", "b", "c"],
  );
  for (const [change, expected] of [
    [{ search: "ROSE" }, ["c"]],
    [{ search: "sana" }, ["a"]],
    [{ search: "beta" }, ["b"]],
    [{ from: "2026-10-21" }, ["c", "b"]],
    [{ to: "2026-10-20" }, ["a"]],
    [{ client: "Alpha", staff: "John" }, ["c"]],
  ])
    assert.deepEqual(
      filterOrders(rows, { ...filters, ...change }).map((row) => row.id),
      expected,
    );
});
