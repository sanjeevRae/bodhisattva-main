import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  datetime,
  foreignKey,
  index,
  int,
  mysqlTable,
  varchar,
} from "drizzle-orm/mysql-core";
import { users } from "./auth.js";
import { mediaAssets } from "./media.js";

/**
 * Website popup (owner feature, 2026-11-20) — a single announcement /
 * welcome / advertising popup shown once per visitor on the home page.
 *
 * Multiple rows may exist (drafts, past announcements) but AT MOST ONE
 * is active: the migration adds a generated `active_slot` column
 * (1 when is_active, NULL otherwise) with a UNIQUE index, so the
 * database itself rejects a second active row even if two admins
 * activate different popups at the same moment. `active_slot` is a
 * DB-only invariant column — the application never reads or writes it,
 * which is why it is deliberately absent from this schema.
 *
 * `version` is the visitor-facing generation: it increments ONLY when
 * public content changes (heading, message, image, button label, link
 * URL) — never on activate/deactivate — and the browser's seen marker
 * is keyed by (id, version), so edited content shows once more while
 * mere re-activation of unchanged content does not re-show.
 */
export const sitePopups = mysqlTable(
  "site_popups",
  {
    id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
    heading: varchar("heading", { length: 160 }).notNull(),
    message: varchar("message", { length: 2000 }).notNull(),
    imageMediaId: bigint("image_media_id", { mode: "number", unsigned: true }),
    buttonLabel: varchar("button_label", { length: 80 }),
    linkUrl: varchar("link_url", { length: 500 }),
    isActive: boolean("is_active").notNull().default(false),
    version: int("version", { unsigned: true }).notNull().default(1),
    createdBy: bigint("created_by", { mode: "number", unsigned: true }),
    updatedBy: bigint("updated_by", { mode: "number", unsigned: true }),
    createdAt: datetime("created_at", { fsp: 3, mode: "date" })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime("updated_at", { fsp: 3, mode: "date" })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`)
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("idx_popups_active").on(table.isActive),
    foreignKey({
      columns: [table.imageMediaId],
      foreignColumns: [mediaAssets.id],
      name: "fk_popups_image",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.createdBy],
      foreignColumns: [users.id],
      name: "fk_popups_created_by",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.updatedBy],
      foreignColumns: [users.id],
      name: "fk_popups_updated_by",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
  ],
);
