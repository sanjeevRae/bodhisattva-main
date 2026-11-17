/**
 * Store-module seed data — Phase 6 (CMS_CONTENT_MAPPING.md §6, §10 step 7;
 * DATABASE_DESIGN.md §9.1/§9.2/§9.3).
 *
 * The Gift Shop catalogue: 5 product categories and 12 products,
 * transcribed VERBATIM from the inline arrays in
 * `src/app/pages/GiftShopPage.tsx` (names, `detail` lines, category keys,
 * image ids). No copy has been edited, corrected or "improved".
 *
 * Transformations applied (all mechanical, per mapping §6 S2/S3):
 *  - Categories: the component's tab list minus the "All" pseudo-tab
 *    (a UI construct, not a record). `name` is the tab label exactly as
 *    rendered; `sortOrder` follows the tab order.
 *  - `slug` (products): generated from the name — lowercased,
 *    diacritics folded (é → e), every non-alphanumeric run collapsed to
 *    a single hyphen. The mapping requires a slug; none exists in the
 *    source.
 *  - `sku`: assigned at migration per the mapping ("absent — must be
 *    assigned at migration"): BOD-001 … BOD-012 in source array order.
 *  - `price`: the source is a DISPLAY STRING ("Rs.4,500"). Parse rule:
 *    strip the "Rs." prefix and the thousands commas → whole rupees →
 *    DECIMAL string with two fraction digits ("4500.00"); `pricePaisa`
 *    is the same value in integer minor units (rupees × 100), the form
 *    the shared money helpers compute in. Both are carried so the seed
 *    step can write the DECIMAL column and tests can assert paisa
 *    without re-parsing. The original display string is quoted in a
 *    comment beside each record. No product is on sale in the source,
 *    so there is no sale-price field here (the column stays NULL).
 *  - `image`: exactly one image per product in the source. The URL is
 *    built with the component's own `uimg()` helper at the dimensions
 *    the product grid requests — `uimg(imgId, 500, 666)` =
 *    `https://images.unsplash.com/<imgId>?w=500&h=666&fit=crop&auto=format&q=80`
 *    — and `alt` is the product name, which is what the component
 *    renders (`alt={product.name}`). These become `product_images`
 *    rows via the legacy `image_url` bridge (schema deviation 1 in
 *    `../schema/store.ts`; media migration is the BD-2 decision).
 *  - `isPublished: true` for every product: the source page shows all
 *    12. The products table has no boolean — the seed step maps this
 *    to `status = 'ACTIVE'` (mapping §6: status defaults to active).
 *
 * ⚠ STOCK — PLACEHOLDER, READ BEFORE SEEDING:
 * NO stock data exists anywhere in the source material — not in the
 * component, not in the mapping's source audit (CMS_CONTENT_MAPPING.md
 * §6 S3: "stockQuantity: absent — no stock data exists anywhere;
 * initial stock must be supplied by the client at Phase 6 seeding").
 * The client has not yet supplied real counts. `stockQuantity` is
 * therefore set to 10 for every product as a PLACEHOLDER so the store
 * can be exercised end-to-end (cart, checkout, reservations) during
 * development. These numbers are NOT real inventory. Before launch
 * they must be replaced with the client's actual counts through admin
 * inventory adjustments (which write proper OPENING/ADJUSTMENT ledger
 * movements) — never by editing this file after the fact.
 *
 * ------------------------------------------------------------------------
 * COUNT CHECK — records exported here vs CMS_CONTENT_MAPPING.md §10
 * ------------------------------------------------------------------------
 *  product_categories   5   (§10 step 7: "product_categories (5)")     ✓
 *  products            12   (§10 step 7: "products (12, prices parsed,
 *                            SKUs assigned)")                          ✓
 * ------------------------------------------------------------------------
 */

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

/** An image reference: current Unsplash URL + alt text (see header note). */
export interface StoreImage {
  url: string;
  alt: string;
}

// ---------------------------------------------------------------------------
// Product categories (§6 S2) — the Gift Shop tab list, minus "All".
// ---------------------------------------------------------------------------

export interface ProductCategorySeed {
  /** The component's tab `key`; also the products' `cat` value. */
  slug: string;
  /** The tab label exactly as rendered. */
  name: string;
  sortOrder: number;
  isActive: boolean;
}

export const PRODUCT_CATEGORIES: ProductCategorySeed[] = [
  { slug: "books", name: "Books & Catalogs", sortOrder: 0, isActive: true },
  { slug: "paintings", name: "Paintings", sortOrder: 1, isActive: true },
  { slug: "ceramics", name: "Ceramics", sortOrder: 2, isActive: true },
  { slug: "jewelry", name: "Jewelry", sortOrder: 3, isActive: true },
  { slug: "souvenirs", name: "Souvenirs", sortOrder: 4, isActive: true },
];

// ---------------------------------------------------------------------------
// Products (§6 S3) — the component's inline array, in source order.
// `detail` becomes the products.short_description column (the design's
// card/detail line, §9.2); no long description exists in the source.
// ---------------------------------------------------------------------------

export interface ProductSeed {
  slug: string;
  /** Assigned at migration: BOD-001 … BOD-012 in source order. */
  sku: string;
  name: string;
  /** The source `detail` line, verbatim. */
  detail: string;
  /** DECIMAL string, e.g. "4500.00" (parse rule in the header). */
  price: string;
  /** The same price in integer paisa, e.g. 450000. */
  pricePaisa: number;
  categorySlug: string;
  image: StoreImage;
  sortOrder: number;
  /** Maps to products.status = 'ACTIVE' at seed time (see header). */
  isPublished: boolean;
  /** ⚠ PLACEHOLDER 10 for every product — see the header warning. */
  stockQuantity: number;
}

export const PRODUCTS: ProductSeed[] = [
  {
    slug: "gandharan-buddha-museum-edition-giclee-print",
    sku: "BOD-001",
    name: "Gandharan Buddha — Museum Edition Giclée Print",
    detail: "A2 Archival Giclée, Limited to 200",
    price: "4500.00", // source display string: "Rs.4,500"
    pricePaisa: 450000,
    categorySlug: "paintings",
    image: {
      url: "https://images.unsplash.com/photo-1775212253782-d223fe035ddc?w=500&h=666&fit=crop&auto=format&q=80",
      alt: "Gandharan Buddha — Museum Edition Giclée Print",
    },
    sortOrder: 0,
    isPublished: true,
    stockQuantity: 10,
  },
  {
    slug: "silk-road-art-along-the-trade-routes",
    sku: "BOD-002",
    name: "Silk Road: Art Along the Trade Routes",
    detail: "Hardcover, 320 pp., 280 color plates",
    price: "2800.00", // source display string: "Rs.2,800"
    pricePaisa: 280000,
    categorySlug: "books",
    image: {
      url: "https://images.unsplash.com/photo-1760986784449-79e1a6ba616b?w=500&h=666&fit=crop&auto=format&q=80",
      alt: "Silk Road: Art Along the Trade Routes",
    },
    sortOrder: 1,
    isPublished: true,
    stockQuantity: 10,
  },
  {
    slug: "terracotta-dharma-wheel-pendant",
    sku: "BOD-003",
    name: "Terracotta Dharma Wheel Pendant",
    detail: "Handthrown, kiln-fired, glazed finish",
    price: "1200.00", // source display string: "Rs.1,200"
    pricePaisa: 120000,
    categorySlug: "jewelry",
    image: {
      url: "https://images.unsplash.com/photo-1767330855651-238523c49601?w=500&h=666&fit=crop&auto=format&q=80",
      alt: "Terracotta Dharma Wheel Pendant",
    },
    sortOrder: 2,
    isPublished: true,
    stockQuantity: 10,
  },
  {
    slug: "buddhist-manuscript-facsimile-portfolio",
    sku: "BOD-004",
    name: "Buddhist Manuscript Facsimile Portfolio",
    detail: "12 facsimile plates, limited to 500",
    price: "6500.00", // source display string: "Rs.6,500"
    pricePaisa: 650000,
    categorySlug: "books",
    image: {
      url: "https://images.unsplash.com/photo-1765127959724-631190c32e8a?w=500&h=666&fit=crop&auto=format&q=80",
      alt: "Buddhist Manuscript Facsimile Portfolio",
    },
    sortOrder: 3,
    isPublished: true,
    stockQuantity: 10,
  },
  {
    slug: "hand-painted-miniature-bodhisattva",
    sku: "BOD-005",
    name: "Hand-Painted Miniature — Bodhisattva",
    detail: "Original, 6×8 in., natural pigments",
    price: "18000.00", // source display string: "Rs.18,000"
    pricePaisa: 1800000,
    categorySlug: "paintings",
    image: {
      url: "https://images.unsplash.com/photo-1563000215-e31a8ddcb2d0?w=500&h=666&fit=crop&auto=format&q=80",
      alt: "Hand-Painted Miniature — Bodhisattva",
    },
    sortOrder: 4,
    isPublished: true,
    stockQuantity: 10,
  },
  {
    slug: "sancai-glazed-ceramic-bowl",
    sku: "BOD-006",
    name: "Sancai-Glazed Ceramic Bowl",
    detail: "Artisan-made, 300ml, dishwasher safe",
    price: "850.00", // source display string: "Rs.850"
    pricePaisa: 85000,
    categorySlug: "ceramics",
    image: {
      url: "https://images.unsplash.com/photo-1772617616268-a2f27d194fce?w=500&h=666&fit=crop&auto=format&q=80",
      alt: "Sancai-Glazed Ceramic Bowl",
    },
    sortOrder: 5,
    isPublished: true,
    stockQuantity: 10,
  },
  {
    slug: "the-bodhisattva-collection-2026-catalog",
    sku: "BOD-007",
    name: "The Bodhisattva Collection — 2026 Catalog",
    detail: "Softcover, 180 pp., bilingual EN/HI",
    price: "1500.00", // source display string: "Rs.1,500"
    pricePaisa: 150000,
    categorySlug: "books",
    image: {
      url: "https://images.unsplash.com/photo-1605429523419-d828acb941d9?w=500&h=666&fit=crop&auto=format&q=80",
      alt: "The Bodhisattva Collection — 2026 Catalog",
    },
    sortOrder: 6,
    isPublished: true,
    stockQuantity: 10,
  },
  {
    slug: "brass-lotus-incense-holder",
    sku: "BOD-008",
    name: "Brass Lotus Incense Holder",
    detail: "Hand-cast, antique brass finish",
    price: "2200.00", // source display string: "Rs.2,200"
    pricePaisa: 220000,
    categorySlug: "souvenirs",
    image: {
      url: "https://images.unsplash.com/photo-1765470129726-3689336ff549?w=500&h=666&fit=crop&auto=format&q=80",
      alt: "Brass Lotus Incense Holder",
    },
    sortOrder: 7,
    isPublished: true,
    stockQuantity: 10,
  },
  {
    slug: "carved-soapstone-ganesha-figurine",
    sku: "BOD-009",
    name: "Carved Soapstone Ganesha Figurine",
    detail: "Artisan carved, 4-inch, gift-boxed",
    price: "3400.00", // source display string: "Rs.3,400"
    pricePaisa: 340000,
    categorySlug: "souvenirs",
    image: {
      url: "https://images.unsplash.com/photo-1761334859641-139cffff4a47?w=500&h=666&fit=crop&auto=format&q=80",
      alt: "Carved Soapstone Ganesha Figurine",
    },
    sortOrder: 8,
    isPublished: true,
    stockQuantity: 10,
  },
  {
    slug: "ajanta-caves-fine-art-poster-set",
    sku: "BOD-010",
    name: "Ajanta Caves — Fine Art Poster Set",
    detail: "Set of 4, A3 matte, acid-free paper",
    price: "1800.00", // source display string: "Rs.1,800"
    pricePaisa: 180000,
    categorySlug: "paintings",
    image: {
      url: "https://images.unsplash.com/photo-1735605917461-4c1b77a6616f?w=500&h=666&fit=crop&auto=format&q=80",
      alt: "Ajanta Caves — Fine Art Poster Set",
    },
    sortOrder: 9,
    isPublished: true,
    stockQuantity: 10,
  },
  {
    slug: "patachitra-notebook-handmade-paper",
    sku: "BOD-011",
    name: "Patachitra Notebook — Handmade Paper",
    detail: "120 gsm khadi paper, 128 pages",
    price: "620.00", // source display string: "Rs.620"
    pricePaisa: 62000,
    categorySlug: "souvenirs",
    image: {
      url: "https://images.unsplash.com/photo-1759296456443-1cf1a93d173f?w=500&h=666&fit=crop&auto=format&q=80",
      alt: "Patachitra Notebook — Handmade Paper",
    },
    sortOrder: 10,
    isPublished: true,
    stockQuantity: 10,
  },
  {
    slug: "blue-pottery-sake-set",
    sku: "BOD-012",
    name: "Blue Pottery Sake Set",
    detail: "Jaipur blue pottery, 1 jug + 4 cups",
    price: "2900.00", // source display string: "Rs.2,900"
    pricePaisa: 290000,
    categorySlug: "ceramics",
    image: {
      url: "https://images.unsplash.com/photo-1569783721854-33a99b4c0bae?w=500&h=666&fit=crop&auto=format&q=80",
      alt: "Blue Pottery Sake Set",
    },
    sortOrder: 11,
    isPublished: true,
    stockQuantity: 10,
  },
];
