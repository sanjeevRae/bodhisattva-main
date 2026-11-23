-- Down for 0025: drop the product image placement column. Any
-- placements an admin has set are discarded; product images fall
-- back to the centred default.

ALTER TABLE \`product_images\` DROP COLUMN \`placement\`;
