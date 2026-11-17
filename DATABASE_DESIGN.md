# DATABASE_DESIGN.md — Bodhisattva Museum Dynamic Platform

**Phase:** 0 — Audit & Planning (design only)
**Target:** MySQL 8.0+ **or** MariaDB 10.6+ on cPanel shared hosting, InnoDB, utf8mb4.
**Companion:** `ARCHITECTURE.md` (system design), `PERMISSIONS.md` (role/permission matrix).

> ⏳ **Hosting caveat:** the exact server (MySQL vs MariaDB) and version on the production cPanel account are **not yet verified** (Phase 0 hosting audit). This schema deliberately avoids features whose support differs between MySQL 8.0 and MariaDB 10.6 except where a fallback is named. Where a feature *is* version-sensitive it is flagged inline with ⏳.

---

## 1. Scope

This document defines every table required by Part 4 of the master specification, plus four supporting tables the specification's own rules make necessary:

| Addition | Why |
|---|---|
| `rate_limits` | Spec §15.3 requires persistent, restart-safe rate limiting; Redis cannot be assumed on cPanel, so limits live in MySQL (§11) |
| `invoice_sequences` | Guarantees gap-controlled, duplicate-proof invoice numbers inside the approval transaction (§10.2) |
| `media_folders` | Spec §5.6 requires media categories/folders |
| `site_setting_history` is **not** added | Settings changes are already captured in `audit_logs` with before/after metadata |

Total: **41 tables**.

---

## 2. Global conventions ✅

1. **Engine/charset:** every table `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`. (MariaDB/MySQL sort-order differences in `unicode_ci` vs `0900_ai_ci` are acceptable; email uniqueness does **not** rely on collation alone — see §2.4.)
2. **Primary keys:** `id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT`. Surrogate, never reused, never exposed as a security boundary.
3. **Timestamps:** `created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)`, `updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)`. All values written in **UTC**; the application sets `SET time_zone = '+00:00'` on every pooled connection so server-side defaults are also UTC. Audit timestamps are UTC (spec Part 4).
4. **Soft deletion:** content/business tables carry `deleted_at DATETIME(3) NULL` (NULL = live). Rows with order history, audit relevance or invoice relevance are **never hard-deleted** by application code. Purely ephemeral tables (sessions, codes, tokens, rate limits) are hard-deleted by cleanup jobs.
5. **Money:** `DECIMAL(12,2)` — never `FLOAT`/`DOUBLE`. Currency `CHAR(3) NOT NULL DEFAULT 'NPR'` on orders/invoices. Prices are tax-inclusive display values unless store settings say otherwise; all arithmetic is done server-side in decimal (spec §10.4).
6. **Booleans:** `TINYINT(1) NOT NULL DEFAULT 0`.
7. **JSON columns:** used only for *schema-validated configuration snapshots* (section config, invoice template config, invoice data snapshot, audit metadata). Anything queried, filtered or joined is a real column. ⏳ `CHECK (JSON_VALID(...))` is **not** used (MariaDB auto-validates JSON; MySQL stores TEXT-backed JSON) — validity is enforced by Zod in the application.
8. **Foreign keys:** `ON DELETE RESTRICT` everywhere except pure join/child tables noted per-table (`ON DELETE CASCADE` only where the child is meaningless alone, e.g. `cart_items`, `role_permissions`). `ON UPDATE RESTRICT` everywhere. FK columns are always indexed.
9. **Naming:** snake_case tables (plural), snake_case columns, FK columns `<singular>_id`, index names `idx_<table>_<cols>`, unique keys `uq_<table>_<cols>`, FK names `fk_<table>_<col>`.
10. **Emails:** stored twice — `email` (as entered, trimmed) and `email_normalized` (lowercased, trimmed) with the **unique constraint on `email_normalized`**. Uniqueness therefore does not depend on column collation.
11. **Secrets:** no table ever stores a plaintext password, OTP, token, session id, TOTP secret (plaintext) or recovery code. Hashing/encryption per table notes: passwords Argon2id; session ids SHA-256; OTP codes HMAC-SHA-256 (keyed, env secret); reset/invitation tokens SHA-256; TOTP secrets AES-256-GCM encrypted; recovery codes SHA-256.
12. **Status columns:** `VARCHAR(32)` with application-level enums mirrored in `shared/` TypeScript — **not** MySQL `ENUM`, so adding a status never requires an `ALTER TABLE` on a live table. ⏳ `CHECK` constraints on status values are intentionally omitted for MariaDB/MySQL parity; integrity is enforced in services + tested.

---

## 3. Entity map (grouped)

```
AUTH          users ──< user_sessions, email_verification_codes, password_reset_tokens
AUTHORIZATION roles ──< role_permissions >── permissions ; users ──< user_roles >── roles
ADMIN SEC.    invitations (→ roles) ; users ──< mfa_credentials, mfa_recovery_codes
CMS           pages ──< page_revisions ──< page_sections ; menus ──< menu_items ;
              site_settings ; media_folders ──< media_assets
MUSEUM        collections ; exhibitions ; gallery_items (→ exhibitions) ;
              news_categories ──< news_articles ; foundation_programs ; testimonials
ECOMMERCE     product_categories ──< products ──< product_images, product_variants ;
              products ──< inventory_movements ; users ──< carts ──< cart_items >── products/variants ;
              users ──< customer_addresses ; users ──< orders ──< order_items, order_status_history
INVOICES      orders ── invoices ; invoice_templates ──< invoice_template_versions ; invoice_sequences
SYSTEM        email_outbox ; audit_logs ; contact_submissions ; rate_limits
```

---

## 4. Authentication tables

### 4.1 `users`

One table for customers **and** administrators (spec Part 8: admins are users with admin roles, created by invitation only). Account kind is expressed through `user_roles`, never a flag that could be flipped by registration code.

```sql
CREATE TABLE users (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  full_name         VARCHAR(120)    NOT NULL,
  email             VARCHAR(254)    NOT NULL,
  email_normalized  VARCHAR(254)    NOT NULL,
  phone             VARCHAR(32)     NULL,
  password_hash     VARCHAR(255)    NULL,              -- NULL until invitation accepted / registration verified sets it
  email_verified_at DATETIME(3)     NULL,
  status            VARCHAR(20)     NOT NULL DEFAULT 'PENDING_VERIFICATION',
                    -- PENDING_VERIFICATION | ACTIVE | SUSPENDED | INVITED | DEACTIVATED
  last_login_at     DATETIME(3)     NULL,
  created_at        DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at        DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at        DATETIME(3)     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email_normalized (email_normalized),
  KEY idx_users_status (status),
  KEY idx_users_phone (phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

Notes:
- Registration creates the row as `PENDING_VERIFICATION` with `password_hash` set (hash of the chosen password) but the account **cannot log in** until `email_verified_at` is set by OTP success (spec §7.1 step 12). An unverified account is never an active customer.
- Invited admins are created as `INVITED` with `password_hash NULL`; accepting the invitation sets the password, requires MFA enrolment, then flips to `ACTIVE`.
- `SUSPENDED`/`DEACTIVATED` block login at the session-resolution layer (existing sessions revoked in the same admin action).
- Soft-deleted users keep their orders/invoices (FK `RESTRICT`); PII minimisation on deletion is an anonymisation job, not row removal.

### 4.2 `user_sessions`

```sql
CREATE TABLE user_sessions (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  session_id_hash   CHAR(64)        NOT NULL,          -- SHA-256 hex of the cookie value; raw id never stored
  user_id           BIGINT UNSIGNED NOT NULL,
  auth_level        VARCHAR(20)     NOT NULL DEFAULT 'PASSWORD',
                    -- PASSWORD | MFA_VERIFIED
  ip_address        VARCHAR(45)     NULL,              -- IPv4/IPv6 text
  user_agent        VARCHAR(512)    NULL,
  created_at        DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_seen_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at        DATETIME(3)     NOT NULL,          -- absolute expiry; idle expiry enforced via last_seen_at
  revoked_at        DATETIME(3)     NULL,
  revoke_reason     VARCHAR(40)     NULL,              -- LOGOUT | LOGOUT_ALL | PASSWORD_CHANGE | ROLE_CHANGE | ADMIN_ACTION | EXPIRED
  step_up_at        DATETIME(3)     NULL,              -- last fresh-MFA time for sensitive actions
  PRIMARY KEY (id),
  UNIQUE KEY uq_sessions_hash (session_id_hash),
  KEY idx_sessions_user (user_id, revoked_at),
  KEY idx_sessions_expiry (expires_at),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

Notes: session lookup is one indexed query on the hash. Rotation = insert new row + revoke old row, in the login/MFA transaction. Cleanup job hard-deletes rows 30 days after expiry/revocation (audit events about logins live in `audit_logs`, not here).

### 4.3 `email_verification_codes`

```sql
CREATE TABLE email_verification_codes (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id           BIGINT UNSIGNED NOT NULL,
  code_hmac         CHAR(64)        NOT NULL,          -- HMAC-SHA-256(server OTP key, user_id || ':' || code)
  attempts          TINYINT UNSIGNED NOT NULL DEFAULT 0,
  max_attempts      TINYINT UNSIGNED NOT NULL DEFAULT 5,
  expires_at        DATETIME(3)     NOT NULL,          -- issue + 10 minutes (config)
  consumed_at       DATETIME(3)     NULL,
  created_at        DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_evc_user_active (user_id, consumed_at, expires_at),
  CONSTRAINT fk_evc_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

Notes (spec §7.1): the 8-digit code itself is never stored or logged; only its keyed HMAC. Verification compares HMACs in constant time. Issuing a new code invalidates previous unconsumed codes for that user (set `consumed_at`). Attempt counter increments on every failed verify; at `max_attempts` the code is dead even if unexpired. Send-rate policy (3/hour/email, 60 s cooldown) is enforced via `rate_limits` (§11) plus a check on the latest `created_at`.

### 4.4 `password_reset_tokens`

```sql
CREATE TABLE password_reset_tokens (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id           BIGINT UNSIGNED NOT NULL,
  token_hash        CHAR(64)        NOT NULL,          -- SHA-256 hex of the 256-bit token in the email link
  expires_at        DATETIME(3)     NOT NULL,          -- issue + 60 minutes (config)
  consumed_at       DATETIME(3)     NULL,
  created_at        DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  request_ip        VARCHAR(45)     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_prt_token_hash (token_hash),
  KEY idx_prt_user (user_id, consumed_at),
  CONSTRAINT fk_prt_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

Notes: single-use; a successful reset consumes the token, revokes **all** user sessions, and writes an audit event. Requesting a reset returns the same response whether or not the email exists (no enumeration).

---

## 5. Authorization tables

### 5.1 `roles`

```sql
CREATE TABLE roles (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code        VARCHAR(40)  NOT NULL,                   -- SUPER_ADMIN | ADMIN | STORE_ADMIN | CUSTOMER
  name        VARCHAR(80)  NOT NULL,
  description VARCHAR(255) NULL,
  is_system   TINYINT(1)   NOT NULL DEFAULT 1,         -- system roles cannot be deleted/renamed
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_roles_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 5.2 `permissions`

```sql
CREATE TABLE permissions (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code        VARCHAR(80)  NOT NULL,                   -- e.g. 'cms.pages.publish', 'store.orders.approve'
  module      VARCHAR(40)  NOT NULL,                   -- cms | museum | news | foundation | store | users | audit | settings
  description VARCHAR(255) NULL,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_permissions_code (code),
  KEY idx_permissions_module (module)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

The permission catalogue is code-defined (in `shared/`) and **seeded** (§13); the database is the runtime source the middleware checks, the seed is the deployment source. Adding a permission = code change + seed update, never an ad-hoc admin edit.

### 5.3 `role_permissions`

```sql
CREATE TABLE role_permissions (
  role_id       BIGINT UNSIGNED NOT NULL,
  permission_id BIGINT UNSIGNED NOT NULL,
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (role_id, permission_id),
  KEY idx_rp_permission (permission_id),
  CONSTRAINT fk_rp_role FOREIGN KEY (role_id) REFERENCES roles (id) ON DELETE CASCADE,
  CONSTRAINT fk_rp_permission FOREIGN KEY (permission_id) REFERENCES permissions (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 5.4 `user_roles`

```sql
CREATE TABLE user_roles (
  user_id    BIGINT UNSIGNED NOT NULL,
  role_id    BIGINT UNSIGNED NOT NULL,
  granted_by BIGINT UNSIGNED NULL,                     -- admin who granted; NULL for self-registered CUSTOMER / bootstrap
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, role_id),
  KEY idx_ur_role (role_id),
  CONSTRAINT fk_ur_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_ur_role FOREIGN KEY (role_id) REFERENCES roles (id) ON DELETE RESTRICT,
  CONSTRAINT fk_ur_grantor FOREIGN KEY (granted_by) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

Notes: a user may hold exactly one *administrative* role plus `CUSTOMER`; the service layer enforces "highest privilege wins" for session permission resolution and forbids granting admin roles except through the invitation flow or Super Admin action (all audited). Role changes revoke the target's sessions (privilege change ⇒ rotation, spec §7.4).

---

## 6. Administrative security tables

### 6.1 `invitations`

```sql
CREATE TABLE invitations (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email         VARCHAR(254)    NOT NULL,
  email_normalized VARCHAR(254) NOT NULL,
  role_id       BIGINT UNSIGNED NOT NULL,              -- role the account will receive (never CUSTOMER)
  token_hash    CHAR(64)        NOT NULL,              -- SHA-256 hex; raw token only in the invitation email/link
  invited_by    BIGINT UNSIGNED NOT NULL,              -- Super Admin
  expires_at    DATETIME(3)     NOT NULL,              -- issue + 72 hours (config)
  accepted_at   DATETIME(3)     NULL,
  accepted_user_id BIGINT UNSIGNED NULL,               -- set on acceptance
  revoked_at    DATETIME(3)     NULL,
  created_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_invitations_token (token_hash),
  KEY idx_invitations_email (email_normalized, revoked_at, accepted_at),
  CONSTRAINT fk_inv_role FOREIGN KEY (role_id) REFERENCES roles (id) ON DELETE RESTRICT,
  CONSTRAINT fk_inv_by FOREIGN KEY (invited_by) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_inv_user FOREIGN KEY (accepted_user_id) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

Notes: one live invitation per email (service revokes predecessors on re-issue). Acceptance is a single transaction: validate hash + expiry + not-consumed → create/activate user → assign role → require MFA enrolment before first admin session → mark consumed → audit. Expired/revoked/accepted are terminal states.

### 6.2 `mfa_credentials`

```sql
CREATE TABLE mfa_credentials (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id           BIGINT UNSIGNED NOT NULL,
  type              VARCHAR(20)     NOT NULL DEFAULT 'TOTP',
  secret_encrypted  VARBINARY(512)  NOT NULL,          -- AES-256-GCM(secret, TOTP_ENCRYPTION_KEY) — never plaintext
  confirmed_at      DATETIME(3)     NULL,              -- set after first successful verification during enrolment
  last_used_at      DATETIME(3)     NULL,
  last_used_counter BIGINT          NULL,              -- TOTP time-step counter, replay protection
  created_at        DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_mfa_user_type (user_id, type),
  CONSTRAINT fk_mfa_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

Notes: one TOTP credential per user. Login verification rejects a time-step `<= last_used_counter` (replay). Admin MFA reset (by Super Admin) deletes the row, revokes sessions, forces re-enrolment, and is audited. The encryption key lives only in server env (`TOTP_ENCRYPTION_KEY`), separate from the DB credentials — a DB dump alone does not expose TOTP secrets.

### 6.3 `mfa_recovery_codes`

```sql
CREATE TABLE mfa_recovery_codes (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     BIGINT UNSIGNED NOT NULL,
  code_hash   CHAR(64)        NOT NULL,                -- SHA-256 hex of the normalised code
  used_at     DATETIME(3)     NULL,
  created_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_mrc_user (user_id, used_at),
  CONSTRAINT fk_mrc_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

Notes: 10 codes generated at enrolment, shown once, each single-use. Regeneration deletes all previous rows (in the same audited action). Codes are never logged or emailed after the one-time display.

---

## 7. CMS tables

### 7.1 `pages`

```sql
CREATE TABLE pages (
  id                     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug                   VARCHAR(160)    NOT NULL,        -- '' for home is stored as 'home'; URL path derived from slug
  title                  VARCHAR(200)    NOT NULL,
  status                 VARCHAR(20)     NOT NULL DEFAULT 'DRAFT',
                         -- DRAFT | PUBLISHED | ARCHIVED
  is_system              TINYINT(1)      NOT NULL DEFAULT 0,  -- the 7 existing pages: slug locked, undeletable
  seo_title              VARCHAR(200)    NULL,
  meta_description       VARCHAR(320)    NULL,
  og_image_media_id      BIGINT UNSIGNED NULL,
  draft_revision_id      BIGINT UNSIGNED NULL,          -- FK added after page_revisions exists (§7.3)
  published_revision_id  BIGINT UNSIGNED NULL,          -- FK added after page_revisions exists (§7.3)
  published_at           DATETIME(3)     NULL,
  created_by             BIGINT UNSIGNED NULL,
  updated_by             BIGINT UNSIGNED NULL,
  created_at             DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at             DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at             DATETIME(3)     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_pages_slug (slug),
  KEY idx_pages_status (status, deleted_at),
  CONSTRAINT fk_pages_og_image FOREIGN KEY (og_image_media_id) REFERENCES media_assets (id) ON DELETE RESTRICT,
  CONSTRAINT fk_pages_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_pages_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

> Migration-order note: `pages` is created before `page_revisions` without the two revision FKs; a follow-up `ALTER TABLE` in the same migration adds `fk_pages_draft_revision` / `fk_pages_published_revision` once `page_revisions` exists (circular reference pages ↔ revisions is intentional and resolved this way).

### 7.2 `page_revisions`

```sql
CREATE TABLE page_revisions (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  page_id       BIGINT UNSIGNED NOT NULL,
  revision_no   INT UNSIGNED    NOT NULL,               -- per-page, monotonically increasing
  version       INT UNSIGNED    NOT NULL DEFAULT 1,     -- optimistic-concurrency counter for draft edits
  label         VARCHAR(120)    NULL,                   -- optional admin note ("Fixed hero text")
  created_by    BIGINT UNSIGNED NULL,
  created_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_revisions_page_no (page_id, revision_no),
  KEY idx_revisions_page (page_id, created_at),
  CONSTRAINT fk_rev_page FOREIGN KEY (page_id) REFERENCES pages (id) ON DELETE RESTRICT,
  CONSTRAINT fk_rev_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 7.3 The revision / publication model ✅

- A page's content lives **only** in `page_sections` rows that belong to a revision (§7.4). Revisions are immutable once created: editing never updates a published revision's sections.
- **Edit flow:** opening the builder on a page whose draft == published revision first *clones* the published revision (new revision row + copies of its section rows — pages have ~7–20 sections, so cloning is cheap) and points `draft_revision_id` at the clone. All builder edits (content, order, visibility) write to the draft revision's sections only. `version` increments on every save batch; a stale editor saving with an old `version` gets `409 CONFLICT` (spec §5.4 optimistic concurrency).
- **Publish flow (single transaction):** validate every section config against its Zod schema → set `published_revision_id = draft_revision_id`, `status='PUBLISHED'`, `published_at=NOW()` → audit `cms.pages.publish`. Pointer swap ⇒ atomic, instant, and a validation failure leaves the previously published revision live (spec §5.5).
- **Rollback:** admin picks any earlier revision → publish flow points `published_revision_id` at it and starts a fresh draft clone from it. Nothing is deleted; history is the revision list itself.
- **Autosave** writes draft sections + bumps `version`; drafts are never publicly visible because public reads resolve strictly through `published_revision_id`.
- Retention: revisions are kept indefinitely by default (storage is trivial); an optional prune job (keep ≥ 20 per page) is a Phase 8 operations decision, never automatic in v1.

### 7.4 `page_sections`

```sql
CREATE TABLE page_sections (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  revision_id   BIGINT UNSIGNED NOT NULL,
  type          VARCHAR(60)     NOT NULL,               -- registry key: hero | rich_text | image_text | collection_grid | …
  sort_order    INT             NOT NULL,
  is_visible    TINYINT(1)      NOT NULL DEFAULT 1,
  config        JSON            NOT NULL,               -- content + data-source config; Zod-validated per type
  design        JSON            NULL,                   -- presentation options (background, alignment, spacing…)
  created_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_sections_revision_order (revision_id, sort_order),
  KEY idx_sections_type (type),
  CONSTRAINT fk_sections_revision FOREIGN KEY (revision_id) REFERENCES page_revisions (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

Notes: `config`/`design` are validated against the section registry's Zod schemas on **every** save and again at publish (defence in depth). Rich-text HTML inside config is sanitised server-side at save time. Reorder = one transaction renumbering `sort_order` (0..n) for the draft revision. Media references inside config are media **ids**, resolved at render — the media orphan scan (§11 jobs) parses configs to find references.

### 7.5 `menus` and `menu_items`

```sql
CREATE TABLE menus (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code       VARCHAR(40)  NOT NULL,                     -- primary | footer_visit | footer_engage | footer_connect | mobile
  name       VARCHAR(80)  NOT NULL,
  created_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_menus_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE menu_items (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  menu_id     BIGINT UNSIGNED NOT NULL,
  parent_id   BIGINT UNSIGNED NULL,                     -- reserved for future nesting; v1 renders one level
  label       VARCHAR(120)    NOT NULL,
  link_type   VARCHAR(10)     NOT NULL DEFAULT 'PAGE',  -- PAGE | EXTERNAL | ANCHOR
  page_id     BIGINT UNSIGNED NULL,                     -- when link_type = PAGE
  url         VARCHAR(500)    NULL,                     -- when link_type = EXTERNAL/ANCHOR
  sort_order  INT             NOT NULL DEFAULT 0,
  is_visible  TINYINT(1)      NOT NULL DEFAULT 1,
  created_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_items_menu_order (menu_id, sort_order),
  CONSTRAINT fk_items_menu FOREIGN KEY (menu_id) REFERENCES menus (id) ON DELETE CASCADE,
  CONSTRAINT fk_items_parent FOREIGN KEY (parent_id) REFERENCES menu_items (id) ON DELETE RESTRICT,
  CONSTRAINT fk_items_page FOREIGN KEY (page_id) REFERENCES pages (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 7.6 `site_settings`

```sql
CREATE TABLE site_settings (
  setting_key   VARCHAR(80)  NOT NULL,                  -- site_name | contact_phone | contact_email | opening_hours |
                                                        -- social_facebook | … | store_shipping_fee | store_tax_enabled | invoice_prefix
  setting_value TEXT         NULL,                      -- JSON-encoded for structured values
  is_public     TINYINT(1)   NOT NULL DEFAULT 0,        -- exposed via GET /api/site
  updated_by    BIGINT UNSIGNED NULL,
  updated_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (setting_key),
  CONSTRAINT fk_settings_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

Notes: key–value by design (settings are heterogeneous and few). Secrets are **never** settings — SMTP passwords, keys etc. live only in server env. Every change is audited with old/new values (non-secret keys only).

### 7.7 `media_folders` and `media_assets`

```sql
CREATE TABLE media_folders (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name       VARCHAR(120) NOT NULL,
  parent_id  BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_folders_parent (parent_id),
  CONSTRAINT fk_folders_parent FOREIGN KEY (parent_id) REFERENCES media_folders (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE media_assets (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  folder_id      BIGINT UNSIGNED NULL,
  storage_name   VARCHAR(120)    NOT NULL,              -- random 128-bit name + extension; never the original filename
  original_name  VARCHAR(255)    NULL,                  -- display only
  mime_type      VARCHAR(100)    NOT NULL,              -- sniffed server-side, not client-supplied
  file_size      BIGINT UNSIGNED NOT NULL,              -- bytes (re-encoded master)
  width          INT UNSIGNED    NULL,
  height         INT UNSIGNED    NULL,
  alt_text       VARCHAR(255)    NULL,
  caption        VARCHAR(500)    NULL,
  uploaded_by    BIGINT UNSIGNED NULL,
  created_at     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at     DATETIME(3)     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_media_storage_name (storage_name),
  KEY idx_media_folder (folder_id, deleted_at),
  KEY idx_media_created (created_at),
  CONSTRAINT fk_media_folder FOREIGN KEY (folder_id) REFERENCES media_folders (id) ON DELETE RESTRICT,
  CONSTRAINT fk_media_by FOREIGN KEY (uploaded_by) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

Notes: physical layout in `ARCHITECTURE.md` §9. Derivative sizes are generated files derived from `storage_name` (deterministic suffixes), not separate rows. Deleting a referenced asset is blocked at the service layer (reference scan across section configs, products, exhibitions, templates); unreferenced assets can be soft-deleted, then hard-deleted with their files by an admin-confirmed purge.

---

## 8. Museum tables

### 8.1 `collections`

```sql
CREATE TABLE collections (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug         VARCHAR(160)    NOT NULL,
  name         VARCHAR(200)    NOT NULL,
  category     VARCHAR(80)     NULL,                    -- Sculpture | Painting | Manuscripts | Coins | Textiles | Contemporary
  period_label VARCHAR(120)    NULL,                    -- '1st – 5th Century CE'
  description  TEXT            NULL,
  history      TEXT            NULL,
  cover_media_id BIGINT UNSIGNED NULL,
  item_count   INT UNSIGNED    NULL,                    -- curatorial figure shown publicly (e.g. 487 works); display data, not stock
  is_featured  TINYINT(1)      NOT NULL DEFAULT 0,
  is_published TINYINT(1)      NOT NULL DEFAULT 0,
  sort_order   INT             NOT NULL DEFAULT 0,
  created_by   BIGINT UNSIGNED NULL,
  updated_by   BIGINT UNSIGNED NULL,
  created_at   DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at   DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at   DATETIME(3)     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_collections_slug (slug),
  KEY idx_collections_pub (is_published, is_featured, sort_order),
  CONSTRAINT fk_collections_cover FOREIGN KEY (cover_media_id) REFERENCES media_assets (id) ON DELETE RESTRICT,
  CONSTRAINT fk_collections_cb FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_collections_ub FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 8.2 `exhibitions`

```sql
CREATE TABLE exhibitions (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug           VARCHAR(160)    NOT NULL,
  title          VARCHAR(220)    NOT NULL,
  description    TEXT            NULL,
  cover_media_id BIGINT UNSIGNED NULL,
  location       VARCHAR(160)    NULL,                  -- 'Main Hall', 'East Wing'…
  starts_on      DATE            NULL,
  ends_on        DATE            NULL,
  status         VARCHAR(20)     NOT NULL DEFAULT 'UPCOMING',
                 -- UPCOMING | CURRENT | PAST  (admin-set; date-derived display is a service concern)
  is_featured    TINYINT(1)      NOT NULL DEFAULT 0,
  is_published   TINYINT(1)      NOT NULL DEFAULT 0,
  sort_order     INT             NOT NULL DEFAULT 0,
  created_by     BIGINT UNSIGNED NULL,
  updated_by     BIGINT UNSIGNED NULL,
  created_at     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at     DATETIME(3)     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_exhibitions_slug (slug),
  KEY idx_exhibitions_pub (is_published, status, starts_on),
  CONSTRAINT fk_exhibitions_cover FOREIGN KEY (cover_media_id) REFERENCES media_assets (id) ON DELETE RESTRICT,
  CONSTRAINT fk_exhibitions_cb FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_exhibitions_ub FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

Gallery images beyond the cover are `gallery_items` rows linked by `exhibition_id` (§8.3) — one image store for the whole museum domain, no separate exhibition-images table.

### 8.3 `gallery_items`

```sql
CREATE TABLE gallery_items (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  media_id       BIGINT UNSIGNED NOT NULL,
  exhibition_id  BIGINT UNSIGNED NULL,                  -- NULL = standalone gallery piece
  title          VARCHAR(220)    NULL,
  caption        VARCHAR(500)    NULL,
  category       VARCHAR(80)     NULL,                  -- buddhist | historical | thematic | contemporary (matches current Gallery filters)
  year           SMALLINT        NULL,
  sort_order     INT             NOT NULL DEFAULT 0,
  is_published   TINYINT(1)      NOT NULL DEFAULT 0,
  created_by     BIGINT UNSIGNED NULL,
  created_at     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at     DATETIME(3)     NULL,
  PRIMARY KEY (id),
  KEY idx_gallery_filter (is_published, year, category, sort_order),
  KEY idx_gallery_exhibition (exhibition_id),
  CONSTRAINT fk_gallery_media FOREIGN KEY (media_id) REFERENCES media_assets (id) ON DELETE RESTRICT,
  CONSTRAINT fk_gallery_exhibition FOREIGN KEY (exhibition_id) REFERENCES exhibitions (id) ON DELETE RESTRICT,
  CONSTRAINT fk_gallery_cb FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 8.4 `news_categories` and `news_articles`

```sql
CREATE TABLE news_categories (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug       VARCHAR(120) NOT NULL,
  name       VARCHAR(120) NOT NULL,
  created_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_news_categories_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE news_articles (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  category_id    BIGINT UNSIGNED NULL,
  title          VARCHAR(255)    NOT NULL,
  outlet         VARCHAR(160)    NULL,                  -- publication/source: 'The Hindu', 'Art Nepal Magazine'…
  article_type   VARCHAR(40)     NULL,                  -- News | Interview | Feature | Press Release | Review (current design's labels)
  summary        TEXT            NULL,
  published_on   DATE            NULL,
  external_url   VARCHAR(500)    NULL,
  document_media_id BIGINT UNSIGNED NULL,               -- uploaded clipping/document alternative to external_url
  cover_media_id BIGINT UNSIGNED NULL,
  is_published   TINYINT(1)      NOT NULL DEFAULT 0,
  created_by     BIGINT UNSIGNED NULL,
  updated_by     BIGINT UNSIGNED NULL,
  created_at     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at     DATETIME(3)     NULL,
  PRIMARY KEY (id),
  KEY idx_news_pub (is_published, published_on),
  KEY idx_news_category (category_id),
  FULLTEXT KEY ft_news_search (title, summary, outlet),
  CONSTRAINT fk_news_category FOREIGN KEY (category_id) REFERENCES news_categories (id) ON DELETE RESTRICT,
  CONSTRAINT fk_news_doc FOREIGN KEY (document_media_id) REFERENCES media_assets (id) ON DELETE RESTRICT,
  CONSTRAINT fk_news_cover FOREIGN KEY (cover_media_id) REFERENCES media_assets (id) ON DELETE RESTRICT,
  CONSTRAINT fk_news_cb FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_news_ub FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

Notes: the FULLTEXT index powers the News page search (spec §6.4). ⏳ FULLTEXT on InnoDB is supported by both MySQL 8 and MariaDB 10.6; if the verified host disables it, the fallback is a `LIKE`-based search on the same columns (slower, acceptable at this catalogue size) — decided at Phase 5, no schema change either way.

### 8.5 `foundation_programs`

```sql
CREATE TABLE foundation_programs (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug           VARCHAR(160)    NOT NULL,
  name           VARCHAR(200)    NOT NULL,
  category       VARCHAR(80)     NULL,                  -- Education | Artist Support | Access | Heritage
  description    TEXT            NULL,
  impact_label   VARCHAR(160)    NULL,                  -- '6,200 students per year'
  cover_media_id BIGINT UNSIGNED NULL,
  is_featured    TINYINT(1)      NOT NULL DEFAULT 0,
  is_published   TINYINT(1)      NOT NULL DEFAULT 0,
  sort_order     INT             NOT NULL DEFAULT 0,
  created_by     BIGINT UNSIGNED NULL,
  updated_by     BIGINT UNSIGNED NULL,
  created_at     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at     DATETIME(3)     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_programs_slug (slug),
  KEY idx_programs_pub (is_published, is_featured, sort_order),
  CONSTRAINT fk_programs_cover FOREIGN KEY (cover_media_id) REFERENCES media_assets (id) ON DELETE RESTRICT,
  CONSTRAINT fk_programs_cb FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_programs_ub FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

Foundation impact statistics (programs count, students reached, grants) are `site_settings` keys rendered by the statistics section — they are site-wide figures, not program rows.

### 8.6 `testimonials`

```sql
CREATE TABLE testimonials (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  quote          TEXT            NOT NULL,
  author_name    VARCHAR(120)    NOT NULL,
  author_role    VARCHAR(160)    NULL,                  -- 'Living Craft Fellow, 2024'
  avatar_media_id BIGINT UNSIGNED NULL,
  context        VARCHAR(40)     NOT NULL DEFAULT 'FOUNDATION',  -- FOUNDATION | GENERAL
  is_published   TINYINT(1)      NOT NULL DEFAULT 0,
  sort_order     INT             NOT NULL DEFAULT 0,
  created_by     BIGINT UNSIGNED NULL,
  created_at     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at     DATETIME(3)     NULL,
  PRIMARY KEY (id),
  KEY idx_testimonials_pub (context, is_published, sort_order),
  CONSTRAINT fk_testimonials_avatar FOREIGN KEY (avatar_media_id) REFERENCES media_assets (id) ON DELETE RESTRICT,
  CONSTRAINT fk_testimonials_cb FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

---

## 9. Ecommerce tables

### 9.1 `product_categories`

```sql
CREATE TABLE product_categories (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug        VARCHAR(140)    NOT NULL,
  name        VARCHAR(140)    NOT NULL,
  description VARCHAR(500)    NULL,
  sort_order  INT             NOT NULL DEFAULT 0,
  is_active   TINYINT(1)      NOT NULL DEFAULT 1,
  created_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_product_categories_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 9.2 `products`

```sql
CREATE TABLE products (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  category_id      BIGINT UNSIGNED NULL,
  slug             VARCHAR(180)    NOT NULL,
  sku              VARCHAR(60)     NULL,
  name             VARCHAR(220)    NOT NULL,
  short_description VARCHAR(500)   NULL,                -- card/detail line, matches current design ('detail' text)
  description      TEXT            NULL,
  price            DECIMAL(12,2)   NOT NULL,            -- regular price, NPR
  sale_price       DECIMAL(12,2)   NULL,                -- NULL = not on sale; effective price = COALESCE(sale_price, price)
  stock_qty        INT             NOT NULL DEFAULT 0,  -- cached balance; the ledger (§9.5) is the proof
  track_inventory  TINYINT(1)      NOT NULL DEFAULT 1,
  status           VARCHAR(20)     NOT NULL DEFAULT 'DRAFT',
                   -- DRAFT | ACTIVE | ARCHIVED
  is_featured      TINYINT(1)      NOT NULL DEFAULT 0,
  created_by       BIGINT UNSIGNED NULL,
  updated_by       BIGINT UNSIGNED NULL,
  created_at       DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at       DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at       DATETIME(3)     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_products_slug (slug),
  UNIQUE KEY uq_products_sku (sku),
  KEY idx_products_public (status, category_id, is_featured),
  KEY idx_products_name (name),
  CONSTRAINT fk_products_category FOREIGN KEY (category_id) REFERENCES product_categories (id) ON DELETE RESTRICT,
  CONSTRAINT fk_products_cb FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_products_ub FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

Notes: products with order history are archived, never deleted (service enforces; `deleted_at` is for pre-sale mistakes only and the service refuses it once an `order_items` row references the product). Effective price is always computed server-side from `price`/`sale_price` at cart/checkout time — the browser never submits prices (spec §10.3).

### 9.3 `product_images`

```sql
CREATE TABLE product_images (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  product_id BIGINT UNSIGNED NOT NULL,
  media_id   BIGINT UNSIGNED NOT NULL,
  alt_text   VARCHAR(255)    NULL,
  sort_order INT             NOT NULL DEFAULT 0,
  is_primary TINYINT(1)      NOT NULL DEFAULT 0,
  created_at DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_pimages_product (product_id, sort_order),
  CONSTRAINT fk_pimages_product FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE,
  CONSTRAINT fk_pimages_media FOREIGN KEY (media_id) REFERENCES media_assets (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 9.4 `product_variants`

```sql
CREATE TABLE product_variants (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  product_id  BIGINT UNSIGNED NOT NULL,
  sku         VARCHAR(60)     NULL,
  name        VARCHAR(160)    NOT NULL,                 -- 'A2 Print', 'Hardcover'…
  price_delta DECIMAL(12,2)   NOT NULL DEFAULT 0.00,    -- added to product effective price; may be negative
  stock_qty   INT             NOT NULL DEFAULT 0,       -- variants carry their own stock when present
  is_active   TINYINT(1)      NOT NULL DEFAULT 1,
  sort_order  INT             NOT NULL DEFAULT 0,
  created_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_variants_sku (sku),
  KEY idx_variants_product (product_id, is_active),
  CONSTRAINT fk_variants_product FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

Notes: variants are optional ("where needed", spec §10.1). If a product has active variants, stock is tracked per variant and `products.stock_qty` mirrors the sum (maintained by the inventory service in the same transaction as every movement). The current Gift Shop catalogue needs no variants; the table ships in the initial migration so adding them later needs no schema change.

### 9.5 `inventory_movements` — the stock ledger ✅

```sql
CREATE TABLE inventory_movements (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  product_id    BIGINT UNSIGNED NOT NULL,
  variant_id    BIGINT UNSIGNED NULL,
  movement_type VARCHAR(24)     NOT NULL,
                -- OPENING | PURCHASE | ADJUSTMENT_IN | ADJUSTMENT_OUT |
                -- ORDER_DEDUCT | ORDER_RESTORE | CORRECTION
  quantity      INT             NOT NULL,               -- signed delta applied to stock
  balance_after INT             NOT NULL,               -- stock immediately after this movement
  order_id      BIGINT UNSIGNED NULL,                   -- set for ORDER_DEDUCT / ORDER_RESTORE
  actor_id      BIGINT UNSIGNED NULL,                   -- admin for manual adjustments; NULL = system
  reason        VARCHAR(255)    NULL,
  created_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_movements_product (product_id, variant_id, created_at),
  KEY idx_movements_order (order_id),
  CONSTRAINT fk_movements_product FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE RESTRICT,
  CONSTRAINT fk_movements_variant FOREIGN KEY (variant_id) REFERENCES product_variants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_movements_order FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE RESTRICT,
  CONSTRAINT fk_movements_actor FOREIGN KEY (actor_id) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

> Migration-order note: created after `orders` (§9.8) or with the `order_id` FK added by follow-up `ALTER TABLE` in the same migration, like §7.1.

**Ledger rules (enforced by the inventory service, the only writer):**

1. `products.stock_qty` (or the variant's) is a **cached balance**; `inventory_movements` is the append-only proof. Every change writes both in one transaction.
2. **No overselling, ever:** deduction is a conditional update —
   `UPDATE products SET stock_qty = stock_qty - :qty WHERE id = :id AND stock_qty >= :qty` — and the transaction aborts unless exactly 1 row is affected. Two concurrent checkouts therefore cannot both succeed against the last unit (spec Part 23 concurrency test).
3. Stock can never go negative: rule 2 for deductions; manual `ADJUSTMENT_OUT` uses the same conditional form.
4. Order cancellation restores stock with an offsetting `ORDER_RESTORE` movement — history is never rewritten or deleted.
5. A reconciliation check (sum of `quantity` per product vs `stock_qty`) runs in the admin inventory screen and in tests; any drift is a bug alarm, not a normal state.

### 9.6 `carts` and `cart_items`

```sql
CREATE TABLE carts (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    BIGINT UNSIGNED NOT NULL,                  -- carts exist only for authenticated customers (spec §10.3)
  created_at DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_carts_user (user_id),
  CONSTRAINT fk_carts_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE cart_items (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  cart_id    BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NOT NULL,
  variant_id BIGINT UNSIGNED NULL,
  quantity   INT UNSIGNED    NOT NULL,
  created_at DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_cart_items_line (cart_id, product_id, variant_id),
  CONSTRAINT fk_ci_cart FOREIGN KEY (cart_id) REFERENCES carts (id) ON DELETE CASCADE,
  CONSTRAINT fk_ci_product FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE RESTRICT,
  CONSTRAINT fk_ci_variant FOREIGN KEY (variant_id) REFERENCES product_variants (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

Notes: **no price is stored in the cart.** Prices are read live from `products` on every cart view and re-validated at checkout (spec §10.3 "never trust browser-submitted prices"). One cart per customer (`uq_carts_user`); guest intent ("add this after login") is held client-side and replayed once after authentication, then the server cart is authoritative. Checkout converts the cart to an order in one transaction and clears the cart.

### 9.7 `customer_addresses`

```sql
CREATE TABLE customer_addresses (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id          BIGINT UNSIGNED NOT NULL,
  label            VARCHAR(60)     NULL,                -- 'Home', 'Office'
  recipient_name   VARCHAR(120)    NOT NULL,
  phone            VARCHAR(32)     NOT NULL,
  address_line     VARCHAR(255)    NOT NULL,
  city             VARCHAR(120)    NOT NULL,            -- city / municipality
  district         VARCHAR(120)    NULL,
  postal_code      VARCHAR(20)     NULL,
  delivery_notes   VARCHAR(500)    NULL,
  is_default       TINYINT(1)      NOT NULL DEFAULT 0,
  created_at       DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at       DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at       DATETIME(3)     NULL,
  PRIMARY KEY (id),
  KEY idx_addresses_user (user_id, deleted_at),
  CONSTRAINT fk_addresses_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

Notes: exactly one default per user is enforced by the service (transaction clears the previous default). Orders copy the address into snapshot columns (§9.8) — later edits here never rewrite order history.

### 9.8 `orders`

```sql
CREATE TABLE orders (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_number       VARCHAR(24)     NOT NULL,          -- public reference, e.g. 'ORD-2026-000123'
  user_id            BIGINT UNSIGNED NOT NULL,
  status             VARCHAR(24)     NOT NULL DEFAULT 'PENDING_APPROVAL',
                     -- PENDING_APPROVAL | APPROVED | PROCESSING | SHIPPED | DELIVERED | CANCELLED
  payment_method     VARCHAR(20)     NOT NULL DEFAULT 'COD',
  currency           CHAR(3)         NOT NULL DEFAULT 'NPR',
  subtotal           DECIMAL(12,2)   NOT NULL,
  shipping_fee       DECIMAL(12,2)   NOT NULL DEFAULT 0.00,
  discount_total     DECIMAL(12,2)   NOT NULL DEFAULT 0.00,
  tax_total          DECIMAL(12,2)   NOT NULL DEFAULT 0.00,
  grand_total        DECIMAL(12,2)   NOT NULL,
  -- delivery snapshot (copied from the chosen address at checkout; immutable thereafter)
  ship_recipient_name VARCHAR(120)   NOT NULL,
  ship_phone         VARCHAR(32)     NOT NULL,
  ship_address_line  VARCHAR(255)    NOT NULL,
  ship_city          VARCHAR(120)    NOT NULL,
  ship_district      VARCHAR(120)    NULL,
  ship_postal_code   VARCHAR(20)     NULL,
  ship_notes         VARCHAR(500)    NULL,
  customer_email_snapshot VARCHAR(254) NOT NULL,        -- contact snapshot at order time
  idempotency_key    VARCHAR(64)     NULL,              -- checkout submission key (ARCHITECTURE.md §6.1)
  placed_at          DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  approved_at        DATETIME(3)     NULL,
  approved_by        BIGINT UNSIGNED NULL,
  cancelled_at       DATETIME(3)     NULL,
  cancelled_by       BIGINT UNSIGNED NULL,
  cancellation_reason VARCHAR(255)   NULL,
  created_at         DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at         DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_orders_number (order_number),
  UNIQUE KEY uq_orders_idempotency (user_id, idempotency_key),
  KEY idx_orders_user (user_id, placed_at),
  KEY idx_orders_status (status, placed_at),
  CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_orders_approver FOREIGN KEY (approved_by) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_orders_canceller FOREIGN KEY (cancelled_by) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

Notes: all totals are computed by the checkout service from live product rows inside the order transaction; client-submitted totals are ignored. `order_number` is generated from the same sequence mechanism as invoices (§10.2 pattern, its own counter row) — human-friendly, unique, and not the PK. Status transitions are only via the orders service state machine (ARCHITECTURE.md §13); every transition also writes §9.10.

### 9.9 `order_items` — price/name snapshots ✅

```sql
CREATE TABLE order_items (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id         BIGINT UNSIGNED NOT NULL,
  product_id       BIGINT UNSIGNED NULL,                -- NULL-able so a hard-purged pre-sale product never breaks history
  variant_id       BIGINT UNSIGNED NULL,
  product_name_snapshot  VARCHAR(220) NOT NULL,         -- as sold
  variant_name_snapshot  VARCHAR(160) NULL,
  sku_snapshot           VARCHAR(60)  NULL,
  unit_price       DECIMAL(12,2)   NOT NULL,            -- effective price actually charged per unit
  quantity         INT UNSIGNED    NOT NULL,
  line_total       DECIMAL(12,2)   NOT NULL,            -- unit_price * quantity, computed server-side
  created_at       DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_items_order (order_id),
  KEY idx_items_product (product_id),
  CONSTRAINT fk_items_order FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE RESTRICT,
  CONSTRAINT fk_items_product FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE RESTRICT,
  CONSTRAINT fk_items_variant FOREIGN KEY (variant_id) REFERENCES product_variants (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

Notes (spec Part 4 rule): historical orders must read correctly forever — invoices, order detail and reports render from the **snapshot columns**, never by joining back to the (possibly renamed/repriced/archived) product. The product FK is retained only for analytics and stock-restore targeting.

### 9.10 `order_status_history`

```sql
CREATE TABLE order_status_history (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id      BIGINT UNSIGNED NOT NULL,
  from_status   VARCHAR(24)     NULL,                   -- NULL for the initial placement row
  to_status     VARCHAR(24)     NOT NULL,
  actor_id      BIGINT UNSIGNED NULL,                   -- NULL = customer/system action
  actor_role    VARCHAR(40)     NULL,
  reason        VARCHAR(255)    NULL,
  created_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_osh_order (order_id, created_at),
  CONSTRAINT fk_osh_order FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE RESTRICT,
  CONSTRAINT fk_osh_actor FOREIGN KEY (actor_id) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

Append-only; written in the same transaction as every status change. `orders.status` is a cache of the latest `to_status` — history is never overwritten (spec §11.1).

---

## 10. Invoice tables

### 10.1 `invoices`

```sql
CREATE TABLE invoices (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  invoice_number    VARCHAR(24)     NOT NULL,           -- e.g. 'INV-2026-00042' (§10.2)
  order_id          BIGINT UNSIGNED NOT NULL,
  template_version_id BIGINT UNSIGNED NULL,             -- version used to render (§10.3)
  currency          CHAR(3)         NOT NULL DEFAULT 'NPR',
  subtotal          DECIMAL(12,2)   NOT NULL,
  shipping_fee      DECIMAL(12,2)   NOT NULL DEFAULT 0.00,
  discount_total    DECIMAL(12,2)   NOT NULL DEFAULT 0.00,
  tax_total         DECIMAL(12,2)   NOT NULL DEFAULT 0.00,
  grand_total       DECIMAL(12,2)   NOT NULL,
  snapshot          JSON            NOT NULL,           -- immutable render data: company info, customer,
                                                        -- address, lines, totals, terms — exactly as issued
  pdf_storage_name  VARCHAR(120)    NULL,               -- file in private-storage/invoices/
  email_status      VARCHAR(20)     NOT NULL DEFAULT 'PENDING',
                    -- PENDING | SENT | FAILED (mirrors the outbox row; outbox is the delivery mechanism)
  issued_at         DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  issued_by         BIGINT UNSIGNED NULL,               -- the approving admin
  created_at        DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_invoices_number (invoice_number),
  UNIQUE KEY uq_invoices_order (order_id),              -- one invoice per order — structural duplicate prevention
  CONSTRAINT fk_invoices_order FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE RESTRICT,
  CONSTRAINT fk_invoices_tmpl_version FOREIGN KEY (template_version_id) REFERENCES invoice_template_versions (id) ON DELETE RESTRICT,
  CONSTRAINT fk_invoices_by FOREIGN KEY (issued_by) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

Notes: `uq_invoices_order` makes duplicate invoice creation for one order **impossible at the database level**, which together with idempotent approval (ARCHITECTURE.md §13) satisfies spec §11.2/§12.2. The PDF is rendered once from `snapshot` at issue time; re-downloads and email retries serve the stored file. If an order is cancelled after invoicing, the invoice row is **not** deleted — a future credit-note flow would supersede it (out of v1 scope; recorded in KNOWN_LIMITATIONS.md).

### 10.2 Invoice-number uniqueness strategy ✅

Format: `<prefix>-<year>-<sequence, zero-padded>` — default prefix `INV` (configurable per template), e.g. `INV-2026-00042`.

```sql
CREATE TABLE invoice_sequences (
  scope        VARCHAR(40) NOT NULL,                    -- 'INVOICE:2026' | 'ORDER:2026'
  last_value   BIGINT UNSIGNED NOT NULL DEFAULT 0,
  updated_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (scope)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

Mechanism, inside the approval transaction:
1. `SELECT last_value FROM invoice_sequences WHERE scope = 'INVOICE:2026' FOR UPDATE;` — row lock serialises concurrent approvals (short critical section, no deadlock surface: this is the first lock taken in the transaction).
2. `next = last_value + 1`; `UPDATE invoice_sequences SET last_value = next …`.
3. Insert the invoice with the formatted number. The `UNIQUE` constraint on `invoice_number` is the final guarantee: any bug or race that still produced a duplicate fails the transaction loudly instead of issuing two invoices with one number.
4. Rolled-back transactions may consume a number (a gap). Gaps are acceptable and auditable; duplicates are not. (If Meena later requires gapless numbering for tax reasons, the sequence update moves to the very end of the transaction — same table, noted here as the variation point.) 🔶

### 10.3 `invoice_templates` and `invoice_template_versions`

```sql
CREATE TABLE invoice_templates (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name           VARCHAR(120)    NOT NULL,              -- 'Default Museum Invoice'
  is_active      TINYINT(1)      NOT NULL DEFAULT 0,    -- exactly one active template (service-enforced)
  current_version_id BIGINT UNSIGNED NULL,              -- FK added after versions table (same pattern as §7.1)
  created_by     BIGINT UNSIGNED NULL,
  updated_by     BIGINT UNSIGNED NULL,
  created_at     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT fk_templates_cb FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_templates_ub FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE invoice_template_versions (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  template_id  BIGINT UNSIGNED NOT NULL,
  version_no   INT UNSIGNED    NOT NULL,
  config       JSON            NOT NULL,                -- validated config only: logo media id, company name/address/
                                                        -- phone/email, prefix, colours, footer text, terms,
                                                        -- field toggles — NO executable template code (spec §12.1)
  created_by   BIGINT UNSIGNED NULL,
  created_at   DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_itv_template_version (template_id, version_no),
  CONSTRAINT fk_itv_template FOREIGN KEY (template_id) REFERENCES invoice_templates (id) ON DELETE RESTRICT,
  CONSTRAINT fk_itv_cb FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

Notes: editing a template creates a **new version row** and moves `current_version_id`; versions are immutable. Invoices record the version they were rendered with (`invoices.template_version_id`) and their own data `snapshot`, so a template edit can never alter an already-issued invoice (spec §12.2). Rendering is a controlled PDFKit layout driven by `config` — admins configure, they never supply code or markup templates.

---

## 11. System tables

### 11.1 `email_outbox`

```sql
CREATE TABLE email_outbox (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  type          VARCHAR(40)     NOT NULL,
                -- VERIFICATION | PASSWORD_RESET | INVITATION | ORDER_CONFIRMATION |
                -- ORDER_APPROVED | ORDER_CANCELLED | INVOICE | LOGIN_NOTICE
  recipient_email VARCHAR(254)  NOT NULL,
  recipient_user_id BIGINT UNSIGNED NULL,
  subject       VARCHAR(255)    NOT NULL,
  template_data JSON            NOT NULL,               -- render inputs snapshot (tokens stored hashed refs only;
                                                        -- raw one-time links are re-derivable? NO — see note)
  attachment_storage_name VARCHAR(120) NULL,            -- invoice PDF for INVOICE type
  related_type  VARCHAR(40)     NULL,                   -- 'order' | 'invoice' | 'user' | 'invitation'
  related_id    BIGINT UNSIGNED NULL,
  status        VARCHAR(20)     NOT NULL DEFAULT 'PENDING',
                -- PENDING | PROCESSING | SENT | FAILED | DEAD
  attempts      TINYINT UNSIGNED NOT NULL DEFAULT 0,
  next_attempt_at DATETIME(3)   NULL,
  last_error    VARCHAR(500)    NULL,                   -- sanitised SMTP error summary, never credentials
  claimed_by    VARCHAR(64)     NULL,                   -- worker instance id while PROCESSING
  sent_at       DATETIME(3)     NULL,
  created_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_outbox_drain (status, next_attempt_at),
  KEY idx_outbox_related (related_type, related_id),
  CONSTRAINT fk_outbox_user FOREIGN KEY (recipient_user_id) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

Notes:
- Written in the **same transaction** as the business event (transactional outbox — ARCHITECTURE.md §10). A crash between event and send loses nothing.
- **Secrets in email:** verification codes and reset/invitation links must reach the email, so the *plaintext one-time secret* is needed at render time. Design: the outbox row stores only the **token/code id** (`related_id` + type); the worker re-reads the secret's hash record and cannot recover plaintext — therefore one-time-secret emails are rendered **at enqueue time** into `template_data` by the calling service, which holds the plaintext only in memory. The rendered body is stored in the row (`template_data.rendered_html`/`rendered_text`) and the row is hard-deleted 7 days after `SENT`. This is the one place a live secret transiently exists at rest; it is mitigated by the short retention, DB access controls, and the secrets' own short expiry (≤72 h worst case for invitations). Recorded explicitly so the security review (Subagent 4) can challenge it.
- Claiming: `SELECT … FOR UPDATE SKIP LOCKED` ⏳ (MySQL 8.0+/MariaDB 10.6+); fallback claim is an atomic conditional `UPDATE` (ARCHITECTURE.md §10). Backoff: 1m/5m/30m/2h, `DEAD` after 5 attempts with admin manual retry (resets to `PENDING`, audited). A `DEAD` invoice email never blocks or duplicates the invoice itself.

### 11.2 `audit_logs` — append-only ✅

```sql
CREATE TABLE audit_logs (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_id      BIGINT UNSIGNED NULL,                   -- NULL for anonymous events (failed login on unknown email)
  actor_email_snapshot VARCHAR(254) NULL,               -- safe snapshot so history survives account changes
  actor_role    VARCHAR(40)     NULL,
  action        VARCHAR(80)     NOT NULL,               -- 'auth.login.success', 'cms.pages.publish', 'store.orders.approve', …
  target_type   VARCHAR(40)     NULL,                   -- 'page' | 'order' | 'product' | 'user' | 'invoice' | …
  target_id     BIGINT UNSIGNED NULL,
  result        VARCHAR(10)     NOT NULL DEFAULT 'SUCCESS',  -- SUCCESS | FAILURE | DENIED
  ip_address    VARCHAR(45)     NULL,
  user_agent    VARCHAR(512)    NULL,
  metadata      JSON            NULL,                   -- safe structured detail (changed fields, old→new status…)
  created_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_audit_created (created_at),
  KEY idx_audit_actor (actor_id, created_at),
  KEY idx_audit_action (action, created_at),
  KEY idx_audit_target (target_type, target_id),
  KEY idx_audit_result (result, created_at)
  -- deliberately NO foreign keys: audit rows must survive deletion/anonymisation of the rows they describe
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

**Immutability approach (layered):**
1. **Application:** a single audit service exposes `write()` only — no update/delete code paths exist; no admin API touches the table except the Super Admin read API (`audit.read`).
2. **Database privileges:** the application's DB user is granted `INSERT, SELECT` on `audit_logs` and **not** `UPDATE`/`DELETE` — enforced in the deployment grant script, so even compromised app code cannot rewrite history through the app's own connection.
3. **Content rules:** passwords, OTPs, tokens, session ids, TOTP secrets and recovery codes are never written (spec Part 14) — the audit service takes an explicit field allowlist per action.
4. Permission failures (`result='DENIED'`) are logged too — they are a security signal, not noise.
5. Retention: kept indefinitely in v1; archival to backup storage is an operations decision (Phase 8), never automatic deletion.

### 11.3 `contact_submissions`

```sql
CREATE TABLE contact_submissions (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name        VARCHAR(120)  NOT NULL,
  email       VARCHAR(254)  NOT NULL,
  phone       VARCHAR(32)   NULL,
  subject     VARCHAR(160)  NULL,
  message     TEXT          NOT NULL,
  status      VARCHAR(20)   NOT NULL DEFAULT 'NEW',     -- NEW | READ | ARCHIVED
  ip_address  VARCHAR(45)   NULL,
  created_at  DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  read_at     DATETIME(3)   NULL,
  PRIMARY KEY (id),
  KEY idx_contact_status (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

Notes: backs the existing About-page contact form. Public POST is rate-limited + honeypot-field protected; submissions are stored first (never lost to an SMTP failure) and optionally mirrored to email via the outbox.

### 11.4 `rate_limits` — MySQL-backed rate-limit store ✅ (spec §15.3)

```sql
CREATE TABLE rate_limits (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  scope        VARCHAR(80)     NOT NULL,                -- policy+subject key, e.g. 'login:acct:42' | 'login:ip:203.0.113.9'
                                                        -- | 'otp_send:email:<hmac>' | 'register:ip:…'
  window_start DATETIME(3)     NOT NULL,
  window_end   DATETIME(3)     NOT NULL,
  hit_count    INT UNSIGNED    NOT NULL DEFAULT 0,
  blocked_until DATETIME(3)    NULL,                    -- progressive backoff marker
  updated_at   DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_rate_limits_scope_window (scope, window_start),
  KEY idx_rate_limits_expiry (window_end)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

Design:
- Fixed-window counters with **atomic upsert**: `INSERT … ON DUPLICATE KEY UPDATE hit_count = hit_count + 1` — race-safe across multiple Passenger workers and restarts, which is exactly why the store is in MySQL rather than process memory.
- Emails inside `scope` are stored as HMAC hashes, never raw addresses (the table is not a user directory leak).
- Policies (config, spec §15.3): registration 3/IP/hour; OTP send 3/email/hour + 60 s cooldown (cooldown checked against latest `email_verification_codes.created_at`); OTP verify 5 attempts/code (also hard-enforced by the code row itself, §4.3); login 5 failures/15 min per account and per IP (two scopes, either can trip); password recovery 3/email/hour; admin login stricter (3/15 min) + audit flag.
- Failed-login counting increments on failure only; success clears the account scope. `blocked_until` implements progressive backoff without permanent lockout (spec: never permanently lock accounts).
- Hourly cleanup deletes rows whose `window_end` and `blocked_until` are both past.

---

## 12. Cross-cutting integrity rules (summary)

| Rule | Mechanism |
|---|---|
| No duplicate accounts | `uq_users_email_normalized` + service pre-check for a friendly error |
| No duplicate page slugs | `uq_pages_slug` + reserved-slug list (ARCHITECTURE.md §8.4) |
| No duplicate invoice numbers | sequence row lock in approval txn + `uq_invoices_number` (§10.2) |
| Max one invoice per order | `uq_invoices_order` |
| No overselling / negative stock | conditional stock UPDATE + movement ledger (§9.5) |
| Order history immutable | snapshots in `order_items` + address snapshot in `orders` + append-only `order_status_history` |
| Issued invoices immutable | data `snapshot` JSON + pinned `template_version_id` + stored PDF |
| Audit history immutable | insert-only service + restricted DB grants (§11.2) |
| Session theft from DB leak useless | only SHA-256 hashes stored (§4.2) |
| OTP brute force bounded | HMAC storage + attempt counter + expiry + rate limits (§4.3, §11.4) |
| Money correctness | `DECIMAL(12,2)` everywhere; totals recomputed server-side in the order transaction |

---

## 13. Migrations, rollback, seeds

### 13.1 Tooling ✅

- Drizzle ORM schema in `server/src/database/schema/` is the authoring source; `drizzle-kit` generates SQL migrations into `server/migrations/` with the standard journal. **Generated SQL is always reviewed by hand before commit** — hand adjustments in this design (deferred FKs in §7.1/§9.5/§10.3, FULLTEXT index, grants for `audit_logs`) are written into the migration files explicitly.
- Migrations run **forward-only in production** through the migration runner; every migration also ships a reviewed `down` SQL for local/dev rollback. Production rollback of a destructive migration is a restore-from-backup operation (BACKUP_RESTORE.md), never an improvised `ALTER` — stated plainly so nobody expects `db:rollback` to undo data loss on the live host.
- Migration order inside the initial migration: lookup/auth tables → CMS (with deferred-FK ALTERs) → museum → ecommerce (`inventory_movements` FK to `orders` deferred) → invoices → system → indexes/grants.

### 13.2 Commands (root `package.json` scripts delegating to `server/`) ✅

```bash
npm run db:migrate     # apply pending migrations to the configured database
npm run db:status      # list applied vs pending migrations (journal vs files)
npm run db:seed        # idempotent seed: roles, permissions, role_permissions,
                       # reserved menus, default site settings, default invoice template v1
npm run test           # server test suite (Vitest) — includes migration up/down smoke test
```

`db:seed` is safe to re-run: every insert is an upsert keyed on natural unique keys (`roles.code`, `permissions.code`, `setting_key`). It contains **no user accounts**.

### 13.3 Seed policy ✅ (spec Part 4)

- **Seeded:** the 4 roles; the full permission catalogue from `PERMISSIONS.md`; the role→permission matrix; the 5 menu shells; baseline `site_settings` (site name, contact details from the current site, shipping fee 0, tax disabled, invoice prefix `INV`); one default invoice template + version 1.
- **Never seeded:** demonstration or test accounts, sample products/orders, placeholder admin users — in any environment that can become production.
- **First Super Admin:** created only by the one-time CLI bootstrap (`npm --prefix server run bootstrap:super-admin`, interactive, refuses to run if any Super Admin exists), which creates the user, assigns the role, and forces MFA enrolment at first login. This is an operational command, not a seed.
- **Content migration** (the existing seven pages' sections, the 12 current shop products, collections, exhibitions, news, programs, testimonials) is a separate, reviewed **content-import script** in Phase 3/5/6 — it imports real current content from the existing components, it is not demo seed data, and it is run once per environment with its output diffed against the live site.

### 13.4 Environment notes

- Dev databases are disposable: migrate → seed → content-import gives a full local system.
- The production database is created in cPanel (MySQL Databases wizard), a dedicated DB user is granted the least privileges the app needs (`SELECT/INSERT/UPDATE/DELETE` on app tables, `INSERT/SELECT` only on `audit_logs`, DDL only during the deployment window), and migrations are run once over the verified connection (SSH tunnel if remote access is restricted — ⏳ hosting-dependent, never by exposing MySQL publicly).

---

## 14. Open items for approval / verification

| # | Item | Type |
|---|---|---|
| D1 | Invoice number format `INV-<year>-<5-digit seq>`; gaps acceptable, duplicates impossible | 🔶 Business approval (format only) |
| D2 | Order number format `ORD-<year>-<6-digit seq>` | 🔶 Business approval |
| D3 | Stock deducted at order creation; no checkout-time reservation (ARCHITECTURE.md §13) | 🔶 Design decision to confirm |
| D4 | MySQL vs MariaDB + version on the actual cPanel account (affects `SKIP LOCKED`, FULLTEXT, grants) | ⏳ Hosting verification |
| D5 | DB user privilege split for `audit_logs` must be permitted by the host's cPanel MySQL tooling | ⏳ Hosting verification — fallback: single user + application-level immutability + documented limitation |
| D6 | Session lifetimes (customer 24 h idle/7 d absolute; admin 30 min idle/12 h absolute) stored as config, enforced via §4.2 columns | 🔶 Confirm strictness |
| D7 | Revision retention unlimited in v1 | ✅ Decided; revisit only if storage becomes an issue |
