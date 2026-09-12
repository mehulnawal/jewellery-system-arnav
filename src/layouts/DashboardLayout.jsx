import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { usePageFreeze } from "../hooks/usePageFreeze";
import "./dashboardLayout.css";
const Icon = ({ name }) => (
  <svg
    className="dashboard-icon"
    viewBox="0 0 24 24"
    aria-hidden="true"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.85"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {name === "diamond" && (
      <path d="m12 3 7 8-7 10L5 11l7-8Zm-7 8h14M9 3l3 8 3-8" />
    )}
    {name === "inventory" && (
      <>
        <path d="m12 3 7 4v10l-7 4-7-4V7l7-4Z" />
        <path d="m5 7 7 4 7-4M12 11v10" />
      </>
    )}
    {name === "check" && (
      <>
        <circle cx="10.8" cy="10.8" r="6" />
        <path d="m16 16 4 4M8 11l2 2 4-4" />
      </>
    )}
    {name === "challan" && (
      <>
        <path d="M3 6h11v10H3zM14 9h4l3 3v4h-7z" />
        <circle cx="7" cy="18" r="2" />
        <circle cx="18" cy="18" r="2" />
        <path d="M17 9v3h4" />
      </>
    )}
    {name === "activity" && (
      <>
        <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" />
        <path d="M9 8h6M9 12h4" />
        <circle cx="16.5" cy="16.5" r="2.5" />
        <path d="M16.5 15v1.7l1.1.7" />
      </>
    )}
    {name === "settings" && (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.1 2.1-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56v.1h-3v-.1A1.7 1.7 0 0 0 10.7 18.64a1.7 1.7 0 0 0-1.88.34l-.06.06-2.1-2.1.06-.06A1.7 1.7 0 0 0 7.06 15a1.7 1.7 0 0 0-1.56-1.03h-.1v-3h.1A1.7 1.7 0 0 0 7.06 9.94a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.1-2.1.06.06a1.7 1.7 0 0 0 1.88.34 1.7 1.7 0 0 0 1.03-1.56v-.1h3v.1a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.1 2.1-.06.06A1.7 1.7 0 0 0 19.4 15Z" />
      </>
    )}
    {name === "sun" && (
      <>
        <circle cx="12" cy="12" r="3.5" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </>
    )}
    {name === "moon" && (
      <path d="M20 15.2A8.2 8.2 0 0 1 8.8 4 8.2 8.2 0 1 0 20 15.2Z" />
    )}
    {name === "logout" && (
      <>
        <path d="M10 5H5v14h5" />
        <path d="M14 8l4 4-4 4M18 12H9" />
      </>
    )}
    {name === "chevron" && <path d="m9 18 6-6-6-6" />}
  </svg>
);
const modules = [
  {
    label: "Inventory",
    to: "/dashboard/inventory",
    icon: "inventory",
    key: "inventory",
  },
  {
    label: "Check Inventory",
    to: "/dashboard/check-inventory",
    icon: "check",
    always: true,
  },
  {
    label: "Challan",
    to: "/dashboard/challan",
    icon: "challan",
    key: [
      "challan-stage-1",
      "challan-stage-2",
      "challan-stage-3",
      "challan-stage-4",
    ],
  },
  {
    label: "Activity Log",
    to: "/dashboard/activity-log",
    icon: "activity",
    superAdmin: true,
  },
  {
    label: "Settings",
    to: "/dashboard/admin-settings",
    icon: "settings",
    superAdmin: true,
  },
];
export default function DashboardLayout() {
  const { user, logout, hasPermission } = useAuth(),
    location = useLocation(),
    [expanded, setExpanded] = useState(false),
    [pageLoading, setPageLoading] = useState(false),
    [theme, setTheme] = useState(
      () => localStorage.getItem("theme") || "light",
    ),
    [logoutConfirm, setLogoutConfirm] = useState(false);
  const inventoryPage = location.pathname.endsWith("/inventory"),
    available = modules.filter((m) =>
      m.superAdmin
        ? user?.role === "superadmin"
        : m.always ||
          user?.role === "superadmin" ||
          (Array.isArray(m.key)
            ? m.key.some(hasPermission)
            : hasPermission(m.key)),
    );
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("theme", theme);
  }, [theme]);
  useEffect(() => {
    if (!pageLoading) return;
    const timer = window.setTimeout(() => setPageLoading(false), 350);
    return () => window.clearTimeout(timer);
  }, [location.pathname, pageLoading]);
  useEffect(() => {
    if (!logoutConfirm) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setLogoutConfirm(false);
      }
      if (event.key === "Enter") {
        event.preventDefault();
        void logout();
      }
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [logoutConfirm, logout]);
  return (
    <div
      className={`dashboard-shell ${inventoryPage ? "inventory-layout" : ""} ${expanded ? "sidebar-expanded" : ""}`}
    >
      <aside className="dashboard-sidebar">
        <div className="dashboard-brand">
          <div className="dashboard-logo">
            <Icon name="diamond" />
          </div>
          <span>
            <b>Grantha</b>
            <small>Exports</small>
          </span>
        </div>
        <nav>
          {available.map((m) => (
            <NavLink
              key={m.label}
              to={m.to}
              onClick={() => setPageLoading(true)}
              className={({ isActive }) =>
                `dashboard-nav-item ${isActive ? "active" : ""}`
              }
            >
              <span className="dashboard-nav-icon">
                <Icon name={m.icon} />
              </span>
              <span className="dashboard-nav-label">{m.label}</span>
              <span className="dashboard-tooltip">{m.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="dashboard-sidebar-footer">
          <button
            className="dashboard-theme-toggle"
            onClick={() =>
              setTheme((current) => (current === "light" ? "dark" : "light"))
            }
            aria-label="Toggle color theme"
          >
            <Icon name={theme === "light" ? "moon" : "sun"} />
            <span>{theme === "light" ? "Dark mode" : "Light mode"}</span>
          </button>
          <button
            className="dashboard-collapse"
            onClick={() => setExpanded((v) => !v)}
            aria-label="Toggle sidebar"
          >
            <span className={expanded ? "collapse-reverse" : ""}>
              <Icon name="chevron" />
            </span>
            <em>Collapse</em>
          </button>
          <button
            className="dashboard-collapse"
            onClick={() => setLogoutConfirm(true)}
            aria-label="Logout"
          >
            <span>
              <Icon name="logout" />
            </span>
            <em>Logout</em>
          </button>
        </div>
      </aside>
      <main className="dashboard-main">
        <header className="dashboard-header">
          <h1>Grantha Exports</h1>
        </header>
        <div className="dashboard-content">
          {pageLoading && (
            <div className="dashboard-page-loading" role="status">
              <i />
              Loading...
            </div>
          )}
          <Outlet />
        </div>
      </main>
      {logoutConfirm && (
        <div
          className="logout-modal-backdrop"
          role="presentation"
          onMouseDown={() => setLogoutConfirm(false)}
        >
          <section
            className="logout-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="logout-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="logout-modal-icon">
              <Icon name="logout" />
            </div>
            <h2 id="logout-title">Log out?</h2>
            <p>Are you sure you want to log out of Grantha Exports?</p>
            <small className="logout-shortcuts">
              <kbd>Esc</kbd> Cancel <span>·</span> <kbd>Enter</kbd> Log out
            </small>
            <div className="logout-modal-actions">
              <button
                type="button"
                className="logout-cancel"
                onClick={() => setLogoutConfirm(false)}
              >
                Cancel
              </button>
              <button type="button" className="logout-confirm" onClick={logout}>
                Yes, log out
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
