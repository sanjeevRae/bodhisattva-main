import { useState } from "react";
import { useSearchParams } from "react-router";
import { Search } from "lucide-react";
import { usePage } from "../lib/api";
import PageRenderer, { PageStatus } from "../components/PageRenderer";
import NewsArchive from "../components/NewsArchive";

/**
 * News Clippings — the hero band comes from the CMS (GET /api/pages/news)
 * via PageRenderer, exactly as before: title/eyebrow from the section
 * config, the search input inside the band. Below it, the news_listing
 * section now renders the digital press archive (NewsArchive): the
 * hero's query becomes the archive's server-side search, and the
 * archive adds facets-driven filters, a featured story and Load More
 * pagination over GET /api/news. The initial query is read from the
 * `search` URL param so shared archive links land pre-searched.
 */
export default function NewsPage() {
  const { data: page, error } = usePage("news");
  const [searchParams] = useSearchParams();
  const [query, setQuery] = useState(
    () => searchParams.get("search") ?? "",
  );
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
                  <p className="font-mono text-[0.6rem] tracking-[0.28em] uppercase text-muted-foreground mb-3">{section.config.eyebrow}</p>
                  <h1 className="font-display text-5xl md:text-6xl font-medium mb-10">{section.config.heading}</h1>
                  <div className="relative max-w-2xl">
                    <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input
                      type="text"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search by title, outlet, or type…"
                      className="w-full bg-background border border-border pl-10 pr-5 py-3.5 text-sm font-sans focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/40 text-foreground placeholder:text-muted-foreground"
                    />
                  </div>
                </div>
              </div>
            );
          }
          if (section.type === "news_listing") {
            return (
              <NewsArchive
                query={query}
                onClearQuery={() => setQuery("")}
              />
            );
          }
          return undefined;
        }}
      />
    </div>
  );
}
