import { useState } from "react";
import { Search } from "lucide-react";
import { usePage } from "../lib/api";
import PageRenderer, { NewsRows, PageStatus } from "../components/PageRenderer";

/**
 * News Clippings — content from the CMS (GET /api/pages/news) via
 * PageRenderer. The search box is the listing section's configuration
 * (enableSearch) rendered inside the hero band, as on the current site;
 * the query is page state shared between the band and the rows.
 * Article records are the temporary module data until Phase 5.
 */
export default function NewsPage() {
  const { data: page, error } = usePage("news");
  const [query, setQuery] = useState("");
  if (error) return <PageStatus error />;
  if (!page) return <PageStatus />;
  return (
    <div className="pt-16">
      <PageRenderer
        page={page}
        renderSection={(section) => {
          if (section.type === "hero") {
            return (
              <div className="bg-secondary border-b border-border py-20">
                <div className="max-w-screen-xl mx-auto px-6 lg:px-10">
                  <p className="font-mono text-[0.52rem] tracking-[0.28em] uppercase text-muted-foreground mb-3">{section.config.eyebrow}</p>
                  <h1 className="font-display text-5xl md:text-6xl font-medium mb-10">{section.config.heading}</h1>
                  <div className="relative max-w-xl">
                    <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input
                      type="text"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search by title, outlet, or type…"
                      className="w-full bg-background border border-border pl-10 pr-5 py-3.5 text-sm font-sans focus:outline-none focus:border-accent text-foreground placeholder:text-muted-foreground"
                    />
                  </div>
                </div>
              </div>
            );
          }
          if (section.type === "news_listing") {
            return <NewsRows query={query} />;
          }
          return undefined;
        }}
      />
    </div>
  );
}
