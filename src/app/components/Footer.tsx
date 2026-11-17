import { useEffect, useState } from "react";
import { Link } from "react-router";
import { getMenu, getSiteSettings, settingString, type CmsMenu } from "../lib/api";

interface FooterColumn {
  title: string;
  links: { label: string; path: string }[];
}

// Initial render state = the current hardcoded values, so first paint
// matches the pre-CMS site exactly; the API data (menus footer_visit /
// footer_engage / footer_connect + site settings) replaces it as soon
// as it resolves (mapping §2). The legal spans at the bottom are inert
// on the current site and stay as-is (mapping §2.2).
const DEFAULT_COLUMNS: FooterColumn[] = [
  {
    title: "Visit",
    links: [
      { label: "Home", path: "/" },
      { label: "Museum", path: "/museum" },
      { label: "Gallery", path: "/gallery" },
      { label: "Gift Shop", path: "/shop" },
    ],
  },
  {
    title: "Engage",
    links: [
      { label: "Foundation", path: "/foundation" },
      { label: "News Clippings", path: "/news" },
      { label: "Membership", path: "/about" },
      { label: "Events", path: "/museum" },
    ],
  },
  {
    title: "Connect",
    links: [
      { label: "About Us", path: "/about" },
      { label: "Press Enquiries", path: "/news" },
      { label: "Research & Loans", path: "/about" },
      { label: "Contact", path: "/about" },
    ],
  },
];

function toColumn(menu: CmsMenu): FooterColumn {
  return {
    title: menu.name,
    links: menu.items
      .filter((item) => item.isVisible && item.path)
      .map((item) => ({ label: item.label, path: item.path as string })),
  };
}

export default function Footer() {
  const [columns, setColumns] = useState<FooterColumn[]>(DEFAULT_COLUMNS);
  const [siteName, setSiteName] = useState("Bodhisattva");
  const [siteTagline, setSiteTagline] = useState("Museum & Art Gallery");
  const [address, setAddress] = useState("Kupondole, Lalitpur, Nepal");
  const [hoursSummary, setHoursSummary] = useState("Sun-Fri 10:00am to 5:00pm");
  const [phone, setPhone] = useState("+977-9818882876");
  const [copyright, setCopyright] = useState("© 2026 Bodhisattva Museum & Art Gallery. All rights reserved.");

  useEffect(() => {
    let alive = true;
    Promise.all([getMenu("footer_visit"), getMenu("footer_engage"), getMenu("footer_connect")])
      .then((menus) => {
        if (!alive) return;
        const mapped = menus.map(toColumn);
        if (mapped.every((col) => col.links.length > 0)) setColumns(mapped);
      })
      .catch(() => { /* keep the initial values */ });
    getSiteSettings()
      .then((settings) => {
        if (!alive) return;
        setSiteName(settingString(settings, "site_name", "Bodhisattva"));
        setSiteTagline(settingString(settings, "site_tagline", "Museum & Art Gallery"));
        setAddress(settingString(settings, "contact_address", "Kupondole, Lalitpur, Nepal"));
        setHoursSummary(settingString(settings, "opening_hours_summary", "Sun-Fri 10:00am to 5:00pm"));
        setPhone(settingString(settings, "contact_phone", "+977-9818882876"));
        setCopyright(settingString(settings, "copyright_text", "© 2026 Bodhisattva Museum & Art Gallery. All rights reserved."));
      })
      .catch(() => { /* keep the initial values */ });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <footer className="bg-secondary border-t border-border">
      <div className="max-w-screen-xl mx-auto px-6 lg:px-10 pt-16 pb-10">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-10 mb-16">
          <div className="col-span-2 md:col-span-1">
            <div className="font-display text-base font-semibold tracking-[0.1em] uppercase mb-0.5">{siteName}</div>
            <div className="font-mono text-[0.46rem] tracking-[0.28em] uppercase text-accent mb-5">{siteTagline}</div>
            <p className="font-sans text-xs text-muted-foreground leading-relaxed font-light">{address}</p><br />
            <p className="font-sans text-xs text-muted-foreground leading-relaxed font-light">{hoursSummary}</p>
            <p className="font-sans text-xs text-muted-foreground leading-relaxed font-light">{phone}</p>
          </div>
          {columns.map((col) => (
            <div key={col.title}>
              <h4 className="font-mono text-[0.52em] tracking-widest uppercase text-foreground mb-5">{col.title}</h4>
              <div className="space-y-3">
                {col.links.map((link) => (
                  <Link key={link.label} to={link.path} className="block font-sans text-xs text-muted-foreground hover:text-accent transition-colors font-light">{link.label}</Link>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="border-t border-border pt-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <span className="font-mono text-[0.46rem] tracking-widest uppercase text-muted-foreground">{copyright}</span>
          <div className="flex gap-6">
            {["Privacy Policy", "Terms of Use", "Accessibility"].map((item) => (
              <span key={item} className="font-mono text-[0.46rem] tracking-wider text-muted-foreground cursor-pointer hover:text-accent transition-colors">{item}</span>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
