import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  datetime,
  foreignKey,
  index,
  int,
  longtext,
  mysqlTable,
  varchar,
} from "drizzle-orm/mysql-core";
import { users } from "./auth.js";

/**
 * Legal / policy pages (owner feature, 2026-11-20; plan reviewed by
 * ChatGPT thinking mode, 8/10 → amendments adopted).
 *
 * Exactly THREE pages exist — privacy-policy, terms-of-use,
 * accessibility — enforced three ways: the API slug allowlist, a DB
 * CHECK constraint, and the absence of create/delete endpoints.
 * Admins edit title + rich-text body; saving publishes immediately,
 * BUT every save first snapshots the previous content into
 * `site_policy_revisions` inside the same transaction (with the audit
 * row), so any earlier version can be inspected and restored.
 * `version` is an optimistic-concurrency counter: an update must name
 * the version the editor loaded, or it is rejected with 409.
 */
export const sitePolicies = mysqlTable(
  "site_policies",
  {
    slug: varchar("slug", { length: 40 }).primaryKey(),
    title: varchar("title", { length: 160 }).notNull(),
    bodyHtml: longtext("body_html").notNull(),
    version: int("version", { unsigned: true }).notNull().default(1),
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
    check(
      "chk_policies_slug",
      sql`${table.slug} IN ('privacy-policy', 'terms-of-use', 'accessibility')`,
    ),
    foreignKey({
      columns: [table.updatedBy],
      foreignColumns: [users.id],
      name: "fk_policies_updated_by",
    })
      .onDelete("set null")
      .onUpdate("restrict"),
  ],
);

export const sitePolicyRevisions = mysqlTable(
  "site_policy_revisions",
  {
    id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
    slug: varchar("slug", { length: 40 }).notNull(),
    title: varchar("title", { length: 160 }).notNull(),
    bodyHtml: longtext("body_html").notNull(),
    /** The policy version this snapshot was taken from. */
    version: int("version", { unsigned: true }).notNull(),
    savedBy: bigint("saved_by", { mode: "number", unsigned: true }),
    createdAt: datetime("created_at", { fsp: 3, mode: "date" })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (table) => [
    index("idx_policy_revisions_slug").on(table.slug, table.id),
    foreignKey({
      columns: [table.slug],
      foreignColumns: [sitePolicies.slug],
      name: "fk_policy_revisions_slug",
    })
      .onDelete("cascade")
      .onUpdate("restrict"),
    foreignKey({
      columns: [table.savedBy],
      foreignColumns: [users.id],
      name: "fk_policy_revisions_saved_by",
    })
      .onDelete("set null")
      .onUpdate("restrict"),
  ],
);
