import { useGo, type Page } from "./shared";

export default function Footer() {
  const go = useGo();
  return (
    <footer className="bg-secondary border-t border-border">
      <div className="max-w-screen-xl mx-auto px-6 lg:px-10 pt-16 pb-10">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-10 mb-16">
          <div className="col-span-2 md:col-span-1">
            <div className="font-display text-base font-semibold tracking-[0.1em] uppercase mb-0.5">Bodhisattva</div>
            <div className="font-mono text-[0.46rem] tracking-[0.28em] uppercase text-accent mb-5">Museum & Art Gallery</div>
            <p className="font-sans text-xs text-muted-foreground leading-relaxed font-light">Kupondole, Lalitpur, Nepal</p><br />
            <p className="font-sans text-xs text-muted-foreground leading-relaxed font-light">Sun-Fri 10:00am to 5:00pm</p>
            <p className="font-sans text-xs text-muted-foreground leading-relaxed font-light">+977-9818882876</p>
          </div>
          {([
            { title: "Visit", links: [["Home", "home"], ["Museum", "museum"], ["Gallery", "gallery"], ["Gift Shop", "shop"]] },
            { title: "Engage", links: [["Foundation", "foundation"], ["News Clippings", "news"], ["Membership", "about"], ["Events", "museum"]] },
            { title: "Connect", links: [["About Us", "about"], ["Press Enquiries", "news"], ["Research & Loans", "about"], ["Contact", "about"]] },
          ] as { title: string; links: [string, Page][] }[]).map((col) => (
            <div key={col.title}>
              <h4 className="font-mono text-[0.52em] tracking-widest uppercase text-foreground mb-5">{col.title}</h4>
              <div className="space-y-3">
                {col.links.map(([label, page]) => (
                  <button key={label} onClick={() => go(page)} className="block font-sans text-xs text-muted-foreground hover:text-accent transition-colors font-light">{label}</button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="border-t border-border pt-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <span className="font-mono text-[0.46rem] tracking-widest uppercase text-muted-foreground">© 2026 Bodhisattva Museum & Art Gallery. All rights reserved.</span>
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
