import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "./AuthContext";
export default function ProtectedRoute() {
  const { user, isLoading } = useAuth();
  if (isLoading) return <main className="auth-loading">Loading...</main>;
  return user ? <Outlet /> : <Navigate to="/login" replace />;
}
export function PermissionRoute({ permission, adminOnly = false }) {
  const { user, hasPermission } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  const allowed = Array.isArray(permission)
    ? permission.some(hasPermission)
    : hasPermission(permission);
  if (adminOnly ? user.role !== "superadmin" : !allowed)
    return <Navigate to="/dashboard/check-inventory" replace />;
  return <Outlet />;
}
