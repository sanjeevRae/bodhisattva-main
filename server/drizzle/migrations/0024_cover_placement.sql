-- 0024_cover_placement (2026-11-22)
-- Owner feature: the admin Exhibitions and Collections forms gain the
-- same "Edit position" control the Page Editor has for CMS images.
-- Placement (focal point / zoom / fit, per device) is a per-usage value
-- stored on the record itself — never on the media asset — reusing the
-- existing ImagePlacement model and editor unchanged.
--  1. `cover_placement` JSON, nullable, on `exhibitions` and
--     `collections` only (Foundation/News covers are out of scope).
--     NULL = no placement = the centred default rendering, so every
--     existing row renders exactly as before until an admin sets one.
--  2. Shape is enforced at the API boundary by the shared placement
--     zod schema (exported from the CMS registry); SQL NULL — never
--     the JSON literal null — represents "no placement".
-- Plan reviewed by ChatGPT Thinking (8.5/10) and Gemini (8.5/10);
-- amendments adopted: the museum service clears the placement
-- server-side whenever the cover source changes or is removed, and
-- public DTOs omit the placement key entirely when unset.
-- The drizzle-generated snapshot (meta/0024_snapshot.json) is kept;
-- the generated SQL needed no drift removal.

ALTER TABLE `collections` ADD `cover_placement` json;--> statement-breakpoint
ALTER TABLE `exhibitions` ADD `cover_placement` json;
