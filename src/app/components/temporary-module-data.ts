/**
 * TODO Phase 5/6 module data — TEMPORARY record sets for the
 * module-reference sections (CMS_CONTENT_MAPPING.md §1.3).
 *
 * The CMS sections for collections, exhibitions, news, foundation
 * programs and testimonials carry CONFIGURATION ONLY in the database;
 * the records themselves belong to the museum/foundation/store modules
 * that land in Phases 5 and 6. Until those APIs exist, the renderers
 * below keep using these arrays — copied VERBATIM from the current page
 * components (src/app/pages/*.tsx) so the Phase 3 rendering switch is
 * visually identical. When the module APIs land, each export here is
 * replaced by a fetch and this file is deleted.
 */

// ---------------------------------------------------------------------------
// Collections module records (Phases 5) — Home "Featured Collections" (H3)
// TODO Phase 5/6 module data: replace with GET /api/collections?featured=1
// ---------------------------------------------------------------------------
export const TEMP_HOME_COLLECTIONS = [
  { title: "Gandharan Sculpture", period: "1st – 5th Century CE", count: "487 works", id: "photo-1775212253782-d223fe035ddc", alt: "Two ancient statues in contemplation" },
  { title: "Buddhist Manuscript Art", period: "8th – 16th Century", count: "1,240 manuscripts", id: "photo-1765127959724-631190c32e8a", alt: "Ancient manuscript display case" },
  { title: "Contemporary Dialogues", period: "1960 – Present", count: "890 works", id: "photo-1605429523419-d828acb941d9", alt: "Contemporary paintings on gallery wall" },
];

// ---------------------------------------------------------------------------
// Collections module records (Phase 5) — Museum "Explore by Category" (M4)
// TODO Phase 5/6 module data: replace with GET /api/collections
// The current records carry no category, which is why the filter buttons
// below do not filter today (Audit D1) — the taxonomy arrives with the
// module. The label list is the current hardcoded chrome, kept as-is.
// ---------------------------------------------------------------------------
export const TEMP_MUSEUM_COLLECTIONS = [
  { name: "Gandharan Sculpture", count: 487, id: "photo-1775212253782-d223fe035ddc", alt: "Ancient statues in contemplation" },
  { name: "Buddhist Paintings", count: 1240, id: "photo-1605429523419-d828acb941d9", alt: "Gallery wall with paintings" },
  { name: "Palm Leaf Manuscripts", count: 890, id: "photo-1765127959724-631190c32e8a", alt: "Ancient manuscript display" },
  { name: "Numismatic Collection", count: 3200, id: "photo-1768481498978-25ac2b210b35", alt: "Museum visitors at exhibit" },
  { name: "Decorative Textiles", count: 560, id: "photo-1772617616268-a2f27d194fce", alt: "Gallery sculptures and displays" },
  { name: "Contemporary Works", count: 724, id: "photo-1569783721854-33a99b4c0bae", alt: "Contemporary gallery visitors" },
];

export const TEMP_MUSEUM_COLLECTION_FILTERS = ["All", "Sculpture", "Painting", "Manuscripts", "Coins", "Textiles", "Contemporary"];

// ---------------------------------------------------------------------------
// Exhibitions module records (Phase 5) — Home "Current Exhibitions" (H4),
// layout featured-split: one featured record + a list of three.
// TODO Phase 5/6 module data: replace with GET /api/exhibitions?current=1
// ---------------------------------------------------------------------------
export const TEMP_HOME_FEATURED_EXHIBITION = {
  imgId: "photo-1569783721854-33a99b4c0bae",
  alt: "Visitors observing paintings in gallery",
  loc: "Main Hall · Until Nov 2026",
  title: "Echoes of Enlightenment",
};

export const TEMP_HOME_EXHIBITIONS = [
  { loc: "East Wing · Until Sep 2026", title: "The Silk Road Chronicles", desc: "Tracing Buddhist iconography along ancient trade routes from Gandhara to Tang Dynasty China." },
  { loc: "North Gallery · Until Oct 2026", title: "Feminine Divine", desc: "Goddess iconography across Buddhist, Jain, and Hindu artistic traditions." },
  { loc: "Terrace Gallery · Until Dec 2026", title: "Living Crafts of Nepal", desc: "Contemporary craftspeople working within inherited regional traditions, photographed in their workshops." },
];

// ---------------------------------------------------------------------------
// Exhibitions module records (Phase 5) — Gallery archive (G3), masonry.
// TODO Phase 5/6 module data: replace with GET /api/exhibitions
// ---------------------------------------------------------------------------
export const TEMP_GALLERY_EXHIBITIONS = [
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

// ---------------------------------------------------------------------------
// News module records (Phase 5) — Home "Latest News" (H7), cards layout.
// Note: these are the HOME page's copies, which differ slightly from the
// News page's records for two titles (mapping §H7) — kept verbatim.
// TODO Phase 5/6 module data: replace with GET /api/news?latest=3
// ---------------------------------------------------------------------------
export const TEMP_HOME_NEWS = [
  { outlet: "The Hindu", date: "12 Aug 2026", title: "Bodhisattva Museum Acquires Rare 3rd Century Mathura Sculpture", type: "News" },
  { outlet: "Art Nepal Magazine", date: "05 Aug 2026", title: "Siddhartha Man Shakya on the Future of Buddhist Art Scholarship in Nepal", type: "Interview" },
  { outlet: "Times of Nepal", date: "28 Jul 2026", title: "'Echoes of Enlightenment' Draws Record 40,000 Visitors in First Month", type: "Press Release" },
];

// ---------------------------------------------------------------------------
// News module records (Phase 5) — News page listing (N2), rows layout.
// TODO Phase 5/6 module data: replace with GET /api/news
// ---------------------------------------------------------------------------
export const TEMP_NEWS_ARTICLES = [
  { id: 1, outlet: "The Hindu", date: "12 Aug 2026", title: "Bodhisattva Museum Acquires Rare 3rd Century Mathura Sculpture", type: "News", summary: "The museum announced the acquisition of a polished red sandstone Buddha figure from the estate of late collector Shri P.N. Lal — considered one of the finest Mathura school pieces in private hands." },
  { id: 2, outlet: "Art Nepal Magazine", date: "05 Aug 2026", title: "Siddhartha Man Shakya on the Future of Buddhist Art Scholarship", type: "Interview", summary: "In conversation with our editor, the chief curator discusses how digital technology is democratizing access to ancient art, and why the next decade will be a golden age for South Asian museum scholarship." },
  { id: 3, outlet: "Times of Nepal", date: "28 Jul 2026", title: "'Echoes of Enlightenment' Draws Record 40,000 Visitors in Opening Month", type: "Press Release", summary: "The museum's flagship 2026 exhibition has exceeded attendance projections, prompting an extension through November. Weekend slots are fully booked through September." },
  { id: 4, outlet: "The Wire", date: "14 Jul 2026", title: "Can Museums Keep Buddhist Art Sacred? A National Debate", type: "Feature", summary: "A longform examination of the ethics of displaying sacred objects, drawing on commentary from Bodhisattva Museum's curatorial team and scholars across Nepal and Sri Lanka." },
  { id: 5, outlet: "Mint Lounge", date: "02 Jun 2026", title: "Inside the Museum That Believes Art Should Be Free", type: "Feature", summary: "How the Bodhisattva Foundation's free-entry Sunday policy has transformed who visits Nepal's art institutions — and what other museums could learn." },
  { id: 6, outlet: "Hindustan Times", date: "20 May 2026", title: "Bodhisattva Museum Signs MOU with Nalanda University", type: "News", summary: "A landmark research partnership enabling co-curated exhibitions and joint publication of scholarly catalogs on early Buddhist art history." },
  { id: 7, outlet: "Outlook", date: "11 Apr 2026", title: "Review: The Silk Road Chronicles — Four Stars", type: "Review", summary: "\"A rare exhibition that succeeds in making scholarship viscerally felt. The material culture of faith, compressed across three millennia and two continents, emerges startlingly coherent.\"" },
  { id: 8, outlet: "NDTV", date: "15 Mar 2026", title: "Museum Launches Free Digital Archive of 5,000 Artifacts", type: "Press Release", summary: "All artifact photography and curatorial notes from the permanent collection are now freely available at the museum's new open-access digital library, supporting researchers worldwide." },
];

// The article-type colour map is presentation code (mapping §N2: it moves
// to `news_categories.colorToken` with the module) — kept here verbatim
// until then.
export const TEMP_NEWS_TYPE_COLOR: Record<string, string> = {
  "News": "text-amber-700 dark:text-amber-400",
  "Interview": "text-emerald-700 dark:text-emerald-400",
  "Feature": "text-blue-700 dark:text-blue-400",
  "Press Release": "text-purple-700 dark:text-purple-400",
  "Review": "text-rose-700 dark:text-rose-400",
};

// ---------------------------------------------------------------------------
// Foundation programs module records (Phase 5) — Foundation page (F4).
// `iconName` replaces the Lucide component reference held in the current
// data objects (mapping §F4); PageRenderer maps name → component.
// TODO Phase 5/6 module data: replace with GET /api/foundation/programs
// ---------------------------------------------------------------------------
export const TEMP_FOUNDATION_PROGRAMS = [
  { name: "ArtReach Schools", cat: "Education", desc: "Bringing art history and studio practice to 200+ government schools across Humla, Dolpa and Manang. We train teachers, supply materials, and run monthly artist residencies.", impact: "6,200 students per year", iconName: "BookOpen" },
  { name: "Living Craft Fellowship", cat: "Artist Support", desc: "Annual grants of Rs.1-4 lakhs to master craftspeople working in endangered traditional forms — Kalamkari, Bidri metalwork, and Thangka painting among them.", impact: "42 fellowships awarded", iconName: "Award" },
  { name: "Community Museum Visits", cat: "Access", desc: "Free-of-charge museum access, transportation, and guided tours for schools, NGOs, and community groups from underserved neighbourhoods across NCR.", impact: "18,000 visitors facilitated", iconName: "Users" },
  { name: "Cultural Preservation Archive", cat: "Heritage", desc: "Documentation and digitization of endangered folk art traditions. Our archive holds 40,000+ high-resolution records, freely accessible to researchers worldwide.", impact: "40,000+ records preserved", iconName: "Leaf" },
];

// ---------------------------------------------------------------------------
// Testimonials module records (Phase 5) — Foundation page grid (F5).
// TODO Phase 5/6 module data: replace with GET /api/testimonials?context=foundation
// ---------------------------------------------------------------------------
export const TEMP_FOUNDATION_TESTIMONIALS = [
  { quote: "The fellowship gave me two years to focus solely on Bidri metalwork. My daughter is now learning alongside me — for the first time in four generations, we believe this will continue.", name: "Meena Gurung", role: "Living Craft Fellow, 2024", imgId: "photo-1592060036126-1b6d5139dea4" },
  { quote: "Before ArtReach, our school had no art teacher and no materials. Now we have a dedicated studio and six students who have applied to arts colleges.", name: "Sunita Lama", role: "Teacher, Govt. School, Varanasi", imgId: "photo-1708795921259-263a5e973acb" },
  { quote: "Bringing 80 students to the museum changed something. They saw themselves in the art — the faces, the stories. One girl said, 'This is my history too.'", name: "Arjun Singh", role: "NGO Coordinator, Asha Foundation", imgId: "photo-1756694915450-50c9796fb96d" },
];
