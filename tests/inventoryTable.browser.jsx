import "../src/index.css";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { disableNetwork } from "firebase/firestore";
import { db } from "./fixtures/firebase.js";
import { ToastProvider } from "../src/ui/ToastContext.jsx";
import Inventory from "../src/modules/inventory/Inventory.jsx";

await disableNetwork(db);

createRoot(document.getElementById("root")).render(
  <MemoryRouter>
    <ToastProvider>
      <Inventory />
    </ToastProvider>
  </MemoryRouter>,
);
