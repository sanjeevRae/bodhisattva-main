import { useExhibitions, usePage } from "../lib/api";
import PageRenderer, { PageStatus } from "../components/PageRenderer";

/**
 * Gallery — content from the CMS (GET /api/pages/gallery) via
 * PageRenderer. The year/category filter state lives inside the
 * exhibition_grid renderer, operating on the GET /api/exhibitions
 * records (years derived from each record's startsOn).
 */
export default function GalleryPage() {
  const { data: page, error } = usePage("gallery");
  const exhibitions = useExhibitions();
  if (error) return <PageStatus error />;
  if (!page) return <PageStatus />;
  return (
    <div className="pt-16">
      <PageRenderer page={page} moduleData={{ exhibitions: exhibitions.data ?? undefined }} />
    </div>
  );
}
