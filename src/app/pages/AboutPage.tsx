import { motion } from "motion/react";
import { Sun, MapPin, Phone, Mail, Globe, Clock } from "lucide-react";
import { uimg, SectionLabel } from "../components/shared";

export default function AboutPage() {
  const team = [
    { name: "Siddhartha Man Shakya Sharma", role: "Co-Founder", dept: "Leadership" },
    { name: "Siddhartha Man Shakya", role: "Chief Curator", dept: "Curatorial" },
    { name: "Siddhartha Man Shakya", role: "Director of Operations", dept: "Management" },
    { name: "Siddhartha Man Shakya", role: "Head, Bodhisattva Foundation", dept: "CSR" },
    { name: "Siddhartha Man Shakya", role: "Senior Curator, Ancient Art", dept: "Curatorial" },
    { name: "Siddhartha Man Shakya", role: "Curator, Manuscripts & Textiles", dept: "Curatorial" },
    { name: "Siddhartha Man Shakya", role: "Head of Education", dept: "Programs" },
    { name: "Siddhartha Man Shakya", role: "Digital Experience Lead", dept: "Technology" },
  ];

  return (
    <div className="pt-16">
      <div className="bg-secondary border-b border-border py-20">
        <div className="max-w-screen-xl mx-auto px-6 lg:px-10">
          <p className="font-mono text-[0.52rem] tracking-[0.28em] uppercase text-muted-foreground mb-3">Who We Are</p>
          <h1 className="font-display text-5xl md:text-6xl font-medium">About Us</h1>
        </div>
      </div>

      <section className="py-24 max-w-screen-xl mx-auto px-6 lg:px-10">
        <div className="grid lg:grid-cols-2 gap-20 items-start">
          <div>
            <SectionLabel>History</SectionLabel>
            <h2 className="font-display text-3xl md:text-4xl font-medium mb-8 leading-[1.1]">
              Founded in Conviction.<br /><em className="font-sans italic font-light text-accent">Grown in Purpose.</em>
            </h2>
            <div className="space-y-5">
              <p className="font-sans text-sm text-muted-foreground leading-relaxed font-light">Bodhisattva Museum & Art Gallery was founded in 2000 by Siddhartha Man Shakya, a collector, scholar, and educator who believed Nepal&apos;s Buddhist artistic heritage was being underserved by existing cultural institutions. What began with 200 carefully selected objects in a converted haveli in Civil Lines, Lalitpur, has grown into one of Asia&apos;s foremost institutions of its kind.</p>
              <p className="font-sans text-sm text-muted-foreground leading-relaxed font-light">Over nearly three decades, the museum has built deep partnerships with institutions across South and Southeast Asia, Japan, the UK, and the United States — establishing scholarly exchange programs, jointly curated exhibitions, and shared digitization initiatives that have set new standards for the field.</p>
              <p className="font-sans text-sm text-muted-foreground leading-relaxed font-light">In 2012, the Bodhisattva Foundation was established as the museum&apos;s social responsibility arm, extending its mandate from collecting to community-building.</p>
            </div>
          </div>
          <div className="space-y-5">
            <div className="aspect-video overflow-hidden bg-muted">
              <img src={uimg("photo-1765470129726-3689336ff549", 800, 450)} alt="Grand museum interior" className="w-full h-full object-cover" />
            </div>
            <div className="bg-foreground text-primary-foreground p-8">
              <p className="font-sans text-base italic font-light leading-relaxed mb-4">&ldquo;The Bodhisattva is the figure who postpones their own liberation to remain in the world, to serve. Our museum aspires to that same ethic.&rdquo;</p>
              <span className="font-mono text-[0.5rem] tracking-widest uppercase text-accent">Siddhartha Man Shakya &nbsp;·&nbsp; Co-Founder</span>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-secondary border-y border-border">
        <div className="max-w-screen-xl mx-auto px-6 lg:px-10">
          <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border">
            <div className="py-14 md:pr-14">
              <span className="font-mono text-[0.52rem] tracking-[0.22em] uppercase text-accent block mb-6">Our Vision</span>
              <p className="font-display text-2xl md:text-3xl font-medium leading-[1.25]">A world where art from every civilization is preserved, understood, and felt as a living inheritance by all people.</p>
            </div>
            <div className="py-14 md:pl-14">
              <span className="font-mono text-[0.52rem] tracking-[0.22em] uppercase text-accent block mb-6">Our Mission</span>
              <p className="font-sans text-sm text-muted-foreground leading-relaxed font-light">To collect, preserve, and interpret the artistic heritage of South Asian Buddhist and cultural traditions; to present that heritage through world-class exhibitions and scholarship; and to make art accessible to all communities through education, outreach, and open digital access.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="py-24 max-w-screen-xl mx-auto px-6 lg:px-10">
        <SectionLabel>Leadership</SectionLabel>
        <h2 className="font-display text-3xl md:text-4xl font-medium mb-14">The Team</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8">
          {team.map((member, i) => (
            <motion.div key={member.name} initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5, delay: i * 0.07 }}>
              <div className="aspect-square bg-secondary border border-border mb-4 relative overflow-hidden">
                <div className="absolute inset-0 flex items-end p-5">
                  <span className="font-display text-5xl font-medium text-muted/60 leading-none">{member.name.split(" ").map((w) => w[0]).join("").slice(0, 2)}</span>
                </div>
              </div>
              <span className="font-mono text-[0.48rem] tracking-widest uppercase text-accent block mb-1">{member.dept}</span>
              <h3 className="font-display text-sm font-medium mb-1">{member.name}</h3>
              <p className="font-sans text-xs text-muted-foreground font-light">{member.role}</p>
            </motion.div>
          ))}
        </div>
      </section>

      <section className="bg-foreground text-primary-foreground py-24">
        <div className="max-w-screen-xl mx-auto px-6 lg:px-10">
          <div className="grid md:grid-cols-2 gap-20 items-start">
            <div>
              <SectionLabel light>Visit & Contact</SectionLabel>
              <h2 className="font-display text-3xl md:text-4xl font-medium mb-10">Get in Touch</h2>
              <div className="space-y-7">
                {[
                  { Icon: MapPin, label: "Address", value: "Kupondole, Lalitpur, Nepal" },
                  { Icon: Clock, label: "Hours", value: "Sun – Fri: 10:00 AM – 5:00 PM\nMonday: Closed" },
                  { Icon: Phone, label: "Phone", value: "+977-9818882876" },
                  { Icon: Mail, label: "Email", value: "info@bodhisattvainternational.com" },
                  { Icon: Globe, label: "Web", value: "www.bodhisattvainternational.com" },
                ].map(({ Icon, label, value }) => (
                  <div key={label} className="flex items-start gap-4">
                    <Icon size={15} className="text-accent mt-0.5 shrink-0" />
                    <div>
                      <span className="font-mono text-[0.48rem] tracking-widest uppercase text-primary-foreground/33 block mb-0.5">{label}</span>
                      <span className="font-sans text-sm text-primary-foreground/65 font-light whitespace-pre-line">{value}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h3 className="font-display text-2xl font-medium mb-7">Send a Message</h3>
              <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
                <div className="grid grid-cols-2 gap-4">
                  <input type="text" placeholder="First Name" className="bg-primary-foreground/8 border border-primary-foreground/15 px-4 py-3.5 text-sm font-sans focus:outline-none focus:border-accent text-primary-foreground placeholder:text-primary-foreground/25" />
                  <input type="text" placeholder="Last Name" className="bg-primary-foreground/8 border border-primary-foreground/15 px-4 py-3.5 text-sm font-sans focus:outline-none focus:border-accent text-primary-foreground placeholder:text-primary-foreground/25" />
                </div>
                <input type="email" placeholder="Email Address" className="w-full bg-primary-foreground/8 border border-primary-foreground/15 px-4 py-3.5 text-sm font-sans focus:outline-none focus:border-accent text-primary-foreground placeholder:text-primary-foreground/25" />
                <select className="w-full bg-primary-foreground/8 border border-primary-foreground/15 px-4 py-3.5 text-sm font-sans focus:outline-none focus:border-accent text-primary-foreground/65 appearance-none">
                  <option value="">Subject — Select one</option>
                  <option>General Enquiry</option>
                  <option>Exhibition Information</option>
                  <option>Foundation / CSR</option>
                  <option>Press & Media</option>
                  <option>Membership</option>
                  <option>Research & Loans</option>
                </select>
                <textarea rows={4} placeholder="Your message…" className="w-full bg-primary-foreground/8 border border-primary-foreground/15 px-4 py-3.5 text-sm font-sans focus:outline-none focus:border-accent text-primary-foreground placeholder:text-primary-foreground/25 resize-none" />
                <button type="submit" className="w-full bg-accent text-accent-foreground py-4 text-[0.58rem] tracking-[0.22em] uppercase font-sans hover:opacity-90 transition-opacity">Send Message</button>
              </form>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
