import { usePage } from "../lib/api";
import PageRenderer, { PageStatus } from "../components/PageRenderer";

/**
 * About — content from the CMS (GET /api/pages/about) via PageRenderer.
 * The contact_information + contact_form sections compose into the
 * single dark band inside PageRenderer; contact values come from site
 * settings, the form renders from config and its submission stays a
 * no-op (contact endpoint is a later phase).
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
