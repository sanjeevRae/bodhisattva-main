/**
 * Admin SPA root: authentication state machine + shell.
 *
 * Auth states mirror the server's session levels:
 *   loading → anonymous (login form)
 *           → mfa_pending (TOTP / recovery code)
 *           → enrolment_required (first-login MFA enrolment)
 *           → full (the shell)
 * GET /api/auth/me is the source of truth on load and after every
 * transition; the login response only tells us which gate comes next.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from "react-router";
import {
  CalendarRange,
  ChevronsLeft,
  ChevronsRight,
  ClipboardList,
  ExternalLink,
  FileText,
  HeartHandshake,
  Images,
  LayoutDashboard,
  Library,
  LogOut,
  Menu as MenuIcon,
  Newspaper,
  Receipt,
  ScrollText,
  Settings as SettingsIcon,
  ShieldCheck,
  ShoppingBag,
  Tags,
  Users as UsersIcon,
} from "lucide-react";
import { authApi, setUnauthorizedHandler, usersApi } from "./api";
import { confirmNavigation } from "./guard";
import type { AuthLevel, MeUser } from "./types";
import { Badge, Spinner, cx } from "./ui";
import LoginScreen from "./screens/Login";
import Dashboard from "./screens/Dashboard";
import PagesList from "./screens/PagesList";
import PageEditor from "./screens/PageEditor";
import MediaLibrary from "./screens/MediaLibrary";
import MenusScreen from "./screens/Menus";
import SettingsScreen from "./screens/Settings";
import UsersScreen from "./screens/Users";
import CollectionsScreen from "./screens/Collections";
import ExhibitionsScreen from "./screens/Exhibitions";
import NewsScreen from "./screens/News";
import FoundationScreen from "./screens/Foundation";
import ProductsScreen from "./screens/Products";
import ProductEditorScreen from "./screens/ProductEditor";
import ProductCategoriesScreen from "./screens/ProductCategories";
import OrdersScreen from "./screens/Orders";
import OrderDetailScreen from "./screens/OrderDetail";
import InvoicesScreen from "./screens/Invoices";
import InvoiceTemplateScreen from "./screens/InvoiceTemplate";
import AuditLogScreen from "./screens/AuditLog";

export type AuthStatus = "loading" | "anonymous" | AuthLevel;

export interface AuthContextValue {
  status: AuthStatus;
  user: MeUser | null;
  /** Effective permission set; null = unknown (roles fetch failed) → show everything, the server still enforces. */
  permissions: Set<string> | null;
  hasPermission: (permission: string) => boolean;
  applyLogin: (user: MeUser, authLevel: AuthLevel) => void;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AdminApp");
  return ctx;
}

function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<MeUser | null>(null);
  const [permissions, setPermissions] = useState<Set<string> | null>(null);
  const navigate = useNavigate();
  const location = useLocation();

  const loadPermissions = useCallback(async (me: MeUser) => {
    try {
      const { items } = await usersApi.roles();
      const granted = new Set<string>();
      for (const role of items) {
        if (me.roles.includes(role.code)) {
          for (const permission of role.permissions) granted.add(permission);
        }
      }
      setPermissions(granted);
    } catch {
      setPermissions(null);
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const me = await authApi.me();
      setUser(me.user);
      setStatus(me.authLevel);
      if (me.authLevel === "full") void loadPermissions(me.user);
    } catch {
      setUser(null);
      setStatus("anonymous");
    }
  }, [loadPermissions]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // A 401 anywhere in the admin API means the session is gone: drop to
  // the login screen (unless we are already there).
  const locationRef = useRef(location.pathname);
  locationRef.current = location.pathname;
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null);
      setPermissions(null);
      setStatus("anonymous");
      if (locationRef.current !== "/admin/login") navigate("/admin/login");
    });
    return () => setUnauthorizedHandler(null);
  }, [navigate]);

  const applyLogin = useCallback(
    (nextUser: MeUser, authLevel: AuthLevel) => {
      setUser(nextUser);
      setStatus(authLevel);
      if (authLevel === "full") void loadPermissions(nextUser);
    },
    [loadPermissions],
  );

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // Session already gone — the local reset below is what matters.
    }
    setUser(null);
    setPermissions(null);
    setStatus("anonymous");
    navigate("/admin/login");
  }, [navigate]);

  const hasPermission = useCallback(
    (permission: string) => permissions === null || permissions.has(permission),
    [permissions],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, permissions, hasPermission, applyLogin, refresh, logout }),
    [status, user, permissions, hasPermission, applyLogin, refresh, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

const NAV_ITEMS: Array<{
  to: string;
  label: string;
  icon: ReactNode;
  permission?: string;
  end?: boolean;
}> = [
  { to: "/admin", label: "Dashboard", icon: <LayoutDashboard size={17} />, end: true },
  { to: "/admin/pages", label: "Pages", icon: <FileText size={17} />, permission: "cms.pages.read" },
  { to: "/admin/collections", label: "Collections", icon: <Library size={17} />, permission: "museum.collections.manage" },
  { to: "/admin/exhibitions", label: "Exhibitions", icon: <CalendarRange size={17} />, permission: "museum.exhibitions.manage" },
  { to: "/admin/news", label: "News Clippings", icon: <Newspaper size={17} />, permission: "news.manage" },
  { to: "/admin/foundation", label: "Foundation", icon: <HeartHandshake size={17} />, permission: "foundation.manage" },
  { to: "/admin/products", label: "Products", icon: <ShoppingBag size={17} />, permission: "store.products.manage" },
  { to: "/admin/product-categories", label: "Product Categories", icon: <Tags size={17} />, permission: "store.categories.manage" },
  { to: "/admin/orders", label: "Orders", icon: <ClipboardList size={17} />, permission: "store.orders.read" },
  { to: "/admin/invoices", label: "Invoices", icon: <Receipt size={17} />, permission: "store.invoices.manage" },
  { to: "/admin/invoice-template", label: "Invoice Template", icon: <ScrollText size={17} />, permission: "store.invoice_templates.manage" },
  { to: "/admin/audit-log", label: "Audit Log", icon: <ShieldCheck size={17} />, permission: "audit.read" },
  { to: "/admin/media", label: "Media", icon: <Images size={17} />, permission: "media.read" },
  { to: "/admin/menus", label: "Menus", icon: <MenuIcon size={17} />, permission: "cms.menus.manage" },
  { to: "/admin/settings", label: "Settings", icon: <SettingsIcon size={17} />, permission: "settings.manage" },
  { to: "/admin/users", label: "Users", icon: <UsersIcon size={17} />, permission: "roles.read" },
];

const SIDEBAR_PREF_KEY = "bodhisattva-admin-sidebar";

function readSidebarPreference(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_PREF_KEY) === "collapsed";
  } catch {
    return false;
  }
}

function Shell() {
  const { user, logout, hasPermission } = useAuth();
  const location = useLocation();
  const isPageEditor = /^\/admin\/pages\/[^/]+\/edit$/.test(location.pathname);
  // Sidebar state has two separate sources (kept apart so the editor
  // never rewrites the user's own choice):
  //  - preferenceCollapsed: the user's persistent preference, used on
  //    every screen except the page editor, saved to localStorage.
  //  - editorOverride: a temporary in-editor choice. Entering the
  //    page editor collapses the sidebar by default (the editor's
  //    canvas + inspector need the width); the user can expand it
  //    while editing, and leaving the editor drops the override and
  //    restores the preference.
  const [preferenceCollapsed, setPreferenceCollapsed] = useState<boolean>(readSidebarPreference);
  const [editorOverride, setEditorOverride] = useState<boolean | null>(null);
  useEffect(() => {
    setEditorOverride(null);
  }, [isPageEditor]);
  const collapsed = isPageEditor ? (editorOverride ?? true) : preferenceCollapsed;
  const toggleSidebar = () => {
    if (isPageEditor) {
      setEditorOverride(!collapsed);
      return;
    }
    const next = !collapsed;
    setPreferenceCollapsed(next);
    try {
      window.localStorage.setItem(SIDEBAR_PREF_KEY, next ? "collapsed" : "expanded");
    } catch {
      // Storage unavailable (private mode) — the choice just won't persist.
    }
  };
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside
        className={cx(
          "sticky top-0 flex h-screen shrink-0 flex-col border-r border-border bg-card transition-[width] duration-200",
          collapsed ? "w-16" : "w-60",
        )}
      >
        {collapsed ? (
          <div className="border-b border-border px-2 py-4" title="Bodhisattva — Museum Admin">
            <p className="text-center font-display text-xl tracking-wide" aria-hidden="true">B</p>
            <span className="sr-only">Bodhisattva — Museum Admin</span>
          </div>
        ) : (
          <div className="border-b border-border px-5 py-4">
            <p className="font-display text-xl tracking-wide">Bodhisattva</p>
            <p className="font-mono text-[0.6rem] tracking-[0.22em] uppercase text-muted-foreground">
              Museum Admin
            </p>
          </div>
        )}
        <nav className={cx("flex-1 space-y-1 overflow-y-auto py-4", collapsed ? "px-2" : "px-3")} aria-label="Admin">
          {NAV_ITEMS.filter((item) => !item.permission || hasPermission(item.permission)).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              title={item.label}
              aria-label={item.label}
              onClick={(e) => {
                if (!confirmNavigation()) e.preventDefault();
              }}
              className={({ isActive }) =>
                cx(
                  "flex items-center gap-3 rounded-sm px-3 py-2 text-sm transition-colors",
                  collapsed && "justify-center px-0",
                  isActive ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-secondary",
                )
              }
            >
              {item.icon}
              {!collapsed && item.label}
            </NavLink>
          ))}
        </nav>
        <div className="space-y-1 border-t border-border px-3 py-3">
          <button
            type="button"
            onClick={toggleSidebar}
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={cx(
              "flex w-full items-center gap-3 rounded-sm px-3 py-2 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground",
              collapsed && "justify-center px-0",
            )}
          >
            {collapsed ? <ChevronsRight size={17} /> : <ChevronsLeft size={17} />}
            {!collapsed && "Collapse"}
          </button>
          <Link
            to="/"
            onClick={(e) => {
              if (!confirmNavigation()) e.preventDefault();
            }}
            title="View site"
            aria-label="View site"
            className={cx(
              "flex items-center gap-3 rounded-sm px-3 py-2 text-sm hover:bg-secondary",
              collapsed && "justify-center px-0",
            )}
          >
            <ExternalLink size={17} />
            {!collapsed && "View site"}
          </Link>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/95 px-6 backdrop-blur">
          <div className="flex-1" />
          {user && (
            <>
              <span className="hidden text-sm text-muted-foreground sm:block">{user.email}</span>
              {user.roles.map((role) => (
                <Badge key={role} tone="dark">
                  {role.replace(/_/g, " ")}
                </Badge>
              ))}
              <button
                type="button"
                onClick={() => {
                  if (confirmNavigation()) void logout();
                }}
                className="inline-flex items-center gap-2 rounded-sm border border-border px-3 py-1.5 text-sm hover:bg-secondary"
              >
                <LogOut size={15} /> Log out
              </button>
            </>
          )}
        </header>
        <main className="min-w-0 flex-1 px-6 py-6">
          <Routes>
            <Route index element={<Dashboard />} />
            <Route path="pages" element={<PagesList />} />
            <Route path="pages/:id/edit" element={<PageEditor />} />
            <Route path="collections" element={<CollectionsScreen />} />
            <Route path="exhibitions" element={<ExhibitionsScreen />} />
            <Route path="news" element={<NewsScreen />} />
            <Route path="foundation" element={<FoundationScreen />} />
            <Route path="products" element={<ProductsScreen />} />
            <Route path="products/new" element={<ProductEditorScreen />} />
            <Route path="products/:id" element={<ProductEditorScreen />} />
            <Route path="product-categories" element={<ProductCategoriesScreen />} />
            <Route path="orders" element={<OrdersScreen />} />
            <Route path="orders/:id" element={<OrderDetailScreen />} />
            <Route path="invoices" element={<InvoicesScreen />} />
            <Route path="invoice-template" element={<InvoiceTemplateScreen />} />
            <Route path="audit-log" element={<AuditLogScreen />} />
            <Route path="media" element={<MediaLibrary />} />
            <Route path="menus" element={<MenusScreen />} />
            <Route path="settings" element={<SettingsScreen />} />
            <Route path="users" element={<UsersScreen />} />
            <Route path="*" element={<Navigate to="/admin" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

export default function AdminApp() {
  return (
    <AuthProvider>
      <AdminRoutes />
    </AuthProvider>
  );
}

function AdminRoutes() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Spinner label="Checking your session…" />
      </div>
    );
  }

  if (status !== "full") {
    // Login, MFA verify and MFA enrolment all live on the login route.
    if (location.pathname !== "/admin/login") {
      return <Navigate to="/admin/login" replace />;
    }
    return (
      <Routes>
        <Route path="login" element={<LoginScreen />} />
        <Route path="*" element={<Navigate to="/admin/login" replace />} />
      </Routes>
    );
  }

  if (location.pathname === "/admin/login") {
    return <Navigate to="/admin" replace />;
  }

  return (
    <Routes>
      <Route path="login" element={<Navigate to="/admin" replace />} />
      <Route path="*" element={<Shell />} />
    </Routes>
  );
}
