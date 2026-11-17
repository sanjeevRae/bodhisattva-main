import { useCollections, usePage } from "../lib/api";
import PageRenderer, { PageStatus } from "../components/PageRenderer";

/**
 * Museum — content from the CMS (GET /api/pages/museum) via PageRenderer.
 * The collection browser consumes GET /api/collections records; its
 * filter buttons filter by record category inside the collection_grid
 * renderer (Phase 5 — fixes Audit D1).
 */
export default function MuseumPage() {
  const { data: page, error } = usePage("museum");
  const collections = useCollections();
  if (error) return <PageStatus error />;
  if (!page) return <PageStatus />;
  return (
    <div>
      <PageRenderer page={page} moduleData={{ collections: collections.data ?? undefined }} />
    </div>
  );
}
