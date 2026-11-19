/**
 * Destination-frame mapping for the placement editor (docs/
 * IMAGE_PLACEMENT_EDITOR.md §2). The module under test is the admin's
 * src/admin/image-frames.ts, imported directly: these cases pin the
 * editor's frames to the public renderer's actual containers, so a
 * renderer aspect change fails here instead of silently desyncing
 * the editor preview from the published crop.
 */
import { describe, expect, it } from "vitest";
import { frameForImageField } from "../../src/admin/image-frames";

describe("frameForImageField", () => {
  it("maps the fullscreen hero with its 22% built-in anchor", () => {
    const frame = frameForImageField("hero", "backgroundImage", { variant: "fullscreen" });
    expect(frame?.desktop).toEqual([16, 9]);
    expect(frame?.tablet).toEqual([3, 4]);
    expect(frame?.mobile).toEqual([9, 16]);
    // PageRenderer renders this variant object-[center_22%].
    expect(frame?.defaultDevice).toEqual({ x: 50, y: 22, zoom: 1 });
    expect(frame?.fluid).toBe(true);
  });

  it("maps the page-banner hero", () => {
    const frame = frameForImageField("hero", "backgroundImage", { variant: "page-banner" });
    expect(frame?.desktop).toEqual([8, 3]);
    expect(frame?.mobile).toEqual([3, 4]);
    expect(frame?.defaultDevice).toBeUndefined();
  });

  it("maps image_text by variant, as the renderer does", () => {
    // Quote variant: fixed aspect-video, imageAspect ignored.
    const quote = frameForImageField("image_text", "image", {
      quote: { text: "Q", attribution: "A" },
      imageAspect: "4:5",
    });
    expect(quote?.desktop).toEqual([16, 9]);
    // Callout variant: imageAspect ?? 4:5.
    const callout = frameForImageField("image_text", "image", {
      calloutBadge: { label: "Est.", value: "2023" },
    });
    expect(callout?.desktop).toEqual([4, 5]);
    // Plain variant: imageAspect ?? 4:3.
    const plain = frameForImageField("image_text", "image", {});
    expect(plain?.desktop).toEqual([4, 3]);
    const custom = frameForImageField("image_text", "image", { imageAspect: "1:1" });
    expect(custom?.desktop).toEqual([1, 1]);
  });

  it("maps the collage list at 3:4 and team photos square", () => {
    expect(frameForImageField("image_text", "images", {})?.desktop).toEqual([3, 4]);
    expect(frameForImageField("team_members", "members.0.photo", {})?.desktop).toEqual([1, 1]);
  });

  it("marks gallery frames natural", () => {
    const frame = frameForImageField("image_gallery", "images", {});
    expect(frame?.natural).toBe(true);
  });

  it("offers no editor where placement does not apply", () => {
    // Full-width image sections render at natural ratio.
    expect(frameForImageField("image", "image", {})).toBeNull();
    // Partner logos are in the schema but not rendered.
    expect(frameForImageField("partner_list", "items.0.logoImage", {})).toBeNull();
    // Hero fields other than the background image.
    expect(frameForImageField("hero", "portraitImage", { variant: "fullscreen" })).toBeNull();
    expect(frameForImageField("unknown_type", "image", {})).toBeNull();
    expect(frameForImageField(undefined, "image", {})).toBeNull();
  });
});
