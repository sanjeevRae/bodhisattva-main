import { Fragment, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { motion } from "motion/react";
import {
  ArrowRight, BookOpen, Award, Users, Leaf, Star, Play, Download,
  MapPin, Clock, Phone, Mail, Globe, CheckCircle2, ChevronDown, Loader2,
  type LucideIcon,
} from "lucide-react";
import {
  useFeaturedProducts, usePagePathMap, useSiteSettings, settingString,
  type CmsLinkRef, type CmsPage, type CmsSection,
  type ExhibitionRecord, type ModuleData, type NewsArticleRecord,
} from "../lib/api";
import { formatRs, shopRequest, ShopApiError, getShopCsrfToken, setShopCsrfToken } from "../lib/shop";
import { SectionLabel } from "./shared";
import { TurnstileWidget, TURNSTILE_SITE_KEY } from "./Turnstile";

/**
 * PageRenderer — ARCHITECTURE.md §8.2/§8.3 + amendment A10.
 *
 * Maps published CMS sections (GET /api/pages/:slug) to the exact markup
 * the seven page components used to hardcode. Public mode only: this
 * component renders published content; the editor/preview surfaces of
 * Phase 4 are separate components and never share this render path.
 *
 * Content sections render 100% from `config`. Module-reference sections
 * (collection_grid, exhibition_grid, news_listing, foundation_programs,
 * testimonial grids) render their chrome from config and their records
 * from the Phase 5 museum module APIs, passed in via the `moduleData`
 * prop. When module data is absent or a list is empty, the section
 * renders its chrome with no cards — there is no hardcoded fallback.
 * Since Phase 6, featured_products follows the same pattern with the
 * store's product list (GET /api/shop/products, featured order).
 */

// ---------------------------------------------------------------------------
// Module-record display helpers.
// ---------------------------------------------------------------------------

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-08-05" → "05 Aug 2026" (the news cards'/rows' display format). */
function formatNewsDate(iso: string | null): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${m[3]} ${MONTHS_SHORT[Number(m[2]) - 1]} ${m[1]}`;
}

/** "2026-11-30" → "Nov 2026" (the Home exhibition "Until …" line). */
function formatMonthYear(iso: string | null): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})/.exec(iso);
  if (!m) return "";
  return `${MONTHS_SHORT[Number(m[2]) - 1]} ${m[1]}`;
}

/** "{location} · Until {Mon YYYY}", tolerating either part missing. */
function exhibitionLocLine(ex: ExhibitionRecord): string {
  const until = ex.endsOn ? `Until ${formatMonthYear(ex.endsOn)}` : null;
  return [ex.locationLabel, until].filter(Boolean).join(" · ");
}

// ---------------------------------------------------------------------------
// Link plumbing. Section config links reference pages by id; the public
// path for an id comes from the primary menu (see lib/api.getPagePathMap).
// ---------------------------------------------------------------------------

export function CmsLink({ link, className, children }: {
  link: CmsLinkRef;
  className?: string;
  children?: ReactNode;
}) {
  const pathMap = usePagePathMap();
  const navigate = useNavigate();
  const label = children ?? link.label;
  if (link.kind === "url" && link.url) {
    return <a href={link.url} className={className}>{label}</a>;
  }
  const path = link.pageId != null ? pathMap?.get(link.pageId) : undefined;
  if (path) return <Link to={path} className={className}>{label}</Link>;
  // Path map still loading (or unknown id): keep the element and resolve
  // at click time — by then the cached map is available.
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        if (link.pageId != null) {
          const target = pathMap?.get(link.pageId);
          if (target) navigate(target);
        }
      }}
    >
      {label}
    </button>
  );
}

function usePageNavigator() {
  const pathMap = usePagePathMap();
  const navigate = useNavigate();
  return (pageId: number | null | undefined) => {
    if (pageId == null) return;
    const target = pathMap?.get(pageId);
    if (target) navigate(target);
  };
}

const ASPECT_CLASS: Record<string, string> = {
  "4:5": "aspect-[4/5]",
  "4:3": "aspect-[4/3]",
  "16:9": "aspect-video",
  "3:4": "aspect-[3/4]",
  "1:1": "aspect-square",
};

// ---------------------------------------------------------------------------
// Loading / error region (the page shell — Nav/Footer — always renders).
// ---------------------------------------------------------------------------

export function PageStatus({ error = false }: { error?: boolean }) {
  return (
    <div className="pt-16">
      <div className="py-24 max-w-screen-xl mx-auto px-6 lg:px-10 text-center">
        <p className="font-mono text-[0.6rem] tracking-[0.22em] uppercase text-muted-foreground">
          {error ? "Content unavailable — please try again later." : "Loading…"}
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hero — variants: fullscreen (Home), page-banner (Museum/Foundation),
// title-band (Gallery/Shop/News/About).
// ---------------------------------------------------------------------------

export function HeroSection({ section, bannerClass = "h-[62vh] min-h-[460px]" }: {
  section: CmsSection;
  /** page-banner height utilities; Foundation's banner is shorter than
   *  Museum's although both seed the same variant + design (contract gap
   *  noted in docs/phase-3/visual-diff.md). */
  bannerClass?: string;
}) {
  const config = section.config;
  const [loaded, setLoaded] = useState(false);

  if (config.variant === "fullscreen") {
    return (
      <section className="relative h-screen min-h-[640px] flex flex-col justify-end overflow-hidden">
        <div className="absolute inset-0 bg-[#1C1A16]">
          {config.backgroundImage && (
            <img
              src={config.backgroundImage.url}
              alt={config.backgroundImage.alt}
              onLoad={() => setLoaded(true)}
              className={`w-full h-full object-cover transition-opacity duration-1000 ${loaded ? "opacity-60" : "opacity-0"}`}
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-[#0F0D0A]/80 via-[#0F0D0A]/20 to-transparent" />
        </div>
        <div className="relative z-10 max-w-screen-xl mx-auto px-6 lg:px-10 pb-20 w-full">
          <motion.div initial={{ opacity: 0, y: 48 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}>
            <p className="font-mono text-[0.56rem] tracking-[0.32em] uppercase text-white/38 mb-5">{config.eyebrow}</p>
            <h1 className="font-display text-5xl sm:text-6xl md:text-7xl lg:text-[5.5rem] font-medium text-white leading-[0.92] mb-7 max-w-4xl">
              {config.headingLine1}<br /><em className="font-sans italic font-light text-amber-200/90">{config.headingAccent}</em>
            </h1>
            <p className="font-sans text-sm text-white/52 max-w-md leading-relaxed mb-10 font-light">{config.subtext}</p>
            <div className="flex flex-wrap gap-4">
              {config.primaryCta && (
                <CmsLink link={config.primaryCta} className="inline-flex items-center gap-2 bg-amber-800/85 hover:bg-amber-800 text-amber-50 px-7 py-3.5 text-[0.62rem] tracking-[0.18em] uppercase font-sans transition-colors">
                  {config.primaryCta.label} <ArrowRight size={13} />
                </CmsLink>
              )}
              {config.secondaryCta && (
                <CmsLink link={config.secondaryCta} className="inline-flex items-center gap-2 border border-white/28 text-white/75 px-7 py-3.5 text-[0.62rem] tracking-[0.18em] uppercase font-sans hover:border-white hover:text-white transition-all">
                  {config.secondaryCta.label}
                </CmsLink>
              )}
            </div>
          </motion.div>
        </div>
        {config.scrollHint && (
          <div className="absolute bottom-8 right-8 z-10 flex flex-col items-center gap-3">
            <div className="w-px h-14 bg-gradient-to-b from-transparent to-white/18" />
            <span className="font-mono text-[0.46rem] tracking-[0.22em] uppercase text-white/28 [writing-mode:vertical-rl]">{config.scrollHint}</span>
          </div>
        )}
      </section>
    );
  }

  if (config.variant === "page-banner") {
    return (
      <section className={`relative ${bannerClass} flex items-end overflow-hidden mt-16`}>
        {config.backgroundImage && (
          <img src={config.backgroundImage.url} alt={config.backgroundImage.alt} className="absolute inset-0 w-full h-full object-cover" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#0F0D0A]/75 via-[#0F0D0A]/20 to-transparent" />
        <div className="relative z-10 max-w-screen-xl mx-auto px-6 lg:px-10 pb-16 w-full">
          <p className="font-mono text-[0.52rem] tracking-[0.28em] uppercase text-white/38 mb-3">{config.eyebrow}</p>
          <h1 className="font-display text-5xl md:text-6xl font-medium text-white">{config.heading}</h1>
        </div>
      </section>
    );
  }

  // title-band
  return <TitleBand eyebrow={config.eyebrow} heading={config.heading} />;
}

export function TitleBand({ eyebrow, heading }: { eyebrow?: string; heading?: string }) {
  return (
    <div className="bg-secondary py-20 border-b border-border">
      <div className="max-w-screen-xl mx-auto px-6 lg:px-10">
        <p className="font-mono text-[0.52rem] tracking-[0.28em] uppercase text-muted-foreground mb-3">{eyebrow}</p>
        <h1 className="font-display text-5xl md:text-6xl font-medium">{heading}</h1>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Image and text — three current layouts, selected by config extensions:
// `imageMode: "collage2"` (Home H6), `quote` (About A2), `calloutBadge`
// (Home H2); the plain remainder is Foundation F3.
// ---------------------------------------------------------------------------

function ImageTextSection({ section }: { section: CmsSection }) {
  const config = section.config;

  if (config.imageMode === "collage2") {
    const images: { url: string; alt: string }[] = config.images ?? [];
    return (
      <section className="py-28 max-w-screen-xl mx-auto px-6 lg:px-10">
        <div className="grid lg:grid-cols-2 gap-20 items-center">
          <div className="grid grid-cols-2 gap-4">
            {images.map((image, i) => (
              <motion.div
                key={image.url}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.7, delay: i * 0.12 }}
                className={`aspect-square overflow-hidden bg-muted ${i === 1 ? "mt-10" : ""}`}
              >
                <img src={image.url} alt={image.alt} className="w-full h-full object-cover" />
              </motion.div>
            ))}
          </div>
          <div>
            <SectionLabel>{config.sectionLabel}</SectionLabel>
            <h2 className="font-display text-4xl md:text-5xl font-medium leading-[1.08] mb-6">
              {config.headingLine1}<br /><em className="font-sans italic font-light text-accent">{config.headingAccent}</em>
            </h2>
            <p className="font-sans text-sm text-muted-foreground leading-relaxed mb-8 font-light">{config.paragraph}</p>
            {config.stats && (
              <div className="grid grid-cols-3 gap-4 mb-10 py-6 border-y border-border">
                {config.stats.map((s: { value: string; label: string }) => (
                  <div key={s.label}>
                    <div className="font-display text-3xl font-medium text-accent">{s.value}</div>
                    <div className="font-mono text-[0.5rem] tracking-wider uppercase text-muted-foreground mt-1 leading-relaxed">{s.label}</div>
                  </div>
                ))}
              </div>
            )}
            {config.cta && (
              <CmsLink link={config.cta} className="inline-flex items-center gap-2 bg-accent text-accent-foreground px-7 py-3.5 text-[0.62rem] tracking-[0.18em] uppercase font-sans hover:opacity-90 transition-opacity">
                {config.cta.label} <ArrowRight size={13} />
              </CmsLink>
            )}
          </div>
        </div>
      </section>
    );
  }

  if (config.quote) {
    const paragraphs: string[] = config.paragraphs ?? [];
    return (
      <section className="py-24 max-w-screen-xl mx-auto px-6 lg:px-10">
        <div className="grid lg:grid-cols-2 gap-20 items-start">
          <div>
            <SectionLabel>{config.sectionLabel}</SectionLabel>
            <h2 className="font-display text-3xl md:text-4xl font-medium mb-8 leading-[1.1]">
              {config.headingLine1}<br /><em className="font-sans italic font-light text-accent">{config.headingAccent}</em>
            </h2>
            <div className="space-y-5">
              {paragraphs.map((p, i) => (
                <p key={i} className="font-sans text-sm text-muted-foreground leading-relaxed font-light">{p}</p>
              ))}
            </div>
          </div>
          <div className="space-y-5">
            {config.image && (
              <div className="aspect-video overflow-hidden bg-muted">
                <img src={config.image.url} alt={config.image.alt} className="w-full h-full object-cover" />
              </div>
            )}
            <div className="bg-foreground text-primary-foreground p-8">
              <p className="font-sans text-base italic font-light leading-relaxed mb-4">&ldquo;{config.quote.text}&rdquo;</p>
              <span className="font-mono text-[0.5rem] tracking-widest uppercase text-accent">{config.quote.attribution}</span>
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (config.calloutBadge) {
    const paragraphs: string[] = config.paragraphs ?? [];
    return (
      <section className="py-28 max-w-screen-xl mx-auto px-6 lg:px-10">
        <div className="grid lg:grid-cols-2 gap-20 items-center">
          <motion.div initial={{ opacity: 0, x: -32 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}>
            <SectionLabel>{config.sectionLabel}</SectionLabel>
            <h2 className="font-display text-4xl md:text-5xl font-medium leading-[1.08] mb-8">
              {config.headingLine1}<br /><em className="font-sans italic font-light text-accent">{config.headingAccent}</em>
            </h2>
            {paragraphs.map((p, i) => (
              <p key={i} className={`font-sans text-sm text-muted-foreground leading-relaxed font-light ${i < paragraphs.length - 1 ? "mb-5" : "mb-10"}`}>{p}</p>
            ))}
            {config.cta && (
              <CmsLink link={config.cta} className="inline-flex items-center gap-2 text-[0.62rem] tracking-[0.18em] uppercase font-sans border-b border-foreground pb-0.5 hover:text-accent hover:border-accent transition-colors">
                {config.cta.label} <ArrowRight size={12} />
              </CmsLink>
            )}
          </motion.div>
          <motion.div initial={{ opacity: 0, x: 32 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1], delay: 0.1 }} className="relative">
            {config.image && (
              <div className={`${ASPECT_CLASS[config.imageAspect as string] ?? "aspect-[4/5]"} overflow-hidden bg-muted`}>
                <img src={config.image.url} alt={config.image.alt} className="w-full h-full object-cover hover:scale-105 transition-transform duration-700" />
              </div>
            )}
            <div className="absolute -bottom-6 -left-6 bg-accent text-accent-foreground px-8 py-6">
              <div className="font-display text-4xl font-medium">{config.calloutBadge.value}</div>
              <div className="font-mono text-[0.5rem] tracking-[0.2em] uppercase opacity-80 mt-1">{config.calloutBadge.label}</div>
            </div>
            <div className="absolute -top-5 -right-5 w-20 h-20 border border-accent/30" />
          </motion.div>
        </div>
      </section>
    );
  }

  // Plain variant (Foundation F3).
  const paragraphs: string[] = config.paragraphs ?? [];
  return (
    <section className="py-24 max-w-screen-xl mx-auto px-6 lg:px-10">
      <div className="grid lg:grid-cols-2 gap-20 items-center">
        <div>
          <SectionLabel>{config.sectionLabel}</SectionLabel>
          <h2 className="font-display text-4xl md:text-5xl font-medium leading-[1.08] mb-8">
            {config.headingLine1}<br /><em className="font-sans italic font-light text-accent">{config.headingAccent}</em>
          </h2>
          {paragraphs.map((p, i) => (
            <p key={i} className={`font-sans text-sm text-muted-foreground leading-relaxed font-light ${i < paragraphs.length - 1 ? "mb-5" : ""}`}>{p}</p>
          ))}
        </div>
        {config.image && (
          <div className={`${ASPECT_CLASS[config.imageAspect as string] ?? "aspect-[4/3]"} overflow-hidden bg-muted`}>
            <img src={config.image.url} alt={config.image.alt} className="w-full h-full object-cover" />
          </div>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Rich text — Museum overview (+ facts extension) and the About
// two-column statements variant. Paragraphs/bodies are server-sanitized
// HTML (sanitized at save in the CMS registry), rendered as HTML.
// ---------------------------------------------------------------------------

function RichTextSection({ section }: { section: CmsSection }) {
  const config = section.config;

  if (config.columns) {
    const columns: { label: string; body: string; emphasis: "display" | "body" }[] = config.columns;
    return (
      <section className="bg-secondary border-y border-border">
        <div className="max-w-screen-xl mx-auto px-6 lg:px-10">
          <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border">
            {columns.map((col, i) => (
              <div key={col.label} className={i === 0 ? "py-14 md:pr-14" : "py-14 md:pl-14"}>
                <span className="font-mono text-[0.52rem] tracking-[0.22em] uppercase text-accent block mb-6">{col.label}</span>
                {col.emphasis === "display" ? (
                  <p className="font-display text-2xl md:text-3xl font-medium leading-[1.25]" dangerouslySetInnerHTML={{ __html: col.body }} />
                ) : (
                  <p className="font-sans text-sm text-muted-foreground leading-relaxed font-light" dangerouslySetInnerHTML={{ __html: col.body }} />
                )}
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  const paragraphs: string[] = config.paragraphs ?? [];
  const facts: { label: string; value: string }[] = config.facts ?? [];
  return (
    <section className="py-24 max-w-screen-xl mx-auto px-6 lg:px-10">
      <div className="grid lg:grid-cols-5 gap-16">
        <div className="lg:col-span-3">
          <SectionLabel>{config.sectionLabel}</SectionLabel>
          <h2 className="font-display text-3xl md:text-4xl font-medium mb-8 leading-[1.1]">
            {config.headingLine1}<br /><em className="font-sans italic font-light text-accent">{config.headingAccent}</em>
          </h2>
          {paragraphs.map((p, i) => (
            <p
              key={i}
              className={`font-sans text-sm text-muted-foreground leading-relaxed font-light ${i < paragraphs.length - 1 ? "mb-5" : ""}`}
              dangerouslySetInnerHTML={{ __html: p }}
            />
          ))}
        </div>
        <div className="lg:col-span-2 space-y-5">
          {facts.map((fact) => (
            <div key={fact.label} className="flex items-end justify-between border-b border-border pb-4">
              <span className="font-mono text-[0.56rem] tracking-widest uppercase text-muted-foreground">{fact.label}</span>
              <span className="font-display text-xl font-medium">{fact.value}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Statistics (Foundation F2)
// ---------------------------------------------------------------------------

function StatisticsSection({ section }: { section: CmsSection }) {
  const items: { value: string; label: string }[] = section.config.items ?? [];
  return (
    <section className="border-y border-border bg-secondary/60">
      <div className="max-w-screen-xl mx-auto px-6 lg:px-10 py-16">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-0 md:divide-x divide-border">
          {items.map((s) => (
            <motion.div key={s.label} initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6 }} className="text-center md:px-8">
              <div className="font-display text-4xl md:text-5xl font-medium text-accent mb-2">{s.value}</div>
              <div className="font-mono text-[0.52rem] tracking-widest uppercase text-muted-foreground">{s.label}</div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Testimonials — single-featured (Home H5) and grid (Foundation F5).
// Records come from the testimonials pool via moduleData (GET
// /api/foundation). Grid mode filters by the config selection's context
// ("context:foundation"); single-featured prefers the pool's
// context=curator record and falls back to the testimonial embedded in
// config (the registry schema's sanctioned alternative form).
// ---------------------------------------------------------------------------

function TestimonialsSection({ section, moduleData }: { section: CmsSection; moduleData?: ModuleData }) {
  const config = section.config;
  const records = moduleData?.foundation?.testimonials ?? [];

  if (config.displayMode === "grid") {
    const selection = typeof config.selection === "string" ? config.selection : "";
    const context = selection.startsWith("context:") ? selection.slice("context:".length) : "foundation";
    const items = records.filter((t) => t.context === context);
    return (
      <section className="py-24 max-w-screen-xl mx-auto px-6 lg:px-10">
        <SectionLabel>{config.sectionLabel}</SectionLabel>
        <h2 className="font-display text-3xl md:text-4xl font-medium mb-12">{config.heading}</h2>
        <div className="grid md:grid-cols-3 gap-6">
          {items.map((s) => (
            <div key={s.id} className="bg-secondary p-8 border border-border">
              <blockquote className="font-sans text-sm italic font-light leading-relaxed mb-6 text-foreground/80">&ldquo;{s.quote}&rdquo;</blockquote>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full overflow-hidden bg-muted shrink-0">
                  {s.image && <img src={s.image.url} alt={s.authorName} className="w-full h-full object-cover" />}
                </div>
                <div>
                  <div className="font-sans text-xs font-medium">{s.authorName}</div>
                  <div className="font-mono text-[0.46rem] tracking-wider text-muted-foreground uppercase">{s.authorRole}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    );
  }

  const fromPool = records.find((t) => t.context === "curator");
  const t = (fromPool
    ? { quote: fromPool.quote, authorName: fromPool.authorName, authorRole: fromPool.authorRole ?? "" }
    : config.testimonial) as { quote: string; authorName: string; authorRole: string } | undefined;
  return (
    <section className="bg-foreground text-primary-foreground py-24">
      <div className="max-w-screen-lg mx-auto px-6 text-center">
        <SectionLabel light>{config.sectionLabel}</SectionLabel>
        {t && (
          <>
            <blockquote className="font-sans text-2xl md:text-3xl lg:text-[2rem] font-light italic leading-[1.4] mb-8 text-primary-foreground/88">
              &ldquo;{t.quote}&rdquo;
            </blockquote>
            <div className="flex items-center justify-center gap-4">
              <div className="w-10 h-px bg-accent" />
              <span className="font-mono text-[0.52rem] tracking-[0.25em] uppercase text-primary-foreground/38">{t.authorName} · {t.authorRole}</span>
              <div className="w-10 h-px bg-accent" />
            </div>
          </>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// History timeline (Museum M3)
// ---------------------------------------------------------------------------

function HistoryTimelineSection({ section }: { section: CmsSection }) {
  const config = section.config;
  const items: { yearLabel: string; text: string }[] = config.items ?? [];
  return (
    <section className="bg-secondary py-24 border-y border-border">
      <div className="max-w-screen-xl mx-auto px-6 lg:px-10">
        <SectionLabel>{config.sectionLabel}</SectionLabel>
        <h2 className="font-display text-3xl font-medium mb-14">{config.heading}</h2>
        <div className="relative overflow-x-auto pb-2">
          <div className="flex min-w-[680px]">
            {items.map((item, i) => (
              <div key={item.yearLabel} className="flex-1 relative pl-5 pr-4">
                <div className="absolute left-0 top-0 w-3 h-3 rounded-full bg-accent border-2 border-secondary z-10" />
                {i < items.length - 1 && <div className="absolute left-3 top-1.5 h-px bg-border" style={{ width: "calc(100% + 0.5rem)" }} />}
                <div className="pt-8">
                  <span className="font-display text-2xl font-medium text-accent block mb-3">{item.yearLabel}</span>
                  <p className="font-sans text-xs text-muted-foreground leading-relaxed font-light">{item.text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Directory / floor guide (Museum M5)
// ---------------------------------------------------------------------------

function DirectorySection({ section }: { section: CmsSection }) {
  const config = section.config;
  const groups: { title: string; items: string[] }[] = config.groups ?? [];
  return (
    <section className="max-w-screen-xl mx-auto px-6 lg:px-10 pb-24">
      <SectionLabel>{config.sectionLabel}</SectionLabel>
      <h2 className="font-display text-3xl font-medium mb-8">{config.heading}</h2>
      <div className="border border-border bg-secondary">
        <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-border">
          {groups.map((fl) => (
            <div key={fl.title} className="p-7">
              <div className="font-mono text-[0.52rem] tracking-widest uppercase text-accent mb-4">{fl.title}</div>
              {fl.items.map((room) => (
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
  );
}

// ---------------------------------------------------------------------------
// CTA band (Museum M6 — currently seeded hidden; implemented so the type
// renders the moment the client supplies a tour URL and it is published)
// ---------------------------------------------------------------------------

function CtaSection({ section }: { section: CmsSection }) {
  const config = section.config;
  return (
    <section className="bg-foreground text-primary-foreground py-20">
      <div className="max-w-screen-xl mx-auto px-6 lg:px-10 flex flex-col md:flex-row items-center justify-between gap-10">
        <div>
          <SectionLabel light>{config.sectionLabel}</SectionLabel>
          <h2 className="font-display text-3xl md:text-4xl font-medium mb-3">{config.heading}</h2>
          <p className="font-sans text-sm text-primary-foreground/48 max-w-lg font-light leading-relaxed">{config.text}</p>
        </div>
        {config.cta && (
          <CmsLink link={config.cta} className="shrink-0 flex items-center gap-3 bg-accent text-accent-foreground px-8 py-4 text-[0.6rem] tracking-[0.2em] uppercase font-sans hover:opacity-90 transition-opacity">
            <Play size={15} /> {config.cta.label}
          </CmsLink>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Partner list (Foundation F6)
// ---------------------------------------------------------------------------

function PartnerListSection({ section }: { section: CmsSection }) {
  const config = section.config;
  const items: { name: string }[] = config.items ?? [];
  return (
    <section className="bg-secondary py-14 border-t border-border">
      <div className="max-w-screen-xl mx-auto px-6 lg:px-10 text-center">
        <p className="font-mono text-[0.52rem] tracking-[0.25em] uppercase text-muted-foreground mb-8">{config.heading}</p>
        <div className="flex flex-wrap justify-center gap-x-10 gap-y-3 items-center">
          {items.map((p) => (
            <span key={p.name} className="font-display text-sm font-medium text-muted-foreground hover:text-foreground transition-colors cursor-default">{p.name}</span>
          ))}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Team members (About A4 — members are content, in config)
// ---------------------------------------------------------------------------

function TeamMembersSection({ section }: { section: CmsSection }) {
  const config = section.config;
  const members: { name: string; role: string; department: string; photo?: { url: string; alt: string } }[] = config.members ?? [];
  return (
    <section className="py-24 max-w-screen-xl mx-auto px-6 lg:px-10">
      <SectionLabel>{config.sectionLabel}</SectionLabel>
      <h2 className="font-display text-3xl md:text-4xl font-medium mb-14">{config.heading}</h2>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8">
        {members.map((member, i) => (
          <motion.div key={`${member.name}-${member.role}`} initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5, delay: i * 0.07 }}>
            <div className="aspect-square bg-secondary border border-border mb-4 relative overflow-hidden">
              {member.photo ? (
                <img src={member.photo.url} alt={member.photo.alt} className="absolute inset-0 w-full h-full object-cover" />
              ) : (
                <div className="absolute inset-0 flex items-end p-5">
                  <span className="font-display text-5xl font-medium text-muted/60 leading-none">
                    {member.name.split(" ").map((w) => w[0]).join("").slice(0, 2)}
                  </span>
                </div>
              )}
            </div>
            <span className="font-mono text-[0.48rem] tracking-widest uppercase text-accent block mb-1">{member.department}</span>
            <h3 className="font-display text-sm font-medium mb-1">{member.name}</h3>
            <p className="font-sans text-xs text-muted-foreground font-light">{member.role}</p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Collection grid (module-reference) — Home featured cards (H3) and the
// Museum category browser (M4). Chrome from config; records from
// GET /api/collections via moduleData. The Museum filter buttons filter
// by record category (Phase 5 — this fixes Audit D1, where the buttons
// set state but the grid always rendered every record).
// ---------------------------------------------------------------------------

function CollectionGridSection({ section, pageSlug, moduleData }: { section: CmsSection; pageSlug: string; moduleData?: ModuleData }) {
  const config = section.config;
  const goToPage = usePageNavigator();
  const [activeFilter, setActiveFilter] = useState("All");
  const records = moduleData?.collections ?? [];

  if (pageSlug === "museum") {
    const filters = [
      "All",
      ...Array.from(new Set(records.map((c) => c.category).filter((c): c is string => !!c))),
    ];
    const visible = activeFilter === "All" ? records : records.filter((c) => c.category === activeFilter);
    return (
      <section className="py-24 max-w-screen-xl mx-auto px-6 lg:px-10">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6 mb-10">
          <div><SectionLabel>{config.sectionLabel}</SectionLabel><h2 className="font-display text-3xl md:text-4xl font-medium">{config.heading}</h2></div>
          <div className="flex gap-1 flex-wrap">
            {filters.map((f) => (
              <button key={f} onClick={() => setActiveFilter(f)} className={`font-mono text-[0.52rem] tracking-widest uppercase px-3.5 py-2 border transition-colors ${activeFilter === f ? "border-accent bg-accent text-accent-foreground" : "border-border text-muted-foreground hover:border-foreground hover:text-foreground"}`}>{f}</button>
            ))}
          </div>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {visible.map((col, i) => (
            <motion.div key={col.id} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5, delay: i * 0.07 }} className="group cursor-pointer">
              <div className="aspect-[4/3] overflow-hidden bg-muted mb-3">
                {col.image && <img src={col.image.url} alt={col.image.alt} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" />}
              </div>
              <div className="flex items-center justify-between">
                <h3 className="font-display text-base font-medium group-hover:text-accent transition-colors">{col.name}</h3>
                {col.worksCountLabel && <span className="font-mono text-[0.5rem] tracking-wider text-muted-foreground">{col.worksCountLabel}</span>}
              </div>
            </motion.div>
          ))}
        </div>
      </section>
    );
  }

  // Home featured collections: the pool's featured records, in order.
  const limit = typeof config.limit === "number" ? config.limit : 3;
  const featured = records.filter((c) => c.isFeatured).slice(0, limit);
  return (
    <section className="bg-secondary py-24">
      <div className="max-w-screen-xl mx-auto px-6 lg:px-10">
        <div className="flex items-end justify-between mb-12">
          <div><SectionLabel>{config.sectionLabel}</SectionLabel><h2 className="font-display text-3xl md:text-4xl font-medium">{config.heading}</h2></div>
          {config.viewAllLink && (
            <CmsLink link={config.viewAllLink} className="hidden md:inline-flex items-center gap-2 text-[0.6rem] tracking-[0.18em] uppercase font-sans text-muted-foreground hover:text-accent transition-colors">
              {config.viewAllLink.label} <ArrowRight size={12} />
            </CmsLink>
          )}
        </div>
        <div className="grid md:grid-cols-3 gap-6">
          {featured.map((col, i) => (
            <motion.div key={col.id} initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6, delay: i * 0.1 }} className="group cursor-pointer" onClick={() => goToPage(config.viewAllLink?.pageId)}>
              <div className="aspect-[3/4] overflow-hidden bg-muted mb-4">
                {col.image && <img src={col.image.url} alt={col.image.alt} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" />}
              </div>
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-display text-lg font-medium mb-1 group-hover:text-accent transition-colors">{col.name}</h3>
                  {col.periodLabel && <p className="font-mono text-[0.52rem] tracking-widest uppercase text-muted-foreground">{col.periodLabel}</p>}
                </div>
                {col.worksCountLabel && <span className="font-mono text-[0.52rem] tracking-wider text-accent mt-1">{col.worksCountLabel}</span>}
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Exhibition grid (module-reference) — Home featured-split (H4) and the
// Gallery masonry archive (G3, with the G2 filter bar as its chrome).
// ---------------------------------------------------------------------------

function ExhibitionGridSection({ section, moduleData }: { section: CmsSection; moduleData?: ModuleData }) {
  const config = section.config;
  const goToPage = usePageNavigator();
  const [year, setYear] = useState("all");
  const [cat, setCat] = useState("all");
  const records = moduleData?.exhibitions ?? [];

  if (config.layout === "masonry") {
    // Filter options are derived from the records (mapping §G2),
    // reproducing the Phase 3 lists exactly: years 2026→2023 (the year
    // of each record's startsOn, first-appearance order), the four
    // categories.
    const years = ["all", ...Array.from(new Set(records.map((e) => e.startsOn?.slice(0, 4)).filter((y): y is string => !!y)))];
    const cats = ["all", ...Array.from(new Set(records.map((e) => e.category).filter((c): c is string => !!c)))];
    const filtered = records.filter((e) => (year === "all" || e.startsOn?.startsWith(year)) && (cat === "all" || e.category === cat));
    return (
      <>
        <div className="border-b border-border sticky top-16 bg-background/96 backdrop-blur-md z-30">
          <div className="max-w-screen-xl mx-auto px-6 lg:px-10 py-3.5 flex flex-wrap gap-x-10 gap-y-2.5">
            {config.enableYearFilter && (
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
            )}
            {config.enableCategoryFilter && (
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
            )}
          </div>
        </div>

        <div className="max-w-screen-xl mx-auto px-6 lg:px-10 py-16">
          {filtered.length === 0 ? (
            <p className="text-center py-24 font-sans text-sm text-muted-foreground">No exhibitions match your selection.</p>
          ) : (
            <div className="columns-1 sm:columns-2 lg:columns-3 gap-6">
              {filtered.map((ex, i) => (
                <motion.div key={ex.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: i * 0.06 }} className="break-inside-avoid mb-6 group cursor-pointer">
                  <div className={`overflow-hidden bg-muted ${ex.coverAspect === "tall" ? "aspect-[3/4]" : "aspect-[4/3]"}`}>
                    {ex.image && <img src={ex.image.url} alt={ex.image.alt} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" />}
                  </div>
                  <div className="pt-4 pb-6 border-b border-border">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-mono text-[0.5rem] tracking-widest uppercase text-accent">{ex.category}</span>
                      <span className="font-mono text-[0.5rem] tracking-wider text-muted-foreground">{ex.dateLabel}</span>
                    </div>
                    <h3 className="font-display text-lg font-medium mb-1.5 group-hover:text-accent transition-colors">{ex.title}</h3>
                    <p className="font-sans text-xs text-muted-foreground leading-relaxed mb-2 font-light">{ex.description}</p>
                    {ex.curator && <p className="font-mono text-[0.48rem] tracking-widest uppercase text-muted-foreground/55">Curator: {ex.curator}</p>}
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </>
    );
  }

  // featured-split (Home H4): the featured current record large, the
  // remaining current records as the side list (config limit includes
  // the featured one). The "Until …" line derives from each record's
  // endsOn. With no current records the section renders chrome only.
  const current = records.filter((e) => e.status === "current");
  const featured = current.find((e) => e.isFeatured) ?? current[0];
  if (!featured) {
    return (
      <section className="py-28 max-w-screen-xl mx-auto px-6 lg:px-10">
        <SectionLabel>{config.sectionLabel}</SectionLabel>
      </section>
    );
  }
  const list = current
    .filter((e) => e.id !== featured.id)
    .slice(0, Math.max(0, (typeof config.limit === "number" ? config.limit : 4) - 1));
  return (
    <section className="py-28 max-w-screen-xl mx-auto px-6 lg:px-10">
      <SectionLabel>{config.sectionLabel}</SectionLabel>
      <div className="grid lg:grid-cols-5 border border-border">
        <div className="lg:col-span-3 relative aspect-[16/10] overflow-hidden bg-muted">
          {featured.image && <img src={featured.image.url} alt={featured.image.alt} className="w-full h-full object-cover hover:scale-105 transition-transform duration-700" />}
          <div className="absolute inset-0 bg-gradient-to-t from-[#1C1A16]/70 via-transparent to-transparent" />
          <div className="absolute bottom-8 left-8 right-8">
            <span className="font-mono text-[0.52rem] tracking-widest uppercase text-white/48 block mb-2">{exhibitionLocLine(featured)}</span>
            <h3 className="font-display text-2xl md:text-3xl text-white font-medium">{featured.title}</h3>
          </div>
        </div>
        <div className="lg:col-span-2 flex flex-col divide-y divide-border border-l border-border">
          {list.map((ex) => (
            <div key={ex.id} className="p-7 group cursor-pointer hover:bg-secondary/60 transition-colors" onClick={() => goToPage(config.viewAllLink?.pageId)}>
              <span className="font-mono text-[0.5rem] tracking-widest uppercase text-accent block mb-2">{exhibitionLocLine(ex)}</span>
              <h3 className="font-display text-base font-medium mb-2 group-hover:text-accent transition-colors">{ex.title}</h3>
              <p className="font-sans text-xs text-muted-foreground leading-relaxed font-light">{ex.description}</p>
            </div>
          ))}
          <div className="p-7">
            {config.viewAllLink && (
              <CmsLink link={config.viewAllLink} className="inline-flex items-center gap-2 text-[0.6rem] tracking-[0.18em] uppercase font-sans border-b border-foreground pb-0.5 hover:text-accent hover:border-accent transition-colors">
                {config.viewAllLink.label} <ArrowRight size={12} />
              </CmsLink>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// News listing (module-reference) — Home cards (H7) and News rows (N2).
// The rows renderer is exported: the News page drives it with its search
// state (the search box itself lives in the page's hero band).
// ---------------------------------------------------------------------------

export function NewsRows({ articles, query }: { articles: NewsArticleRecord[]; query: string }) {
  // Records arrive pre-filtered from the API (the News page's search
  // drives GET /api/news?search=); `query` is only used for the
  // empty-state message. The Download PDF / Read Article buttons keep
  // their Phase 3 inert rendering unless the record carries a document
  // or external URL, in which case they open it.
  return (
    <div className="max-w-screen-xl mx-auto px-6 lg:px-10 py-12">
      {articles.length === 0 && query && (
        <p className="py-16 text-center font-sans text-sm text-muted-foreground">No results for &ldquo;{query}&rdquo;</p>
      )}
      <div className="divide-y divide-border">
        {articles.map((article) => (
          <article key={article.id} className="grid md:grid-cols-6 gap-6 py-10 group cursor-pointer hover:bg-secondary/40 -mx-6 lg:-mx-10 px-6 lg:px-10 transition-colors">
            <div className="md:col-span-1">
              <span className={`font-mono text-[0.5rem] tracking-widest uppercase block mb-1 ${article.colorToken ?? "text-accent"}`}>{article.categoryName}</span>
              <span className="font-mono text-[0.5rem] tracking-wider text-muted-foreground block mb-2">{formatNewsDate(article.publishedDate)}</span>
              <span className="font-sans text-xs font-medium text-foreground block">{article.sourceName}</span>
            </div>
            <div className="md:col-span-5">
              <h3 className="font-display text-xl font-medium mb-3 group-hover:text-accent transition-colors leading-snug">{article.title}</h3>
              <p className="font-sans text-xs text-muted-foreground leading-relaxed mb-4 font-light max-w-2xl">{article.summary}</p>
              <div className="flex items-center gap-6">
                <button
                  className="flex items-center gap-2 font-mono text-[0.5rem] tracking-widest uppercase text-muted-foreground hover:text-accent transition-colors"
                  onClick={() => {
                    if (article.documentUrl) window.open(article.documentUrl, "_blank", "noopener");
                  }}
                >
                  <Download size={11} /> Download PDF
                </button>
                <button
                  className="flex items-center gap-2 font-mono text-[0.5rem] tracking-widest uppercase text-muted-foreground hover:text-accent transition-colors"
                  onClick={() => {
                    if (article.externalUrl) window.open(article.externalUrl, "_blank", "noopener");
                  }}
                >
                  Read Article <ArrowRight size={11} />
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function NewsListingSection({ section, moduleData }: { section: CmsSection; moduleData?: ModuleData }) {
  const config = section.config;
  const goToPage = usePageNavigator();

  if (config.layout === "rows") {
    return <NewsRows articles={moduleData?.news?.items ?? []} query="" />;
  }

  // cards (Home H7): the latest records, newest first (API order).
  const limit = typeof config.limit === "number" ? config.limit : 3;
  const items = (moduleData?.news?.items ?? []).slice(0, limit);
  return (
    <section className="bg-secondary py-24">
      <div className="max-w-screen-xl mx-auto px-6 lg:px-10">
        <div className="flex items-end justify-between mb-12">
          <div><SectionLabel>{config.sectionLabel}</SectionLabel><h2 className="font-display text-3xl md:text-4xl font-medium">{config.heading}</h2></div>
          {config.viewAllLink && (
            <CmsLink link={config.viewAllLink} className="hidden md:inline-flex items-center gap-2 text-[0.6rem] tracking-[0.18em] uppercase font-sans text-muted-foreground hover:text-accent transition-colors">
              {config.viewAllLink.label} <ArrowRight size={12} />
            </CmsLink>
          )}
        </div>
        <div className="grid md:grid-cols-3 gap-0 border-t border-border">
          {items.map((item, i) => (
            <article key={item.id} onClick={() => goToPage(config.viewAllLink?.pageId)} className={`pt-8 pb-8 pr-8 group cursor-pointer ${i > 0 ? "pl-8 border-l border-border" : ""}`}>
              <div className="flex items-center justify-between mb-3">
                <span className="font-mono text-[0.5rem] tracking-widest uppercase text-accent">{item.categoryName}</span>
                <span className="font-mono text-[0.5rem] tracking-wider text-muted-foreground">{formatNewsDate(item.publishedDate)}</span>
              </div>
              <h3 className="font-display text-lg font-medium leading-snug mb-2 group-hover:text-accent transition-colors">{item.title}</h3>
              <p className="font-sans text-xs text-muted-foreground">{item.sourceName}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Foundation programs (module-reference, F4)
// ---------------------------------------------------------------------------

const PROGRAM_ICONS: Record<string, LucideIcon> = { BookOpen, Award, Users, Leaf };

function FoundationProgramsSection({ section, moduleData }: { section: CmsSection; moduleData?: ModuleData }) {
  const config = section.config;
  const items = moduleData?.foundation?.programs ?? [];
  const cols = 2;
  const lastRowStart = items.length - (items.length % cols === 0 ? cols : items.length % cols);
  return (
    <section className="bg-secondary py-24 border-y border-border">
      <div className="max-w-screen-xl mx-auto px-6 lg:px-10">
        <SectionLabel>{config.sectionLabel}</SectionLabel>
        <h2 className="font-display text-3xl md:text-4xl font-medium mb-14">{config.heading}</h2>
        <div className="grid md:grid-cols-2 gap-0 border border-border">
          {items.map((p, i) => {
            const Icon = PROGRAM_ICONS[p.iconName ?? ""] ?? BookOpen;
            return (
              <div key={p.id} className={`p-10 border-border ${i % cols === 0 ? "border-r" : ""} ${i < lastRowStart ? "border-b" : ""}`}>
                <div className="flex items-start gap-4 mb-6">
                  <div className="p-3 bg-accent/10 shrink-0"><Icon size={18} className="text-accent" /></div>
                  <div>
                    <span className="font-mono text-[0.5rem] tracking-widest uppercase text-accent block mb-1">{p.categoryLabel}</span>
                    <h3 className="font-display text-xl font-medium">{p.name}</h3>
                  </div>
                </div>
                <p className="font-sans text-sm text-muted-foreground leading-relaxed mb-5 font-light">{p.description}</p>
                {p.impactMetric && (
                  <div className="flex items-center gap-2">
                    <Star size={11} className="text-accent fill-accent" />
                    <span className="font-mono text-[0.52rem] tracking-wider text-accent uppercase">{p.impactMetric}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Contact information + contact form (About A5). In the current page the
// two sections compose ONE dark band (two columns of a single section);
// PageRenderer pairs them (see renderSection below). Values come from
// site settings (mapping §A5: single source shared with the footer).
// ---------------------------------------------------------------------------

const CONTACT_FIELD_META: Record<string, { Icon: LucideIcon; label: string; settingKey: string }> = {
  address: { Icon: MapPin, label: "Address", settingKey: "contact_address" },
  openingHours: { Icon: Clock, label: "Hours", settingKey: "opening_hours" },
  phone: { Icon: Phone, label: "Phone", settingKey: "contact_phone" },
  email: { Icon: Mail, label: "Email", settingKey: "contact_email" },
  website: { Icon: Globe, label: "Web", settingKey: "website" },
};

function ContactInformationColumn({ section }: { section: CmsSection }) {
  const config = section.config;
  const { data: settings } = useSiteSettings();
  const fields: string[] = config.fields ?? [];
  return (
    <div>
      <SectionLabel light>{config.sectionLabel}</SectionLabel>
      <h2 className="font-display text-3xl md:text-4xl font-medium mb-10">{config.heading}</h2>
      <div className="space-y-7">
        {fields.map((field) => {
          const meta = CONTACT_FIELD_META[field];
          if (!meta) return null;
          const raw = settings?.[meta.settingKey];
          const value = Array.isArray(raw) ? raw.join("\n") : typeof raw === "string" ? raw : "";
          const Icon = meta.Icon;
          return (
            <div key={field} className="flex items-start gap-4">
              <Icon size={15} className="text-accent mt-0.5 shrink-0" />
              <div>
                <span className="font-mono text-[0.48rem] tracking-widest uppercase text-primary-foreground/33 block mb-0.5">{meta.label}</span>
                <span className="font-sans text-sm text-primary-foreground/65 font-light whitespace-pre-line">{value}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

type ContactStatus = "idle" | "submitting" | "success" | "error";

const CONTACT_TEXT_FIELDS = ["firstName", "lastName", "email"] as const;

function ContactFormColumn({ section }: { section: CmsSection }) {
  const config = section.config;
  const fields: { name: string; label: string }[] = config.fields ?? [];
  const byName = new Map(fields.map((f) => [f.name, f.label]));
  const subjectOptions: string[] = config.subjectOptions ?? [];
  const turnstileEnabled = Boolean(TURNSTILE_SITE_KEY);

  const [values, setValues] = useState({
    firstName: "",
    lastName: "",
    email: "",
    subject: "",
    message: "",
    website: "",
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [status, setStatus] = useState<ContactStatus>("idle");
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileReset, setTurnstileReset] = useState(0);
  // Synchronous submit lock: React state (`busy`) has not applied when a
  // second click lands in the same task, so the state check alone lets a
  // rapid double-click submit twice (QA defect D-1). The ref flips before
  // the first await and is released on every failure path via failWith.
  const submitLock = useRef(false);

  const busy = status === "submitting";
  const inputClass =
    "w-full bg-primary-foreground/8 border border-primary-foreground/15 px-4 py-3.5 text-sm font-sans focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/40 text-primary-foreground placeholder:text-primary-foreground/25 disabled:opacity-60";
  const labelClass =
    "font-mono text-[0.48rem] tracking-widest uppercase text-primary-foreground/55 block mb-1.5";
  const errorClass = "text-[#f0a198] text-xs font-sans mt-1.5";

  const setField = (name: keyof typeof values) => (e: { target: { value: string } }) => {
    setValues((v) => ({ ...v, [name]: e.target.value }));
    setFieldErrors((errs) => {
      if (!errs[name]) return errs;
      const next = { ...errs };
      delete next[name];
      return next;
    });
  };

  const validate = (): Record<string, string> => {
    const errs: Record<string, string> = {};
    if (!values.firstName.trim()) errs.firstName = "Please enter your first name.";
    if (!values.lastName.trim()) errs.lastName = "Please enter your last name.";
    if (!values.email.trim()) errs.email = "Please enter your email address.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) {
      errs.email = "Please enter a valid email address.";
    }
    if (!values.subject) errs.subject = "Please choose a subject.";
    const message = values.message.trim();
    if (!message) errs.message = "Please write your message.";
    else if (message.length < 10) errs.message = "Your message needs at least 10 characters.";
    else if (message.length > 5000) errs.message = "Your message is too long (5,000 characters maximum).";
    return errs;
  };

  const failWith = (message: string, errs: Record<string, string> = {}) => {
    submitLock.current = false;
    setFieldErrors(errs);
    setFormError(message);
    setStatus("error");
    // Turnstile tokens are single-use: issue a fresh challenge for the retry.
    setTurnstileToken(null);
    setTurnstileReset((n) => n + 1);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitLock.current) return;
    submitLock.current = true;
    setFormError(null);
    const errs = validate();
    if (Object.keys(errs).length > 0) {
      submitLock.current = false;
      setFieldErrors(errs);
      setFormError("Please check the highlighted fields.");
      setStatus("error");
      return;
    }
    if (turnstileEnabled && !turnstileToken) {
      submitLock.current = false;
      setFormError("Please complete the verification check below, then send again.");
      setStatus("error");
      return;
    }
    setStatus("submitting");
    try {
      // The contact post is state-changing, so it rides the platform's
      // double-submit CSRF pair. An anonymous visitor may not hold a
      // csrf cookie yet — fetch one on demand (GET /api/auth/csrf-token
      // issues it) so shopRequest can echo it in the header.
      if (!getShopCsrfToken()) {
        try {
          const issued = await shopRequest<{ csrfToken?: string }>("/api/auth/csrf-token");
          if (issued?.csrfToken) setShopCsrfToken(issued.csrfToken);
        } catch {
          // Proceed anyway: if the endpoint is CSRF-exempt the post
          // still succeeds; otherwise the error path below reports it.
        }
      }
      await shopRequest<{ success: boolean; data: { submitted: boolean } }>("/api/contact", {
        method: "POST",
        body: {
          firstName: values.firstName.trim(),
          lastName: values.lastName.trim(),
          email: values.email.trim(),
          subject: values.subject,
          message: values.message.trim(),
          website: values.website,
          ...(turnstileEnabled ? { turnstileToken } : {}),
        },
      });
      // Success is shown only after the server has accepted the message.
      setStatus("success");
    } catch (err) {
      if (err instanceof ShopApiError && err.code === "VALIDATION_FAILED") {
        const serverErrs: Record<string, string> = {};
        for (const d of err.details) {
          if (d && typeof d.field === "string" && typeof d.issue === "string") {
            serverErrs[d.field] = d.issue;
          }
        }
        failWith("Please check the highlighted fields.", serverErrs);
      } else if (err instanceof ShopApiError && (err.code === "RATE_LIMITED" || err.status === 429)) {
        failWith("Too many messages — please wait a few minutes and try again.");
      } else {
        failWith("Your message could not be sent. Please try again.");
      }
    }
  };

  const fieldError = (name: string) =>
    fieldErrors[name] ? (
      <p id={`contact-${name}-error`} className={errorClass} role="alert">
        {fieldErrors[name]}
      </p>
    ) : null;

  const describedBy = (name: string) => (fieldErrors[name] ? `contact-${name}-error` : undefined);

  return (
    <div>
      <h3 className="font-display text-2xl font-medium mb-7">{config.heading}</h3>
      {status === "success" ? (
        <div className="border border-accent/50 bg-primary-foreground/5 px-6 py-8 text-center" role="status">
          <CheckCircle2 size={30} className="text-accent mx-auto mb-4" />
          <p className="font-display text-xl font-medium mb-2">Thank you — your message has been sent.</p>
          <p className="font-sans text-sm font-light text-primary-foreground/65">
            We have received your enquiry and will reply to {values.email.trim()} as soon as we can.
          </p>
        </div>
      ) : (
        <form className="space-y-4 relative" onSubmit={submit} noValidate>
          {formError && (
            <div className="border border-[#f0a198]/40 bg-[#f0a198]/10 px-4 py-3" role="alert">
              <p className="font-sans text-sm text-[#f5c6c0]">{formError}</p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            {CONTACT_TEXT_FIELDS.slice(0, 2).map((name) =>
              byName.has(name) ? (
                <div key={name}>
                  <label className={labelClass} htmlFor={`contact-${name}`}>
                    {byName.get(name)}
                  </label>
                  <input
                    id={`contact-${name}`}
                    type="text"
                    autoComplete={name === "firstName" ? "given-name" : "family-name"}
                    placeholder={byName.get(name)}
                    className={inputClass}
                    value={values[name]}
                    onChange={setField(name)}
                    disabled={busy}
                    aria-invalid={Boolean(fieldErrors[name])}
                    aria-describedby={describedBy(name)}
                  />
                  {fieldError(name)}
                </div>
              ) : null,
            )}
          </div>
          {byName.has("email") && (
            <div>
              <label className={labelClass} htmlFor="contact-email">
                {byName.get("email")}
              </label>
              <input
                id="contact-email"
                type="email"
                autoComplete="email"
                placeholder={byName.get("email")}
                className={inputClass}
                value={values.email}
                onChange={setField("email")}
                disabled={busy}
                aria-invalid={Boolean(fieldErrors.email)}
                aria-describedby={describedBy("email")}
              />
              {fieldError("email")}
            </div>
          )}
          {byName.has("subject") && (
            <div>
              <label className={labelClass} htmlFor="contact-subject">
                {byName.get("subject")}
              </label>
              <div className="relative">
                <select
                  id="contact-subject"
                  className={`contact-subject-select ${inputClass} appearance-none pr-11`}
                  value={values.subject}
                  onChange={setField("subject")}
                  disabled={busy}
                  aria-invalid={Boolean(fieldErrors.subject)}
                  aria-describedby={describedBy("subject")}
                >
                  <option value="">{byName.get("subject")}</option>
                  {subjectOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={16}
                  className="text-primary-foreground/50 absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none"
                />
              </div>
              {fieldError("subject")}
            </div>
          )}
          {byName.has("message") && (
            <div>
              <label className={labelClass} htmlFor="contact-message">
                {byName.get("message")}
              </label>
              <textarea
                id="contact-message"
                rows={4}
                placeholder={byName.get("message")}
                className={`${inputClass} resize-none`}
                value={values.message}
                onChange={setField("message")}
                disabled={busy}
                aria-invalid={Boolean(fieldErrors.message)}
                aria-describedby={describedBy("message")}
              />
              {fieldError("message")}
            </div>
          )}
          {/* Honeypot: real visitors never see or fill this field; bots do.
              A populated value is submitted as `website` and the server
              discards the submission. */}
          <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden opacity-0">
            <input
              type="text"
              name="website"
              tabIndex={-1}
              autoComplete="off"
              value={values.website}
              onChange={setField("website")}
            />
          </div>
          {turnstileEnabled && <TurnstileWidget onToken={setTurnstileToken} resetSignal={turnstileReset} />}
          <button
            type="submit"
            disabled={busy}
            className="w-full bg-accent text-accent-foreground py-4 text-[0.58rem] tracking-[0.22em] uppercase font-sans hover:opacity-90 transition-opacity disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {busy ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Sending…
              </>
            ) : (
              config.submitLabel
            )}
          </button>
        </form>
      )}
    </div>
  );
}

function ContactBand({ info, form }: { info?: CmsSection; form?: CmsSection }) {
  return (
    <section className="bg-foreground text-primary-foreground py-24">
      <div className="max-w-screen-xl mx-auto px-6 lg:px-10">
        <div className="grid md:grid-cols-2 gap-20 items-start">
          {info && <ContactInformationColumn section={info} />}
          {form && <ContactFormColumn section={form} />}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Spacer (Home H8 — the current empty newsletter section, mapping §11.1)
// ---------------------------------------------------------------------------

function SpacerSection() {
  return <section className="py-24 max-w-screen-xl mx-auto px-6 lg:px-10"></section>;
}

// ---------------------------------------------------------------------------
// Phase 4 library types — retained builder utilities (mapping §11.1/§11.2)
// that no current page uses yet: image, image_gallery, featured_products,
// divider, newsletter_signup.
// ---------------------------------------------------------------------------

function ImageSection({ section }: { section: CmsSection }) {
  const config = section.config;
  const image = config.image as { url: string; alt: string } | undefined;
  if (!image) return null;
  const img = <img src={image.url} alt={image.alt} className="w-full h-auto" />;
  return (
    <section className="py-24 max-w-screen-xl mx-auto px-6 lg:px-10">
      <figure>
        {config.link ? (
          <CmsLink link={config.link} className="block">
            {img}
          </CmsLink>
        ) : (
          img
        )}
        {config.caption && (
          <figcaption className="mt-4 text-center font-sans text-xs text-muted-foreground font-light">
            {config.caption}
          </figcaption>
        )}
      </figure>
    </section>
  );
}

const GALLERY_COLUMN_CLASS: Record<number, string> = {
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-2 lg:grid-cols-3",
  4: "sm:grid-cols-2 lg:grid-cols-4",
};

function ImageGallerySection({ section }: { section: CmsSection }) {
  const config = section.config;
  const images: { url: string; alt: string }[] = config.images ?? [];
  const columns = typeof config.columns === "number" ? config.columns : 3;
  return (
    <section className="py-24 max-w-screen-xl mx-auto px-6 lg:px-10">
      {config.sectionLabel && <SectionLabel>{config.sectionLabel}</SectionLabel>}
      {config.heading && (
        <h2 className="font-display text-3xl md:text-4xl font-medium mb-12">{config.heading}</h2>
      )}
      <div className={`grid gap-6 ${GALLERY_COLUMN_CLASS[columns] ?? GALLERY_COLUMN_CLASS[3]}`}>
        {images.map((image) => (
          <div key={image.url} className="overflow-hidden bg-muted">
            <img src={image.url} alt={image.alt} className="w-full h-full object-cover" />
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * Featured products (Phase 6) — records come from the store module via
 * moduleData.products (GET /api/shop/products in "featured" order:
 * flagged products first, then category/product sort order). When the
 * caller passes no moduleData, the section fetches the same list
 * itself. Flagged products lead; the pool order fills the rest, sliced
 * to config.limit (default 3, matching the grid). Cards link to the
 * Gift Shop — the product detail surface is the shop's quick view.
 */
function FeaturedProductsSection({ section, moduleData }: { section: CmsSection; moduleData?: ModuleData }) {
  const config = section.config;
  const fetched = useFeaturedProducts();
  const pool = moduleData?.products ?? fetched.data ?? [];
  const limit = typeof config.limit === "number" ? config.limit : 3;
  const flagged = pool.filter((p) => p.isFeatured);
  const ordered = flagged.length > 0 ? [...flagged, ...pool.filter((p) => !p.isFeatured)] : pool;
  const items = ordered.slice(0, limit);
  return (
    <section className="py-24 max-w-screen-xl mx-auto px-6 lg:px-10">
      <div className="flex items-end justify-between mb-12">
        <div>
          {config.sectionLabel && <SectionLabel>{config.sectionLabel}</SectionLabel>}
          {config.heading && (
            <h2 className="font-display text-3xl md:text-4xl font-medium">{config.heading}</h2>
          )}
        </div>
        {config.viewAllLink && (
          <CmsLink link={config.viewAllLink} className="hidden md:inline-flex items-center gap-2 text-[0.6rem] tracking-[0.18em] uppercase font-sans text-muted-foreground hover:text-accent transition-colors">
            {config.viewAllLink.label} <ArrowRight size={12} />
          </CmsLink>
        )}
      </div>
      <div className="grid md:grid-cols-3 gap-6">
        {items.map((product) => (
          <Link key={product.id} to="/shop" className="group block">
            <div className="relative aspect-[3/4] overflow-hidden bg-muted mb-4">
              {product.image && (
                <img src={product.image.url} alt={product.image.alt} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" />
              )}
              {!product.inStock && (
                <span className="absolute left-3 top-3 bg-background/85 backdrop-blur-sm px-2.5 py-1 font-mono text-[0.5rem] tracking-[0.18em] uppercase text-foreground">
                  Out of Stock
                </span>
              )}
            </div>
            <h3 className="font-display text-sm font-medium leading-snug mb-1">{product.name}</h3>
            <p className="font-mono text-[0.5rem] tracking-wider text-muted-foreground mb-2">{product.detail}</p>
            <span className="font-display text-base font-medium text-accent">{formatRs(product.effectivePricePaisa)}</span>
            {product.salePricePaisa != null && (
              <span className="ml-2 font-display text-sm text-muted-foreground line-through">{formatRs(product.pricePaisa)}</span>
            )}
          </Link>
        ))}
      </div>
    </section>
  );
}

function DividerSection() {
  return (
    <div className="max-w-screen-xl mx-auto px-6 lg:px-10">
      <hr className="border-border" />
    </div>
  );
}

function NewsletterSignupSection({ section }: { section: CmsSection }) {
  const config = section.config;
  return (
    <section className="bg-secondary py-24 border-y border-border">
      <div className="max-w-screen-lg mx-auto px-6 text-center">
        <h2 className="font-display text-3xl md:text-4xl font-medium mb-4">{config.heading}</h2>
        {config.text && (
          <p className="font-sans text-sm text-muted-foreground leading-relaxed font-light max-w-md mx-auto mb-10">
            {config.text}
          </p>
        )}
        {/* TODO: submissions store (newsletter_subscribers) — later phase.
            Until the store exists the form is a no-op, exactly like the
            contact form; `successMessage` is honoured once it lands. */}
        <form
          className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto"
          onSubmit={(e) => e.preventDefault()}
        >
          <input
            type="email"
            required
            placeholder={config.emailPlaceholder ?? "Email address"}
            className="flex-1 bg-background border border-border px-4 py-3.5 text-sm font-sans focus:outline-none focus:border-accent placeholder:text-muted-foreground"
          />
          <button
            type="submit"
            className="bg-accent text-accent-foreground px-7 py-3.5 text-[0.62rem] tracking-[0.18em] uppercase font-sans hover:opacity-90 transition-opacity"
          >
            {config.buttonLabel}
          </button>
        </form>
        {config.privacyNote && (
          <p className="font-sans text-xs text-muted-foreground font-light mt-5">{config.privacyNote}</p>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// PageRenderer
// ---------------------------------------------------------------------------

function renderDefaultSection(section: CmsSection, pageSlug: string, moduleData?: ModuleData): ReactNode {
  switch (section.type) {
    case "hero":
      return <HeroSection section={section} />;
    case "image_text":
      return <ImageTextSection section={section} />;
    case "rich_text":
      return <RichTextSection section={section} />;
    case "statistics":
      return <StatisticsSection section={section} />;
    case "testimonials":
      return <TestimonialsSection section={section} moduleData={moduleData} />;
    case "history_timeline":
      return <HistoryTimelineSection section={section} />;
    case "directory":
      return <DirectorySection section={section} />;
    case "cta":
      return <CtaSection section={section} />;
    case "partner_list":
      return <PartnerListSection section={section} />;
    case "team_members":
      return <TeamMembersSection section={section} />;
    case "collection_grid":
      return <CollectionGridSection section={section} pageSlug={pageSlug} moduleData={moduleData} />;
    case "exhibition_grid":
      return <ExhibitionGridSection section={section} moduleData={moduleData} />;
    case "news_listing":
      return <NewsListingSection section={section} moduleData={moduleData} />;
    case "foundation_programs":
      return <FoundationProgramsSection section={section} moduleData={moduleData} />;
    case "contact_information":
      return <ContactBand info={section} />;
    case "contact_form":
      return <ContactBand form={section} />;
    case "spacer":
      return <SpacerSection />;
    case "image":
      return <ImageSection section={section} />;
    case "image_gallery":
      return <ImageGallerySection section={section} />;
    case "featured_products":
      return <FeaturedProductsSection section={section} moduleData={moduleData} />;
    case "divider":
      return <DividerSection />;
    case "newsletter_signup":
      return <NewsletterSignupSection section={section} />;
    default:
      return null;
  }
}

export interface PageRendererProps {
  page: CmsPage;
  /**
   * Optional per-section override for page-level behaviour that is not
   * content (News search state, Shop cart badge, Foundation hero size).
   * Return `undefined` to fall through to the default renderer.
   */
  renderSection?: (section: CmsSection, index: number) => ReactNode | undefined;
  /**
   * Phase 5 museum module records (collections, exhibitions, news,
   * foundation) consumed by the module-reference sections. Pages fetch
   * the slices they need via the hooks in lib/api and pass them down;
   * absent data renders section chrome with no cards.
   */
  moduleData?: ModuleData;
}

export default function PageRenderer({ page, renderSection, moduleData }: PageRendererProps) {
  const out: ReactNode[] = [];
  const sections = page.sections;
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const override = renderSection?.(section, i);
    if (override !== undefined) {
      out.push(<Fragment key={i}>{override}</Fragment>);
      continue;
    }
    // About A5 composition: contact_information immediately followed by
    // contact_form renders as ONE dark band, as in the current page.
    if (section.type === "contact_information" && sections[i + 1]?.type === "contact_form") {
      out.push(
        <Fragment key={i}>
          <ContactBand info={section} form={sections[i + 1]} />
        </Fragment>,
      );
      i++;
      continue;
    }
    out.push(<Fragment key={i}>{renderDefaultSection(section, page.slug, moduleData)}</Fragment>);
  }
  return <>{out}</>;
}
