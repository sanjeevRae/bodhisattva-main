import { usePage } from "../lib/api";
import PageRenderer, { HeroSection, PageStatus } from "../components/PageRenderer";

/**
 * Foundation — content from the CMS (GET /api/pages/foundation) via
 * PageRenderer. One override: this page's banner hero is shorter
 * (h-[56vh]) than the Museum's although both seed the same hero variant
 * and design — the height is page chrome the config cannot yet express
 * (contract gap, docs/phase-3/visual-diff.md).
 */
export default function FoundationPage() {
  const { data: page, error } = usePage("foundation");
  if (error) return <PageStatus error />;
  if (!page) return <PageStatus />;
  return (
    <div>
      <PageRenderer
        page={page}
        renderSection={(section) =>
          section.type === "hero" ? (
            <HeroSection section={section} bannerClass="h-[56vh] min-h-[400px]" />
          ) : undefined
        }
      />
    </div>
  );
}
