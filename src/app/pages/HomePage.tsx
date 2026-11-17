import { useCollections, useExhibitions, useNews, useFoundation, useFeaturedProducts, usePage, type ModuleData } from "../lib/api";
import PageRenderer, { PageStatus } from "../components/PageRenderer";

/**
 * Home — content from the CMS (GET /api/pages/home) via PageRenderer.
 * The module sections (featured collections, current exhibitions,
 * curator testimonial, latest news) consume the Phase 5 museum module
 * records, fetched here and passed down as `moduleData`; Phase 6 adds
 * the store's featured products for featured_products sections.
 */
export default function HomePage() {
  const { data: page, error } = usePage("home");
  const collections = useCollections();
  const exhibitions = useExhibitions();
  const news = useNews();
  const foundation = useFoundation();
  const products = useFeaturedProducts();
  if (error) return <PageStatus error />;
  if (!page) return <PageStatus />;
  const moduleData: ModuleData = {
    collections: collections.data ?? undefined,
    exhibitions: exhibitions.data ?? undefined,
    news: news.data ?? undefined,
    foundation: foundation.data ?? undefined,
    products: products.data ?? undefined,
  };
  return (
    <div>
      <PageRenderer page={page} moduleData={moduleData} />
    </div>
  );
}
