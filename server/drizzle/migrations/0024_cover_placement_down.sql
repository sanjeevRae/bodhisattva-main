-- Down for 0024: drop the cover placement columns. Any placements an
-- admin has set are discarded; covers fall back to the centred default.

ALTER TABLE `collections` DROP COLUMN `cover_placement`;--> statement-breakpoint
ALTER TABLE `exhibitions` DROP COLUMN `cover_placement`;
