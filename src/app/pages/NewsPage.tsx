import { useState } from "react";
import { Search, ArrowRight, Download } from "lucide-react";

export default function NewsPage() {
  const [query, setQuery] = useState("");

  const articles = [
    { id: 1, outlet: "The Hindu", date: "12 Aug 2026", title: "Bodhisattva Museum Acquires Rare 3rd Century Mathura Sculpture", type: "News", summary: "The museum announced the acquisition of a polished red sandstone Buddha figure from the estate of late collector Shri P.N. Lal — considered one of the finest Mathura school pieces in private hands." },
    { id: 2, outlet: "Art Nepal Magazine", date: "05 Aug 2026", title: "Siddhartha Man Shakya on the Future of Buddhist Art Scholarship", type: "Interview", summary: "In conversation with our editor, the chief curator discusses how digital technology is democratizing access to ancient art, and why the next decade will be a golden age for South Asian museum scholarship." },
    { id: 3, outlet: "Times of Nepal", date: "28 Jul 2026", title: "'Echoes of Enlightenment' Draws Record 40,000 Visitors in Opening Month", type: "Press Release", summary: "The museum's flagship 2026 exhibition has exceeded attendance projections, prompting an extension through November. Weekend slots are fully booked through September." },
    { id: 4, outlet: "The Wire", date: "14 Jul 2026", title: "Can Museums Keep Buddhist Art Sacred? A National Debate", type: "Feature", summary: "A longform examination of the ethics of displaying sacred objects, drawing on commentary from Bodhisattva Museum's curatorial team and scholars across Nepal and Sri Lanka." },
    { id: 5, outlet: "Mint Lounge", date: "02 Jun 2026", title: "Inside the Museum That Believes Art Should Be Free", type: "Feature", summary: "How the Bodhisattva Foundation's free-entry Sunday policy has transformed who visits Nepal's art institutions — and what other museums could learn." },
    { id: 6, outlet: "Hindustan Times", date: "20 May 2026", title: "Bodhisattva Museum Signs MOU with Nalanda University", type: "News", summary: "A landmark research partnership enabling co-curated exhibitions and joint publication of scholarly catalogs on early Buddhist art history." },
    { id: 7, outlet: "Outlook", date: "11 Apr 2026", title: "Review: The Silk Road Chronicles — Four Stars", type: "Review", summary: "\"A rare exhibition that succeeds in making scholarship viscerally felt. The material culture of faith, compressed across three millennia and two continents, emerges startlingly coherent.\"" },
    { id: 8, outlet: "NDTV", date: "15 Mar 2026", title: "Museum Launches Free Digital Archive of 5,000 Artifacts", type: "Press Release", summary: "All artifact photography and curatorial notes from the permanent collection are now freely available at the museum's new open-access digital library, supporting researchers worldwide." },
  ];

  const typeColor: Record<string, string> = {
    "News": "text-amber-700 dark:text-amber-400",
    "Interview": "text-emerald-700 dark:text-emerald-400",
    "Feature": "text-blue-700 dark:text-blue-400",
    "Press Release": "text-purple-700 dark:text-purple-400",
    "Review": "text-rose-700 dark:text-rose-400",
  };

  const filtered = articles.filter((a) => query === "" || a.title.toLowerCase().includes(query.toLowerCase()) || a.outlet.toLowerCase().includes(query.toLowerCase()) || a.type.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="pt-16">
      <div className="bg-secondary border-b border-border py-20">
        <div className="max-w-screen-xl mx-auto px-6 lg:px-10">
          <p className="font-mono text-[0.52rem] tracking-[0.28em] uppercase text-muted-foreground mb-3">Press Archive</p>
          <h1 className="font-display text-5xl md:text-6xl font-medium mb-10">News Clippings</h1>
          <div className="relative max-w-xl">
            <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by title, outlet, or type…" className="w-full bg-background border border-border pl-10 pr-5 py-3.5 text-sm font-sans focus:outline-none focus:border-accent text-foreground placeholder:text-muted-foreground" />
          </div>
        </div>
      </div>

      <div className="max-w-screen-xl mx-auto px-6 lg:px-10 py-12">
        {filtered.length === 0 && (
          <p className="py-16 text-center font-sans text-sm text-muted-foreground">No results for &ldquo;{query}&rdquo;</p>
        )}
        <div className="divide-y divide-border">
          {filtered.map((article) => (
            <article key={article.id} className="grid md:grid-cols-6 gap-6 py-10 group cursor-pointer hover:bg-secondary/40 -mx-6 lg:-mx-10 px-6 lg:px-10 transition-colors">
              <div className="md:col-span-1">
                <span className={`font-mono text-[0.5rem] tracking-widest uppercase block mb-1 ${typeColor[article.type] ?? "text-accent"}`}>{article.type}</span>
                <span className="font-mono text-[0.5rem] tracking-wider text-muted-foreground block mb-2">{article.date}</span>
                <span className="font-sans text-xs font-medium text-foreground block">{article.outlet}</span>
              </div>
              <div className="md:col-span-5">
                <h3 className="font-display text-xl font-medium mb-3 group-hover:text-accent transition-colors leading-snug">{article.title}</h3>
                <p className="font-sans text-xs text-muted-foreground leading-relaxed mb-4 font-light max-w-2xl">{article.summary}</p>
                <div className="flex items-center gap-6">
                  <button className="flex items-center gap-2 font-mono text-[0.5rem] tracking-widest uppercase text-muted-foreground hover:text-accent transition-colors"><Download size={11} /> Download PDF</button>
                  <button className="flex items-center gap-2 font-mono text-[0.5rem] tracking-widest uppercase text-muted-foreground hover:text-accent transition-colors">Read Article <ArrowRight size={11} /></button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
