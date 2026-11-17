import { usePage } from "../lib/api";
import PageRenderer, { PageStatus } from "../components/PageRenderer";

/**
 * Home — content now comes from the CMS (GET /api/pages/home) and renders
 * through PageRenderer. The page component keeps no content of its own.
 */
export default function HomePage() {
  const { data: page, error } = usePage("home");
  if (error) return <PageStatus error />;
  if (!page) return <PageStatus />;
  return (
    <div>
      <PageRenderer page={page} />
    </div>
  );
}
