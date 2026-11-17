import { useState, useEffect } from "react";
import { useLocation } from "react-router";
import { Menu, X, ShoppingBag, Moon, Sun, ChevronRight } from "lucide-react";
import { pageFromPath, useGo, type Page } from "./shared";

export default function Nav({ dark, onToggleDark }: {
  dark: boolean; onToggleDark: () => void;
}) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const current = pageFromPath(location.pathname);
  const onNav = useGo();

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 60);
    window.addEventListener("scroll", fn, { passive: true });
    return () => window.removeEventListener("scroll", fn);
  }, []);

  const items: { label: string; page: Page }[] = [
    { label: "Home", page: "home" },
    { label: "Museum", page: "museum" },
    { label: "Gallery", page: "gallery" },
    { label: "Gift Shop", page: "shop" },
    { label: "News Clippings", page: "news" },
    { label: "Foundation", page: "foundation" },
    { label: "About Us", page: "about" },
  ];

  const go = (p: Page) => { onNav(p); setOpen(false); };
  const hero = current === "home" && !scrolled && !open;

  return (
    <header className={`fixed top-0 inset-x-0 z-50 transition-all duration-500 ${hero ? "bg-transparent" : "bg-background/95 backdrop-blur-md border-b border-border"}`}>
      <div className="max-w-screen-xl mx-auto px-6 lg:px-10 h-16 flex items-center justify-between gap-8">

        <button onClick={() => go("home")} className="shrink-0 focus:outline-none">
          <span className={`block font-display text-[1.05rem] font-semibold tracking-[0.12em] uppercase leading-none transition-colors ${hero ? "text-white" : "text-foreground"}`}>
            Bodhisattva
          </span>
          <span className={`block font-mono text-[0.46rem] tracking-[0.3em] uppercase mt-0.5 transition-colors ${hero ? "text-amber-300/70" : "text-accent"}`}>
            Museum & Art Gallery
          </span>
        </button>

        <nav className="hidden xl:flex items-center gap-7">
          {items.map((item) => (
            <button key={item.page} onClick={() => go(item.page)}
              className={`font-mono text-[0.57rem] tracking-[0.16em] uppercase transition-colors ${current === item.page ? (hero ? "text-amber-400" : "text-accent") : (hero ? "text-white/55 hover:text-white" : "text-muted-foreground hover:text-foreground")}`}>
              {item.label}
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-4">
          <button onClick={onToggleDark} className={`transition-colors ${hero ? "text-white/55 hover:text-white" : "text-muted-foreground hover:text-foreground"}`} aria-label="Toggle dark mode">
            {dark ? <Sun size={15} /> : <Moon size={15} />}
          </button>
          <button onClick={() => go("shop")} className={`hidden sm:block transition-colors ${hero ? "text-white/55 hover:text-white" : "text-muted-foreground hover:text-foreground"}`} aria-label="Cart">
            <ShoppingBag size={15} />
          </button>
          <button onClick={() => go("museum")} className={`hidden sm:flex items-center gap-1.5 font-mono text-[0.54rem] tracking-widest uppercase px-4 py-2 border transition-colors ${hero ? "border-white/25 text-white/60 hover:border-white hover:text-white" : "border-border text-muted-foreground hover:border-foreground hover:text-foreground"}`}>
            Plan Visit
          </button>
          <button onClick={() => setOpen(!open)} className={`xl:hidden transition-colors ${hero ? "text-white/70 hover:text-white" : "text-muted-foreground hover:text-foreground"}`}>
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      {open && (
        <div className="xl:hidden border-t border-border bg-background/98 backdrop-blur-md">
          <nav className="max-w-screen-xl mx-auto px-6 py-5 flex flex-col gap-0.5">
            {items.map((item) => (
              <button key={item.page} onClick={() => go(item.page)}
                className={`text-left font-sans text-sm py-3 border-b border-border/40 flex items-center justify-between transition-colors ${current === item.page ? "text-accent" : "text-foreground/70 hover:text-foreground"}`}>
                {item.label} <ChevronRight size={14} className="text-muted-foreground" />
              </button>
            ))}
          </nav>
        </div>
      )}
    </header>
  );
}
