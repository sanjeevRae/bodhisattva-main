import { useState } from "react";
import { motion } from "motion/react";
import { X, Search, ShoppingBag, Heart } from "lucide-react";
import { uimg } from "../components/shared";
import { usePage } from "../lib/api";
import PageRenderer, { PageStatus } from "../components/PageRenderer";

/**
 * Gift Shop — the page's only CMS section is the header band (hero),
 * rendered from GET /api/pages/shop via PageRenderer with the cart-count
 * badge injected from this component's cart state. The category tabs,
 * product grid and quick-preview modal below are ecommerce module
 * surface (mapping §6), not page sections: they stay in this component,
 * operating on the current in-component product data until the Phase 6
 * store APIs land.
 */
export default function GiftShopPage() {
  const { data: page, error } = usePage("shop");
  const [tab, setTab] = useState("all");
  const [wishlist, setWishlist] = useState<number[]>([]);
  const [cart, setCart] = useState<number[]>([]);
  const [preview, setPreview] = useState<number | null>(null);

  const tabs = [
    { key: "all", label: "All" }, { key: "books", label: "Books & Catalogs" },
    { key: "paintings", label: "Paintings" }, { key: "ceramics", label: "Ceramics" },
    { key: "jewelry", label: "Jewelry" }, { key: "souvenirs", label: "Souvenirs" },
  ];
  const products = [
    { id: 1, name: "Gandharan Buddha — Museum Edition Giclée Print", price: "Rs.4,500", cat: "paintings", detail: "A2 Archival Giclée, Limited to 200", imgId: "photo-1775212253782-d223fe035ddc" },
    { id: 2, name: "Silk Road: Art Along the Trade Routes", price: "Rs.2,800", cat: "books", detail: "Hardcover, 320 pp., 280 color plates", imgId: "photo-1760986784449-79e1a6ba616b" },
    { id: 3, name: "Terracotta Dharma Wheel Pendant", price: "Rs.1,200", cat: "jewelry", detail: "Handthrown, kiln-fired, glazed finish", imgId: "photo-1767330855651-238523c49601" },
    { id: 4, name: "Buddhist Manuscript Facsimile Portfolio", price: "Rs.6,500", cat: "books", detail: "12 facsimile plates, limited to 500", imgId: "photo-1765127959724-631190c32e8a" },
    { id: 5, name: "Hand-Painted Miniature — Bodhisattva", price: "Rs.18,000", cat: "paintings", detail: "Original, 6×8 in., natural pigments", imgId: "photo-1563000215-e31a8ddcb2d0" },
    { id: 6, name: "Sancai-Glazed Ceramic Bowl", price: "Rs.850", cat: "ceramics", detail: "Artisan-made, 300ml, dishwasher safe", imgId: "photo-1772617616268-a2f27d194fce" },
    { id: 7, name: "The Bodhisattva Collection — 2026 Catalog", price: "Rs.1,500", cat: "books", detail: "Softcover, 180 pp., bilingual EN/HI", imgId: "photo-1605429523419-d828acb941d9" },
    { id: 8, name: "Brass Lotus Incense Holder", price: "Rs.2,200", cat: "souvenirs", detail: "Hand-cast, antique brass finish", imgId: "photo-1765470129726-3689336ff549" },
    { id: 9, name: "Carved Soapstone Ganesha Figurine", price: "Rs.3,400", cat: "souvenirs", detail: "Artisan carved, 4-inch, gift-boxed", imgId: "photo-1761334859641-139cffff4a47" },
    { id: 10, name: "Ajanta Caves — Fine Art Poster Set", price: "Rs.1,800", cat: "paintings", detail: "Set of 4, A3 matte, acid-free paper", imgId: "photo-1735605917461-4c1b77a6616f" },
    { id: 11, name: "Patachitra Notebook — Handmade Paper", price: "Rs.620", cat: "souvenirs", detail: "120 gsm khadi paper, 128 pages", imgId: "photo-1759296456443-1cf1a93d173f" },
    { id: 12, name: "Blue Pottery Sake Set", price: "Rs.2,900", cat: "ceramics", detail: "Jaipur blue pottery, 1 jug + 4 cups", imgId: "photo-1569783721854-33a99b4c0bae" },
  ];

  const filtered = tab === "all" ? products : products.filter((p) => p.cat === tab);
  const previewItem = products.find((p) => p.id === preview);
  const toggleWishlist = (id: number) => setWishlist((prev) => prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]);
  const toggleCart = (id: number) => setCart((prev) => prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]);

  if (error) return <PageStatus error />;
  if (!page) return <PageStatus />;

  return (
    <div className="pt-16">
      <PageRenderer
        page={page}
        renderSection={(section) => {
          if (section.type !== "hero") return undefined;
          return (
            <div className="bg-secondary border-b border-border py-20">
              <div className="max-w-screen-xl mx-auto px-6 lg:px-10">
                <p className="font-mono text-[0.52rem] tracking-[0.28em] uppercase text-muted-foreground mb-3">{section.config.eyebrow}</p>
                <div className="flex items-end justify-between">
                  <h1 className="font-display text-5xl md:text-6xl font-medium">{section.config.heading}</h1>
                  <div className="flex items-center gap-2 ml-4">
                    <ShoppingBag size={17} className="text-accent" />
                    <span className="font-mono text-sm text-accent font-medium">{cart.length}</span>
                  </div>
                </div>
              </div>
            </div>
          );
        }}
      />

      <div className="border-b border-border">
        <div className="max-w-screen-xl mx-auto px-6 lg:px-10 flex gap-0 overflow-x-auto">
          {tabs.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)} className={`font-mono text-[0.52rem] tracking-widest uppercase px-6 py-4 whitespace-nowrap border-b-2 transition-colors ${tab === t.key ? "border-accent text-accent" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-screen-xl mx-auto px-6 lg:px-10 py-16">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
          {filtered.map((product) => (
            <motion.div key={product.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="group">
              <div className="relative aspect-[3/4] overflow-hidden bg-muted mb-4">
                <img src={uimg(product.imgId, 500, 666)} alt={product.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" />
                <div className="absolute inset-0 bg-foreground/0 group-hover:bg-foreground/8 transition-colors" />
                <div className="absolute top-3 right-3 flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => toggleWishlist(product.id)} className={`w-8 h-8 flex items-center justify-center rounded-full backdrop-blur-sm transition-colors ${wishlist.includes(product.id) ? "bg-accent text-accent-foreground" : "bg-background/80 text-foreground hover:bg-accent hover:text-accent-foreground"}`} aria-label="Wishlist">
                    <Heart size={12} fill={wishlist.includes(product.id) ? "currentColor" : "none"} />
                  </button>
                  <button onClick={() => setPreview(product.id)} className="w-8 h-8 flex items-center justify-center rounded-full bg-background/80 text-foreground hover:bg-foreground hover:text-background backdrop-blur-sm transition-colors" aria-label="Quick preview">
                    <Search size={12} />
                  </button>
                </div>
                <div className="absolute bottom-0 inset-x-0 translate-y-full group-hover:translate-y-0 transition-transform duration-300">
                  <button onClick={() => toggleCart(product.id)} className={`w-full py-3 text-[0.56rem] tracking-[0.2em] uppercase font-sans transition-colors ${cart.includes(product.id) ? "bg-foreground text-primary-foreground" : "bg-accent text-accent-foreground"}`}>
                    {cart.includes(product.id) ? "In Cart ✓" : "Add to Cart"}
                  </button>
                </div>
              </div>
              <h3 className="font-display text-sm font-medium leading-snug mb-1">{product.name}</h3>
              <p className="font-mono text-[0.5rem] tracking-wider text-muted-foreground mb-2">{product.detail}</p>
              <span className="font-display text-base font-medium text-accent">{product.price}</span>
            </motion.div>
          ))}
        </div>
      </div>

      {previewItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6" onClick={() => setPreview(null)}>
          <div className="absolute inset-0 bg-foreground/60 backdrop-blur-sm" />
          <div className="relative bg-background max-w-2xl w-full grid sm:grid-cols-2 overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="aspect-square sm:aspect-auto overflow-hidden bg-muted">
              <img src={uimg(previewItem.imgId, 600, 600)} alt={previewItem.name} className="w-full h-full object-cover" />
            </div>
            <div className="p-8 flex flex-col justify-between">
              <div>
                <button onClick={() => setPreview(null)} className="text-muted-foreground hover:text-foreground mb-6 block"><X size={18} /></button>
                <p className="font-mono text-[0.5rem] tracking-widest uppercase text-accent mb-2">{previewItem.cat}</p>
                <h3 className="font-display text-xl font-medium mb-2">{previewItem.name}</h3>
                <p className="font-mono text-[0.52rem] tracking-wider text-muted-foreground mb-6">{previewItem.detail}</p>
                <span className="font-display text-3xl font-medium text-accent">{previewItem.price}</span>
              </div>
              <button onClick={() => { toggleCart(previewItem.id); setPreview(null); }} className="mt-8 w-full bg-accent text-accent-foreground py-3.5 text-[0.58rem] tracking-[0.2em] uppercase font-sans hover:opacity-90 transition-opacity">
                {cart.includes(previewItem.id) ? "Remove from Cart" : "Add to Cart"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
