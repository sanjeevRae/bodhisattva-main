-- 0016_banner_images (2026-11-19)
-- The Museum and Foundation page banners displayed badly: the museum
-- image was a 683x491 crop (a visitor with a magnifying lens, sliced
-- mid-frame by the wide banner), and the foundation image was the
-- square Memorial Art Award POSTER, whose wide-banner crop cut the
-- founder's face off and left poster text colliding with the heading.
-- Both are replaced with purpose-cropped banner images:
--  - museum-banner.jpg (2400x764): the illuminated paubha shrine in
--    the museum's dark shrine room, from the owner's booklet photo
--    (3456x4904 original), cropped to the glowing artwork band.
--  - foundation-banner.jpg (1600x570): the founder's painted portrait
--    from the same award artwork, cropped above the poster's text so
--    the banner shows the portrait on its dark gold ground.
-- The share-preview images for /museum and /foundation point at the
-- same new files in code (meta.ts, spa.ts). Seed parity: cms-content.

UPDATE `page_sections` ps JOIN `pages` p ON (ps.revision_id = p.published_revision_id OR ps.revision_id = p.draft_revision_id) SET ps.config = '{"variant":"page-banner","eyebrow":"The Collection","heading":"The Museum","backgroundImage":{"url":"/images/pages/museum-banner.jpg","alt":"An illuminated paubha deity glowing in the dark shrine room of Purna Museum of Newa Art"}}' WHERE p.slug = 'museum' AND ps.sort_order = 0;
--> statement-breakpoint
UPDATE `page_sections` ps JOIN `pages` p ON (ps.revision_id = p.published_revision_id OR ps.revision_id = p.draft_revision_id) SET ps.config = '{"variant":"page-banner","eyebrow":"Social Responsibility","heading":"The Foundation","backgroundImage":{"url":"/images/pages/foundation-banner.jpg","alt":"Portrait of Purna Man Shakya, founder of Bodhisattva Gallery, against a dark gold ground"}}' WHERE p.slug = 'foundation' AND ps.sort_order = 0;
