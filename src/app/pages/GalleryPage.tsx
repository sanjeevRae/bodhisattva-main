import { useState } from "react";
import { motion } from "motion/react";
import { uimg } from "../components/shared";

export default function GalleryPage() {
  const [year, setYear] = useState("all");
  const [cat, setCat] = useState("all");

  const exhibitions = [
    { id: 1, title: "Echoes of Enlightenment", year: "2026", cat: "buddhist", date: "Mar – Nov 2026", curator: "Siddhartha Man Shakya", desc: "An immersive journey through Pali Buddhist iconography from Amaravati to Sanchi.", imgId: "photo-1569783721854-33a99b4c0bae", tall: true },
    { id: 2, title: "The Silk Road Chronicles", year: "2026", cat: "historical", date: "Jan – Sep 2026", curator: "Siddhartha Man Shakya", desc: "Tracing Buddhist iconography along ancient trade routes from Gandhara to Tang China.", imgId: "photo-1775212253782-d223fe035ddc", tall: false },
    { id: 3, title: "Feminine Divine", year: "2026", cat: "thematic", date: "Jun – Oct 2026", curator: "Siddhartha Man Shakya", desc: "Goddess iconography across Buddhist, Jain, and Hindu traditions.", imgId: "photo-1563000215-e31a8ddcb2d0", tall: true },
    { id: 4, title: "Sacred Geometries", year: "2025", cat: "thematic", date: "Sep 2025 – Jan 2026", curator: "Siddhartha Man Shakya", desc: "Mandala and yantra traditions across South and Southeast Asia.", imgId: "photo-1735605917461-4c1b77a6616f", tall: false },
    { id: 5, title: "Ink & Devotion", year: "2025", cat: "buddhist", date: "Apr – Aug 2025", curator: "Siddhartha Man Shakya", desc: "Sanskrit manuscript painting from the Pala workshops of Bengal.", imgId: "photo-1765127959724-631190c32e8a", tall: false },
    { id: 6, title: "Living Crafts of Nepal", year: "2025", cat: "contemporary", date: "Jan – May 2025", curator: "Siddhartha Man Shakya", desc: "Contemporary craftspeople working within inherited regional traditions.", imgId: "photo-1605429523419-d828acb941d9", tall: true },
    { id: 7, title: "Conversations in Bronze", year: "2024", cat: "historical", date: "Oct 2024 – Feb 2025", curator: "Siddhartha Man Shakya", desc: "Chola bronzes and their twentieth-century resonances.", imgId: "photo-1772617616268-a2f27d194fce", tall: false },
    { id: 8, title: "The Enlightened Eye", year: "2024", cat: "contemporary", date: "Mar – Jul 2024", curator: "Siddhartha Man Shakya", desc: "Contemporary artists responding to Buddhist philosophies of seeing.", imgId: "photo-1761334859641-139cffff4a47", tall: false },
    { id: 9, title: "Pillars of Dharma", year: "2023", cat: "buddhist", date: "Jun – Dec 2023", curator: "Siddhartha Man Shakya", desc: "Monumental Buddhist architecture and its rich symbolic language.", imgId: "photo-1759296456443-1cf1a93d173f", tall: true },
  ];

  const years = ["all", "2026", "2025", "2024", "2023"];
  const cats = ["all", "buddhist", "historical", "thematic", "contemporary"];
  const filtered = exhibitions.filter((e) => (year === "all" || e.year === year) && (cat === "all" || e.cat === cat));

  return (
    <div className="pt-16">
      <div className="bg-secondary py-20 border-b border-border">
        <div className="max-w-screen-xl mx-auto px-6 lg:px-10">
          <p className="font-mono text-[0.52rem] tracking-[0.28em] uppercase text-muted-foreground mb-3">Archive</p>
          <h1 className="font-display text-5xl md:text-6xl font-medium">Past Exhibitions</h1>
        </div>
      </div>

      <div className="border-b border-border sticky top-16 bg-background/96 backdrop-blur-md z-30">
        <div className="max-w-screen-xl mx-auto px-6 lg:px-10 py-3.5 flex flex-wrap gap-x-10 gap-y-2.5">
          <div className="flex items-center gap-3">
            <span className="font-mono text-[0.48rem] tracking-widest uppercase text-muted-foreground">Year</span>
            <div className="flex gap-1">
              {years.map((y) => (
                <button key={y} onClick={() => setYear(y)} className={`font-mono text-[0.52rem] tracking-widest uppercase px-3 py-1.5 border transition-colors ${year === y ? "border-accent bg-accent text-accent-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
                  {y === "all" ? "All" : y}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="font-mono text-[0.48rem] tracking-widest uppercase text-muted-foreground">Category</span>
            <div className="flex gap-1">
              {cats.map((c) => (
                <button key={c} onClick={() => setCat(c)} className={`font-mono text-[0.52rem] tracking-widest uppercase px-3 py-1.5 border transition-colors ${cat === c ? "border-accent bg-accent text-accent-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
                  {c === "all" ? "All" : c}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-screen-xl mx-auto px-6 lg:px-10 py-16">
        {filtered.length === 0 ? (
          <p className="text-center py-24 font-sans text-sm text-muted-foreground">No exhibitions match your selection.</p>
        ) : (
          <div className="columns-1 sm:columns-2 lg:columns-3 gap-6">
            {filtered.map((ex, i) => (
              <motion.div key={ex.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: i * 0.06 }} className="break-inside-avoid mb-6 group cursor-pointer">
                <div className={`overflow-hidden bg-muted ${ex.tall ? "aspect-[3/4]" : "aspect-[4/3]"}`}>
                  <img src={uimg(ex.imgId, 700, ex.tall ? 933 : 525)} alt={ex.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" />
                </div>
                <div className="pt-4 pb-6 border-b border-border">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono text-[0.5rem] tracking-widest uppercase text-accent">{ex.cat}</span>
                    <span className="font-mono text-[0.5rem] tracking-wider text-muted-foreground">{ex.date}</span>
                  </div>
                  <h3 className="font-display text-lg font-medium mb-1.5 group-hover:text-accent transition-colors">{ex.title}</h3>
                  <p className="font-sans text-xs text-muted-foreground leading-relaxed mb-2 font-light">{ex.desc}</p>
                  <p className="font-mono text-[0.48rem] tracking-widest uppercase text-muted-foreground/55">Curator: {ex.curator}</p>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
