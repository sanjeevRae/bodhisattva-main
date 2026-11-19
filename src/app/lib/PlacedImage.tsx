import type { ImgHTMLAttributes } from "react";
import { placementVars, type ImagePlacement } from "./image-placement";

type PlacedImageProps = ImgHTMLAttributes<HTMLImageElement> & {
  placement?: ImagePlacement | null;
};

/**
 * The one shared image renderer for CMS images (docs/
 * IMAGE_PLACEMENT_EDITOR.md §4). Without a placement it renders a plain
 * <img> exactly as the section components did before; with one, the
 * `.placed-img` rules in theme.css apply the focal point + zoom per
 * device (desktop ≥1024px, tablet 768–1023px, mobile <768px, with
 * inheritance mobile → tablet → desktop). The admin placement editor
 * previews with this same component, so the preview is the published
 * rendering by construction.
 */
export function PlacedImage({ placement, className, style, ...rest }: PlacedImageProps) {
  if (!placement) {
    return <img {...rest} className={className} style={style} />;
  }
  return (
    <img
      {...rest}
      className={`placed-img ${className ?? ""}`}
      style={{ ...placementVars(placement), objectFit: placement.fit ?? "cover", ...style }}
    />
  );
}
