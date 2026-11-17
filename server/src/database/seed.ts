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
import {
  collections as collectionsTable,
  exhibitions as exhibitionsTable,
  foundationPrograms as foundationProgramsTable,
  newsArticles as newsArticlesTable,
  newsCategories as newsCategoriesTable,
  testimonials as testimonialsTable,
} from './schema/museum.js';
import {
  inventoryMovements as inventoryMovementsTable,
  productCategories as productCategoriesTable,
  productImages as productImagesTable,
  products as productsTable,
} from './schema/store.js';
import {
  invoiceTemplates as invoiceTemplatesTable,
  invoiceTemplateVersions as invoiceTemplateVersionsTable,
} from './schema/invoices.js';
import {
  DEFAULT_INVOICE_TEMPLATE_CONFIG,
  DEFAULT_INVOICE_TEMPLATE_NAME,
} from './seed-data/invoice-content.js';
import { CMS_MENUS, CMS_PAGES, CMS_SETTINGS } from './seed-data/cms-content.js';
import {
  COLLECTIONS as MUSEUM_COLLECTIONS,
  EXHIBITIONS as MUSEUM_EXHIBITIONS,
  FOUNDATION_PROGRAMS as MUSEUM_PROGRAMS,
  NEWS_ARTICLES as MUSEUM_ARTICLES,
  NEWS_CATEGORIES as MUSEUM_CATEGORIES,
  TESTIMONIALS as MUSEUM_TESTIMONIALS,
} from './seed-data/museum-content.js';
import {
  PERMISSION_SEEDS,
  ROLE_PERMISSIONS,
  ROLE_SEEDS,
} from './seed-data/permissions.js';
import {
  PRODUCT_CATEGORIES as STORE_CATEGORIES,
  PRODUCTS as STORE_PRODUCTS,
} from './seed-data/store-content.js';

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
 * (the seven migrated system pages, menus and public site settings). Phase 5
 * adds the `museum-content` step (the canonical museum/news/foundation
 * records). Phase 6 adds the `store-content` step (Gift Shop categories,
 * products, opening stock and placeholder store settings). Phase 7 adds
 * the `invoice-template` step (one default invoice template + version 1;
 * placeholder identity defaults for the client to edit — never a tax
 * number). They contain no accounts and no secrets, and are safe in every
 * environment including production (§13.3).
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
  {
    // Phase 5 content migration (CMS_CONTENT_MAPPING.md §3–§8, §10): the
    // canonical museum-module records from `seed-data/museum-content.ts`.
    // Idempotent by natural key, same rule as cms-content: a record whose
    // slug already exists is skipped whole (it may have been edited in the
    // admin since); testimonials have no slug, so their natural key is the
    // quote text. All records seed published. Field mappings (seed-data
    // vocabulary → §8 columns): collections itemCount is parsed back out
    // of the display string ("1,240 works" → 1240); exhibitions status
    // current|past → CURRENT|PAST, locationLabel → location; news
    // sourceName → outlet, publishedDate → published_on, articleType =
    // the category's name, categories resolve by slug first; programs
    // categoryLabel → category, impactMetric → impact_label; images land
    // in the legacy image_url/image_alt pair (BD-2, see schema header).
    name: 'museum-content',
    async run(db) {
      const existingCollectionSlugs = new Set(
        (await db.select({ slug: collectionsTable.slug }).from(collectionsTable)).map(
          (row) => row.slug,
        ),
      );
      for (const record of MUSEUM_COLLECTIONS) {
        if (existingCollectionSlugs.has(record.slug)) continue;
        await db.insert(collectionsTable).values({
          slug: record.slug,
          name: record.name,
          category: record.category,
          periodLabel: record.periodLabel,
          itemCount: Number(record.worksCountLabel.replace(/[^0-9]/g, '')) || null,
          imageUrl: record.image.url,
          imageAlt: record.image.alt,
          isFeatured: record.isFeatured,
          isPublished: true,
          sortOrder: record.sortOrder,
        });
      }

      const existingExhibitionSlugs = new Set(
        (await db.select({ slug: exhibitionsTable.slug }).from(exhibitionsTable)).map(
          (row) => row.slug,
        ),
      );
      for (const record of MUSEUM_EXHIBITIONS) {
        if (existingExhibitionSlugs.has(record.slug)) continue;
        await db.insert(exhibitionsTable).values({
          slug: record.slug,
          title: record.title,
          location: record.locationLabel,
          description: record.description,
          startsOn: record.startsOn,
          endsOn: record.endsOn,
          status: record.status === 'current' ? 'CURRENT' : 'PAST',
          curator: record.curator,
          category: record.category,
          coverAspect: record.coverAspect,
          imageUrl: record.image.url,
          imageAlt: record.image.alt,
          isFeatured: record.isFeatured,
          isPublished: true,
          sortOrder: record.sortOrder,
        });
      }

      // News categories first — articles resolve their category by slug.
      const categoryIdBySlug = new Map<string, number>();
      const categoryNameBySlug = new Map<string, string>();
      for (const row of await db
        .select({ id: newsCategoriesTable.id, slug: newsCategoriesTable.slug, name: newsCategoriesTable.name })
        .from(newsCategoriesTable)) {
        categoryIdBySlug.set(row.slug, row.id);
        categoryNameBySlug.set(row.slug, row.name);
      }
      for (const record of MUSEUM_CATEGORIES) {
        if (categoryIdBySlug.has(record.slug)) continue;
        const [inserted] = await db
          .insert(newsCategoriesTable)
          .values({ slug: record.slug, name: record.name, colorToken: record.colorToken })
          .$returningId();
        categoryIdBySlug.set(record.slug, inserted.id);
        categoryNameBySlug.set(record.slug, record.name);
      }

      const existingArticleSlugs = new Set(
        (await db.select({ slug: newsArticlesTable.slug }).from(newsArticlesTable)).map(
          (row) => row.slug,
        ),
      );
      for (const record of MUSEUM_ARTICLES) {
        if (existingArticleSlugs.has(record.slug)) continue;
        const categoryId = categoryIdBySlug.get(record.categorySlug);
        if (categoryId === undefined) {
          throw new Error(
            `seed museum-content: article '${record.slug}' references unknown news category '${record.categorySlug}'`,
          );
        }
        await db.insert(newsArticlesTable).values({
          slug: record.slug,
          title: record.title,
          categoryId,
          articleType: categoryNameBySlug.get(record.categorySlug) ?? null,
          outlet: record.sourceName,
          publishedOn: record.publishedDate,
          summary: record.summary,
          externalUrl: record.externalUrl,
          imageUrl: record.image?.url ?? null,
          imageAlt: record.image?.alt ?? null,
          isPublished: true,
        });
      }

      const existingProgramSlugs = new Set(
        (
          await db
            .select({ slug: foundationProgramsTable.slug })
            .from(foundationProgramsTable)
        ).map((row) => row.slug),
      );
      for (const record of MUSEUM_PROGRAMS) {
        if (existingProgramSlugs.has(record.slug)) continue;
        await db.insert(foundationProgramsTable).values({
          slug: record.slug,
          name: record.name,
          category: record.categoryLabel,
          description: record.description,
          impactLabel: record.impactMetric,
          iconName: record.iconName,
          isPublished: true,
          sortOrder: record.sortOrder,
        });
      }

      const existingQuotes = new Set(
        (await db.select({ quote: testimonialsTable.quote }).from(testimonialsTable)).map(
          (row) => row.quote,
        ),
      );
      for (const record of MUSEUM_TESTIMONIALS) {
        if (existingQuotes.has(record.quote)) continue;
        await db.insert(testimonialsTable).values({
          quote: record.quote,
          authorName: record.authorName,
          authorRole: record.authorRole,
          context: record.context,
          imageUrl: record.image?.url ?? null,
          imageAlt: record.image?.alt ?? null,
          isPublished: true,
          sortOrder: record.sortOrder,
        });
      }
    },
  },
  {
    // Phase 6 (DATABASE_DESIGN.md §9): the Gift Shop catalogue from
    // `seed-data/store-content.ts`. Idempotent by natural key, same rule
    // as the other content steps: categories skip by slug, products skip
    // by SKU (a skipped product keeps whatever stock/admin edits it has
    // accumulated — the seed never rewrites live inventory). Each newly
    // inserted product gets its primary image row (legacy image_url
    // pair, BD-2) and its opening ledger entry: stock_qty is set AND an
    // OPENING movement is written (§9.5 — the inventory ledger is the
    // source of truth, the column is its cache).
    //
    // ⚠ The seeded stock quantities are PLACEHOLDERS (10 per product —
    // no stock data exists in the source); the client's real counts
    // must replace them via admin inventory adjustments before launch.
    //
    // The store.* settings below are PLACEHOLDER DEFAULTS, filled only
    // when missing: no shipping fee, no tax, COD enabled. The real
    // fee/tax values are the client's decision (store settings screen).
    name: 'store-content',
    async run(db) {
      const categoryIdBySlug = new Map<string, number>();
      for (const row of await db
        .select({ id: productCategoriesTable.id, slug: productCategoriesTable.slug })
        .from(productCategoriesTable)) {
        categoryIdBySlug.set(row.slug, row.id);
      }
      for (const record of STORE_CATEGORIES) {
        if (categoryIdBySlug.has(record.slug)) continue;
        const [inserted] = await db
          .insert(productCategoriesTable)
          .values({
            slug: record.slug,
            name: record.name,
            sortOrder: record.sortOrder,
            isActive: record.isActive,
          })
          .$returningId();
        categoryIdBySlug.set(record.slug, inserted.id);
      }

      const existingSkus = new Set(
        (await db.select({ sku: productsTable.sku }).from(productsTable))
          .map((row) => row.sku)
          .filter((sku): sku is string => sku !== null),
      );
      for (const record of STORE_PRODUCTS) {
        if (existingSkus.has(record.sku)) continue;
        const categoryId = categoryIdBySlug.get(record.categorySlug);
        if (categoryId === undefined) {
          throw new Error(
            `seed store-content: product '${record.sku}' references unknown category '${record.categorySlug}'`,
          );
        }
        const [inserted] = await db
          .insert(productsTable)
          .values({
            slug: record.slug,
            sku: record.sku,
            name: record.name,
            categoryId,
            shortDescription: record.detail,
            price: record.price,
            stockQty: record.stockQuantity,
            status: record.isPublished ? 'ACTIVE' : 'DRAFT',
          })
          .$returningId();
        await db.insert(productImagesTable).values({
          productId: inserted.id,
          imageUrl: record.image.url,
          altText: record.image.alt,
          sortOrder: 0,
          isPrimary: true,
        });
        if (record.stockQuantity > 0) {
          await db.insert(inventoryMovementsTable).values({
            productId: inserted.id,
            variantId: null,
            movementType: 'OPENING',
            quantity: record.stockQuantity,
            balanceAfter: record.stockQuantity,
            reason: 'Initial stock (seed)',
          });
        }
      }

      // Store settings — fill-missing only (same rule as cms-content
      // settings): an existing key, however it got there, is never
      // overwritten by the seed.
      const existingSettingKeys = new Set(
        (
          await db
            .select({ key: siteSettingsTable.settingKey })
            .from(siteSettingsTable)
        ).map((row) => row.key),
      );
      const storeSettings: { key: string; value: string }[] = [
        { key: 'store.shipping_flat_fee', value: '0.00' },
        { key: 'store.tax_rate_percent', value: '0' },
        { key: 'store.cod_enabled', value: 'true' },
      ];
      for (const setting of storeSettings) {
        if (existingSettingKeys.has(setting.key)) continue;
        await db.insert(siteSettingsTable).values({
          settingKey: setting.key,
          settingValue: JSON.stringify(setting.value),
          isPublic: false,
        });
      }
    },
  },
  {
    // Phase 7 (DATABASE_DESIGN.md §10.3): the default invoice template
    // and its version 1, from `seed-data/invoice-content.ts`. Skip-if-any
    // rule like the other content steps: once a template exists the seed
    // never touches it — template editing belongs to the admin editor,
    // which versions every change.
    name: 'invoice-template',
    async run(db) {
      const existing = await db
        .select({ id: invoiceTemplatesTable.id })
        .from(invoiceTemplatesTable)
        .limit(1);
      if (existing.length > 0) return;
      const [template] = await db
        .insert(invoiceTemplatesTable)
        .values({ name: DEFAULT_INVOICE_TEMPLATE_NAME, isActive: true })
        .$returningId();
      const [version] = await db
        .insert(invoiceTemplateVersionsTable)
        .values({
          templateId: template.id,
          versionNo: 1,
          config: DEFAULT_INVOICE_TEMPLATE_CONFIG,
        })
        .$returningId();
      await db
        .update(invoiceTemplatesTable)
        .set({ currentVersionId: version.id })
        .where(eq(invoiceTemplatesTable.id, template.id));
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
