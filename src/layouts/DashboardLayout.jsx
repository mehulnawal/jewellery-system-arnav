import { MasterPricesProvider } from "../hooks/useMasterPrices";
import { createPortal } from "react-dom";
import BusinessGate from "./BusinessGate";
import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import "./dashboardLayout.css";
import { isAdminAccount } from "../auth/accessPolicy.js";
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
    {name === "dashboard" && (
      <>
        <rect x="3" y="3" width="8" height="8" rx="1.5" />
        <rect x="13" y="3" width="8" height="5" rx="1.5" />
        <rect x="13" y="10" width="8" height="11" rx="1.5" />
        <rect x="3" y="13" width="8" height="8" rx="1.5" />
      </>
    )}
    {name === "check" && (
      <>
        <circle cx="10.8" cy="10.8" r="6" />
        <path d="m16 16 4 4M8 11l2 2 4-4" />
      </>
    )}
    {name === "purchase" && (
      <>
        <path d="M4 6h16v14H4z" />
        <path d="M8 3v6M16 3v6M8 13h8M8 17h5" />
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
    {name === "management" && (
      <>
        <rect x="4" y="4" width="16" height="16" rx="3" />
        <path d="M8 9h8M8 13h8M8 17h5" />
      </>
    )}
    {name === "history" && (
      <>
        <path d="M4 5h16v14H4z" />
        <path d="M8 9h8M8 13h6M8 17h4" />
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
        <path d="M4 3h11v18H4z" />
        <path d="M11 12h9m-3-3 3 3-3 3" />
      </>
    )}
    {name === "chevron" && <path d="m9 18 6-6-6-6" />}
  </svg>
);

const operations = [
  {
    label: "Inventory",
    to: "/dashboard/inventory",
    icon: "inventory",
    permission: "inventory",
  },
  { label: "Check Inventory", to: "/dashboard/check-inventory", icon: "check" },
  {
    label: "Purchase",
    to: "/dashboard/purchase",
    icon: "purchase",
    permission: "purchase",
  },
  {
    label: "Challan",
    to: "/dashboard/challan",
    icon: "challan",
    permission: [
      "challan-stage-1",
      "challan-stage-2",
      "challan-stage-3",
      "challan-stage-4",
    ],
  },
];
const reportLinks = [
  { label: "Activity Log", to: "/dashboard/activity-log", icon: "activity" },
  { label: "Weekly Report", to: "/dashboard/weekly-report", icon: "activity" },
  {
    label: "Vendor Purchase History",
    to: "/dashboard/vendor-purchase-history",
    icon: "history",
  },
  {
    label: "Party Challan History",
    to: "/dashboard/party-challan-history",
    icon: "history",
  },
];
const adminLinks = [
  {
    label: "Master Price List",
    to: "/dashboard/master-prices",
    icon: "management",
  },
  { label: "Settings", to: "/dashboard/admin-settings", icon: "settings" },
];
const stored = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
};
export default function DashboardLayout() {
  const { user, logout, hasPermission } = useAuth(),
    location = useLocation();
  const [expanded, setExpanded] = useState(() =>
    stored("sidebar-expanded", false),
  );
  const [groups, setGroups] = useState(() => stored("sidebar-groups", {}));
  const [theme, setTheme] = useState(
    () => localStorage.getItem("theme") || "light",
  );
  const [hint, setHint] = useState(null);
  const [collapsedMenu, setCollapsedMenu] = useState(null);
  const groupButtons = useRef({});
  const menuRef = useRef(null);
  const menuWidth = 224;
  const positionMenu = (button, itemCount) => {
    const box = button.getBoundingClientRect();
    const height = 44 + itemCount * 40 + 12;
    return {
      left: Math.min(box.right + 10, Math.max(8, window.innerWidth - menuWidth - 8)),
      top: Math.max(8, Math.min(box.top, window.innerHeight - height - 8)),
    };
  };
  const hintEvents = (label) => ({
    onMouseEnter: (event) => {
      const box = event.currentTarget.getBoundingClientRect();
      setHint({ label, top: box.top + box.height / 2, left: box.right + 10 });
    },
    onMouseLeave: () => setHint(null),
    onFocus: (event) => {
      const box = event.currentTarget.getBoundingClientRect();
      setHint({ label, top: box.top + box.height / 2, left: box.right + 10 });
    },
    onBlur: () => setHint(null),
    onKeyDown: (event) => {
      if (event.key === "Escape") setHint(null);
    },
  });
  const [logoutConfirm, setLogoutConfirm] = useState(false);
  const isAdmin = isAdminAccount(user);
  const sections = [
    {
      name: "Operations",
      icon: "inventory",
      items: operations.filter(
        (item) =>
          !item.permission ||
          isAdmin ||
          (Array.isArray(item.permission)
            ? item.permission.some(hasPermission)
            : hasPermission(item.permission)),
      ),
    },
    ...(isAdmin
      ? [
          { name: "Reports", icon: "activity", items: reportLinks },
          { name: "Admin", icon: "management", items: adminLinks },
        ]
      : []),
  ].filter((group) => group.items.length);
  const pageTitle =
    [...operations, ...reportLinks, ...adminLinks].find(
      (item) => item.to === location.pathname,
    )?.label ||
    (location.pathname.endsWith("/danger-zone") ? "Danger Zone" : "Dashboard");
  const activeGroup = sections.find((group) =>
    group.items.some(
      (item) =>
        item.to === location.pathname ||
        location.pathname.startsWith(item.to + "/"),
    ),
  )?.name;
  useEffect(() => {
    localStorage.setItem("sidebar-expanded", JSON.stringify(expanded));
  }, [expanded]);
  useEffect(() => {
    localStorage.setItem("sidebar-groups", JSON.stringify(groups));
  }, [groups]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("theme", theme);
  }, [theme]);
  useEffect(() => {
    if (expanded && activeGroup)
      queueMicrotask(() =>
        setGroups((old) =>
          old[activeGroup] ? old : { ...old, [activeGroup]: true },
        ),
      );
  }, [expanded, activeGroup]);
  useEffect(() => {
    if (!logoutConfirm) return;
    const close = (event) => {
      if (event.key === "Escape") setLogoutConfirm(false);
      if (event.key === "Enter") {
        event.preventDefault();
        logout();
      }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [logoutConfirm, logout]);
  useEffect(() => {
    if (expanded) queueMicrotask(() => setCollapsedMenu(null));
  }, [expanded]);
  useEffect(() => {
    queueMicrotask(() => setCollapsedMenu(null));
  }, [location.pathname]);
  const menuName = collapsedMenu?.name;
  const menuItemCount = sections.find((group) => group.name === menuName)?.items.length;
  useEffect(() => {
    if (!menuName) return;
    const closeOnOutside = (event) => {
      if (menuRef.current?.contains(event.target)) return;
      if (groupButtons.current[menuName]?.contains(event.target)) return;
      setCollapsedMenu(null);
    };
    const onKeyDown = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setCollapsedMenu(null);
      groupButtons.current[menuName]?.focus();
    };
    const reposition = () => {
      const button = groupButtons.current[menuName];
      if (!button || !menuItemCount) return setCollapsedMenu(null);
      const next = positionMenu(button, menuItemCount);
      setCollapsedMenu((old) => old?.name === menuName ? { ...old, ...next } : old);
    };
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    const first = menuRef.current?.querySelector('[role="menuitem"]');
    first?.focus();
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [menuName, menuItemCount]);
  const onMenuKeyDown = (event) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = [...menuRef.current.querySelectorAll('[role="menuitem"]')];
    if (!items.length) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement);
    const next = event.key === "Home" ? 0
      : event.key === "End" ? items.length - 1
      : event.key === "ArrowDown" ? (current + 1) % items.length
      : (current - 1 + items.length) % items.length;
    items[next].focus();
  };
  // Keep the selected destination visible without expanding a collapsed sidebar.
  const groupOpen = (name) =>
    expanded && (activeGroup === name || Boolean(groups[name]));
  const link = (item) => (
    <NavLink
      key={item.to}
      to={item.to}
      end={item.to === "/dashboard"}
      aria-label={item.label}
      title={expanded ? item.label : undefined}
      {...(!expanded ? hintEvents(item.label) : {})}
      className={({ isActive }) => "nav-row " + (isActive ? "active" : "")}
    >
      <Icon name={item.icon} />
      <span>{item.label}</span>
    </NavLink>
  );
  return (
    <div className={"dashboard-shell " + (expanded ? "sidebar-expanded" : "")}>
      <aside className="dashboard-sidebar" aria-label="Main sidebar">
        <div className="nav-brand">
          <div className="nav-logo">
            <Icon name="diamond" />
          </div>
          {expanded && <b>Grantha Exports</b>}
          <button
            type="button"
            aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
            aria-expanded={expanded}
            title={expanded ? "Collapse sidebar" : undefined}
            {...(!expanded ? hintEvents("Expand sidebar") : {})}
            onClick={() => {
              setHint(null);
              setExpanded((value) => !value);
            }}
          >
            <Icon name="chevron" />
          </button>
        </div>
        <nav aria-label="Application navigation" onScroll={() => setHint(null)}>
          {isAdmin && link({ label: "Dashboard", to: "/dashboard", icon: "dashboard" })}
          {sections.map((group) => (
            <section className="nav-group" key={group.name}>
              <button
                className={
                  "nav-row nav-group-toggle " +
                  (activeGroup === group.name ? "contains-active" : "")
                }
                {...(!expanded ? hintEvents(group.name) : {})}
                ref={(button) => { groupButtons.current[group.name] = button; }}
                aria-label={group.name}
                aria-haspopup={!expanded ? "menu" : undefined}
                aria-expanded={expanded ? groupOpen(group.name) : collapsedMenu?.name === group.name}
                aria-controls={expanded ? "nav-" + group.name : "collapsed-nav-" + group.name}
                onClick={(event) => {
                  setHint(null);
                  if (!expanded) {
                    const position = positionMenu(event.currentTarget, group.items.length);
                    setCollapsedMenu((old) => old?.name === group.name ? null : { name: group.name, ...position });
                  } else {
                    setGroups((old) => ({
                      ...old,
                      [group.name]: activeGroup === group.name || !old[group.name],
                    }));
                  }
                }}
              >
                <Icon name={group.icon} />
                <span>{group.name}</span>
                <i className={groupOpen(group.name) ? "is-open" : ""}>
                  <Icon name="chevron" />
                </i>
              </button>
              {groupOpen(group.name) && (
                <div id={"nav-" + group.name} className="nav-children">
                  {group.items.map(link)}
                </div>
              )}
            </section>
          ))}
        </nav>
      </aside>
      {!expanded &&
        !collapsedMenu &&
        hint &&
        createPortal(
          <div
            className="sidebar-tooltip"
            role="tooltip"
            style={{ top: hint.top, left: hint.left }}
          >
            {hint.label}
          </div>,
          document.body,
        )}
      {!expanded && collapsedMenu && createPortal(
        <div
          ref={menuRef}
          id={"collapsed-nav-" + collapsedMenu.name}
          className="sidebar-menu"
          role="menu"
          aria-label={collapsedMenu.name}
          style={{ top: collapsedMenu.top, left: collapsedMenu.left }}
          onKeyDown={onMenuKeyDown}
        >
          <div className="sidebar-menu-heading">{collapsedMenu.name}</div>
          {sections.find((group) => group.name === collapsedMenu.name)?.items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              role="menuitem"
              className={({ isActive }) => "sidebar-menu-item" + (isActive ? " active" : "")}
              onClick={() => setCollapsedMenu(null)}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </div>,
        document.body,
      )}
      <main className="dashboard-main">
        <header className="dashboard-header">
          <span className="app-page-context">{pageTitle}</span>
          <div className="app-tools">
            <button
              onClick={() =>
                setTheme((current) => (current === "light" ? "dark" : "light"))
              }
              aria-label="Toggle color theme"
              title={theme === "light" ? "Dark mode" : "Light mode"}
            >
              <Icon name={theme === "light" ? "moon" : "sun"} />
            </button>
            <button onClick={() => setLogoutConfirm(true)} aria-label="Logout">
              <Icon name="logout" />
              <span>Logout</span>
            </button>
          </div>
        </header>
        <div className="dashboard-content">
          <BusinessGate>
            <MasterPricesProvider>
              <Outlet />
            </MasterPricesProvider>
          </BusinessGate>
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
