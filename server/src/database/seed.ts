import { eq } from 'drizzle-orm';
import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2';
import { createPool, type Pool } from 'mysql2/promise';
import {
  permissions as permissionsTable,
  rolePermissions as rolePermissionsTable,
  roles as rolesTable,
} from './schema/authorization.js';
import {
  menuItems as menuItemsTable,
  menus as menusTable,
  pageRevisions as pageRevisionsTable,
  pageSections as pageSectionsTable,
  pages as pagesTable,
  siteSettings as siteSettingsTable,
} from './schema/cms.js';
import { CMS_MENUS, CMS_PAGES, CMS_SETTINGS } from './seed-data/cms-content.js';
import {
  PERMISSION_SEEDS,
  ROLE_PERMISSIONS,
  ROLE_SEEDS,
} from './seed-data/permissions.js';

/**
 * `npm run db:seed` — safe, idempotent seed runner (DATABASE_DESIGN.md §13.2–13.3,
 * DEVELOPMENT_ROADMAP.md Phase 1 deliverables).
 *
 * Contract for every seed step:
 *  - IDEMPOTENT: safe to re-run at any time. Every insert is an upsert keyed on
 *    a natural unique key (e.g. `roles.code`, `permissions.code`).
 *  - NO ACCOUNTS, EVER: seeds never create user accounts — no demonstration,
 *    test or placeholder admins in any environment (§13.3). The first Super
 *    Admin is created only by the one-time interactive bootstrap command
 *    (Phase 2), never by a seed.
 *  - TRANSACTIONAL: the runner executes each step inside its own transaction;
 *    a failed step rolls back and aborts the run.
 *
 * Phase 2 state: three production steps seed the authorization reference
 * data — roles, permissions, role_permissions — from PERMISSIONS.md (§2, §4,
 * §5) via `seed-data/permissions.ts`. Phase 3 adds the `cms-content` step
 * (the seven migrated system pages, menus and public site settings). They
 * contain no accounts and no secrets, and are safe in every environment
 * including production (§13.3).
 * The `--dev` placeholder step exists only to prove the mechanism
 * end-to-end; it writes nothing.
 */

export interface SeedStep {
  name: string;
  run: (db: MySql2Database) => Promise<void>;
}

/** Production seed steps, executed in order. */
export const seedSteps: SeedStep[] = [
  {
    name: 'roles',
    async run(db) {
      // Upsert on the natural key `roles.code` (uq_roles_code). Re-running
      // refreshes name/description and changes nothing else.
      for (const role of ROLE_SEEDS) {
        await db
          .insert(rolesTable)
          .values({
            code: role.code,
            name: role.name,
            description: role.description,
            isSystem: true,
          })
          .onDuplicateKeyUpdate({
            set: { name: role.name, description: role.description, isSystem: true },
          });
      }
    },
  },
  {
    name: 'permissions',
    async run(db) {
      // Upsert on the natural key `permissions.code` (uq_permissions_code).
      for (const permission of PERMISSION_SEEDS) {
        await db
          .insert(permissionsTable)
          .values({
            code: permission.code,
            module: permission.module,
            description: permission.description,
          })
          .onDuplicateKeyUpdate({
            set: { module: permission.module, description: permission.description },
          });
      }
    },
  },
  {
    name: 'role-permissions',
    async run(db) {
      // Insert only the matrix pairs that are missing (composite PK is the
      // natural key). A re-run inserts nothing — grants are never duplicated
      // and existing rows are untouched.
      const roleRows = await db
        .select({ id: rolesTable.id, code: rolesTable.code })
        .from(rolesTable);
      const permissionRows = await db
        .select({ id: permissionsTable.id, code: permissionsTable.code })
        .from(permissionsTable);
      const roleIdByCode = new Map(roleRows.map((row) => [row.code, row.id]));
      const permissionIdByCode = new Map(
        permissionRows.map((row) => [row.code, row.id]),
      );

      const wanted: { roleId: number; permissionId: number }[] = [];
      for (const [roleCode, permissionCodes] of Object.entries(ROLE_PERMISSIONS)) {
        const roleId = roleIdByCode.get(roleCode);
        if (roleId === undefined) {
          throw new Error(`seed role-permissions: role '${roleCode}' not found — run the roles step first`);
        }
        for (const permissionCode of permissionCodes) {
          const permissionId = permissionIdByCode.get(permissionCode);
          if (permissionId === undefined) {
            throw new Error(
              `seed role-permissions: permission '${permissionCode}' not found — run the permissions step first`,
            );
          }
          wanted.push({ roleId, permissionId });
        }
      }

      const existing = await db
        .select({
          roleId: rolePermissionsTable.roleId,
          permissionId: rolePermissionsTable.permissionId,
        })
        .from(rolePermissionsTable);
      const existingKeys = new Set(
        existing.map((row) => `${row.roleId}:${row.permissionId}`),
      );
      const missing = wanted.filter(
        (pair) => !existingKeys.has(`${pair.roleId}:${pair.permissionId}`),
      );
      if (missing.length > 0) {
        await db.insert(rolePermissionsTable).values(missing);
      }
    },
  },
  {
    // Phase 3 content migration (CMS_CONTENT_MAPPING.md): the seven system
    // pages with their sections, the navigation/footer menus and the
    // public site settings, from `seed-data/cms-content.ts`. Idempotent by
    // natural key: a page whose slug already exists is skipped whole (its
    // content may have been edited in the CMS since), a menu whose code
    // exists is skipped, and settings only fill in missing keys — re-runs
    // never overwrite CMS edits. Section links carry `pageSlug` in the
    // seed data; they are resolved to `pageId` here (two passes: every
    // page id exists before any section is written).
    name: 'cms-content',
    async run(db) {
      const pageIdBySlug = new Map<string, number>();
      const existingPages = await db
        .select({ id: pagesTable.id, slug: pagesTable.slug })
        .from(pagesTable);
      for (const row of existingPages) pageIdBySlug.set(row.slug, row.id);

      const pendingSections: {
        revisionId: number;
        sections: (typeof CMS_PAGES)[number]['sections'];
      }[] = [];

      for (const pageSeed of CMS_PAGES) {
        if (pageIdBySlug.has(pageSeed.slug)) continue;
        const [pageRow] = await db
          .insert(pagesTable)
          .values({
            slug: pageSeed.slug,
            title: pageSeed.title,
            status: 'PUBLISHED',
            isSystem: true,
            seoTitle: pageSeed.seoTitle ?? null,
            metaDescription: pageSeed.metaDescription ?? null,
            publishedAt: new Date(),
          })
          .$returningId();
        const [revisionRow] = await db
          .insert(pageRevisionsTable)
          .values({ pageId: pageRow.id, revisionNo: 1, version: 1 })
          .$returningId();
        await db
          .update(pagesTable)
          .set({
            draftRevisionId: revisionRow.id,
            publishedRevisionId: revisionRow.id,
          })
          .where(eq(pagesTable.id, pageRow.id));
        pageIdBySlug.set(pageSeed.slug, pageRow.id);
        pendingSections.push({
          revisionId: revisionRow.id,
          sections: pageSeed.sections,
        });
      }

      for (const pending of pendingSections) {
        if (pending.sections.length === 0) continue;
        await db.insert(pageSectionsTable).values(
          pending.sections.map((section) => ({
            revisionId: pending.revisionId,
            type: section.type,
            sortOrder: section.sortOrder,
            isVisible: section.isVisible,
            config: resolveSeedLinks(section.config, pageIdBySlug),
            design: section.design ?? null,
          })),
        );
      }

      for (const menuSeed of CMS_MENUS) {
        const [existingMenu] = await db
          .select({ id: menusTable.id })
          .from(menusTable)
          .where(eq(menusTable.code, menuSeed.code))
          .limit(1);
        if (existingMenu) continue;
        const [menuRow] = await db
          .insert(menusTable)
          .values({ code: menuSeed.code, name: menuSeed.name })
          .$returningId();
        if (menuSeed.items.length > 0) {
          await db.insert(menuItemsTable).values(
            menuSeed.items.map((item) => {
              let pageId: number | null = null;
              if (item.linkType === 'PAGE') {
                pageId = item.pageSlug
                  ? (pageIdBySlug.get(item.pageSlug) ?? null)
                  : null;
                if (pageId === null) {
                  throw new Error(
                    `seed cms-content: menu '${menuSeed.code}' item '${item.label}' references unknown page slug '${item.pageSlug}'`,
                  );
                }
              }
              return {
                menuId: menuRow.id,
                label: item.label,
                linkType: item.linkType,
                pageId,
                url: item.url ?? null,
                sortOrder: item.sortOrder,
                isVisible: item.isVisible,
              };
            }),
          );
        }
      }

      const existingSettings = await db
        .select({ key: siteSettingsTable.settingKey })
        .from(siteSettingsTable);
      const existingKeys = new Set(existingSettings.map((row) => row.key));
      for (const setting of CMS_SETTINGS) {
        if (existingKeys.has(setting.key)) continue;
        await db.insert(siteSettingsTable).values({
          settingKey: setting.key,
          settingValue: JSON.stringify(setting.value),
          isPublic: setting.isPublic,
        });
      }
    },
  },
];

/**
 * Deep-resolve seed-time links: any object shaped like a CMS link
 * (`{ kind: 'page', pageSlug, … }`) has its `pageSlug` replaced by the
 * target page's `pageId`, per the seed-data convention in
 * `seed-data/cms-content.ts`. Everything else is copied unchanged.
 */
function resolveSeedLinks(
  value: unknown,
  pageIdBySlug: Map<string, number>,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => resolveSeedLinks(item, pageIdBySlug));
  }
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(record)) {
      if (key === 'pageSlug') continue;
      out[key] = resolveSeedLinks(child, pageIdBySlug);
    }
    if (record.kind === 'page' && typeof record.pageSlug === 'string') {
      const pageId = pageIdBySlug.get(record.pageSlug);
      if (pageId === undefined) {
        throw new Error(
          `seed cms-content: link references unknown page slug '${record.pageSlug}'`,
        );
      }
      out.pageId = pageId;
    }
    return out;
  }
  return value;
}

/** Development-only steps. Never run in production (enforced in main()). */
export const devSeedSteps: SeedStep[] = [
  {
    name: 'dev-placeholder',
    async run(): Promise<void> {
      // Mechanism proof only — writes nothing, creates no accounts.
      console.log('seed: [dev-placeholder] no-op — seed mechanism OK, no data written.');
    },
  },
];

async function main(): Promise<void> {
  const dev = process.argv.includes('--dev');
  if (dev && process.env.NODE_ENV === 'production') {
    console.error('seed: refusing to run --dev steps with NODE_ENV=production.');
    process.exit(1);
  }

  const steps = dev ? [...seedSteps, ...devSeedSteps] : seedSteps;
  if (steps.length === 0) {
    console.log('seed: no seed steps registered. Nothing to do.');
    return;
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('seed: DATABASE_URL is not set. See server/.env.example.');
    process.exit(1);
  }

  let pool: Pool | undefined;
  try {
    pool = createPool(url);
    const connection = await pool.getConnection();
    try {
      await connection.query("SET time_zone = '+00:00'"); // design §2.3 — UTC everywhere
    } finally {
      connection.release();
    }
    const db = drizzle(pool);
    for (const step of steps) {
      await db.transaction(async (tx) => {
        await step.run(tx as MySql2Database);
      });
      console.log(`seed: [${step.name}] done.`);
    }
    console.log(`seed: OK — ${steps.length} step(s) completed.`);
  } finally {
    await pool?.end();
  }
}

main().catch((error: unknown) => {
  console.error('seed: FAILED', error);
  process.exit(1);
});
