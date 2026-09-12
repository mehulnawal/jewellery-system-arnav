import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "./AuthContext";
export default function SuperAdminRoute() {
  const { user } = useAuth();
  return user?.role === "superadmin" ? (
    <Outlet />
  ) : (
    <Navigate to="/dashboard/inventory" replace />
  );
}
