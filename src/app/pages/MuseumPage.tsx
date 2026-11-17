import { usePage } from "../lib/api";
import PageRenderer, { PageStatus } from "../components/PageRenderer";

/**
 * Museum — content from the CMS (GET /api/pages/museum) via PageRenderer.
 * The collection filter state lives inside the collection_grid renderer,
 * as it did in this component before the switch.
 */
export default function MuseumPage() {
  const { data: page, error } = usePage("museum");
  if (error) return <PageStatus error />;
  if (!page) return <PageStatus />;
  return (
    <div>
      <PageRenderer page={page} />
    </div>
  );
}
