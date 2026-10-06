const uid = localStorage.getItem("test-role") || "admin";
export const testUser = {
  uid: localStorage.getItem("test-role") || "admin",
  role: uid === "admin" ? "superadmin" : "employee",
  accessId: localStorage.getItem("test-role") || "admin",
  name: "Local Test",
  active: true,
  permissions: uid === "admin" ? [] : uid === "purchase-only" ? ["purchase"] : uid === "no-purchase" ? ["inventory"] : uid === "stage-one" ? ["challan-stage-1"] : uid === "stage-two" ? ["challan-stage-2"] : ["inventory", "purchase", "challan-stage-1", "challan-stage-2", "challan-stage-3", "challan-stage-4"],
};
export function AuthProvider({ children }) { return children; }
export const useAuth = () => ({
  user: testUser, isLoading: false, loading: false,
  hasPermission: (permission) => testUser.role === "superadmin" || testUser.permissions.includes(permission),
  logout: async () => {},
});
