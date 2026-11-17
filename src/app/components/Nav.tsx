import { useState, useEffect } from "react";
import { Link, useLocation } from "react-router";
import { Menu, X, ShoppingBag, Moon, Sun, ChevronRight } from "lucide-react";
import { pageFromPath, pagePaths, useGo, type Page } from "./shared";
import { getMenu, getSiteSettings, settingString, type CmsLinkRef } from "../lib/api";
import { useCustomer } from "../lib/customer";

interface NavItem {
  label: string;
  page: Page;
  path: string;
}

// Initial render state = the current hardcoded values, so first paint
// matches the pre-CMS site exactly; the API data replaces it as soon as
// GET /api/menus/primary + GET /api/site resolve (mapping §2.1).
const DEFAULT_ITEMS: NavItem[] = [
  { label: "Home", page: "home", path: "/" },
  { label: "Museum", page: "museum", path: "/museum" },
  { label: "Gallery", page: "gallery", path: "/gallery" },
  { label: "Gift Shop", page: "shop", path: "/shop" },
  { label: "News Clippings", page: "news", path: "/news" },
  { label: "Foundation", page: "foundation", path: "/foundation" },
  { label: "About Us", page: "about", path: "/about" },
];

export default function Nav({ dark, onToggleDark }: {
  dark: boolean; onToggleDark: () => void;
}) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NavItem[]>(DEFAULT_ITEMS);
  const [siteName, setSiteName] = useState("Bodhisattva");
  const [siteTagline, setSiteTagline] = useState("Museum & Art Gallery");
  const [planVisitLabel, setPlanVisitLabel] = useState("Plan Visit");
  const [planVisitPath, setPlanVisitPath] = useState<string>(pagePaths.museum);
  const location = useLocation();
  // pageFromPath defaults unknown paths to "home" — fine for CMS slugs,
  // but the Phase 6 routes (/login, /checkout, /account…) are not CMS
  // pages: they must not inherit the home hero treatment (transparent
  // bar, white text) or mark Home as the active item.
  const isCmsPath = (Object.values(pagePaths) as string[]).includes(location.pathname);
  const current: Page | null = isCmsPath ? pageFromPath(location.pathname) : null;
  const onNav = useGo();
  const { status, user, cartCount, setCartOpen } = useCustomer();
  const signedIn = status === "full" && user !== null;
  const firstName = user?.name.trim().split(/\s+/)[0] ?? "";

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 60);
    window.addEventListener("scroll", fn, { passive: true });
    return () => window.removeEventListener("scroll", fn);
  }, []);

  useEffect(() => {
    let alive = true;
    getMenu("primary")
      .then((menu) => {
        if (!alive) return;
        const mapped = menu.items
          .filter((item) => item.isVisible && item.path)
          .map((item) => ({
            label: item.label,
            page: (item.slug ?? "home") as Page,
            path: item.path as string,
          }));
        if (mapped.length > 0) setItems(mapped);
      })
      .catch(() => { /* keep the initial values */ });
    getSiteSettings()
      .then((settings) => {
        if (!alive) return;
        setSiteName(settingString(settings, "site_name", "Bodhisattva"));
        setSiteTagline(settingString(settings, "site_tagline", "Museum & Art Gallery"));
        const planVisit = settings.plan_visit_link as CmsLinkRef | undefined;
        if (planVisit?.label) setPlanVisitLabel(planVisit.label);
        if (planVisit?.pageSlug && planVisit.pageSlug in pagePaths) {
          setPlanVisitPath(pagePaths[planVisit.pageSlug as Page]);
        }
      })
      .catch(() => { /* keep the initial values */ });
    return () => {
      alive = false;
    };
  }, []);

  const go = (p: Page) => { onNav(p); setOpen(false); };
  const hero = current === "home" && !scrolled && !open;

  return (
    <header className={`fixed top-0 inset-x-0 z-50 transition-all duration-500 ${hero ? "bg-transparent" : "bg-background/95 backdrop-blur-md border-b border-border"}`}>
      <div className="max-w-screen-xl mx-auto px-6 lg:px-10 h-16 flex items-center justify-between gap-8">

        <button onClick={() => go("home")} className="shrink-0 focus:outline-none">
          <span className={`block font-display text-[1.05rem] font-semibold tracking-[0.12em] uppercase leading-none transition-colors ${hero ? "text-white" : "text-foreground"}`}>
            {siteName}
          </span>
          <span className={`block font-mono text-[0.46rem] tracking-[0.3em] uppercase mt-0.5 transition-colors ${hero ? "text-amber-300/70" : "text-accent"}`}>
            {siteTagline}
          </span>
        </button>

        <nav className="hidden xl:flex items-center gap-7">
          {items.map((item) => (
            <Link key={item.path} to={item.path}
              className={`font-mono text-[0.57rem] tracking-[0.16em] uppercase transition-colors ${current === item.page ? (hero ? "text-amber-400" : "text-accent") : (hero ? "text-white/55 hover:text-white" : "text-muted-foreground hover:text-foreground")}`}>
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-4">
          {signedIn ? (
            <Link to="/account" className={`hidden sm:block font-mono text-[0.54rem] tracking-widest uppercase transition-colors ${hero ? "text-white/60 hover:text-white" : "text-muted-foreground hover:text-foreground"}`}>
              {firstName}
            </Link>
          ) : (
            <Link to="/login" className={`hidden sm:block font-mono text-[0.54rem] tracking-widest uppercase transition-colors ${hero ? "text-white/60 hover:text-white" : "text-muted-foreground hover:text-foreground"}`}>
              Sign In
            </Link>
          )}
          <button onClick={onToggleDark} className={`transition-colors ${hero ? "text-white/55 hover:text-white" : "text-muted-foreground hover:text-foreground"}`} aria-label="Toggle dark mode">
            {dark ? <Sun size={15} /> : <Moon size={15} />}
          </button>
          <button onClick={() => setCartOpen(true)} className={`relative hidden sm:block transition-colors ${hero ? "text-white/55 hover:text-white" : "text-muted-foreground hover:text-foreground"}`} aria-label="Cart">
            <ShoppingBag size={15} />
            {signedIn && cartCount > 0 && (
              <span className="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 font-mono text-[0.52rem] font-medium text-accent-foreground">
                {cartCount}
              </span>
            )}
          </button>
          <Link to={planVisitPath} className={`hidden sm:flex items-center gap-1.5 font-mono text-[0.54rem] tracking-widest uppercase px-4 py-2 border transition-colors ${hero ? "border-white/25 text-white/60 hover:border-white hover:text-white" : "border-border text-muted-foreground hover:border-foreground hover:text-foreground"}`}>
            {planVisitLabel}
          </Link>
          <button onClick={() => setOpen(!open)} className={`xl:hidden transition-colors ${hero ? "text-white/70 hover:text-white" : "text-muted-foreground hover:text-foreground"}`}>
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      {open && (
        <div className="xl:hidden border-t border-border bg-background/98 backdrop-blur-md">
          <nav className="max-w-screen-xl mx-auto px-6 py-5 flex flex-col gap-0.5">
            {items.map((item) => (
              <Link key={item.path} to={item.path} onClick={() => setOpen(false)}
                className={`text-left font-sans text-sm py-3 border-b border-border/40 flex items-center justify-between transition-colors ${current === item.page ? "text-accent" : "text-foreground/70 hover:text-foreground"}`}>
                {item.label} <ChevronRight size={14} className="text-muted-foreground" />
              </Link>
            ))}
            <button onClick={() => { setOpen(false); setCartOpen(true); }}
              className="text-left font-sans text-sm py-3 border-b border-border/40 flex items-center justify-between text-foreground/70 hover:text-foreground transition-colors">
              Cart{signedIn && cartCount > 0 ? ` (${cartCount})` : ""} <ShoppingBag size={14} className="text-muted-foreground" />
            </button>
            <Link to={signedIn ? "/account" : "/login"} onClick={() => setOpen(false)}
              className="text-left font-sans text-sm py-3 flex items-center justify-between text-foreground/70 hover:text-foreground transition-colors">
              {signedIn ? `Account — ${firstName}` : "Sign In"} <ChevronRight size={14} className="text-muted-foreground" />
            </Link>
          </nav>
        </div>
      )}
    </header>
  );
}
