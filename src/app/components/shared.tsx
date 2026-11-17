import { useState, useEffect } from "react";
import { useNavigate } from "react-router";

export type Page = "home" | "museum" | "gallery" | "shop" | "news" | "foundation" | "about";

export const pagePaths: Record<Page, string> = {
  home: "/",
  museum: "/museum",
  gallery: "/gallery",
  shop: "/shop",
  news: "/news",
  foundation: "/foundation",
  about: "/about",
};

export function pageFromPath(pathname: string): Page {
  const entry = (Object.entries(pagePaths) as [Page, string][]).find(([, p]) => p === pathname);
  return entry ? entry[0] : "home";
}

export function useGo() {
  const navigate = useNavigate();
  return (p: Page) => navigate(pagePaths[p]);
}

export const uimg = (id: string, w = 1200, h = 800) =>
  `https://images.unsplash.com/${id}?w=${w}&h=${h}&fit=crop&auto=format&q=80`;

export function SectionLabel({ children, light = false }: { children: React.ReactNode; light?: boolean }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <span className={`block w-8 h-px ${light ? "bg-amber-400" : "bg-accent"}`} />
      <span className={`font-mono text-[0.6rem] tracking-[0.22em] uppercase ${light ? "text-amber-400" : "text-accent"}`}>
        {children}
      </span>
    </div>
  );
}

export function useWebsiteProtection() {
  const [contentObscured, setContentObscured] = useState(false);

  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
    };

    const prevent = (event: Event) => {
      event.preventDefault();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const blockedCombo =
        (event.ctrlKey && event.shiftKey && ["i", "j", "c"].includes(key)) ||
        (event.metaKey && event.altKey && ["i", "j", "c"].includes(key)) ||
        ((event.ctrlKey || event.metaKey) && key === "u") ||
        (event.metaKey && event.shiftKey && key === "s");

      if (event.key === "F12" || blockedCombo) {
        event.preventDefault();
        event.stopPropagation();
        setContentObscured(true);
        window.setTimeout(() => setContentObscured(false), 1400);
      }
    };

    const handleCopyCut = (event: ClipboardEvent) => {
      if (!isEditableTarget(event.target)) prevent(event);
    };

    const handleVisibility = () => {
      setContentObscured(document.hidden);
    };

    const handleBlur = () => setContentObscured(true);
    const handleFocus = () => setContentObscured(false);
    const handlePrintScreen = (event: KeyboardEvent) => {
      if (event.key === "PrintScreen") {
        setContentObscured(true);
        window.setTimeout(() => setContentObscured(false), 1400);
      }
    };

    document.addEventListener("contextmenu", prevent);
    document.addEventListener("dragstart", prevent);
    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("keyup", handlePrintScreen, true);
    document.addEventListener("copy", handleCopyCut);
    document.addEventListener("cut", handleCopyCut);
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("blur", handleBlur);
    window.addEventListener("focus", handleFocus);

    return () => {
      document.removeEventListener("contextmenu", prevent);
      document.removeEventListener("dragstart", prevent);
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("keyup", handlePrintScreen, true);
      document.removeEventListener("copy", handleCopyCut);
      document.removeEventListener("cut", handleCopyCut);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("blur", handleBlur);
      window.removeEventListener("focus", handleFocus);
    };
  }, []);

  return contentObscured;
}
