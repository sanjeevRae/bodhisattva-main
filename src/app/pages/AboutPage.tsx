import { usePage } from "../lib/api";
import PageRenderer, { PageStatus } from "../components/PageRenderer";

/**
 * About — content from the CMS (GET /api/pages/about) via PageRenderer.
 * The contact_information + contact_form sections compose into the
 * single dark band inside PageRenderer; contact values come from site
 * settings, and the form renders from config and submits to
 * POST /api/contact (see ContactFormColumn in PageRenderer).
 */
export default function AboutPage() {
  const { data: page, error } = usePage("about");
  if (error) return <PageStatus error />;
  if (!page) return <PageStatus />;
  return (
    <div className="pt-16">
      <PageRenderer page={page} />
    </div>
  );
}
