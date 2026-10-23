import { useState } from "react";
import { createRoot } from "react-dom/client";
import "../src/index.css";
import "../src/modules/dashboard/businessDashboard.css";
import GoodsWithCustomers from "../src/modules/dashboard/GoodsWithCustomers.jsx";

const fixture = [7, 3, 4].map((weight, i) => ({
  id: String(i),
  stage: 1,
  number: `CH-${101 + i}`,
  party: ["Rohan", "Shyam", "Manoj"][i],
  date: ["2026-10-20", "2026-10-21", "2026-10-23"][i],
  items: [{ sku: "3.35_Oval_HP", inventoryId: "i1", weight }],
}));
function Harness() {
  const [records, setRecords] = useState(fixture);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="business-dashboard">
      <div>
        <button
          onClick={() =>
            setRecords([
              ...fixture,
              {
                ...fixture[0],
                id: "new",
                number: "CH-104",
                items: [{ ...fixture[0].items[0], weight: 2 }],
              },
            ])
          }
        >
          Create / import snapshot
        </button>
        <button
          onClick={() =>
            setRecords(
              fixture.map((r, i) =>
                i === 1 ? { ...r, items: [{ ...r.items[0], weight: 5 }] } : r,
              ),
            )
          }
        >
          Edit snapshot
        </button>
        <button onClick={() => setRecords(fixture.slice(0, 2))}>
          Delete snapshot
        </button>
        <button
          onClick={() =>
            setRecords(
              fixture.map((r, i) => (i === 0 ? { ...r, stage: 2 } : r)),
            )
          }
        >
          Transition snapshot
        </button>
        <button onClick={() => setRecords([])}>Empty snapshot</button>
        <button onClick={() => setLoading((value) => !value)}>
          Toggle loading
        </button>
        <button
          onClick={() =>
            setError((value) => (value ? "" : "permission-denied"))
          }
        >
          Toggle error
        </button>
      </div>
      <GoodsWithCustomers records={records} loading={loading} error={error} />
    </div>
  );
}
createRoot(document.getElementById("root")).render(<Harness />);
