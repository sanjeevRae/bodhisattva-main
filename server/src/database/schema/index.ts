/**
 * Drizzle schema barrel — the authoring source for all migrations
 * (DATABASE_DESIGN.md §13.1).
 *
 * Phase 1 foundation set: authentication, authorization and the two system
 * tables the foundation needs. Later phases add their modules here
 * (auth-extras, cms, museum, ecommerce, invoices, system-extras) — one schema
 * module per design-document group, re-exported from this index.
 */
export * from './auth.js';
export * from './auth-challenges.js';
export * from './authorization.js';
export * from './cms.js';
export * from './media.js';
export * from './museum.js';
export * from './store.js';
export * from './invoices.js';
export * from './system.js';
