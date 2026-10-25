export const isAdminAccount = (user) => user?.role === "superadmin";

export const hasModulePermission = (user, key) =>
  isAdminAccount(user) ||
  (user?.role === "admin" && key === "challan-stage-4") ||
  Boolean(
    user?.permissions?.includes(key) || user?.allowedModules?.includes(key),
  );

export const landingPath = (user) =>
  isAdminAccount(user) ? "/dashboard" : "/dashboard/check-inventory";
