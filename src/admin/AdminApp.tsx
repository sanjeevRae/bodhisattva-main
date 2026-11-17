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
  ExternalLink,
  FileText,
  HeartHandshake,
  Images,
  LayoutDashboard,
  Library,
  LogOut,
  Menu as MenuIcon,
  Newspaper,
  Settings as SettingsIcon,
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
  { to: "/admin/news", label: "News", icon: <Newspaper size={17} />, permission: "news.manage" },
  { to: "/admin/foundation", label: "Foundation", icon: <HeartHandshake size={17} />, permission: "foundation.manage" },
  { to: "/admin/products", label: "Products", icon: <ShoppingBag size={17} />, permission: "store.products.manage" },
  { to: "/admin/product-categories", label: "Product Categories", icon: <Tags size={17} />, permission: "store.categories.manage" },
  { to: "/admin/media", label: "Media", icon: <Images size={17} />, permission: "media.read" },
  { to: "/admin/menus", label: "Menus", icon: <MenuIcon size={17} />, permission: "cms.menus.manage" },
  { to: "/admin/settings", label: "Settings", icon: <SettingsIcon size={17} />, permission: "settings.manage" },
  { to: "/admin/users", label: "Users", icon: <UsersIcon size={17} />, permission: "roles.read" },
];

function Shell() {
  const { user, logout, hasPermission } = useAuth();
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-border bg-card">
        <div className="border-b border-border px-5 py-4">
          <p className="font-display text-xl tracking-wide">Bodhisattva</p>
          <p className="font-mono text-[0.6rem] tracking-[0.22em] uppercase text-muted-foreground">
            Museum Admin
          </p>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4" aria-label="Admin">
          {NAV_ITEMS.filter((item) => !item.permission || hasPermission(item.permission)).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={(e) => {
                if (!confirmNavigation()) e.preventDefault();
              }}
              className={({ isActive }) =>
                cx(
                  "flex items-center gap-3 rounded-sm px-3 py-2 text-sm transition-colors",
                  isActive ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-secondary",
                )
              }
            >
              {item.icon}
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-border px-3 py-3">
          <Link
            to="/"
            onClick={(e) => {
              if (!confirmNavigation()) e.preventDefault();
            }}
            className="flex items-center gap-3 rounded-sm px-3 py-2 text-sm hover:bg-secondary"
          >
            <ExternalLink size={17} /> View site
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
