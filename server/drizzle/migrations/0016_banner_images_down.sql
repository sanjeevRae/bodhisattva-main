-- Down for 0016_banner_images: restore the pre-0016 hero configs.

UPDATE `page_sections` ps JOIN `pages` p ON (ps.revision_id = p.published_revision_id OR ps.revision_id = p.draft_revision_id) SET ps.config = '{"variant":"page-banner","eyebrow":"The Collection","heading":"The Museum","backgroundImage":{"url":"/images/pages/museum-hero.jpg","alt":"A visitor studying a paubha painting with a magnifying lens at Purna Museum of Newa Art"}}' WHERE p.slug = 'museum' AND ps.sort_order = 0;
--> statement-breakpoint
UPDATE `page_sections` ps JOIN `pages` p ON (ps.revision_id = p.published_revision_id OR ps.revision_id = p.draft_revision_id) SET ps.config = '{"variant":"page-banner","eyebrow":"Social Responsibility","heading":"The Foundation","backgroundImage":{"url":"/images/pages/foundation-hero.jpg","alt":"Purna Man Shakya Memorial Art Award poster with a portrait of the founder"}}' WHERE p.slug = 'foundation' AND ps.sort_order = 0;
