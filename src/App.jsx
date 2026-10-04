import { Navigate, Route, Routes } from "react-router-dom";
import ProtectedRoute, { PermissionRoute } from "./auth/ProtectedRoute";
import DashboardLayout from "./layouts/DashboardLayout";
import BusinessDashboard from "./modules/dashboard/BusinessDashboard";
import Inventory from "./modules/inventory/Inventory";
import CheckInventory from "./modules/checkInventory/CheckInventory";
import Challan from "./modules/challan/Challan";
import AdminSettings from "./modules/admin/AdminSettings";
import ActivityLog from "./modules/activityLog/ActivityLog";
import WeeklyReport from "./modules/weeklyReport/WeeklyReport";
import Purchase from "./modules/purchase/Purchase";
import VendorPurchaseHistory from "./modules/history/VendorPurchaseHistory";
import PartyChallanHistory from "./modules/history/PartyChallanHistory";
import NotFound from "./pages/NotFound";
import Login from "./pages/Login";
import MasterPrices from "./modules/masterPrices/MasterPrices";
import DangerZone from "./modules/admin/DangerZone";
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
          <Route index element={<BusinessDashboard />} />
          <Route element={<PermissionRoute permission="inventory" />}>
            <Route path="inventory" element={<Inventory />} />
          </Route>
          <Route path="check-inventory" element={<CheckInventory />} />
          <Route element={<PermissionRoute permission="purchase" />}>
            <Route path="purchase" element={<Purchase />} />
          </Route>
          <Route element={<PermissionRoute permission={CHALLAN_PERMISSIONS} />}>
            <Route path="challan" element={<Challan />} />
          </Route>
          <Route element={<PermissionRoute adminOnly />}>
            <Route path="master-prices" element={<MasterPrices />} />
            <Route path="activity-log" element={<ActivityLog />} />
            <Route path="weekly-report" element={<WeeklyReport />} />
            <Route path="admin-settings" element={<AdminSettings />} />
            <Route path="admin-settings/danger-zone" element={<DangerZone />} />
            <Route
              path="vendor-purchase-history"
              element={<VendorPurchaseHistory />}
            />
            <Route
              path="party-challan-history"
              element={<PartyChallanHistory />}
            />
            <Route
              path="admin/vendor-purchase-history"
              element={
                <Navigate to="/dashboard/vendor-purchase-history" replace />
              }
            />
            <Route
              path="admin/party-challan-history"
              element={
                <Navigate to="/dashboard/party-challan-history" replace />
              }
            />
          </Route>
        </Route>
        <Route element={<PermissionRoute adminOnly />}>
          <Route
            path="/admin/vendor-purchase-history"
            element={
              <Navigate to="/dashboard/vendor-purchase-history" replace />
            }
          />
          <Route
            path="/admin/party-challan-history"
            element={<Navigate to="/dashboard/party-challan-history" replace />}
          />
        </Route>
      </Route>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
