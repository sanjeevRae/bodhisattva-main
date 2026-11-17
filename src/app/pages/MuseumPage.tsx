import { useState } from "react";
import { motion } from "motion/react";
import { Play, Leaf } from "lucide-react";
import { uimg, SectionLabel, useGo } from "../components/shared";

export default function MuseumPage() {
  const onNav = useGo();
  const [activeFilter, setActiveFilter] = useState("All");
  const filters = ["All", "Sculpture", "Painting", "Manuscripts", "Coins", "Textiles", "Contemporary"];
  const collections = [
    { name: "Gandharan Sculpture", count: 487, id: "photo-1775212253782-d223fe035ddc", alt: "Ancient statues in contemplation" },
    { name: "Buddhist Paintings", count: 1240, id: "photo-1605429523419-d828acb941d9", alt: "Gallery wall with paintings" },
    { name: "Palm Leaf Manuscripts", count: 890, id: "photo-1765127959724-631190c32e8a", alt: "Ancient manuscript display" },
    { name: "Numismatic Collection", count: 3200, id: "photo-1768481498978-25ac2b210b35", alt: "Museum visitors at exhibit" },
    { name: "Decorative Textiles", count: 560, id: "photo-1772617616268-a2f27d194fce", alt: "Gallery sculptures and displays" },
    { name: "Contemporary Works", count: 724, id: "photo-1569783721854-33a99b4c0bae", alt: "Contemporary gallery visitors" },
  ];
  return (
    <div>
      <section className="relative h-[62vh] min-h-[460px] flex items-end overflow-hidden mt-16">
        <img src={uimg("photo-1765470129726-3689336ff549", 1920, 900)} alt="Interior of a grand museum hall" className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0F0D0A]/75 via-[#0F0D0A]/20 to-transparent" />
        <div className="relative z-10 max-w-screen-xl mx-auto px-6 lg:px-10 pb-16 w-full">
          <p className="font-mono text-[0.52rem] tracking-[0.28em] uppercase text-white/38 mb-3">The Collection</p>
          <h1 className="font-display text-5xl md:text-6xl font-medium text-white">The Museum</h1>
        </div>
      </section>

      <section className="py-24 max-w-screen-xl mx-auto px-6 lg:px-10">
        <div className="grid lg:grid-cols-5 gap-16">
          <div className="lg:col-span-3">
            <SectionLabel>Overview</SectionLabel>
            <h2 className="font-display text-3xl md:text-4xl font-medium mb-8 leading-[1.1]">
              Three Floors. Three Millennia.<br /><em className="font-sans italic font-light text-accent">One Continuous Story.</em>
            </h2>
            <p className="font-sans text-sm text-muted-foreground leading-relaxed mb-5 font-light">
              Spread across 28,000 sq. ft. in the heart of Lalitpur, Bodhisattva Museum houses the subcontinent&apos;s most comprehensive permanent collection of Buddhist art. Our galleries trace iconographic development from the pre-Asokan period through the Pala, Gupta, and Vijayanagara empires to the contemporary moment.
            </p>
            <p className="font-sans text-sm text-muted-foreground leading-relaxed font-light">
              The museum is organized around a principle of living dialogue: ancient works are displayed in conversation with contemporary artistic responses, encouraging visitors to see tradition not as a fixed archive but as a generative force.
            </p>
          </div>
          <div className="lg:col-span-2 space-y-5">
            {[["Established", "2000"], ["Total Area", "28,000 sq.ft."], ["Artifacts", "12,400+"], ["Annual Visitors", "2.1 Million"], ["Active Galleries", "18 Rooms"], ["Languages", "8 Supported"]].map(([l, v]) => (
              <div key={l} className="flex items-end justify-between border-b border-border pb-4">
                <span className="font-mono text-[0.56rem] tracking-widest uppercase text-muted-foreground">{l}</span>
                <span className="font-display text-xl font-medium">{v}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-secondary py-24 border-y border-border">
        <div className="max-w-screen-xl mx-auto px-6 lg:px-10">
          <SectionLabel>History</SectionLabel>
          <h2 className="font-display text-3xl font-medium mb-14">A History of Collecting</h2>
          <div className="relative overflow-x-auto pb-2">
            <div className="flex min-w-[680px]">
              {[
                { year: "2000", event: "Founded by Siddhartha Man Shakya with 200 core artifacts in a converted Civil Lines haveli." },
                { year: "2003", event: "East Wing expansion; landmark Gandharan sculpture collection acquired." },
                { year: "2009", event: "International partnerships with the British Museum and Freer Gallery established." },
                { year: "2015", event: "Digital archive and virtual tour platform launched; 5,000 works digitized." },
                { year: "2022", event: "Contemporary Dialogues wing inaugurated. Foundation reaches 5,000 students." },
              ].map((item, i) => (
                <div key={item.year} className="flex-1 relative pl-5 pr-4">
                  <div className="absolute left-0 top-0 w-3 h-3 rounded-full bg-accent border-2 border-secondary z-10" />
                  {i < 4 && <div className="absolute left-3 top-1.5 h-px bg-border" style={{ width: "calc(100% + 0.5rem)" }} />}
                  <div className="pt-8">
                    <span className="font-display text-2xl font-medium text-accent block mb-3">{item.year}</span>
                    <p className="font-sans text-xs text-muted-foreground leading-relaxed font-light">{item.event}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="py-24 max-w-screen-xl mx-auto px-6 lg:px-10">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6 mb-10">
          <div><SectionLabel>Permanent Collection</SectionLabel><h2 className="font-display text-3xl md:text-4xl font-medium">Explore by Category</h2></div>
          <div className="flex gap-1 flex-wrap">
            {filters.map((f) => (
              <button key={f} onClick={() => setActiveFilter(f)} className={`font-mono text-[0.52rem] tracking-widest uppercase px-3.5 py-2 border transition-colors ${activeFilter === f ? "border-accent bg-accent text-accent-foreground" : "border-border text-muted-foreground hover:border-foreground hover:text-foreground"}`}>{f}</button>
            ))}
          </div>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {collections.map((col, i) => (
            <motion.div key={col.name} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5, delay: i * 0.07 }} className="group cursor-pointer">
              <div className="aspect-[4/3] overflow-hidden bg-muted mb-3">
                <img src={uimg(col.id, 600, 450)} alt={col.alt} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" />
              </div>
              <div className="flex items-center justify-between">
                <h3 className="font-display text-base font-medium group-hover:text-accent transition-colors">{col.name}</h3>
                <span className="font-mono text-[0.5rem] tracking-wider text-muted-foreground">{col.count.toLocaleString()} works</span>
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Floor Map */}
      <section className="max-w-screen-xl mx-auto px-6 lg:px-10 pb-24">
        <SectionLabel>Navigation</SectionLabel>
        <h2 className="font-display text-3xl font-medium mb-8">Interactive Floor Map</h2>
        <div className="border border-border bg-secondary">
          <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-border">
            {[
              { floor: "Ground Floor", rooms: ["Entrance Hall", "Gandharan Gallery", "Gift Shop", "Café & Reading Room"] },
              { floor: "First Floor", rooms: ["Buddhist Paintings", "Manuscripts & Textiles", "Numismatics", "Education Centre"] },
              { floor: "Second Floor", rooms: ["Contemporary Wing", "Special Exhibitions", "Research Library", "Rooftop Terrace"] },
            ].map((fl) => (
              <div key={fl.floor} className="p-7">
                <div className="font-mono text-[0.52rem] tracking-widest uppercase text-accent mb-4">{fl.floor}</div>
                {fl.rooms.map((room) => (
                  <div key={room} className="flex items-center gap-2.5 py-2 border-b border-border/40 last:border-0">
                    <div className="w-1.5 h-1.5 rounded-full bg-accent/50 shrink-0" />
                    <span className="font-sans text-xs text-muted-foreground font-light">{room}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-foreground text-primary-foreground py-20">
        <div className="max-w-screen-xl mx-auto px-6 lg:px-10 flex flex-col md:flex-row items-center justify-between gap-10">
          <div>
            <SectionLabel light>Digital Experience</SectionLabel>
            <h2 className="font-display text-3xl md:text-4xl font-medium mb-3">Take a Virtual Tour</h2>
            <p className="font-sans text-sm text-primary-foreground/48 max-w-lg font-light leading-relaxed">Explore all 18 galleries from anywhere in the world. Immersive 360° experience available in 8 languages.</p>
          </div>
          <button className="shrink-0 flex items-center gap-3 bg-accent text-accent-foreground px-8 py-4 text-[0.6rem] tracking-[0.2em] uppercase font-sans hover:opacity-90 transition-opacity">
            <Play size={15} /> Begin Virtual Tour
          </button>
        </div>
      </section>
    </div>
  );
}
