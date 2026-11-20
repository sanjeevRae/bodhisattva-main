-- Down for 0017_partner_links: restore the name-only partner strip.

UPDATE `page_sections` ps JOIN `pages` p ON (ps.`revision_id` = p.`published_revision_id` OR ps.`revision_id` = p.`draft_revision_id`) SET ps.`config` = '{"heading":"Partner Organizations","items":[{"name":"Weltmuseum Wien"},{"name":"UNESCO Nepal"},{"name":"Siddhartha Art Gallery"},{"name":"Hyatt Regency Kathmandu"},{"name":"Nepal Art Council"},{"name":"Embassy of Nepal in China"},{"name":"Silk Road Cities Alliance"},{"name":"Lan Gallery, Beijing"}]}' WHERE p.`slug` = 'foundation' AND ps.`sort_order` = 5;
