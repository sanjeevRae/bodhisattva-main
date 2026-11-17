import { usePage } from "../lib/api";
import PageRenderer, { PageStatus } from "../components/PageRenderer";

/**
 * Gallery — content from the CMS (GET /api/pages/gallery) via
 * PageRenderer. The year/category filter state lives inside the
 * exhibition_grid renderer, operating on the temporary module data
 * until the Phase 5 exhibitions API lands.
 */
export default function GalleryPage() {
  const { data: page, error } = usePage("gallery");
  if (error) return <PageStatus error />;
  if (!page) return <PageStatus />;
  return (
    <div className="pt-16">
      <PageRenderer page={page} />
    </div>
  );
}
