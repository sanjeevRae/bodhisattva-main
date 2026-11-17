import { motion } from "motion/react";
import { BookOpen, Award, Users, Leaf, Star } from "lucide-react";
import { uimg, SectionLabel } from "../components/shared";

export default function FoundationPage() {
  return (
    <div>
      <section className="relative h-[56vh] min-h-[400px] flex items-end overflow-hidden mt-16">
        <img src={uimg("photo-1756694915450-50c9796fb96d", 1920, 900)} alt="Children painting together in community art program" className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0F0D0A]/75 via-[#0F0D0A]/20 to-transparent" />
        <div className="relative z-10 max-w-screen-xl mx-auto px-6 lg:px-10 pb-16 w-full">
          <p className="font-mono text-[0.52rem] tracking-[0.28em] uppercase text-white/38 mb-3">Social Responsibility</p>
          <h1 className="font-display text-5xl md:text-6xl font-medium text-white">The Foundation</h1>
        </div>
      </section>

      <section className="border-y border-border bg-secondary/60">
        <div className="max-w-screen-xl mx-auto px-6 lg:px-10 py-16">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-0 md:divide-x divide-border">
            {[["14", "Active Programs"], ["1,000+", "Students Reached"], ["RS.10L", "Artist Grants Disbursed"], ["38", "Partner Organizations"]].map(([v, l]) => (
              <motion.div key={l} initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6 }} className="text-center md:px-8">
                <div className="font-display text-4xl md:text-5xl font-medium text-accent mb-2">{v}</div>
                <div className="font-mono text-[0.52rem] tracking-widest uppercase text-muted-foreground">{l}</div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-24 max-w-screen-xl mx-auto px-6 lg:px-10">
        <div className="grid lg:grid-cols-2 gap-20 items-center">
          <div>
            <SectionLabel>Our Mission</SectionLabel>
            <h2 className="font-display text-4xl md:text-5xl font-medium leading-[1.08] mb-8">
              Art as an Act<br /><em className="font-sans italic font-light text-accent">of Responsibility</em>
            </h2>
            <p className="font-sans text-sm text-muted-foreground leading-relaxed mb-5 font-light">
              The Bodhisattva Foundation was established in 2012 as the museum&apos;s social responsibility arm. We believe that cultural institutions carry an obligation not only to preserve the past, but to actively shape a more equitable cultural future.
            </p>
            <p className="font-sans text-sm text-muted-foreground leading-relaxed font-light">
              Our work spans four interconnected domains: education, artist support, community access, and cultural preservation — each reflecting the Bodhisattva ideal of compassionate action in the world.
            </p>
          </div>
          <div className="aspect-[4/3] overflow-hidden bg-muted">
            <img src={uimg("photo-1708795921259-263a5e973acb", 800, 600)} alt="Child painting in art education program" className="w-full h-full object-cover" />
          </div>
        </div>
      </section>

      <section className="bg-secondary py-24 border-y border-border">
        <div className="max-w-screen-xl mx-auto px-6 lg:px-10">
          <SectionLabel>Our Work</SectionLabel>
          <h2 className="font-display text-3xl md:text-4xl font-medium mb-14">Programs & Initiatives</h2>
          <div className="grid md:grid-cols-2 gap-0 border border-border">
            {[
              { name: "ArtReach Schools", cat: "Education", desc: "Bringing art history and studio practice to 200+ government schools across Humla, Dolpa and Manang. We train teachers, supply materials, and run monthly artist residencies.", impact: "6,200 students per year", Icon: BookOpen },
              { name: "Living Craft Fellowship", cat: "Artist Support", desc: "Annual grants of Rs.1-4 lakhs to master craftspeople working in endangered traditional forms — Kalamkari, Bidri metalwork, and Thangka painting among them.", impact: "42 fellowships awarded", Icon: Award },
              { name: "Community Museum Visits", cat: "Access", desc: "Free-of-charge museum access, transportation, and guided tours for schools, NGOs, and community groups from underserved neighbourhoods across NCR.", impact: "18,000 visitors facilitated", Icon: Users },
              { name: "Cultural Preservation Archive", cat: "Heritage", desc: "Documentation and digitization of endangered folk art traditions. Our archive holds 40,000+ high-resolution records, freely accessible to researchers worldwide.", impact: "40,000+ records preserved", Icon: Leaf },
            ].map((p, i) => (
              <div key={p.name} className={`p-10 border-border ${i % 2 === 0 ? "border-r" : ""} ${i < 2 ? "border-b" : ""}`}>
                <div className="flex items-start gap-4 mb-6">
                  <div className="p-3 bg-accent/10 shrink-0"><p.Icon size={18} className="text-accent" /></div>
                  <div>
                    <span className="font-mono text-[0.5rem] tracking-widest uppercase text-accent block mb-1">{p.cat}</span>
                    <h3 className="font-display text-xl font-medium">{p.name}</h3>
                  </div>
                </div>
                <p className="font-sans text-sm text-muted-foreground leading-relaxed mb-5 font-light">{p.desc}</p>
                <div className="flex items-center gap-2">
                  <Star size={11} className="text-accent fill-accent" />
                  <span className="font-mono text-[0.52rem] tracking-wider text-accent uppercase">{p.impact}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-24 max-w-screen-xl mx-auto px-6 lg:px-10">
        <SectionLabel>Voices</SectionLabel>
        <h2 className="font-display text-3xl md:text-4xl font-medium mb-12">Impact in Their Own Words</h2>
        <div className="grid md:grid-cols-3 gap-6">
          {[
            { quote: "The fellowship gave me two years to focus solely on Bidri metalwork. My daughter is now learning alongside me — for the first time in four generations, we believe this will continue.", name: "Meena Gurung", role: "Living Craft Fellow, 2024", imgId: "photo-1592060036126-1b6d5139dea4" },
            { quote: "Before ArtReach, our school had no art teacher and no materials. Now we have a dedicated studio and six students who have applied to arts colleges.", name: "Sunita Lama", role: "Teacher, Govt. School, Varanasi", imgId: "photo-1708795921259-263a5e973acb" },
            { quote: "Bringing 80 students to the museum changed something. They saw themselves in the art — the faces, the stories. One girl said, 'This is my history too.'", name: "Arjun Singh", role: "NGO Coordinator, Asha Foundation", imgId: "photo-1756694915450-50c9796fb96d" },
          ].map((s) => (
            <div key={s.name} className="bg-secondary p-8 border border-border">
              <blockquote className="font-sans text-sm italic font-light leading-relaxed mb-6 text-foreground/80">&ldquo;{s.quote}&rdquo;</blockquote>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full overflow-hidden bg-muted shrink-0">
                  <img src={uimg(s.imgId, 80, 80)} alt={s.name} className="w-full h-full object-cover" />
                </div>
                <div>
                  <div className="font-sans text-xs font-medium">{s.name}</div>
                  <div className="font-mono text-[0.46rem] tracking-wider text-muted-foreground uppercase">{s.role}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-secondary py-14 border-t border-border">
        <div className="max-w-screen-xl mx-auto px-6 lg:px-10 text-center">
          <p className="font-mono text-[0.52rem] tracking-[0.25em] uppercase text-muted-foreground mb-8">Partner Organizations</p>
          <div className="flex flex-wrap justify-center gap-x-10 gap-y-3 items-center">
            {["British Museum", "Freer Gallery — Smithsonian", "Nalanda University", "IGNCA", "UNESCO Nepal", "Nepal Foundation for the Arts", "Aga Khan Trust for Culture", "Tata Trusts"].map((p) => (
              <span key={p} className="font-display text-sm font-medium text-muted-foreground hover:text-foreground transition-colors cursor-default">{p}</span>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
