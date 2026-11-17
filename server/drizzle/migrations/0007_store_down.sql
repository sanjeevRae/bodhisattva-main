-- DOWN migration for 0007_store.sql — Phase 6 ecommerce tables rollback.
--
-- Scope: LOCAL / DEV ONLY. Per DATABASE_DESIGN.md §13.1, production rollback
-- of a destructive migration is a restore-from-backup operation, never an
-- improvised DROP. Run this only against a disposable development database.
--
-- Procedure (from server/):
--   1. mysql <DATABASE> < drizzle/migrations/0007_store_down.sql
--      (or execute the statements below through any MySQL client)
--   2. Remove this migration's bookkeeping row so `db:status` agrees with the
--      schema again: delete the row from `__drizzle_migrations` whose
--      created_at matches this migration's journal `when` value
--      (1794910942942):
--        DELETE FROM `__drizzle_migrations` WHERE created_at = 1794910942942;
--   3. Re-apply with: npm run db:migrate
--
-- Tables are dropped in reverse creation order with FOREIGN_KEY_CHECKS
-- left enabled: inventory_movements first (it references products,
-- product_variants, orders and users), then the order graph, carts,
-- and finally products and their categories. The referenced users /
-- media_assets tables stay. Store data in these tables is disposable
-- in dev by definition — in production orders are financial records
-- and must never be dropped outside a restore.

DROP TABLE IF EXISTS `inventory_movements`;
DROP TABLE IF EXISTS `order_status_history`;
DROP TABLE IF EXISTS `order_items`;
DROP TABLE IF EXISTS `orders`;
DROP TABLE IF EXISTS `customer_addresses`;
DROP TABLE IF EXISTS `cart_items`;
DROP TABLE IF EXISTS `carts`;
DROP TABLE IF EXISTS `product_variants`;
DROP TABLE IF EXISTS `product_images`;
DROP TABLE IF EXISTS `products`;
DROP TABLE IF EXISTS `product_categories`;
