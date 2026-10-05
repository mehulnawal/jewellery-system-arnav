import React from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Outlet, Route, Routes, useLocation } from "react-router-dom";
import DashboardLayout from "../src/layouts/DashboardLayout";
import "../src/index.css";

function Page() {
  const location = useLocation();
  return <div data-testid="current-page">{location.pathname}</div>;
}
createRoot(document.getElementById("root")).render(
  <MemoryRouter initialEntries={["/dashboard"]}>
    <Routes>
      <Route path="/dashboard" element={<DashboardLayout />}>
        <Route index element={<Page />} />
        <Route path="inventory" element={<Page />} />
        <Route path="check-inventory" element={<Page />} />
        <Route path="purchase" element={<Page />} />
        <Route path="challan" element={<Page />} />
        <Route path="activity-log" element={<Page />} />
        <Route path="weekly-report" element={<Page />} />
        <Route path="vendor-purchase-history" element={<Page />} />
        <Route path="party-challan-history" element={<Page />} />
        <Route path="master-prices" element={<Page />} />
        <Route path="admin-settings" element={<Page />} />
      </Route>
    </Routes>
  </MemoryRouter>
);