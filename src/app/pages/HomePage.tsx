import { useState } from "react";
import { motion } from "motion/react";
import { ArrowRight } from "lucide-react";
import { uimg, SectionLabel, useGo } from "../components/shared";

export default function HomePage() {
  const onNav = useGo();
  const [loaded, setLoaded] = useState(false);
  return (
    <div>
      {/* Hero */}
      <section className="relative h-screen min-h-[640px] flex flex-col justify-end overflow-hidden">
        <div className="absolute inset-0 bg-[#1C1A16]">
          <img src={uimg("photo-1779949437853-d8b00aee936c", 1920, 1080)} alt="Ancient Buddhist statue in museum gallery"
            onLoad={() => setLoaded(true)}
            className={`w-full h-full object-cover transition-opacity duration-1000 ${loaded ? "opacity-60" : "opacity-0"}`} />
          <div className="absolute inset-0 bg-gradient-to-t from-[#0F0D0A]/80 via-[#0F0D0A]/20 to-transparent" />
        </div>
        <div className="relative z-10 max-w-screen-xl mx-auto px-6 lg:px-10 pb-20 w-full">
          <motion.div initial={{ opacity: 0, y: 48 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}>
            <p className="font-mono text-[0.56rem] tracking-[0.32em] uppercase text-white/38 mb-5">Est. 2000 &nbsp;·&nbsp; Lalitpur, Nepal &nbsp;·&nbsp; 12,400+ Artifacts</p>
            <h1 className="font-display text-5xl sm:text-6xl md:text-7xl lg:text-[5.5rem] font-medium text-white leading-[0.92] mb-7 max-w-4xl">
              Where Heritage<br /><em className="font-sans italic font-light text-amber-200/90">Meets Eternity</em>
            </h1>
            <p className="font-sans text-sm text-white/52 max-w-md leading-relaxed mb-10 font-light">
              Dedicated to preserving and presenting the finest expressions of South Asian art, Buddhist heritage, and contemporary cultural dialogue.
            </p>
            <div className="flex flex-wrap gap-4">
              <button onClick={() => onNav("museum")} className="inline-flex items-center gap-2 bg-amber-800/85 hover:bg-amber-800 text-amber-50 px-7 py-3.5 text-[0.62rem] tracking-[0.18em] uppercase font-sans transition-colors">
                Explore Museum <ArrowRight size={13} />
              </button>
              <button onClick={() => onNav("gallery")} className="inline-flex items-center gap-2 border border-white/28 text-white/75 px-7 py-3.5 text-[0.62rem] tracking-[0.18em] uppercase font-sans hover:border-white hover:text-white transition-all">
                View Gallery
              </button>
            </div>
          </motion.div>
        </div>
        <div className="absolute bottom-8 right-8 z-10 flex flex-col items-center gap-3">
          <div className="w-px h-14 bg-gradient-to-b from-transparent to-white/18" />
          <span className="font-mono text-[0.46rem] tracking-[0.22em] uppercase text-white/28 [writing-mode:vertical-rl]">Scroll to discover</span>
        </div>
      </section>

      {/* Museum Intro */}
      <section className="py-28 max-w-screen-xl mx-auto px-6 lg:px-10">
        <div className="grid lg:grid-cols-2 gap-20 items-center">
          <motion.div initial={{ opacity: 0, x: -32 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}>
            <SectionLabel>Our Purpose</SectionLabel>
            <h2 className="font-display text-4xl md:text-5xl font-medium leading-[1.08] mb-8">
              A Living Archive of<br /><em className="font-sans italic font-light text-accent">Sacred Civilization</em>
            </h2>
            <p className="font-sans text-sm text-muted-foreground leading-relaxed mb-5 font-light">
              Bodhisattva Museum & Art Gallery stands as Nepal&apos;s premier institution dedicated to Buddhist art and South Asian cultural heritage. Founded in 2000, we house over 12,000 artifacts spanning three millennia of artistic expression.
            </p>
            <p className="font-sans text-sm text-muted-foreground leading-relaxed mb-10 font-light">
              We believe that art is not merely an object to be observed, but a living conversation between civilizations — a bridge between the ancient and the contemporary.
            </p>
            <button onClick={() => onNav("about")} className="inline-flex items-center gap-2 text-[0.62rem] tracking-[0.18em] uppercase font-sans border-b border-foreground pb-0.5 hover:text-accent hover:border-accent transition-colors">
              Our Story <ArrowRight size={12} />
            </button>
          </motion.div>
          <motion.div initial={{ opacity: 0, x: 32 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1], delay: 0.1 }} className="relative">
            <div className="aspect-[4/5] overflow-hidden bg-muted">
              <img src={uimg("photo-1772617616268-a2f27d194fce", 800, 1000)} alt="Sculptures in museum gallery with paintings" className="w-full h-full object-cover hover:scale-105 transition-transform duration-700" />
            </div>
            <div className="absolute -bottom-6 -left-6 bg-accent text-accent-foreground px-8 py-6">
              <div className="font-display text-4xl font-medium">12,400+</div>
              <div className="font-mono text-[0.5rem] tracking-[0.2em] uppercase opacity-80 mt-1">Artifacts Preserved</div>
            </div>
            <div className="absolute -top-5 -right-5 w-20 h-20 border border-accent/30" />
          </motion.div>
        </div>
      </section>

      {/* Featured Collections */}
      <section className="bg-secondary py-24">
        <div className="max-w-screen-xl mx-auto px-6 lg:px-10">
          <div className="flex items-end justify-between mb-12">
            <div><SectionLabel>Permanent Collection</SectionLabel><h2 className="font-display text-3xl md:text-4xl font-medium">Featured Collections</h2></div>
            <button onClick={() => onNav("museum")} className="hidden md:inline-flex items-center gap-2 text-[0.6rem] tracking-[0.18em] uppercase font-sans text-muted-foreground hover:text-accent transition-colors">View All <ArrowRight size={12} /></button>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              { title: "Gandharan Sculpture", period: "1st – 5th Century CE", count: "487 works", id: "photo-1775212253782-d223fe035ddc", alt: "Two ancient statues in contemplation" },
              { title: "Buddhist Manuscript Art", period: "8th – 16th Century", count: "1,240 manuscripts", id: "photo-1765127959724-631190c32e8a", alt: "Ancient manuscript display case" },
              { title: "Contemporary Dialogues", period: "1960 – Present", count: "890 works", id: "photo-1605429523419-d828acb941d9", alt: "Contemporary paintings on gallery wall" },
            ].map((col, i) => (
              <motion.div key={col.title} initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6, delay: i * 0.1 }} className="group cursor-pointer" onClick={() => onNav("museum")}>
                <div className="aspect-[3/4] overflow-hidden bg-muted mb-4">
                  <img src={uimg(col.id, 600, 800)} alt={col.alt} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" />
                </div>
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-display text-lg font-medium mb-1 group-hover:text-accent transition-colors">{col.title}</h3>
                    <p className="font-mono text-[0.52rem] tracking-widest uppercase text-muted-foreground">{col.period}</p>
                  </div>
                  <span className="font-mono text-[0.52rem] tracking-wider text-accent mt-1">{col.count}</span>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Current Exhibitions */}
      <section className="py-28 max-w-screen-xl mx-auto px-6 lg:px-10">
        <SectionLabel>On View Now</SectionLabel>
        <div className="grid lg:grid-cols-5 border border-border">
          <div className="lg:col-span-3 relative aspect-[16/10] overflow-hidden bg-muted">
            <img src={uimg("photo-1569783721854-33a99b4c0bae", 1200, 800)} alt="Visitors observing paintings in gallery" className="w-full h-full object-cover hover:scale-105 transition-transform duration-700" />
            <div className="absolute inset-0 bg-gradient-to-t from-[#1C1A16]/70 via-transparent to-transparent" />
            <div className="absolute bottom-8 left-8 right-8">
              <span className="font-mono text-[0.52rem] tracking-widest uppercase text-white/48 block mb-2">Main Hall &nbsp;·&nbsp; Until Nov 2026</span>
              <h3 className="font-display text-2xl md:text-3xl text-white font-medium">Echoes of Enlightenment</h3>
            </div>
          </div>
          <div className="lg:col-span-2 flex flex-col divide-y divide-border border-l border-border">
            {[
              { loc: "East Wing · Until Sep 2026", title: "The Silk Road Chronicles", desc: "Tracing Buddhist iconography along ancient trade routes from Gandhara to Tang Dynasty China." },
              { loc: "North Gallery · Until Oct 2026", title: "Feminine Divine", desc: "Goddess iconography across Buddhist, Jain, and Hindu artistic traditions." },
              { loc: "Terrace Gallery · Until Dec 2026", title: "Living Crafts of Nepal", desc: "Contemporary craftspeople working within inherited regional traditions, photographed in their workshops." },
            ].map((ex) => (
              <div key={ex.title} className="p-7 group cursor-pointer hover:bg-secondary/60 transition-colors" onClick={() => onNav("gallery")}>
                <span className="font-mono text-[0.5rem] tracking-widest uppercase text-accent block mb-2">{ex.loc}</span>
                <h3 className="font-display text-base font-medium mb-2 group-hover:text-accent transition-colors">{ex.title}</h3>
                <p className="font-sans text-xs text-muted-foreground leading-relaxed font-light">{ex.desc}</p>
              </div>
            ))}
            <div className="p-7">
              <button onClick={() => onNav("gallery")} className="inline-flex items-center gap-2 text-[0.6rem] tracking-[0.18em] uppercase font-sans border-b border-foreground pb-0.5 hover:text-accent hover:border-accent transition-colors">
                All Exhibitions <ArrowRight size={12} />
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Curator Quote */}
      <section className="bg-foreground text-primary-foreground py-24">
        <div className="max-w-screen-lg mx-auto px-6 text-center">
          <SectionLabel light>Curator&apos;s Note</SectionLabel>
          <blockquote className="font-sans text-2xl md:text-3xl lg:text-[2rem] font-light italic leading-[1.4] mb-8 text-primary-foreground/88">
            &ldquo;Every sculpture here is a question the ancient world poses to our present — and an invitation to answer.&rdquo;
          </blockquote>
          <div className="flex items-center justify-center gap-4">
            <div className="w-10 h-px bg-accent" />
            <span className="font-mono text-[0.52rem] tracking-[0.25em] uppercase text-primary-foreground/38">Siddhartha Man Shakya &nbsp;·&nbsp; Chief Curator</span>
            <div className="w-10 h-px bg-accent" />
          </div>
        </div>
      </section>

      {/* Foundation Preview */}
      <section className="py-28 max-w-screen-xl mx-auto px-6 lg:px-10">
        <div className="grid lg:grid-cols-2 gap-20 items-center">
          <div className="grid grid-cols-2 gap-4">
            <motion.div initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.7 }} className="aspect-square overflow-hidden bg-muted">
              <img src={uimg("photo-1708795921259-263a5e973acb", 500, 500)} alt="Child painting on canvas" className="w-full h-full object-cover" />
            </motion.div>
            <motion.div initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.7, delay: 0.12 }} className="aspect-square overflow-hidden bg-muted mt-10">
              <img src={uimg("photo-1756694915450-50c9796fb96d", 500, 500)} alt="Children painting together outdoors" className="w-full h-full object-cover" />
            </motion.div>
          </div>
          <div>
            <SectionLabel>Foundation & CSR</SectionLabel>
            <h2 className="font-display text-4xl md:text-5xl font-medium leading-[1.08] mb-6">
              Art as an Act<br /><em className="font-sans italic font-light text-accent">of Responsibility</em>
            </h2>
            <p className="font-sans text-sm text-muted-foreground leading-relaxed mb-8 font-light">
              The Bodhisattva Foundation runs 14 active programs across Nepal, nurturing young artists, preserving endangered crafts, and bringing museum access to underserved communities.
            </p>
            <div className="grid grid-cols-3 gap-4 mb-10 py-6 border-y border-border">
              {[["14", "Active Programs"], ["1,000+", "Students Reached"], ["Rs.10L", "Artist Grants"]].map(([n, l]) => (
                <div key={l}>
                  <div className="font-display text-3xl font-medium text-accent">{n}</div>
                  <div className="font-mono text-[0.5rem] tracking-wider uppercase text-muted-foreground mt-1 leading-relaxed">{l}</div>
                </div>
              ))}
            </div>
            <button onClick={() => onNav("foundation")} className="inline-flex items-center gap-2 bg-accent text-accent-foreground px-7 py-3.5 text-[0.62rem] tracking-[0.18em] uppercase font-sans hover:opacity-90 transition-opacity">
              Learn More <ArrowRight size={13} />
            </button>
          </div>
        </div>
      </section>

      {/* Latest News */}
      <section className="bg-secondary py-24">
        <div className="max-w-screen-xl mx-auto px-6 lg:px-10">
          <div className="flex items-end justify-between mb-12">
            <div><SectionLabel>Press & Media</SectionLabel><h2 className="font-display text-3xl md:text-4xl font-medium">Latest News</h2></div>
            <button onClick={() => onNav("news")} className="hidden md:inline-flex items-center gap-2 text-[0.6rem] tracking-[0.18em] uppercase font-sans text-muted-foreground hover:text-accent transition-colors">All Clippings <ArrowRight size={12} /></button>
          </div>
          <div className="grid md:grid-cols-3 gap-0 border-t border-border">
            {[
              { outlet: "The Hindu", date: "12 Aug 2026", title: "Bodhisattva Museum Acquires Rare 3rd Century Mathura Sculpture", type: "News" },
              { outlet: "Art Nepal Magazine", date: "05 Aug 2026", title: "Siddhartha Man Shakya on the Future of Buddhist Art Scholarship in Nepal", type: "Interview" },
              { outlet: "Times of Nepal", date: "28 Jul 2026", title: "'Echoes of Enlightenment' Draws Record 40,000 Visitors in First Month", type: "Press Release" },
            ].map((item, i) => (
              <article key={item.title} onClick={() => onNav("news")} className={`pt-8 pb-8 pr-8 group cursor-pointer ${i > 0 ? "pl-8 border-l border-border" : ""}`}>
                <div className="flex items-center justify-between mb-3">
                  <span className="font-mono text-[0.5rem] tracking-widest uppercase text-accent">{item.type}</span>
                  <span className="font-mono text-[0.5rem] tracking-wider text-muted-foreground">{item.date}</span>
                </div>
                <h3 className="font-display text-lg font-medium leading-snug mb-2 group-hover:text-accent transition-colors">{item.title}</h3>
                <p className="font-sans text-xs text-muted-foreground">{item.outlet}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Newsletter */}
      <section className="py-24 max-w-screen-xl mx-auto px-6 lg:px-10">
        
      </section>
    </div>
  );
}
