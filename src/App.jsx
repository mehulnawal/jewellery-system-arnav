import { Navigate, Route, Routes } from "react-router-dom";
import ProtectedRoute, { PermissionRoute } from "./auth/ProtectedRoute";
import DashboardLayout from "./layouts/DashboardLayout";
import Inventory from "./modules/inventory/Inventory";
import CheckInventory from "./modules/checkInventory/CheckInventory";
import Challan from "./modules/challan/Challan";
import AdminSettings from "./modules/admin/AdminSettings";
import ActivityLog from "./modules/activityLog/ActivityLog";
import NotFound from "./pages/NotFound";
import Login from "./pages/Login";
const CHALLAN_PERMISSIONS = [
  "challan-stage-1",
  "challan-stage-2",
  "challan-stage-3",
  "challan-stage-4",
];
export default function App() {
  return (
    <Routes>
      <Route element={<ProtectedRoute />}>
        <Route path="/dashboard" element={<DashboardLayout />}>
          <Route index element={<Navigate to="check-inventory" replace />} />
          <Route element={<PermissionRoute permission="inventory" />}>
            <Route path="inventory" element={<Inventory />} />
          </Route>
          <Route path="check-inventory" element={<CheckInventory />} />
          <Route element={<PermissionRoute permission={CHALLAN_PERMISSIONS} />}>
            <Route path="challan" element={<Challan />} />
          </Route>
          <Route element={<PermissionRoute adminOnly />}>
            <Route path="activity-log" element={<ActivityLog />} />
            <Route path="admin-settings" element={<AdminSettings />} />
          </Route>
        </Route>
      </Route>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
