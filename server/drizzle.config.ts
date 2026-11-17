import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle Kit configuration (DATABASE_DESIGN.md §13.1).
 *
 * Schema is authored in `src/database/schema/`; generated SQL migrations land
 * in `drizzle/migrations/` with the standard journal and are always reviewed
 * by hand before commit.
 *
 * Connection for `drizzle-kit push`/introspection comes from DATABASE_URL
 * (e.g. mysql://bodhisattva:<password>@127.0.0.1:3306/bodhisattva_dev).
 * `generate` itself needs no live database.
 */
export default defineConfig({
  dialect: 'mysql',
  schema: './src/database/schema/index.ts',
  out: './drizzle/migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
  strict: true,
  verbose: true,
});
