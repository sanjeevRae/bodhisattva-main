/**
 * Museum-module seed data — Phase 5 (CMS_CONTENT_MAPPING.md §3–§8, §10).
 *
 * The canonical record sets for the museum/foundation modules:
 * `collections`, `exhibitions`, `news_categories`, `news_articles`,
 * `foundation_programs` and `testimonials`. Originally transcribed from
 * the design-stage page components; on 2026-11-19 the collections,
 * exhibitions, news articles and foundation programs were REPLACED with
 * Bodhisattva International's real content (owner-supplied booklet,
 * documents, exhibition lists and press-clipping archive — migration
 * 0013_real_content carries the same replacement for existing databases).
 * News categories and testimonials still hold the design-stage values;
 * the testimonials are placeholder quotes awaiting the owner's real ones.
 *
 * Dedupe rule (§1.3, §10): ONE canonical set per module. Home renders
 * subsets of these sets (featured collections, current exhibitions,
 * latest news, the curator testimonial) — it never holds copies. Where
 * Home's inline data disagrees with the canonical set's page (different
 * titles, counts or descriptions for the same record), the fuller page's
 * version wins and the disagreement is flagged inline.
 *
 * Conventions:
 *  - `sortOrder` is 0-based, in the on-site order of the canonical page
 *    (Museum for collections, Gallery for exhibitions, News for articles,
 *    Foundation for programs and testimonials).
 *  - `slug` values are kebab-case, generated from the record name/title.
 *  - Images are `{ url, alt }` objects holding the current Unsplash URLs,
 *    built with the exact dimensions the canonical component requests via
 *    `uimg(id, w, h)` (media migration is a later decision, PROJECT_AUDIT
 *    BD-2 — same precedent as `cms-content.ts`).
 *  - Exhibition/news display dates have been split/converted into ISO
 *    dates (Audit D19); the original exhibition display string is kept
 *    in `dateLabel` for exact rendering.
 *
 * ------------------------------------------------------------------------
 * COUNT CHECK — records exported here vs CMS_CONTENT_MAPPING.md §10
 * ------------------------------------------------------------------------
 *  collections          4   (real content, 2026-11-19 — see §REAL)     ✓
 *  exhibitions          21  (real content, 2026-11-19 — see §REAL)     ✓
 *  news_categories      5   (§10 step 5: "news_categories (5)")        ✓
 *  news_articles        20  (real content, 2026-11-19 — see §REAL)     ✓
 *  foundation_programs  3   (real content, 2026-11-19 — see §REAL)     ✓
 *  testimonials         4   (§10 step 6: "3 foundation + 1 curator")   ✓
 * Out of scope for this file: foundation statistics (4) are statistics
 * *section* content, seeded with the pages in `cms-content.ts`;
 * `product_categories` (5) + `products` (12) are Phase 6 (§10 step 7).
 * ------------------------------------------------------------------------
 */

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

/** An image reference: current Unsplash URL + alt text (see header note). */
export interface MuseumImage {
  url: string;
  alt: string;
}

// ---------------------------------------------------------------------------
// REAL CONTENT (2026-11-19, migration 0013): the record sets below were
// replaced with Bodhisattva International's real content, supplied by the
// owner — the institutional booklet "A Glimpse of Bodhisattva
// International" (Oct 2026), the About / What-is-Newa-Art documents, the
// owner's exhibition lists and press-clipping archive, cross-checked
// against published sources. Images are the institution's own exhibition
// posters and clipping scans, served from the frontend's public/images/.
// The fictional design-stage records previously here were removed.
// ---------------------------------------------------------------------------

export interface CollectionSeed {
  slug: string;
  name: string;
  /** Period line shown on Home cards; null where no source states one. */
  periodLabel: string | null;
  /** Display count string; "" where no count is published (seeds null). */
  worksCountLabel: string;
  category: "Sculpture" | "Painting" | "Manuscripts" | "Coins" | "Textiles" | "Contemporary" | "Miniatures";
  description: string;
  image: MuseumImage;
  isFeatured: boolean;
  sortOrder: number;
}

export const COLLECTIONS: CollectionSeed[] = [
  {
    slug: "paubha-paintings",
    name: "Paubha Paintings",
    periodLabel: null,
    worksCountLabel: "",
    category: "Painting",
    description: "Paubha — derived from the Sanskrit pata, cloth painting — is the Kathmandu Valley's sacred painting tradition: large vertical-format paintings of deities, mandalas and narratives, executed to the iconometric grids and proportions laid down in treatises such as the Vishnudharmottara Purana. The earliest dated paubha, the Vasudhara Mandala, was painted in 1365 AD. The collection holds contemporary traditional paubha by the valley's master painters, commissioned and collected by Anjana and Purna Man Shakya over four decades.",
    image: { url: "/images/collections/paubha-paintings.jpg", alt: "Paubha painting of a blue wrathful deity" },
    isFeatured: true,
    sortOrder: 0,
  },
  {
    slug: "lost-wax-bronze-sculpture",
    name: "Lost-Wax Bronze Sculpture",
    periodLabel: null,
    worksCountLabel: "",
    category: "Sculpture",
    description: "Statues cast by the lost-wax process — a technique Newar metalworkers have practised for centuries and carried to Tibet, China and Bhutan. The collection spans monumental bronzes, including the Ucchushma Jambhala whose wax model alone took four years (3,360 hours) to complete, and the work of master statue makers such as Babu Kaji Bajracharya, whose wax models are cast by fellow masters in bronze, copper and silver.",
    image: { url: "/images/collections/lost-wax-bronze-sculpture.jpg", alt: "Golden Jambhala bronze statue at Purna Museum of Newa Art" },
    isFeatured: true,
    sortOrder: 1,
  },
  {
    slug: "repousse",
    name: "Repoussé",
    periodLabel: null,
    worksCountLabel: "",
    category: "Sculpture",
    description: "Gold and silver repoussé — metal hammered into relief from behind — is among the most demanding of Newa crafts, and a specialisation of the gallery since the 1980s. The collection's repoussé works range from ritual plaques to miniature panels on precious metal, including the silver repoussé created for Ucchushma Jambhala's Dhuku.",
    image: { url: "/images/collections/repousse.jpg", alt: "Golden repoussé plaque of a multi-armed goddess" },
    isFeatured: true,
    sortOrder: 2,
  },
  {
    slug: "miniature-art-on-precious-stones",
    name: "Miniature Art on Precious & Semi-Precious Stones",
    periodLabel: null,
    worksCountLabel: "",
    category: "Miniatures",
    description: "Miniature paintings and carvings on precious and semi-precious stones — turquoise, coral and black stone among them — some as small as 0.25 cm. The museum's Small Wonders Great Devotion exhibition brought together 117 such miniature works: paubha paintings, bronze and copper statues, gold and silver repoussé, and finely carved stone sculptures from the collection.",
    image: { url: "/images/collections/miniature-art.jpg", alt: "Miniature paintings and statues — Small Wonders Great Devotion" },
    isFeatured: false,
    sortOrder: 3,
  },
];
// ---------------------------------------------------------------------------
// REAL CONTENT (2026-11-19, migration 0013): the record sets below were
// replaced with Bodhisattva International's real content, supplied by the
// owner — the institutional booklet "A Glimpse of Bodhisattva
// International" (Oct 2026), the About / What-is-Newa-Art documents, the
// owner's exhibition lists and press-clipping archive, cross-checked
// against published sources. Images are the institution's own exhibition
// posters and clipping scans, served from the frontend's public/images/.
// The fictional design-stage records previously here were removed.
// ---------------------------------------------------------------------------

export interface ExhibitionSeed {
  slug: string;
  title: string;
  locationLabel: string | null;
  /** ISO date (yyyy-mm-dd). */
  startsOn: string;
  /** ISO date (yyyy-mm-dd). */
  endsOn: string;
  /** Display string (the API derives its own label from the dates). */
  dateLabel: string;
  description: string;
  curator: string | null;
  category: string;
  status: "current" | "past";
  isFeatured: boolean;
  coverAspect: "tall" | "standard";
  image: MuseumImage;
  sortOrder: number;
}

export const EXHIBITIONS: ExhibitionSeed[] = [
  {
    slug: "ten-years-of-celebrating-embodied-enlightenment",
    title: "10 Years of Celebrating Embodied Enlightenment",
    locationLabel: "Purna Museum of Newa Art & Bodhisattva Gallery, Kupondole",
    startsOn: "2026-11-16",
    endsOn: "2026-12-27",
    dateLabel: "16 Nov – 27 Dec 2026",
    description: "A retrospective exhibition of Samundra Man Singh Shrestha by Bodhisattva International. For the first time in the history of Nepali art, an exhibition is re-celebrated a decade later: Embodied Enlightenment returns, bringing audiences back to the original 2016 retrospective while revealing how its artist has evolved over the past ten years. Works from the private collection of Anjana and the late Purna Man Shakya, originally presented in the landmark exhibition, are shown alongside new and previously unseen works by the artist. Inaugurated by former Crown Princess Himani Shah; open daily 12 PM – 7 PM, entry Rs. 200 in support of the Prime Minister's Disaster Relief Fund.",
    curator: "Prajwol Man Shakya",
    category: "buddhist",
    status: "current",
    isFeatured: true,
    coverAspect: "tall",
    image: { url: "/images/exhibitions/ten-years-of-celebrating-embodied-enlightenment.jpg", alt: "10 Years of Celebrating Embodied Enlightenment — retrospective poster with the blue wrathful deity painting" },
    sortOrder: 0,
  },
  {
    slug: "a-collectors-collection",
    title: "A Collector's Collection",
    locationLabel: "Purna Museum of Newa Art, Kupondole, Lalitpur",
    startsOn: "2023-09-02",
    endsOn: "2024-02-02",
    dateLabel: "Sep 2023 – Feb 2024",
    description: "The exhibition that officially opened the Purna Museum of Newa Art, inaugurated by Minister of Education, Science and Technology Ashok Rai, UNESCO Representative to Nepal Michael Croft, and Co-Founder Anjana Shakya. Featuring the permanent collection of Anjana and the late Purna Man Shakya, it traced the evolution from traditional souvenir-oriented works to technically refined, museum-quality masterpieces — a glimpse into Purna Man Shakya's lasting role in shaping the renaissance of contemporary Newa art.",
    curator: "Prajwol Man Shakya",
    category: "contemporary",
    status: "past",
    isFeatured: false,
    coverAspect: "standard",
    image: { url: "/images/exhibitions/a-collectors-collection.jpg", alt: "A Collector's Collection poster — a visitor studying a paubha with a magnifying lens" },
    sortOrder: 1,
  },
  {
    slug: "small-wonders-great-devotion",
    title: "Small Wonders Great Devotion: Sacred Treasures of the Kathmandu Valley",
    locationLabel: "Purna Museum of Newa Art, Kupondole, Lalitpur",
    startsOn: "2025-02-28",
    endsOn: "2025-11-30",
    dateLabel: "28 Feb – 30 Nov 2025",
    description: "A miniature art exhibition bringing together 117 miniature artworks, each under 9 inches and some as small as 0.25 cm — paubha paintings, bronze and copper statues, gold and silver repoussé, and finely carved turquoise, coral and black stone sculptures, sourced primarily from the private archives of Anjana and the late Purna Man Shakya. These microscopic masterpieces show how immense spiritual depth and technical mastery can exist within the smallest forms.",
    curator: "Prajwol Man Shakya",
    category: "thematic",
    status: "past",
    isFeatured: false,
    coverAspect: "tall",
    image: { url: "/images/exhibitions/small-wonders-great-devotion.jpg", alt: "Small Wonders Great Devotion poster — collage of miniature paintings and statues" },
    sortOrder: 2,
  },
  {
    slug: "whispers-of-the-divine",
    title: "Whispers of the Divine",
    locationLabel: "Purna Museum of Newa Art, Kupondole, Lalitpur",
    startsOn: "2025-05-04",
    endsOn: "2025-11-30",
    dateLabel: "4 May – 30 Nov 2025",
    description: "A landmark three-phase exhibition presenting the work of master painter Udaya Charan Shrestha, a leading figure in contemporary Newar paubha art, inaugurated by Véronique Lorenzo, Ambassador of the European Union to Nepal. Fourteen years in the making, the collection began in 2010 through a long-term relationship between the artist and the Shakya family; every work was commissioned directly from Shrestha, except one painting acquired through a reseller. Rare and previously unseen hyper-realistic paubha paintings, many exhibited publicly for the first time.",
    curator: "Prajwol Man Shakya",
    category: "buddhist",
    status: "past",
    isFeatured: false,
    coverAspect: "tall",
    image: { url: "/images/exhibitions/whispers-of-the-divine.jpg", alt: "Whispers of the Divine poster — pencil drawing of a goddess holding a sword" },
    sortOrder: 3,
  },
  {
    slug: "ucchushma-jambhalas-dhuku",
    title: "Ucchushma Jambhala's Dhuku",
    locationLabel: "Purna Museum of Newa Art, Kupondole, Lalitpur",
    startsOn: "2024-05-19",
    endsOn: "2025-01-19",
    dateLabel: "May 2024 – Jan 2025",
    description: "Ucchushma Jambhala's Dhuku — the Room of Ucchushma Jambhala, or Black Jambhala — was the final exhibition envisioned by the late Purna Man Shakya. Inspired by Udaya Charan Shrestha's original painting, he commissioned a ten-year project encompassing a monumental lost-wax bronze statue, miniature stone works, silver repoussé, and a larger full-colour rendition of the original painting. The bronze statue's wax model alone took four years (3,360 hours), followed by eight months of intensive carving by Aneel and Suman Shakya. Inaugurated by Deputy Mayor of Kathmandu Metropolitan City Sunita Dangol, the exhibition was completed and presented after Purna Man Shakya's passing.",
    curator: "Prajwol Man Shakya",
    category: "buddhist",
    status: "past",
    isFeatured: false,
    coverAspect: "tall",
    image: { url: "/images/exhibitions/ucchushma-jambhalas-dhuku.jpg", alt: "Ucchushma Jambhala's Dhuku poster — golden Jambhala statue beside the blue-black deity painting" },
    sortOrder: 4,
  },
  {
    slug: "the-art-of-babu-kaji-bajracharya",
    title: "The Art of Babu Kaji Bajracharya",
    locationLabel: "Bodhisattva Gallery, Kupondole, Lalitpur",
    startsOn: "2026-07-11",
    endsOn: "2026-07-31",
    dateLabel: "11 – 31 Jul 2026",
    description: "A first-of-its-kind solo exhibition dedicated to a traditional Newa statue maker, celebrating one of Nepal's senior living master wax-model makers at the age of 83. Spanning the 1990s to 2026, it brought together early works and final cast statues in bronze, copper and silver, all from the collections of Anjana Shakya, the late Purna Man Shakya and Bodhisattva Gallery. Inaugurated by Deputy Mayor of Lalitpur Manjali Shakya Bajracharya, with a special edition catalogue documenting his contribution to traditional Newa statue making.",
    curator: "Prajwol Man Shakya",
    category: "contemporary",
    status: "past",
    isFeatured: false,
    coverAspect: "tall",
    image: { url: "/images/exhibitions/the-art-of-babu-kaji-bajracharya.jpg", alt: "The Art of Babu Kaji Bajracharya poster — bronze statues of seated female figures" },
    sortOrder: 5,
  },
  {
    slug: "trinity-of-compassion",
    title: "Trinity of Compassion: Buddha | Tara | Avalokiteshvara",
    locationLabel: "Bodhisattva Gallery, Kupondole, Lalitpur",
    startsOn: "2025-08-02",
    endsOn: "2026-04-30",
    dateLabel: "Aug 2025 – Apr 2026",
    description: "The exhibition explored the profound relationship between three central figures of Mahayana and Vajrayana Buddhism: the Buddha as enlightened wisdom, Tara as active compassion, and Avalokiteshvara as boundless mercy. Rather than separate deities, they are presented as interconnected expressions of a single enlightened continuum — a unified vision of enlightenment that is active, relational and ever-present.",
    curator: "Prajwol Man Shakya",
    category: "buddhist",
    status: "past",
    isFeatured: false,
    coverAspect: "tall",
    image: { url: "/images/exhibitions/trinity-of-compassion.jpg", alt: "Trinity of Compassion poster — gilded Buddha statue in an ornate torana" },
    sortOrder: 6,
  },
  {
    slug: "sacred-forms",
    title: "Sacred Forms: Honouring Udaya Charan Shrestha's Artistic Legacy & Inspired Works",
    locationLabel: "Bodhisattva Gallery, Kupondole, Lalitpur",
    startsOn: "2025-05-04",
    endsOn: "2025-07-05",
    dateLabel: "4 May – 5 Jul 2025",
    description: "A landmark exhibition celebrating the artistic legacy of Udaya Charan Shrestha, one of the most influential modern masters of paubha art. Rather than presenting his work in isolation, it explored the artistic dialogue surrounding his practice — works by his brothers Mahesh Shrestha and Dinesh Charan Shrestha, his daughter Neeti Shrestha, collaborative works, and a special section of works inspired by his art. The result of more than 14 years of dedicated collecting. A parallel presentation, Whispers of the Divine, ran at the Purna Museum of Newa Art.",
    curator: "Prajwol Man Shakya",
    category: "buddhist",
    status: "past",
    isFeatured: false,
    coverAspect: "tall",
    image: { url: "/images/exhibitions/sacred-forms.jpg", alt: "Sacred Forms poster — vertical strips of colourful deity paintings" },
    sortOrder: 7,
  },
  {
    slug: "pancha-pranali",
    title: "Pancha Pranali",
    locationLabel: "Bodhisattva Gallery, Kupondole, Lalitpur",
    startsOn: "2024-12-21",
    endsOn: "2024-12-27",
    dateLabel: "21 – 27 Dec 2024",
    description: "Pancha Pranali was a pioneering cultural project by Miss Nepal World 2023 Srichchha Pradhan, created for the Miss World 'Beauty with a Purpose' initiative. It brought ancient Newa cosmology to a global stage, using the five elemental principles — earth, water, fire, air and space — as a framework for contemporary ecological awareness, with interactive workshops, guided sessions and talks alongside the exhibition.",
    curator: "Srichchha Pradhan, Prajwol Man Shakya",
    category: "thematic",
    status: "past",
    isFeatured: false,
    coverAspect: "standard",
    image: { url: "/images/exhibitions/pancha-pranali.jpg", alt: "Pancha Pranali poster — five element symbols among pink lotus flowers" },
    sortOrder: 8,
  },
  {
    slug: "shakti-divine-feminine-power",
    title: "Shakti: Divine Feminine Power of Hindu and Buddhist Deities",
    locationLabel: "Bodhisattva Gallery, Kupondole, Lalitpur",
    startsOn: "2024-09-14",
    endsOn: "2024-10-30",
    dateLabel: "14 Sep – 30 Oct 2024",
    description: "Exploring the divine feminine as the creative and transformative force of existence, rooted in Hindu and Buddhist philosophical traditions. Through powerful depictions of Kali, Durga, Vajrayogini and other manifestations, the exhibition revealed Shakti as a living cosmic force encompassing compassion, nurturing, destruction and renewal. A highlight was Search for Shakti, a fusion of Charya Nritya and Bharatanatyam honouring Arya Tara, Kaumari, Annapurna and Gujeshwori. Shown in two series: 14 September – 5 October and 8 – 30 October 2024.",
    curator: "Prajwol Man Shakya",
    category: "thematic",
    status: "past",
    isFeatured: false,
    coverAspect: "tall",
    image: { url: "/images/exhibitions/shakti-divine-feminine-power.jpg", alt: "Shakti poster — golden repoussé plaque of a multi-armed goddess" },
    sortOrder: 9,
  },
  {
    slug: "buddhist-connections-in-the-snowyland",
    title: "Buddhist Connections in the Snowyland: Nepalese Fine Art Exhibition",
    locationLabel: "Lan Gallery, Beijing, China",
    startsOn: "2024-08-29",
    endsOn: "2024-09-05",
    dateLabel: "29 Aug – 5 Sep 2024",
    description: "The first dedicated presentation of Newa art in China, hosted at Lan Gallery, Beijing, and organised by the Embassy of Nepal in China and the Silk Road Cities Alliance. Featuring 32 masterworks of sculpture and painting, it highlighted the shared Buddhist heritage connecting Nepal, Tibet and China through centuries of artistic and spiritual dialogue — a living act of cultural diplomacy.",
    curator: "Siddhartha Man Shakya",
    category: "buddhist",
    status: "past",
    isFeatured: false,
    coverAspect: "tall",
    image: { url: "/images/exhibitions/buddhist-connections-in-the-snowyland.jpg", alt: "Buddhist Connections in the Snowyland poster — framed paubha of a dancing deity" },
    sortOrder: 10,
  },
  {
    slug: "wealth-deities-guardians-of-prosperity",
    title: "Wealth Deities: Guardians of Prosperity",
    locationLabel: "Bodhisattva Gallery, Kupondole, Lalitpur",
    startsOn: "2024-05-19",
    endsOn: "2024-08-31",
    dateLabel: "19 May – 31 Aug 2024",
    description: "The exhibition explored the meaning of abundance within Newa spiritual traditions through deities such as Jambhala, Vasudhara, Lakshmi and Ganesh. Featuring selected paubha and statues, it highlighted wealth not as material gain alone, but as a path toward generosity, balance and spiritual growth — explaining symbolic elements such as Jambhala's jewel-spitting mongoose and Vasudhara's overflowing grain.",
    curator: "Prajwol Man Shakya",
    category: "buddhist",
    status: "past",
    isFeatured: false,
    coverAspect: "tall",
    image: { url: "/images/exhibitions/wealth-deities-guardians-of-prosperity.jpg", alt: "Wealth Deities poster — golden Jambhala statue against black" },
    sortOrder: 11,
  },
  {
    slug: "prakriti-where-the-gods-reside",
    title: "Prakriti: Where the Gods Reside",
    locationLabel: "Bodhisattva Gallery, Kupondole, Lalitpur",
    startsOn: "2023-08-07",
    endsOn: "2023-08-21",
    dateLabel: "7 – 21 Aug 2023",
    description: "Prakriti invited audiences to understand the universe itself as sacred, and the five elements of nature — earth, water, fire, air and space — as essential forces that sustain life. It featured a life-sized projection-mapped animation of Goddess Annapurna, abstract paubha by master artist Raj Prakash Tuladhar, bird-feather paintings by Puspa Lal Dangol, and intricate filigree bird sculptures by Pradip Shakya — Newa art as a living tradition speaking to nature, sustainability and climate change.",
    curator: "Prajwol Man Shakya",
    category: "thematic",
    status: "past",
    isFeatured: false,
    coverAspect: "standard",
    image: { url: "/images/exhibitions/prakriti-where-the-gods-reside.jpg", alt: "Prakriti poster — embracing divine couple amid clouds and flames" },
    sortOrder: 12,
  },
  {
    slug: "karunamayas-karuna",
    title: "Karunamaya's Karuna",
    locationLabel: "Bodhisattva Gallery, Kupondole, Lalitpur",
    startsOn: "2022-02-24",
    endsOn: "2022-04-16",
    dateLabel: "24 Feb – 16 Apr 2022",
    description: "An immersive exhibition exploring Avalokiteshvara — the Bodhisattva of Compassion, known locally as Karunamaya. Featuring 31 paintings and 11 sculptures presenting 26 manifestations of the deity, it guided visitors through a narrative progression enhanced by Nepal's first private gallery audio tour and digital projections, including Karunamaya saving souls from the Avichi Hell and a Charya Nritya performance by Raju Shakya. Two Avalokiteshvara statues in the show had been exhibited in Vienna for almost a year in 2019.",
    curator: "Prajwol Man Shakya",
    category: "buddhist",
    status: "past",
    isFeatured: false,
    coverAspect: "tall",
    image: { url: "/images/exhibitions/karunamayas-karuna.jpg", alt: "Karunamaya's Karuna poster — golden Avalokiteshvara statue against black" },
    sortOrder: 13,
  },
  {
    slug: "compassion-and-healing-through-taras",
    title: "Compassion & Healing Through Taras",
    locationLabel: "Bodhisattva Gallery, Kupondole, Lalitpur",
    startsOn: "2021-10-10",
    endsOn: "2021-12-12",
    dateLabel: "10 Oct – 12 Dec 2021",
    description: "Emerging in the aftermath of the COVID-19 pandemic, Compassion & Healing Through Taras was conceived as both an exhibition and a spiritual offering dedicated to communal healing. It featured paubha, sculptures, carved semi-precious stones, and gold and silver repoussé exploring the many forms of Tara — the embodiment of compassion and swift action. The opening programme included a talk on Tara iconography by Rev. Deepak Bajracharya and a sacred Charya Nritya performance by Raju Shakya and his team; the exhibition also introduced digital projection in the gallery for the first time.",
    curator: "Prajwol Man Shakya",
    category: "buddhist",
    status: "past",
    isFeatured: false,
    coverAspect: "tall",
    image: { url: "/images/exhibitions/compassion-and-healing-through-taras.jpg", alt: "Compassion & Healing Through Taras poster — Green Tara painting" },
    sortOrder: 14,
  },
  {
    slug: "nepal-art-now",
    title: "Nepal Art Now: Contemporary Nepalese Art",
    locationLabel: "Weltmuseum Wien, Vienna, Austria",
    startsOn: "2019-04-11",
    endsOn: "2019-11-08",
    dateLabel: "11 Apr – 8 Nov 2019",
    description: "Held at the Weltmuseum Wien, Nepal Art Now was the largest and most comprehensive exhibition of contemporary Nepalese art outside Nepal, with around 130 works by approximately 40 artists. Major loaned works from Bodhisattva Gallery and the private collection of Anjana and the late Purna Man Shakya — including a wooden and bronze Standing Padmapani Lokeshvara and the Vajrapani painting — served as cultural anchors of the exhibition, affirming Purna Man Shakya's legacy as a collector and cultural custodian.",
    curator: null,
    category: "contemporary",
    status: "past",
    isFeatured: false,
    coverAspect: "standard",
    image: { url: "/images/exhibitions/nepal-art-now.jpg", alt: "Nepal Art Now poster — red-and-white Lakhey mask painting" },
    sortOrder: 15,
  },
  {
    slug: "jewels-of-newar-art-second-edition",
    title: "Jewels of Newar Art — Second Edition",
    locationLabel: "Bodhisattva Gallery, Pulchowk, Lalitpur",
    startsOn: "2019-01-20",
    endsOn: "2019-02-09",
    dateLabel: "20 Jan – 9 Feb 2019",
    description: "The second edition of Jewels of Newar Art marked the opening of Bodhisattva Gallery's permanent space in Pulchowk, Lalitpur, inaugurated by Hon. Sashi Shrestha, former Minister of Land Management, Cooperatives and Poverty Alleviation. Designed by Siddhartha Man Shakya and curated by Prajwol Man Shakya, the gallery created an immersive, contemplative atmosphere through controlled lighting and dramatic spotlighting. Featuring over 75 master artists in painting, stone carving and statues, it celebrated the living evolution of contemporary Newa craftsmanship.",
    curator: "Prajwol Man Shakya",
    category: "historical",
    status: "past",
    isFeatured: false,
    coverAspect: "standard",
    image: { url: "/images/exhibitions/jewels-of-newar-art-second-edition.jpg", alt: "Jewels of Newar Art second edition invitation — yellow standing deity painting" },
    sortOrder: 16,
  },
  {
    slug: "embodied-enlightenment-2016",
    title: "Embodied Enlightenment",
    locationLabel: "Nepal Art Council, Babar Mahal, Kathmandu",
    startsOn: "2016-05-29",
    endsOn: "2016-06-09",
    dateLabel: "29 May – 9 Jun 2016",
    description: "A landmark retrospective dedicated to artist Samundra Man Singh Shrestha, organised by Bodhisattva Gallery at the Nepal Art Council. Featuring over 62 works, it highlighted the artist's distinctive fusion of classical Newa iconography with realism, depth and contemporary artistic expression, and drew more than 6,000 visitors in just 11 days. Of the works presented, 45 belonged to the Shakya family, assembled over five years by purchasing important works from collectors in Nepal and abroad and commissioning new works directly from the artist; the remaining works were loaned by the artist and private collectors from Nepal, China and London. The exhibition produced a scholarly catalogue and introduced high-quality giclée prints on cotton canvas.",
    curator: "Dina Bangdel & Prajwol Man Shakya",
    category: "buddhist",
    status: "past",
    isFeatured: false,
    coverAspect: "tall",
    image: { url: "/images/exhibitions/embodied-enlightenment-2016.jpg", alt: "Embodied Enlightenment 2016 poster — blue wrathful deity painting" },
    sortOrder: 17,
  },
  {
    slug: "jewels-of-newar-art-hyatt-regency",
    title: "Jewels of Newar Art — Hyatt Regency Kathmandu Edition",
    locationLabel: "Hyatt Regency Kathmandu, Taragaon, Kathmandu",
    startsOn: "2012-01-01",
    endsOn: "2018-12-31",
    dateLabel: "Jan 2012 – Dec 2018",
    description: "Following the success of the 2011 exhibition, Bodhisattva Gallery organised a series of annual and biannual exhibitions at Hyatt Regency Kathmandu between 2012 and 2018. Set within a luxury international venue, these exhibitions introduced museum-quality Newa paubha and sculptures to global travellers, collectors, diplomats and spiritual leaders, helping reposition Newa art as collectible fine art rather than ethnographic artefact, and building an international collector base for contemporary traditional Newa art.",
    curator: "Bodhisattva Gallery Team",
    category: "historical",
    status: "past",
    isFeatured: false,
    coverAspect: "standard",
    image: { url: "/images/exhibitions/jewels-of-newar-art-hyatt-regency.jpg", alt: "Jewels of Newar Art at Hyatt Regency — Chaitya Court exhibition graphic" },
    sortOrder: 18,
  },
  {
    slug: "royal-fables",
    title: "Royal Fables",
    locationLabel: "The Metropolitan Hotel, Connaught Place, New Delhi, India",
    startsOn: "2011-10-14",
    endsOn: "2011-10-16",
    dateLabel: "14 – 16 Oct 2011",
    description: "In October 2011, Bodhisattva Gallery made its first appearance outside Nepal, participating in Royal Fables Season 2 at The Metropolitan Hotel in New Delhi — a concept exhibition by Anshu Khanna, organised by Khushii and RoyalFables, bringing together the cultural heritage, craftsmanship and contemporary creativity inspired by the royal families of India. Presenting traditional Newa art alongside creations inspired by India's royal traditions, the gallery introduced Nepal's Newa artistic heritage to an international audience.",
    curator: null,
    category: "thematic",
    status: "past",
    isFeatured: false,
    coverAspect: "tall",
    image: { url: "/images/exhibitions/royal-fables.jpg", alt: "Royal Fables poster — portrait of a king in an ornate gold frame" },
    sortOrder: 19,
  },
  {
    slug: "jewels-of-newar-art-2011",
    title: "Jewels of Newar Art 2011",
    locationLabel: "Siddhartha Art Gallery, Babar Mahal Revisited, Kathmandu",
    startsOn: "2011-04-26",
    endsOn: "2011-05-15",
    dateLabel: "26 Apr – 15 May 2011",
    description: "The first Jewels of Newar Art exhibition, presented by Bodhisattva Gallery in collaboration with Siddhartha Art Gallery: 65 paubha paintings and 10 sculptures by more than two dozen Newar artists, collected by Purna Man Shakya over 25 years. Inaugurated by Dr. Dina Bangdel, the exhibition also launched the Jewels of Newar Art book, and its Sunday talk programme covered the Arniko legacy, oil in paubha painting, lost-wax statue making, and paubha and spirituality.",
    curator: "Sangeeta Thapa and Bodhisattva Gallery Team",
    category: "historical",
    status: "past",
    isFeatured: false,
    coverAspect: "tall",
    image: { url: "/images/exhibitions/jewels-of-newar-art-2011.jpg", alt: "Painting of a standing goddess in an ornate torana — Jewels of Newar Art 2011" },
    sortOrder: 20,
  },
];
// ---------------------------------------------------------------------------
// News categories (§7 N2) — seeded from the five `type` values of the
// News page, with their display colours from the component's `typeColor`
// map (mapping §N2: the colours move to `news_categories.colorToken`).
// ---------------------------------------------------------------------------

export interface NewsCategorySeed {
  slug: string;
  name: string;
  /** Tailwind class pair from NewsPage's `typeColor` map, verbatim. */
  colorToken: string;
}

export const NEWS_CATEGORIES: NewsCategorySeed[] = [
  { slug: "news", name: "News", colorToken: "text-amber-700 dark:text-amber-400" },
  { slug: "interview", name: "Interview", colorToken: "text-emerald-700 dark:text-emerald-400" },
  { slug: "feature", name: "Feature", colorToken: "text-blue-700 dark:text-blue-400" },
  { slug: "press-release", name: "Press Release", colorToken: "text-purple-700 dark:text-purple-400" },
  { slug: "review", name: "Review", colorToken: "text-rose-700 dark:text-rose-400" },
];

// ---------------------------------------------------------------------------
// REAL CONTENT (2026-11-19, migration 0013): the record sets below were
// replaced with Bodhisattva International's real content, supplied by the
// owner — the institutional booklet "A Glimpse of Bodhisattva
// International" (Oct 2026), the About / What-is-Newa-Art documents, the
// owner's exhibition lists and press-clipping archive, cross-checked
// against published sources. Images are the institution's own exhibition
// posters and clipping scans, served from the frontend's public/images/.
// The fictional design-stage records previously here were removed.
// ---------------------------------------------------------------------------

export interface NewsArticleSeed {
  slug: string;
  title: string;
  sourceName: string | null;
  /** ISO date (yyyy-mm-dd); null where the clipping prints no date. */
  publishedDate: string | null;
  author: string | null;
  summary: string;
  categorySlug: string;
  externalUrl: string | null;
  /** Full article text where the owner supplied it (Kathmandu Post
   *  feature); null for scan-only clippings. */
  content: string | null;
  image: MuseumImage | null;
}

export const NEWS_ARTICLES: NewsArticleSeed[] = [
  {
    slug: "into-the-exquisite-world-of-religious-art",
    title: "Into the exquisite world of religious art",
    sourceName: "The Kathmandu Post",
    publishedDate: "2022-03-10",
    author: "Shranup Tandukar",
    summary: "Shranup Tandukar's full-page feature on Bodhisattva Gallery's exhibition 'Karunamaya's Karuna' at Pulchowk Road, Lalitpur — 31 paintings and statues curated largely from the Shakya family's own collection, with a guided audio tour — exploring how the show demystifies Buddhist statue making and paubha art.",
    categorySlug: "feature",
    externalUrl: null,
    content: "Into the exquisite world of religious art\n                           Bodhisattva Gallery’s ongoing exhibition, ‘Karunamaya’s Karuna’, attempts to shed\n                               light on and demystify the art of Buddhist statue making and paubha art.\nSHRANUP TANDUKAR\nLALITPUR\n\n\n\n\nT\n            he beauty of art lies in its\n            ability to impact us. To\n            make us think, feel, see,\n            touch, smell, taste, and\n            experience things from a\n            new vantage point. Art\ncan also be unexpected; a trip to\nan art exhibition can be an amazing,\nunderwhelming, resonant, nostalgic,\nconfounding, or sometimes, a\nlearning experience.\n   Religious art can be particularly\ncryptic to people unaware of the\nreligious motifs and history. Paubha,\na genre of traditional painting\nthat originated among the Newa\ninhabitants of the Valley, is a form of\nreligious art that can be baffling to\nmany. While the primary deity promi-\nnently featured in paubha paintings\ncan be familiar, the meaning and sig-\nnificance of the specific pose of the\ndeity, motifs used in the painting,\ncolour scheme, and imageries can\nremain enigmatic.\n   An attempt to shed light and demys-\ntify paubha art as well as Buddhist\nstatues is seen at the Bodhisattva\nGallery’s      ongoing     exhibition,\n‘Karunamaya’s Karuna’. Karunamaya                                                                                                                                            Post Photos: Elite Joshi\nis also known as the Bodhisattva:          The exhibition features 31 paintings and five statues that were curated mostly from the Shakya family’s own collection.\nAvalokiteshvara, Lokeshvara, or\nMachhindranath. It refers to a             others, while Purna Man Shakya, the                 The painting portion of the guided              seems to be shrouded under a perpetu-\ncompassionate being who delays their       late father of Prajwol and Siddhartha            audio tour begins with a paubha done               al rainy day.\nown enlightenment in order to help         Man Shakya, and the Bodhisattva                  by Ujay Bajracharya and sets the                      The next two paintings differ from\nothers reach nirvana.                      Gallery team provided guidance to the            scene for the upcoming twelve paubha               the rest of the paubha art style that\n   The exhibition features 31 paint-       artists.                                         series of different Lokeshvaras and                pervades the exhibition. The black\nings, eleven statues (excluding five          The exhibit no 6 is an insightful             their associated months starting from              and white paintings of the chariot of\nminiature       works),     and     two    section of the tour that focuses on the          Magh and ending with Poush. The                    Rato Machhindranath were done by\nmultimedia artworks. It also has a         lost waxing process of making statues            audio narration sheds light on many                Sushila Singh and they visualise yet\nguided audio tour detailing the            from Buddhist and Hindu pantheons.               mythical stories linked with the                   another vital element of the Bunga\nhistory, significance, and meaning         This traditional technique of making             Lokeshvaras and also provides infor-               dya story and Rato Machhindranath\nbehind each artwork. Curated by            statues passed down from generation              mation on the physical statues and                 jatra.\nelder brother Prajwol Man Shakya           to generation in Shakya and                      worship sites of the Lokeshvaras                      Lastly, the exhibit also contains a\nand designed by younger brother            Bajracharya clans was an “act of reli-           around the Valley.                                 chariya nritya, performed by Raju\nSiddhartha Man Shakya, this art            gious devotion,” further highlighting               The most alluring exhibit is                    Shakya, projected onto a wall.\nexhibition is the third show taking        the notion that making religious art             undoubtedly no 35 which focuses on                 Through the combination of different\nplace at the Bodhisattva Gallery,          was a form of religious worship. The             the origin and significance of Bunga               styles of paintings and a religious\nwhich opened its doors in 2019. Out of     exhibit is divided into six different            dya. Consisting of three paintings and             dance video, the exhibit craftily ties\nthe total 108 forms of Karunamaya,         parts—from A to F—which illustrates              one multimedia video, all created spe-             together the story of Bunga dya and\nthe exhibition only highlights 26                                                           cifically for this exhibition, the exhib-          the Rato Machhindranath jatra in the\ndifferent forms.                                                                            it blends both audio-visual aspects to             Valley.\n   The exhibition includes 14 paubha\nartists along with a few junior\n                                           The entire                                       craft a compelling story of Bunga dya,\n                                                                                            who is also known as Red\n                                                                                                                                                  The idea of incorporating an guided\n                                                                                                                                               audio tour with a paubha and statue\nartists, while there are 15 renowned       atmosphere of the                                Avalokiteshvara,           or       Rato           exhibition was certainly a sorely\nstatue artists and one miniature                                                            Machhindranath. Bunga dya is con-                  needed one. While people can easily\nartist.                                    art exhibition is                                sidered as the deity which provides                appreciate the beauty of paubha\n   The two Shakya brothers are the                                                          rain and harvest and is the central                paintings, the significance of the dei-\nfourth generation involved in the          spiritual.                                       figure worshipped in the Rato                      ties illustrated and the motifs used in\nsector of art business. While their                                                         Machhindranath Jatra.                              the paintings often elude people not\ngreat-grandfather and great-grand-                                                             The first painting done by Raj                  well-versed in Buddhist philosophies.\nmother were both craftsmen using           the making of a statue of Kacheri (a             Prakash Tuladhar and the concept                      Though the guided audio tour,\ncrystal, the family eventually steered     form of Bodhisattva) from a block of             designed by Prajwol Man Shakya, in                 which is almost 42 minutes long, can\ntowards creating a market for the          beeswax into a finished wax statue               this exhibit, delves into the origin of            feel drawn-out, especially in the last\nNewa art. Most of the artworks were        with gold plating and further detail-            Bunga dya; how king Narendra Dev of                five minutes, it is nevertheless a novel\ncurated from the Shakya family’s           ing. Only a few key steps in the mak-            Bhaktapur helped bring an end to the               idea in the realm of Nepali art exhibi-\npersonal collection, while a few           ing of a wax statue are shown and                drought plaguing the Valley in the 7th             tion and works out well. The art exhi-\nartworks (exhibit no 6 and 35) were        described but the exhibit offers a               century CE. The guided audio tour                  bition presents a new perspective\nspecially commissioned by the              glimpse into the amount of collective            digs deeper into the local stories and             towards appreciating art—that you\nBodhisattva      Gallery     team     to   effort and skill needed to create one            explains several symbolisms of                     don’t always have to resonate with art,\nfurther accentuate the appeal of the       statue.                                          Machhindranath jatra while the paint-              but can also learn from it.\nart exhibition.                               Physical artwork is combined with             ing itself consists of the face of Rato\n   The entire atmosphere of the art        multimedia art to provide a creative             Machhindranath statue as the central               ‘Karunamaya’s Karuna’ will be\nexhibition in Bodhisattva Gallery is       twist, which makes the religious story           element accompanied by Karunamaya                  exhibited until April 16 at the\nspiritual—the exhibition is held in        more compelling. In exhibit no 7, a              on the right, Gorakhnath on the left,              Bodhisattva     Gallery,  Pulchowk\none giant room with no windows             large statue of Shakyamuni Buddha is             and several serpents intertwining                  Road, Lalitpur. Prior reservations\nwhich eliminates any distraction and       placed in the form of a projection               across the edges. The theme of rain                must before visiting the exhibition.\ncreates a sombre ambiance. The             which plays a scene of hell where                and water has been incorporated                    (Bringing your own headphones or\ndescriptions of the artworks are also      humans are suffering. In the right               beautifully as the whole painting                  earbuds is highly recommended.)\nminimal, devoid of the creator’s name      corner of the projection, a depiction\nor artist statement and consisting of      of Avalokiteshvara is shown giving\nsimply the name of the deities and         respite to the tortured souls.\nbrief details. There are markings on          The design of the art exhibition is\nthe floor which guide visitors to the      stimulating too—the statues and\npre-designed path in tandem with the       paintings are not placed haphazardly\nguided audio tour. The audio itself,       but with careful consideration to cre-\nnarrated by Surina Shakya, weaves          ate a sense of spiritual journey.\nthrough the stories, origin, signifi-      Visitors start from a point near the\ncance, and creator of the artworks         middle of the room and then start cir-\nwhile a tranquil Buddhist hymn plays       cling the room visiting one statue\nin the background.                         after another. The statues, placed in\n   The first phase of the guided tour      the middle of the room, form the first\nfocuses on the statues of various          phase of the exhibition, while the\nKarunamayas. Most of the statues           paintings, placed around the walls of\nare bronze with some adorning addi-        the room, form the second phase.\ntional precious gems while a few like         The whole journey feels like a soli-\nthe Standing Padmapani statue(exhi-        tary pilgrimage—a circling of a stupa\nbition no 10) are carved out of wood.      or temple—where you feel like you\nThe statues in varying sizes were          gaze into the intricacies of the art-\nmade by master craftsmen such as           works, learn its significance and his-\nRajan Shakya, Nabin Bajracharya,           tory, pay your respects, and make your\nBijay Shakya, Bhim Shakya, among           way onto another.                                The exhibition features a guided audio tour, a relatively novel idea in the Nepali art scene.",
    image: { url: "/images/news/into-the-exquisite-world-of-religious-art.jpg", alt: "Press clipping — Into the exquisite world of religious art" },
  },
  {
    slug: "gorkhapatra-lokeshvara-exhibition-2022",
    title: "लोकेश्वर चित्र तथा मूर्ति प्रदर्शनी",
    sourceName: "Gorkhapatra",
    publishedDate: "2022-03-05",
    author: "Shiva Tamang",
    summary: "Front-page feature by Shiva Tamang on the Lokeshvara (Karunamaya) painting and statue exhibition at Bodhisattva Gallery, Pulchowk, presenting the skills and knowledge of 25 artists with modern technology; the show ran until Baisakh 3.",
    categorySlug: "feature",
    externalUrl: null,
    content: null,
    image: { url: "/images/news/gorkhapatra-lokeshvara-exhibition-2022.jpg", alt: "Press clipping — लोकेश्वर चित्र तथा मूर्ति प्रदर्शनी" },
  },
  {
    slug: "a-homage-to-goddess-tara",
    title: "A homage to Goddess Tara",
    sourceName: "Himalayan News Service",
    publishedDate: null,
    author: null,
    summary: "Report on a talk by priest Deepak Bajracharya of Hiranya Varna Mahavihar (the Golden Temple), Pulchowk, on the goddess Tara, held as part of Bodhisattva Gallery's exhibition 'Compassion & Healing Through Taras', followed by the Charya Nritya dance of White and Green Tara performed by Raju Shakya and team.",
    categorySlug: "news",
    externalUrl: null,
    content: null,
    image: { url: "/images/news/a-homage-to-goddess-tara.jpg", alt: "Press clipping — A homage to Goddess Tara" },
  },
  {
    slug: "marvels-of-traditional-newar-art-on-exhibition",
    title: "Marvels of traditional Newar art on exhibition",
    sourceName: "República — My City",
    publishedDate: null,
    author: null,
    summary: "My City's coverage of 'Jewels of Newar Art — Second Edition' at Bodhisattva Gallery, the exhibition of museum-quality works by renowned Newar artists that inaugurated the gallery's permanent home in Pulchowk, Lalitpur, in January 2019.",
    categorySlug: "news",
    externalUrl: null,
    content: null,
    image: { url: "/images/news/marvels-of-traditional-newar-art-on-exhibition.jpg", alt: "Press clipping — Marvels of traditional Newar art on exhibition" },
  },
  {
    slug: "an-ocean-of-enlightenment",
    title: "An ocean of enlightenment",
    sourceName: "The Kathmandu Post",
    publishedDate: "2016-06-11",
    author: "Sophia L Pande",
    summary: "Sophia L Pande reviews Samundra Man Singh Shrestha's 'Embodied Enlightenment' at the Nepal Art Council, Babar Mahal — a retrospective of the paubha painter's work curated by Dr. Dina Bangdel, illustrated with his Amoghasiddhi, Vajrapani and Padmapani Lokeshvara paintings.",
    categorySlug: "review",
    externalUrl: null,
    content: null,
    image: { url: "/images/news/an-ocean-of-enlightenment.jpg", alt: "Press clipping — An ocean of enlightenment" },
  },
  {
    slug: "samundras-contemporary-paubha-exhibition",
    title: "Samundra's Contemporary Paubha Exhibition",
    sourceName: "The Nepal Weekly",
    publishedDate: "2016-06-07",
    author: "R. P. Narayan",
    summary: "On Samundra Man Singh Shrestha's solo exhibition 'Embodied Enlightenment' — 44 exclusive artworks collected by Purna and Anjana Shakya, organised by Bodhisattva Gallery at the Nepal Art Council, Babarmahal, inaugurated May 29 and concluding June 9, 2016.",
    categorySlug: "news",
    externalUrl: null,
    content: null,
    image: { url: "/images/news/samundras-contemporary-paubha-exhibition.jpg", alt: "Press clipping — Samundra's Contemporary Paubha Exhibition" },
  },
  {
    slug: "the-himalayan-times-ethnic-newar-artworks-2014",
    title: "Ethnic Newar artworks",
    sourceName: "The Himalayan Times",
    publishedDate: "2014-11-06",
    author: null,
    summary: "On 'Jewels of Newar Art', Bodhisattva Gallery's 3rd Annual Exhibition and Sale at Chaitya Court, Hyatt Regency, Boudha (October 29 – November 11, 2014), featuring paubha paintings and sculptures by more than 30 Newar artists, with 5% of sale proceeds going to the Buddhist Child Home orphanage.",
    categorySlug: "review",
    externalUrl: null,
    content: null,
    image: { url: "/images/news/the-himalayan-times-ethnic-newar-artworks-2014.jpg", alt: "Press clipping — Ethnic Newar artworks" },
  },
  {
    slug: "jewels-of-newar-art-at-hyatt-regency",
    title: "Jewels of Newar art",
    sourceName: "The Himalayan Times",
    publishedDate: null,
    author: null,
    summary: "Report on the Bodhisattva Gallery's 'Jewels of Newar Art Exhibition' at the Chaitya Court, Hyatt Regency Kathmandu, Boudha — paubha paintings and sculptures by ethnic Newar artists from Patan, Kathmandu and Bhaktapur, with Prajwol Shakya, Manager/Curator, quoted; 5% of sales to the Buddhist Child Home.",
    categorySlug: "news",
    externalUrl: null,
    content: null,
    image: { url: "/images/news/jewels-of-newar-art-at-hyatt-regency.jpg", alt: "Press clipping — Jewels of Newar art" },
  },
  {
    slug: "hyatt-bodhisattva-gallery-orphanage-handover",
    title: "Hyatt, Bodhisattva Gallery's bid to help orphanage",
    sourceName: "Himalayan News Service",
    publishedDate: null,
    author: null,
    summary: "Hyatt Regency Kathmandu and the Bodhisattva Gallery handed 5% of sale proceeds from the 'Jewels of Newar Art Exhibition' to Durga Mainali, chairperson of the Buddhist Child Home orphanage in Gokarna, Dakshin Dhoka; the hotel had given the orphanage a $10,000 Hyatt Community Grant in 2010.",
    categorySlug: "news",
    externalUrl: null,
    content: null,
    image: { url: "/images/news/hyatt-bodhisattva-gallery-orphanage-handover.jpg", alt: "Press clipping — Hyatt, Bodhisattva Gallery's bid to help orphanage" },
  },
  {
    slug: "tnm-reviving-the-newari-art-culture",
    title: "Reviving the Newari Art Culture",
    sourceName: "TNM",
    publishedDate: null,
    author: null,
    summary: "A two-page TNM feature on Bodhisattva Gallery (Taragaon Museum, Hyatt Regency Kathmandu, Boudha) and founder Purna Man Shakya's work promoting Newar artists, centred on a Green Tara sculpture and the 3rd Annual Exhibition and Sale: Jewels of Newar Art, with 5% of sales to the Buddhist Child Home orphanage.",
    categorySlug: "feature",
    externalUrl: null,
    content: null,
    image: { url: "/images/news/tnm-reviving-the-newari-art-culture.jpg", alt: "Press clipping — Reviving the Newari Art Culture" },
  },
  {
    slug: "a-measure-of-treasure-purna-man-shakya",
    title: "A Measure of Treasure — 3 Qs with Purna Man Shakya",
    sourceName: null,
    publishedDate: null,
    author: "Shristi Ale",
    summary: "A short Q&A with Purna Man Shakya, owner of Bodhisattva Gallery, who argues that traditional Newar artists in Nepal do not receive due recognition, and that traditional art forms are neglected by government and collectors alike. The piece opens with Ted Riccardi's 'Oriental Casebook of Sherlock Holmes' passage on the Kathmandu Valley.",
    categorySlug: "interview",
    externalUrl: null,
    content: null,
    image: { url: "/images/news/a-measure-of-treasure-purna-man-shakya.jpg", alt: "Press clipping — A Measure of Treasure — 3 Qs with Purna Man Shakya" },
  },
  {
    slug: "newar-art-the-best-on-display",
    title: "Newar art: The best on display",
    sourceName: "The Himalayan Times",
    publishedDate: "2011-04-28",
    author: null,
    summary: "'Jewels of Newar Art', an exhibition of works by over two dozen Newari artists collected by Purna Man Shakya, founder of Bodhisattva Gallery, opened April 26 at the Siddhartha Art Gallery, Babarmahal Revisited, inaugurated by Dr. Dina Bangdel; on display until May 15, 2011.",
    categorySlug: "news",
    externalUrl: null,
    content: null,
    image: { url: "/images/news/newar-art-the-best-on-display.jpg", alt: "Press clipping — Newar art: The best on display" },
  },
  {
    slug: "kantipur-paubhas-in-the-exhibition",
    title: "प्रदर्शनीमा पौभाहरू",
    sourceName: "Kantipur",
    publishedDate: "2011-04-28",
    author: null,
    summary: "A feature on the paubhas in the 'Jewels of Newar Art' exhibition: works by 25 artists including Prem Man Chitrakar, Samundra Man Singh Shrestha and Devendra Man Sinkhwal — three paubhas priced at Rs 15 lakh each — with comments from Dr. Dina Bangdel and Bodhisattva Gallery's Prajwol Shakya; the Jewels of Newar Art book was also launched at the show.",
    categorySlug: "feature",
    externalUrl: null,
    content: null,
    image: { url: "/images/news/kantipur-paubhas-in-the-exhibition.jpg", alt: "Press clipping — प्रदर्शनीमा पौभाहरू" },
  },
  {
    slug: "annapurna-post-newari-art-at-siddhartha",
    title: "सिद्धार्थमा नेवारी कला",
    sourceName: "Annapurna Post",
    publishedDate: "2011-04-28",
    author: null,
    summary: "Report on 'Jewels of Newar Art' at Siddhartha Art Gallery: 65 paubhas and 10 metal sculptures priced from Rs 50,000 to Rs 10 lakh, collected by Purna Man Shakya over 25 years, jointly organised by Bodhisattva Gallery and Siddhartha Art Gallery and inaugurated by Dr. Dina Bangdel.",
    categorySlug: "news",
    externalUrl: null,
    content: null,
    image: { url: "/images/news/annapurna-post-newari-art-at-siddhartha.jpg", alt: "Press clipping — सिद्धार्थमा नेवारी कला" },
  },
  {
    slug: "republica-visitor-at-jewels-of-newar-art",
    title: "A visitor observing a painting at the 'Jewels of Newar Art' exhibition",
    sourceName: "República",
    publishedDate: "2011-04-27",
    author: null,
    summary: "News photograph by Keshab Thoker: a visitor looking at paubha paintings, including a red Bhairav/Mahakala work, at the 'Jewels of Newar Art' exhibition at Siddhartha Art Gallery, Babermahal; the exhibition continued until May 15, 2011.",
    categorySlug: "news",
    externalUrl: null,
    content: null,
    image: { url: "/images/news/republica-visitor-at-jewels-of-newar-art.jpg", alt: "Press clipping — A visitor observing a painting at the 'Jewels of Newar Art' exhibition" },
  },
  {
    slug: "nagarik-rs-15-lakh-single-painting",
    title: "एउटै चित्रको १५ लाख",
    sourceName: "Nagarik",
    publishedDate: "2011-04-27",
    author: null,
    summary: "'Rs 1.5 million for a single painting': on the 'Jewels of Newar Art' exhibition at Siddhartha Art Gallery, Kathmandu — paubha paintings by Samundra Man Singh Shrestha ('Vajrapani', 'Mahakal') and Devendra Man Sinkhwal (Rato Bhairav) each priced at Rs 15 lakh; 65 paintings by 26 painters and 10 sculptures by 8 artists from Bodhisattva Gallery's collection, inaugurated by Dr. Dina Bangdel.",
    categorySlug: "news",
    externalUrl: null,
    content: null,
    image: { url: "/images/news/nagarik-rs-15-lakh-single-painting.jpg", alt: "Press clipping — एउटै चित्रको १५ लाख" },
  },
  {
    slug: "jewels-of-newar-art-friday-listing",
    title: "Jewels Of Newar Art",
    sourceName: "Fr!day (ECS)",
    publishedDate: "2011-04-27",
    author: null,
    summary: "Fr!day's art listing for 'Jewels Of Newar Art' at Siddhartha Art Gallery, Baber Mahal Revisited, with the exhibition's Sunday talk programme — the Arniko legacy, oil in paubha painting, lost-wax statue making, and paubha and spirituality — alongside a photo page from the 'Manifestation of Devi' talk programme.",
    categorySlug: "news",
    externalUrl: null,
    content: null,
    image: { url: "/images/news/jewels-of-newar-art-friday-listing.jpg", alt: "Press clipping — Jewels Of Newar Art" },
  },
  {
    slug: "jewels-of-newar-art-friday-preview",
    title: "Jewels of Newar Art",
    sourceName: "Fr!day (ECS)",
    publishedDate: "2011-04-20",
    author: null,
    summary: "Fr!day's preview of the Bodhisattva Gallery / Siddhartha Art Gallery exhibition (26 April – 15 May 2011): 26 paubha artists, statues from 3 artists, and coral and gold repoussé works, with Prajwol Shakya quoted on traditional art being undervalued.",
    categorySlug: "news",
    externalUrl: null,
    content: null,
    image: { url: "/images/news/jewels-of-newar-art-friday-preview.jpg", alt: "Press clipping — Jewels of Newar Art" },
  },
  {
    slug: "ecs-nepal-jewels-of-newar-art",
    title: "Jewels of Newar Art",
    sourceName: "ECS Nepal",
    publishedDate: "2011-05-04",
    author: null,
    summary: "ECS Nepal's feature on Newar art and the 'Jewels of Newar Art' exhibition — opening with the Ted Riccardi Sherlock Holmes passage on the Kathmandu Valley — drawn from Purna Man Shakya's personal collection at Siddhartha Art Gallery, Baber Mahal Revisited (April 26 – May 15, 2011), together with the exhibition listing and its talk programme. (Date from the handwritten note on the scan.)",
    categorySlug: "feature",
    externalUrl: null,
    content: null,
    image: { url: "/images/news/ecs-nepal-jewels-of-newar-art.jpg", alt: "Press clipping — Jewels of Newar Art" },
  },
  {
    slug: "newari-art-on-display-the-reporter",
    title: "Newari art on display",
    sourceName: "The Reporter",
    publishedDate: "2011-05-08",
    author: null,
    summary: "'Jewels of Newar Art', inaugurated April 26 by Dr. Dina Bangdel at Siddhartha Art Gallery, Baber Mahal: paintings and sculptures collected by Purna Man Shakya, founder of Bodhisattva Gallery, by over two dozen artists; on display until May 15, 2011.",
    categorySlug: "news",
    externalUrl: null,
    content: null,
    image: { url: "/images/news/newari-art-on-display-the-reporter.jpg", alt: "Press clipping — Newari art on display" },
  },
];
// ---------------------------------------------------------------------------
// REAL CONTENT (2026-11-19, migration 0013): the record sets below were
// replaced with Bodhisattva International's real content, supplied by the
// owner — the institutional booklet "A Glimpse of Bodhisattva
// International" (Oct 2026), the About / What-is-Newa-Art documents, the
// owner's exhibition lists and press-clipping archive, cross-checked
// against published sources. Images are the institution's own exhibition
// posters and clipping scans, served from the frontend's public/images/.
// The fictional design-stage records previously here were removed.
// ---------------------------------------------------------------------------

export interface FoundationProgramSeed {
  slug: string;
  name: string;
  categoryLabel: string;
  description: string;
  impactMetric: string;
  iconName: string;
  sortOrder: number;
}

export const FOUNDATION_PROGRAMS: FoundationProgramSeed[] = [
  {
    slug: "purna-man-shakya-memorial-art-award",
    name: "Purna Man Shakya Memorial Art Award",
    categoryLabel: "Art Award",
    description: "First presented in 2023 by the Bodhisattva Foundation, the award honours the founders' philosophy of artistic excellence for both senior and emerging artists. Held at Bodhisattva Gallery in two categories — paubha painting and traditional sculpture — it encourages artists to move beyond repetition and mass production toward mastery, innovation and depth. Winners — 2023: Raj Prakash Tuladhar, Sujit Maharjan and Ram Prakash Shrestha (paubha); Shyam Maharjan (statue). 2024: Ram Prakash Shrestha, Priya Shakya and Amrit Dangol (paubha); Niraj Shakya, Birendra Shakya and Rajiv Tandukar (statue). 2025: Ritesh Shahi, Devendra Sinkhwal and Sankha Narayan Shrestha (paubha).",
    impactMetric: "Rs. 50,000 first prize · 3 editions since 2023",
    iconName: "Award",
    sortOrder: 0,
  },
  {
    slug: "humanitarian-support",
    name: "Humanitarian Support",
    categoryLabel: "Humanitarian",
    description: "Beyond art, the Foundation carries forward Purna Man Shakya's quiet legacy of humanity: supporting children's education, funding medical treatment for those in need, and offering protection and support to individuals during Nepal's periods of political conflict. Alongside him, Anjana Shakya shared — and continues to carry forward — these values of compassion and service, placing human dignity and kindness at the heart of the work.",
    impactMetric: "Education · Medical aid · Community support",
    iconName: "Users",
    sortOrder: 1,
  },
  {
    slug: "art-education-talks-and-workshops",
    name: "Art Education, Talks & Workshops",
    categoryLabel: "Education",
    description: "An ongoing programme of lectures, talk series and workshops keeps Newa art in living conversation — from Dr. Dina Bangdel's talks on sacred Newar art and paubha painting, and Udaya Charan Shrestha's lecture series on Ucchushma Jambhala, to hands-on workshops teaching school students paubha painting and the lost-wax process, and conversations on art, climate and heritage at the Gallery and the Museum.",
    impactMetric: "Lectures & workshops since 2013",
    iconName: "BookOpen",
    sortOrder: 2,
  },
];
// the curator record is appended (it lives on Home, not Foundation).
// Avatar alt text follows the Foundation component, which renders
// `alt={name}`. The curator quote is stored without the typographic
// quotation marks the Home component wraps it in (&ldquo;/&rdquo; are
// presentation, added by the renderer — same convention as the
// foundation quotes, which are stored bare).
// ---------------------------------------------------------------------------

export interface TestimonialSeed {
  quote: string;
  authorName: string;
  authorRole: string;
  context: "foundation" | "curator";
  image: MuseumImage | null;
  sortOrder: number;
}

export const TESTIMONIALS: TestimonialSeed[] = [
  {
    quote: "The fellowship gave me two years to focus solely on Bidri metalwork. My daughter is now learning alongside me — for the first time in four generations, we believe this will continue.",
    authorName: "Meena Gurung",
    authorRole: "Living Craft Fellow, 2024",
    context: "foundation",
    image: {
      url: "https://images.unsplash.com/photo-1592060036126-1b6d5139dea4?w=80&h=80&fit=crop&auto=format&q=80",
      alt: "Meena Gurung",
    },
    sortOrder: 0,
  },
  {
    // D20 flag (preserved verbatim, client to confirm/replace):
    // "Govt. School, Varanasi" is India-context copy (mapping §F5).
    quote: "Before ArtReach, our school had no art teacher and no materials. Now we have a dedicated studio and six students who have applied to arts colleges.",
    authorName: "Sunita Lama",
    authorRole: "Teacher, Govt. School, Varanasi",
    context: "foundation",
    image: {
      url: "https://images.unsplash.com/photo-1708795921259-263a5e973acb?w=80&h=80&fit=crop&auto=format&q=80",
      alt: "Sunita Lama",
    },
    sortOrder: 1,
  },
  {
    quote: "Bringing 80 students to the museum changed something. They saw themselves in the art — the faces, the stories. One girl said, 'This is my history too.'",
    authorName: "Arjun Singh",
    authorRole: "NGO Coordinator, Asha Foundation",
    context: "foundation",
    image: {
      url: "https://images.unsplash.com/photo-1756694915450-50c9796fb96d?w=80&h=80&fit=crop&auto=format&q=80",
      alt: "Arjun Singh",
    },
    sortOrder: 2,
  },
  {
    quote: "Every sculpture here is a question the ancient world poses to our present — and an invitation to answer.",
    authorName: "Siddhartha Man Shakya",
    authorRole: "Chief Curator",
    context: "curator",
    image: null,
    sortOrder: 3,
  },
];
