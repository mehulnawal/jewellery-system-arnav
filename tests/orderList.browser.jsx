import { useState } from "react";
import { createRoot } from "react-dom/client";
import OrderForm from "../src/modules/orderList/OrderForm";
import "../src/modules/orderList/orderList.css";
import "../src/index.css";

function Harness() {
  const [mode, setMode] = useState(null);
  const sample = {
    orderDate: "2026-10-23",
    clientName: "Ananya Sharma",
    staffName: "Ravi Kumar",
    description: "Custom necklace\nConfirm stone setting",
    image: {
      secureUrl:
        "data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2780%27 height=%2780%27%3E%3Crect width=%2780%27 height=%2780%27 fill=%27%23168c61%27/%3E%3C/svg%3E",
      filename: "order-image.svg",
    },
  };
  return (
    <main>
      <button type="button" onClick={() => setMode("add")}>
        Open Add Order
      </button>
      <button type="button" onClick={() => setMode("edit")}>
        Open Edit Order
      </button>
      {mode && (
        <OrderForm
          record={mode === "edit" ? sample : undefined}
          onClose={() => setMode(null)}
          onSave={async (form) => {
            window.savedOrder = form;
            setMode(null);
          }}
        />
      )}
    </main>
  );
}
createRoot(document.getElementById("root")).render(<Harness />);
