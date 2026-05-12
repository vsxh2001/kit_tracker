import { useState, useEffect, useRef } from "react";
import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";
import { LayoutDashboard, Package, Users, FileText, LogOut, Box, UserCog, Menu, X, Cpu, BarChart3, ScrollText, Wrench } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { logout } from "../services/auth";
import { cn } from "../lib/utils";

const nav = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/kits", label: "Kits", icon: Package },
  { to: "/entities", label: "Entities", icon: Users },
  { to: "/requests", label: "Requests", icon: FileText },
  { to: "/components", label: "Components", icon: Cpu },
];

export function Layout() {
  const { user, isAdmin, canDecideRequests } = useAuth();
  const hasRole = !!user?.role;
  const location = useLocation();
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef = useRef<HTMLElement>(null);

  const initials = user?.name
    ? user.name.split(" ").map((w: string) => w[0]).slice(0, 2).join("").toUpperCase()
    : user?.email?.[0]?.toUpperCase() ?? "?";

  function handleLogout() {
    logout();
    navigate("/login");
  }

  function closeDrawer() {
    setDrawerOpen(false);
  }

  // Body scroll lock + Escape close + resize clear
  useEffect(() => {
    if (!drawerOpen) return;

    document.body.classList.add("overflow-hidden");

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        closeDrawer();
        return;
      }
      // Focus trap: Tab / Shift+Tab
      if (e.key === "Tab" && drawerRef.current) {
        const focusable = drawerRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) { e.preventDefault(); return; }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) { e.preventDefault(); last.focus(); }
        } else {
          if (document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      }
    }

    function onResize() {
      if (window.innerWidth >= 768) closeDrawer();
    }

    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onResize);

    // Focus first nav item on open
    const firstFocusable = drawerRef.current?.querySelector<HTMLElement>(
      'a[href], button:not([disabled])'
    );
    firstFocusable?.focus();

    return () => {
      document.body.classList.remove("overflow-hidden");
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onResize);
    };
  }, [drawerOpen]);

  const navLinks = (
    <>
      {hasRole && nav.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          onClick={closeDrawer}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-all",
              isActive
                ? "bg-indigo-600 text-white shadow-sm shadow-indigo-900/50"
                : "text-slate-400 hover:bg-slate-800 hover:text-slate-100"
            )
          }
        >
          <Icon className="h-5 w-5 shrink-0" />
          {label}
        </NavLink>
      ))}
      {hasRole && canDecideRequests && (
        <NavLink
          to="/maintenance"
          onClick={closeDrawer}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-all",
              isActive
                ? "bg-indigo-600 text-white shadow-sm shadow-indigo-900/50"
                : "text-slate-400 hover:bg-slate-800 hover:text-slate-100"
            )
          }
        >
          <Wrench className="h-5 w-5 shrink-0" />
          Maintenance
        </NavLink>
      )}
      {hasRole && canDecideRequests && (
        <NavLink
          to="/stats"
          onClick={closeDrawer}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-all",
              isActive
                ? "bg-indigo-600 text-white shadow-sm shadow-indigo-900/50"
                : "text-slate-400 hover:bg-slate-800 hover:text-slate-100"
            )
          }
        >
          <BarChart3 className="h-5 w-5 shrink-0" />
          Stats
        </NavLink>
      )}
      {hasRole && isAdmin && (
        <NavLink
          to="/users"
          onClick={closeDrawer}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-all",
              isActive
                ? "bg-indigo-600 text-white shadow-sm shadow-indigo-900/50"
                : "text-slate-400 hover:bg-slate-800 hover:text-slate-100"
            )
          }
        >
          <UserCog className="h-5 w-5 shrink-0" />
          Users
        </NavLink>
      )}
      {hasRole && isAdmin && (
        <NavLink
          to="/audit"
          onClick={closeDrawer}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-all",
              isActive
                ? "bg-indigo-600 text-white shadow-sm shadow-indigo-900/50"
                : "text-slate-400 hover:bg-slate-800 hover:text-slate-100"
            )
          }
        >
          <ScrollText className="h-5 w-5 shrink-0" />
          Audit
        </NavLink>
      )}
    </>
  );

  const userFooter = (
    <div className="px-3 py-3 border-t border-slate-800 space-y-1">
      <div className="flex items-center gap-2.5 px-1 py-1.5">
        <div className="h-7 w-7 rounded-full bg-indigo-900/70 ring-1 ring-indigo-700/50 flex items-center justify-center text-xs font-semibold text-indigo-300 shrink-0">
          {initials}
        </div>
        <p className="text-xs text-slate-400 truncate">{user?.email}</p>
      </div>
      <button
        onClick={handleLogout}
        className="flex items-center gap-2.5 px-3 py-2 w-full rounded-md text-sm text-slate-500 hover:bg-slate-800 hover:text-slate-100 transition-colors"
      >
        <LogOut className="h-5 w-5" />
        Sign out
      </button>
    </div>
  );

  return (
    <div className="flex h-screen bg-background">
      {/* Desktop sidebar — hidden on mobile */}
      <aside className="hidden md:flex w-56 flex-col bg-slate-900 shrink-0 border-r border-slate-800">
        {/* Indigo radial glow behind logo — echoes login page gradient aesthetic */}
        <div className="px-4 py-5 border-b border-slate-800 relative overflow-hidden">
          <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(ellipse 120% 140% at 10% 50%, hsl(243 75% 40% / 0.22) 0%, transparent 70%)" }} />
          <div className="relative flex items-center gap-2.5">
            <div className="h-7 w-7 rounded-lg bg-indigo-500 flex items-center justify-center shrink-0 shadow-lg shadow-indigo-900/40">
              <Box className="h-4 w-4 text-white" />
            </div>
            <p className="font-semibold text-sm text-white tracking-tight">Kit Tracker</p>
          </div>
        </div>
        <nav className="flex-1 px-2 py-3 space-y-0.5">
          {navLinks}
        </nav>
        {userFooter}
      </aside>

      {/* Mobile drawer backdrop */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 md:hidden"
          onClick={closeDrawer}
        />
      )}

      {/* Mobile drawer */}
      <aside
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-64 flex flex-col bg-slate-900 border-r border-slate-800 transition-transform duration-200 md:hidden",
          drawerOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="px-4 py-5 border-b border-slate-800 flex items-center justify-between relative overflow-hidden">
          <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(ellipse 120% 140% at 10% 50%, hsl(243 75% 40% / 0.22) 0%, transparent 70%)" }} />
          <div className="relative flex items-center gap-2.5">
            <div className="h-7 w-7 rounded-lg bg-indigo-500 flex items-center justify-center shrink-0 shadow-lg shadow-indigo-900/40">
              <Box className="h-4 w-4 text-white" />
            </div>
            <p className="font-semibold text-sm text-white tracking-tight">Kit Tracker</p>
          </div>
          <button onClick={closeDrawer} aria-label="Close menu" className="relative text-slate-400 hover:text-slate-100 h-11 w-11 flex items-center justify-center rounded-md">
            <X className="h-5 w-5" />
          </button>
        </div>
        <nav className="flex-1 px-2 py-3 space-y-0.5">
          {navLinks}
        </nav>
        {userFooter}
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile top bar */}
        <header className="md:hidden flex items-center gap-3 px-4 py-3 bg-slate-900 border-b border-slate-800 shrink-0">
          <button
            onClick={() => setDrawerOpen(true)}
            className="text-slate-400 hover:text-slate-100 p-1"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-md bg-indigo-500 flex items-center justify-center shrink-0">
              <Box className="h-3.5 w-3.5 text-white" />
            </div>
            <p className="font-semibold text-sm text-white tracking-tight">Kit Tracker</p>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          <div key={location.pathname} className="max-w-6xl mx-auto p-4 md:p-6 animate-in fade-in duration-150">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
