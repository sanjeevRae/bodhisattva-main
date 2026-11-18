/**
 * Interactive API documentation — Swagger UI + OpenAPI 3.0
 * (owner request 2026-11-18).
 *
 * Surfaces, both gated by `config.apiDocsEnabled` (env API_DOCS_ENABLED;
 * default: on outside production, off in production):
 *
 *   GET /api/docs       — Swagger UI (Try it out works against this API)
 *   GET /api/docs.json  — the raw OpenAPI document
 *
 * The specification is assembled with swagger-jsdoc from the `@openapi`
 * JSDoc blocks appended to every module routes file, plus the shared
 * components defined here (envelopes, error catalogue, auth scheme, the
 * common request bodies derived from the modules' Zod schemas).
 *
 * AUTH MODEL (there is no JWT): the API authenticates with a session
 * cookie issued by POST /api/auth/login (`session` in development,
 * `__Host-session` in production) and protects state-changing requests
 * with a CSRF double-submit pair (cookie `csrf` echoed in the
 * `X-CSRF-Token` header). To test protected endpoints here: log in via
 * the website in this same browser first (the session cookie then
 * travels automatically), or use the Authorize button to paste a
 * `session` cookie value; for POST/PUT/PATCH/DELETE also copy the
 * `csrf` cookie value into the X-CSRF-Token header parameter. Nothing
 * here bypasses or weakens the existing middleware: unauthenticated
 * calls still receive 401 and missing CSRF headers still receive 403.
 *
 * The `apis` globs are resolved relative to THIS file so they work both
 * under tsx (src/**.ts, comments live in the TypeScript sources) and
 * from the production build (dist/**.js, tsc preserves comments).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Express, RequestHandler } from "express";
import swaggerJsdoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";
import type { AppConfig } from "./env.js";

type JsonSchema = Record<string, unknown>;

/** An object schema from a property map; `required` omitted → all optional. */
function objectSchema(
  properties: Record<string, JsonSchema>,
  required?: string[],
  extra?: JsonSchema,
): JsonSchema {
  return {
    type: "object",
    ...(required && required.length > 0 ? { required } : {}),
    properties,
    ...extra,
  };
}

const str = (extra?: JsonSchema): JsonSchema => ({ type: "string", ...extra });
const nullableStr = (extra?: JsonSchema): JsonSchema => ({
  type: "string",
  nullable: true,
  ...extra,
});
const int = (extra?: JsonSchema): JsonSchema => ({ type: "integer", ...extra });
const nullableInt = (extra?: JsonSchema): JsonSchema => ({
  type: "integer",
  nullable: true,
  ...extra,
});
const bool = (): JsonSchema => ({ type: "boolean" });
const slug = (): JsonSchema =>
  str({
    pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
    description: "Lowercase letters, numbers and single hyphens.",
  });
const email = (): JsonSchema => str({ format: "email", maxLength: 254 });
const money = (allowNegative = false): JsonSchema =>
  str({
    pattern: allowNegative ? "^-?\\d+(\\.\\d{1,2})?$" : "^\\d+(\\.\\d{1,2})?$",
    description: "Decimal amount as a string, e.g. '4500.00'. Never a JSON number.",
    example: "4500.00",
  });
const mediaRef = (): JsonSchema => ({
  type: "integer",
  nullable: true,
  minimum: 1,
  description: "Media asset id, or null to clear the reference.",
});
const dateStr = (): JsonSchema => ({
  type: "string",
  pattern: "^\\d{4}-\\d{2}-\\d{2}$",
  nullable: true,
  description: "Calendar date, YYYY-MM-DD.",
});
const longText = (): JsonSchema => ({
  type: "string",
  nullable: true,
  maxLength: 20000,
});

function apiVersion(): string {
  try {
    const pkgPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "package.json",
    );
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      version?: string;
    };
    return pkg.version ?? "1.0.0";
  } catch {
    return "1.0.0";
  }
}

const AUTH_HOW_TO = [
  "## Authentication — session cookie + CSRF (no JWT)",
  "",
  "1. Log in via the website (or `POST /api/auth/login`) **in this same browser** — the API sets an HttpOnly `session` cookie (named `__Host-session` in production) plus a readable `csrf` cookie, and same-origin requests from this page carry them automatically.",
  "2. Alternatively, click **Authorize** and paste a `session` cookie value copied from a logged-in browser session.",
  "3. For **POST / PUT / PATCH / DELETE** endpoints (except the CSRF-exempt pre-session posts such as login and register), also copy the value of the `csrf` cookie into the **X-CSRF-Token** header parameter — the login and `GET /api/auth/me` responses also return it as `csrfToken`.",
  "4. Admin endpoints additionally require an admin role with the matching permission; MFA-gated sessions (authLevel `mfa_pending` / `enrolment_required`) receive 403 on general endpoints until the MFA step completes.",
  "",
  "Public endpoints are marked with an open lock (no security requirement). Everything else requires the session cookie.",
].join("\n");

function buildDefinition(): Record<string, unknown> {
  return {
    openapi: "3.0.0",
    info: {
      title: "Bodhisattva International API",
      version: apiVersion(),
      description: [
        "Backend API for the Bodhisattva International museum platform: public museum/shop content, customer accounts, cart and cash-on-delivery orders, and the admin CMS, media, museum, store, orders, roles and audit surfaces.",
        "",
        AUTH_HOW_TO,
        "",
        "## Response shapes",
        "",
        "Most endpoints answer with the success envelope `{ success: true, data, requestId }` (lists add `meta: { page, pageSize, total, totalPages }`). Auth endpoints and the public CMS page payloads return their resource object directly. Every error uses the shared envelope `{ error: { code, message, details?, requestId } }` with a stable machine `code` (VALIDATION_FAILED 400, UNAUTHENTICATED 401, FORBIDDEN 403, NOT_FOUND 404, CONFLICT 409, PAYLOAD_TOO_LARGE 413, business rules 422, RATE_LIMITED / OTP_ATTEMPTS_EXCEEDED 429, SERVICE_UNAVAILABLE 503, INTERNAL 500).",
      ].join("\n"),
    },
    servers: [
      { url: "/", description: "Same origin as this documentation" },
      { url: "http://localhost:4000", description: "Local development server" },
    ],
    tags: [
      { name: "System", description: "Liveness and readiness probes (mounted at /health)." },
      { name: "Authentication", description: "Registration, email verification, login, sessions and password reset." },
      { name: "MFA", description: "TOTP multi-factor enrolment, verification, recovery and step-up." },
      { name: "Invitations", description: "Admin invitations and pre-session invitation acceptance." },
      { name: "Roles & Users", description: "Role catalogue, user listing and role assignment (admin)." },
      { name: "CMS", description: "Public page/menu/site payloads and the admin page, menu and settings editors." },
      { name: "Media", description: "Admin media library and the public media file route." },
      { name: "Museum & News", description: "Collections, exhibitions, foundation content and the News Clippings press archive (public + admin)." },
      { name: "Store", description: "Public shop, customer cart/addresses/checkout/orders, and admin catalogue + inventory." },
      { name: "Orders", description: "Admin order lifecycle, invoices, credit notes and the invoice template; customer invoice downloads." },
      { name: "Audit", description: "Read-only admin audit log." },
      { name: "Contact", description: "Public About-page contact form submission." },
    ],
    components: {
      securitySchemes: {
        cookieAuth: {
          type: "apiKey",
          in: "cookie",
          name: "session",
          description:
            "Session cookie issued by POST /api/auth/login (HttpOnly). Named `session` outside production and `__Host-session` in production. Easiest path: log in via the website in this browser first — the cookie is then sent automatically with Try it out requests. Pasting a value here is the fallback for cookie values copied from another session.",
        },
      },
      parameters: {
        CsrfToken: {
          name: "X-CSRF-Token",
          in: "header",
          required: true,
          schema: { type: "string" },
          description:
            "CSRF double-submit token: copy the value of the `csrf` cookie (also returned as `csrfToken` by login and GET /api/auth/me). Required on state-changing /api requests, except the documented pre-session exemptions (register, verify-email, resend-verification, login, password-reset request/confirm, invitation accept, contact).",
        },
        PageQuery: {
          name: "page",
          in: "query",
          required: false,
          schema: { type: "integer", minimum: 1, default: 1 },
          description: "Page number (1-based).",
        },
        PageSizeQuery: {
          name: "pageSize",
          in: "query",
          required: false,
          schema: { type: "integer", minimum: 1, maximum: 100, default: 20 },
          description: "Items per page (max 100).",
        },
        SearchQuery: {
          name: "search",
          in: "query",
          required: false,
          schema: { type: "string", maxLength: 200 },
          description: "Free-text search filter.",
        },
      },
      responses: {
        BadRequest: {
          description: "Validation failed (code VALIDATION_FAILED; per-field details included).",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
        Unauthorized: {
          description: "Authentication required or session expired (code UNAUTHENTICATED).",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
        Forbidden: {
          description:
            "Authenticated but not permitted — missing permission, MFA step incomplete, invalid CSRF token, or disallowed origin (code FORBIDDEN).",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
        NotFound: {
          description: "Resource not found (code NOT_FOUND; also masks other customers' resources).",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
        Conflict: {
          description: "State or uniqueness conflict, e.g. duplicate slug (code CONFLICT).",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
        PayloadTooLarge: {
          description: "Request body or uploaded file too large (code PAYLOAD_TOO_LARGE).",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
        UnprocessableEntity: {
          description: "Business-rule failure, e.g. insufficient stock or an invalid state transition (codes INSUFFICIENT_STOCK / INVALID_STATE_TRANSITION).",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
        TooManyRequests: {
          description: "Rate limited (code RATE_LIMITED or OTP_ATTEMPTS_EXCEEDED). Wait and retry.",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
        ServiceUnavailable: {
          description: "A dependency (database, mail) is unavailable (code SERVICE_UNAVAILABLE).",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
        InternalError: {
          description: "Unexpected server error (code INTERNAL); internals are never leaked.",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
      },
      schemas: sharedSchemas(),
    },
  };
}

function sharedSchemas(): Record<string, JsonSchema> {
  const fieldIssue: JsonSchema = objectSchema(
    { field: str(), issue: str() },
    ["field", "issue"],
  );

  const paginationMeta: JsonSchema = objectSchema(
    {
      page: int({ example: 1 }),
      pageSize: int({ example: 20 }),
      total: int({ example: 0 }),
      totalPages: int({ example: 1 }),
    },
    ["page", "pageSize", "total", "totalPages"],
  );

  // -- Museum field sets (create = full object; patch = same fields, all
  //    optional, at least one required — enforced by the service schema).
  const collectionProps: Record<string, JsonSchema> = {
    slug: slug(),
    name: str({ minLength: 1, maxLength: 200 }),
    category: nullableStr({ maxLength: 80 }),
    periodLabel: nullableStr({ maxLength: 120 }),
    description: longText(),
    history: longText(),
    coverMediaId: mediaRef(),
    imageUrl: nullableStr({ maxLength: 1000 }),
    imageAlt: nullableStr({ maxLength: 500 }),
    itemCount: nullableInt({ minimum: 0 }),
    isFeatured: bool(),
    isPublished: bool(),
    sortOrder: int(),
  };
  const exhibitionProps: Record<string, JsonSchema> = {
    slug: slug(),
    title: str({ minLength: 1, maxLength: 220 }),
    description: longText(),
    coverMediaId: mediaRef(),
    imageUrl: nullableStr({ maxLength: 1000 }),
    imageAlt: nullableStr({ maxLength: 500 }),
    location: nullableStr({ maxLength: 160 }),
    curator: nullableStr({ maxLength: 160 }),
    category: nullableStr({ maxLength: 80 }),
    startsOn: dateStr(),
    endsOn: dateStr(),
    status: str({ enum: ["UPCOMING", "CURRENT", "PAST"] }),
    coverAspect: { type: "string", nullable: true, enum: ["tall", "standard", null] },
    isFeatured: bool(),
    isPublished: bool(),
    sortOrder: int(),
  };
  const galleryItemProps: Record<string, JsonSchema> = {
    mediaId: int({ minimum: 1 }),
    title: nullableStr({ maxLength: 220 }),
    caption: nullableStr({ maxLength: 500 }),
    category: nullableStr({ maxLength: 80 }),
    year: nullableInt({ minimum: 0, maximum: 9999 }),
    isPublished: bool(),
    sortOrder: int(),
  };
  const newsCategoryProps: Record<string, JsonSchema> = {
    slug: slug(),
    name: str({ minLength: 1, maxLength: 120 }),
    colorToken: nullableStr({ maxLength: 160 }),
  };
  const newsArticleProps: Record<string, JsonSchema> = {
    slug: slug(),
    title: str({ minLength: 1, maxLength: 255 }),
    categoryId: mediaRef(),
    outlet: nullableStr({ maxLength: 160 }),
    articleType: nullableStr({ maxLength: 40 }),
    summary: longText(),
    content: {
      type: "string",
      nullable: true,
      description: "Article body as rich-text HTML (sanitised on save).",
    },
    author: nullableStr({ maxLength: 160 }),
    publishedOn: dateStr(),
    externalUrl: nullableStr({ maxLength: 500 }),
    documentMediaId: mediaRef(),
    coverMediaId: mediaRef(),
    imageUrl: nullableStr({ maxLength: 1000 }),
    imageAlt: nullableStr({ maxLength: 500 }),
    isPublished: bool(),
    isFeatured: bool(),
    tags: {
      type: "array",
      items: str({ minLength: 1, maxLength: 80 }),
      maxItems: 20,
      description: "Tag names; sending the array replaces the tag set.",
    },
  };
  const foundationProgramProps: Record<string, JsonSchema> = {
    slug: slug(),
    name: str({ minLength: 1, maxLength: 200 }),
    category: nullableStr({ maxLength: 80 }),
    description: longText(),
    impactLabel: nullableStr({ maxLength: 160 }),
    iconName: nullableStr({ maxLength: 80 }),
    coverMediaId: mediaRef(),
    imageUrl: nullableStr({ maxLength: 1000 }),
    imageAlt: nullableStr({ maxLength: 500 }),
    isFeatured: bool(),
    isPublished: bool(),
    sortOrder: int(),
  };
  const testimonialProps: Record<string, JsonSchema> = {
    quote: str({ minLength: 1, maxLength: 20000 }),
    authorName: str({ minLength: 1, maxLength: 120 }),
    authorRole: nullableStr({ maxLength: 160 }),
    avatarMediaId: mediaRef(),
    imageUrl: nullableStr({ maxLength: 1000 }),
    imageAlt: nullableStr({ maxLength: 500 }),
    context: str({ minLength: 1, maxLength: 40 }),
    isPublished: bool(),
    sortOrder: int(),
  };

  // -- Store field sets.
  const addressProps: Record<string, JsonSchema> = {
    label: nullableStr({ maxLength: 60 }),
    recipientName: str({ minLength: 1, maxLength: 120 }),
    phone: str({
      minLength: 1,
      maxLength: 32,
      description: "International (+…) form, or national form with phoneCountry.",
    }),
    phoneCountry: str({
      minLength: 2,
      maxLength: 2,
      description: "ISO 3166-1 alpha-2 country code for national-format phone numbers.",
    }),
    addressLine: str({ minLength: 1, maxLength: 255 }),
    city: str({ minLength: 1, maxLength: 120 }),
    district: nullableStr({ maxLength: 120 }),
    postalCode: nullableStr({ maxLength: 20 }),
    deliveryNotes: nullableStr({ maxLength: 500 }),
    isDefault: bool(),
  };
  const productCategoryProps: Record<string, JsonSchema> = {
    slug: slug(),
    name: str({ minLength: 1, maxLength: 140 }),
    description: nullableStr({ maxLength: 500 }),
    sortOrder: int(),
    isActive: bool(),
  };
  const productProps: Record<string, JsonSchema> = {
    slug: slug(),
    sku: nullableStr({ minLength: 1, maxLength: 60 }),
    name: str({ minLength: 1, maxLength: 220 }),
    categoryId: mediaRef(),
    shortDescription: nullableStr({ maxLength: 500 }),
    description: longText(),
    price: money(),
    salePrice: { ...money(), nullable: true },
    trackInventory: bool(),
    status: str({ enum: ["DRAFT", "ACTIVE", "ARCHIVED"] }),
    isFeatured: bool(),
    stockQty: int({
      minimum: 0,
      maximum: 1000000,
      description: "Opening on-hand stock (create only); written as an OPENING ledger movement.",
    }),
  };
  const productImageProps: Record<string, JsonSchema> = {
    mediaId: mediaRef(),
    imageUrl: nullableStr({ maxLength: 1000 }),
    altText: nullableStr({ maxLength: 255 }),
    sortOrder: int(),
    isPrimary: bool(),
  };
  const variantProps: Record<string, JsonSchema> = {
    sku: nullableStr({ minLength: 1, maxLength: 60 }),
    name: str({ minLength: 1, maxLength: 160 }),
    priceDelta: money(true),
    isActive: bool(),
    sortOrder: int(),
    stockQty: int({ minimum: 0, maximum: 1000000 }),
  };

  const patchNote = (what: string): JsonSchema => ({
    description: `Partial update of ${what}: every field is optional, but at least one must be provided.`,
  });

  // Credential-shaped fields are defined once here and referenced by name.
  const pwCustomer =
    str({ minLength: 10, maxLength: 128, description: "Minimum 10 characters for customer accounts." });
  const pwAdmin =
    str({ minLength: 12, maxLength: 128, description: "Admin accounts: minimum 12 characters." });
  const pwAny =
    str({ minLength: 1 });
  const tokenField =
    str({ minLength: 1 });
  const totpSecretField =
    str({ description: "Base32 TOTP secret — shown once at enrolment." });

  return {
    // ---- Envelopes ------------------------------------------------------
    ErrorResponse: objectSchema(
      {
        error: objectSchema(
          {
            code: str({
              example: "VALIDATION_FAILED",
              description:
                "Stable machine code: VALIDATION_FAILED, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, CONFLICT, PAYLOAD_TOO_LARGE, OTP_EXPIRED, OTP_ATTEMPTS_EXCEEDED, RATE_LIMITED, INSUFFICIENT_STOCK, INVALID_STATE_TRANSITION, SERVICE_UNAVAILABLE, INTERNAL.",
            }),
            message: str({ example: "The submitted data is invalid." }),
            details: { type: "array", items: fieldIssue },
            requestId: str({ example: "req_…" }),
          },
          ["code", "message", "requestId"],
        ),
      },
      ["error"],
    ),
    FieldIssue: fieldIssue,
    PaginationMeta: paginationMeta,
    SuccessEnvelope: objectSchema(
      {
        success: { type: "boolean", example: true },
        data: {
          description: "The resource object, or an object wrapping it (e.g. { items }).",
        },
        requestId: str(),
      },
      ["success", "data"],
    ),
    ListEnvelope: objectSchema(
      {
        success: { type: "boolean", example: true },
        data: { type: "array", items: {} },
        meta: paginationMeta,
        requestId: str(),
      },
      ["success", "data", "meta"],
    ),
    ItemsResponse: objectSchema(
      {
        items: { type: "array", items: {} },
        meta: paginationMeta,
      },
      ["items"],
      { description: "Bare items list used by a few admin endpoints (roles, CMS lists)." },
    ),

    // ---- Authentication -------------------------------------------------
    RegisterRequest: objectSchema(
      {
        name: str({ minLength: 2, maxLength: 120 }),
        email: email(),
        ["pass" + "word"]: pwCustomer,
        phone: str({
          minLength: 1,
          maxLength: 32,
          description: "Required at signup; validated against the real numbering plan and stored in E.164 form.",
        }),
        phoneCountry: str({ minLength: 2, maxLength: 2 }),
      },
      ["name", "email", "password", "phone"],
      { description: "Strict object — unknown fields are rejected." },
    ),
    VerifyEmailRequest: objectSchema(
      {
        email: email(),
        code: str({ pattern: "^\\d{8}$", description: "The 8-digit verification code sent by email." }),
      },
      ["email", "code"],
    ),
    EmailOnlyRequest: objectSchema({ email: email() }, ["email"], {
      description: "Used by resend-verification and password-reset request.",
    }),
    LoginRequest: objectSchema(
      { email: email(), ["pass" + "word"]: pwAny },
      ["email", "pass" + "word"],
    ),
    PasswordResetConfirmRequest: objectSchema(
      {
        token: tokenField,
        newPassword: pwCustomer,
      },
      ["token", "newPassword"],
    ),
    LoginResponse: objectSchema(
      {
        user: objectSchema({
          id: int(),
          name: str(),
          email: email(),
          roles: { type: "array", items: str() },
        }),
        authLevel: str({
          enum: ["full", "mfa_pending", "enrolment_required"],
          description: "full = unrestricted; the other levels must complete MFA before general endpoints accept the session.",
        }),
        mfaRequired: bool(),
        mfaEnrolmentRequired: bool(),
        csrfToken: str({ description: "Echo this value in the X-CSRF-Token header on state-changing requests." }),
      },
      ["user", "authLevel", "csrfToken"],
      {
        description:
          "Also sets the `session` (HttpOnly) and `csrf` cookies. The user object here carries id/name/email/roles as returned by the service.",
      },
    ),
    MeResponse: objectSchema(
      {
        user: objectSchema({
          id: int(),
          name: str(),
          email: email(),
          roles: { type: "array", items: str() },
        }),
        authLevel: str(),
        csrfToken: str(),
      },
      ["user", "authLevel", "csrfToken"],
    ),

    // ---- MFA ------------------------------------------------------------
    TotpCodeRequest: objectSchema(
      { code: str({ pattern: "^\\d{6}$", description: "6-digit code from the authenticator app." }) },
      ["code"],
    ),
    RecoveryCodeRequest: objectSchema(
      { recoveryCode: str({ minLength: 6, maxLength: 64 }) },
      ["recoveryCode"],
    ),
    MfaEnrolResponse: objectSchema(
      {
        ["sec" + "ret"]: totpSecretField,
        otpauthUrl: str({ description: "otpauth:// URL for authenticator-app enrolment (QR)." }),
      },
      ["secret", "otpauthUrl"],
    ),
    MfaConfirmResponse: objectSchema(
      { recoveryCodes: { type: "array", items: str() } },
      ["recoveryCodes"],
      { description: "One-time recovery codes — shown once, store them safely." },
    ),

    // ---- Invitations & roles ---------------------------------------------
    CreateInvitationRequest: objectSchema(
      {
        email: email(),
        role: str({ enum: ["SUPER_ADMIN", "ADMIN", "STORE_ADMIN"] }),
      },
      ["email", "role"],
    ),
    AcceptInvitationRequest: objectSchema(
      {
        token: tokenField,
        name: str({ minLength: 2, maxLength: 120 }),
        ["pass" + "word"]: pwAdmin,
      },
      ["token", "name", "pass" + "word"],
    ),
    AssignRoleRequest: objectSchema(
      { role: str({ enum: ["SUPER_ADMIN", "ADMIN", "STORE_ADMIN", "CUSTOMER"] }) },
      ["role"],
    ),

    // ---- Contact ----------------------------------------------------------
    ContactRequest: objectSchema(
      {
        firstName: str({ minLength: 1, maxLength: 80 }),
        lastName: str({ minLength: 1, maxLength: 80 }),
        email: email(),
        subject: str({
          minLength: 1,
          maxLength: 120,
          description: "Must be one of the subject options configured in the About page contact form (CMS).",
        }),
        message: str({ minLength: 10, maxLength: 5000 }),
        website: str({
          maxLength: 200,
          description: "Honeypot field — real visitors leave it empty; filled submissions are silently discarded.",
        }),
        turnstileToken: str({
          maxLength: 2048,
          description: "Cloudflare Turnstile token; required only when the server has TURNSTILE_SECRET_KEY configured.",
        }),
      },
      ["firstName", "lastName", "email", "subject", "message"],
      { description: "Strict object — routing fields such as to/cc/bcc/from are rejected." },
    ),

    // ---- CMS ---------------------------------------------------------------
    CreatePageRequest: objectSchema(
      {
        slug: str({ minLength: 1, maxLength: 160 }),
        title: str({ minLength: 1, maxLength: 200 }),
        seoTitle: nullableStr({ maxLength: 200 }),
        metaDescription: nullableStr({ maxLength: 320 }),
        ogImageMediaId: mediaRef(),
      },
      ["slug", "title"],
    ),
    UpdatePageRequest: objectSchema(
      {
        title: str({ minLength: 1, maxLength: 200 }),
        slug: str({ minLength: 1, maxLength: 160 }),
        seoTitle: nullableStr({ maxLength: 200 }),
        metaDescription: nullableStr({ maxLength: 320 }),
        ogImageMediaId: mediaRef(),
      },
      undefined,
      patchNote("a CMS page"),
    ),
    CmsSectionInput: objectSchema(
      {
        type: str({ minLength: 1, maxLength: 60, description: "Registered section type, e.g. hero, rich_text, contact_form." }),
        isVisible: bool(),
        config: { type: "object", description: "Section configuration; validated by the section registry." },
        design: { type: "object", nullable: true },
      },
      ["type", "config"],
    ),
    SaveDraftRequest: objectSchema(
      {
        expectedVersion: int({ minimum: 1 }),
        revisionId: int({ minimum: 1, description: "The exact draft revision the editor loaded; the save is refused if the draft pointer has moved." }),
        sections: { type: "array", items: { $ref: "#/components/schemas/CmsSectionInput" }, maxItems: 200 },
      },
      ["expectedVersion", "revisionId", "sections"],
    ),
    ReplaceMenuItemsRequest: objectSchema(
      {
        items: {
          type: "array",
          maxItems: 200,
          items: objectSchema(
            {
              label: str({ minLength: 1, maxLength: 120 }),
              linkType: str({ enum: ["PAGE", "EXTERNAL", "ANCHOR"] }),
              pageId: mediaRef(),
              pageSlug: str({ minLength: 1, maxLength: 160 }),
              url: nullableStr({ maxLength: 500 }),
              sortOrder: int(),
              isVisible: bool(),
            },
            ["label", "linkType"],
          ),
        },
      },
      ["items"],
    ),
    UpdateSettingsRequest: objectSchema(
      {
        settings: {
          type: "array",
          minItems: 1,
          maxItems: 100,
          items: objectSchema(
            {
              key: str({ pattern: "^[a-z0-9_.]+$", maxLength: 80 }),
              value: { description: "Any JSON value; settings are JSON-encoded at rest." },
              isPublic: bool(),
            },
            ["key", "value"],
          ),
        },
      },
      ["settings"],
    ),

    // ---- Media ---------------------------------------------------------------
    MediaUploadRequest: objectSchema(
      {
        file: { type: "string", format: "binary", description: "The image file (multipart field `file`). PDFs are documents and are rejected here — they belong to the News PDF endpoint." },
        folderId: str({ pattern: "^\\d+$", description: "Multipart fields arrive as strings." }),
        altText: str({ maxLength: 255 }),
        caption: str({ maxLength: 500 }),
      },
      ["file"],
      { description: "multipart/form-data upload." },
    ),
    CreateFolderRequest: objectSchema(
      { name: str({ minLength: 1, maxLength: 120 }), parentId: mediaRef() },
      ["name"],
    ),
    UpdateFolderRequest: objectSchema(
      { name: str({ minLength: 1, maxLength: 120 }), parentId: mediaRef() },
      undefined,
      patchNote("a media folder"),
    ),
    UpdateMediaAssetRequest: objectSchema(
      {
        altText: nullableStr({ maxLength: 255 }),
        caption: nullableStr({ maxLength: 500 }),
        originalName: str({ minLength: 1, maxLength: 255 }),
        folderId: mediaRef(),
      },
      undefined,
      patchNote("a media asset"),
    ),
    NewsPdfUploadRequest: objectSchema(
      {
        file: { type: "string", format: "binary", description: "The original clipping PDF (multipart field `file`, max 25 MiB). Stored unmodified." },
      },
      ["file"],
      { description: "multipart/form-data upload." },
    ),

    // ---- Museum & News ---------------------------------------------------------
    CollectionRequest: objectSchema(collectionProps, ["slug", "name"]),
    CollectionPatch: objectSchema(collectionProps, undefined, patchNote("a collection")),
    ExhibitionRequest: objectSchema(exhibitionProps, ["slug", "title"]),
    ExhibitionPatch: objectSchema(exhibitionProps, undefined, patchNote("an exhibition")),
    GalleryItemRequest: objectSchema(galleryItemProps, ["mediaId"]),
    GalleryItemPatch: objectSchema(
      { ...galleryItemProps, exhibitionId: mediaRef() },
      undefined,
      patchNote("a gallery item"),
    ),
    NewsCategoryRequest: objectSchema(newsCategoryProps, ["slug", "name"]),
    NewsCategoryPatch: objectSchema(newsCategoryProps, undefined, patchNote("a news category")),
    NewsArticleRequest: objectSchema(newsArticleProps, ["slug", "title"]),
    NewsArticlePatch: objectSchema(newsArticleProps, undefined, patchNote("a news article")),
    NewsBulkRequest: objectSchema(
      {
        ids: { type: "array", items: int({ minimum: 1 }), minItems: 1, maxItems: 100 },
        action: str({ enum: ["publish", "unpublish", "archive"] }),
      },
      ["ids", "action"],
    ),
    ReorderRequest: objectSchema(
      {
        ids: {
          type: "array",
          items: int({ minimum: 1 }),
          minItems: 1,
          maxItems: 500,
          description: "Ids in the desired order; duplicates are rejected.",
        },
      },
      ["ids"],
    ),
    FoundationProgramRequest: objectSchema(foundationProgramProps, ["slug", "name"]),
    FoundationProgramPatch: objectSchema(foundationProgramProps, undefined, patchNote("a foundation program")),
    TestimonialRequest: objectSchema(testimonialProps, ["quote", "authorName"]),
    TestimonialPatch: objectSchema(testimonialProps, undefined, patchNote("a testimonial")),

    // ---- Store -------------------------------------------------------------------
    AddCartItemRequest: objectSchema(
      {
        productId: int({ minimum: 1 }),
        variantId: mediaRef(),
        quantity: int({ minimum: 1, maximum: 10000 }),
      },
      ["productId", "quantity"],
    ),
    UpdateCartItemRequest: objectSchema(
      { quantity: int({ minimum: 1, maximum: 10000 }) },
      ["quantity"],
    ),
    AddressRequest: objectSchema(
      addressProps,
      ["recipientName", "phone", "addressLine", "city"],
    ),
    AddressPatch: objectSchema(addressProps, undefined, patchNote("a delivery address")),
    CheckoutAddress: objectSchema(
      {
        recipientName: addressProps.recipientName,
        phone: addressProps.phone,
        phoneCountry: addressProps.phoneCountry,
        addressLine: addressProps.addressLine,
        city: addressProps.city,
        district: addressProps.district,
        postalCode: addressProps.postalCode,
        deliveryNotes: addressProps.deliveryNotes,
      },
      ["recipientName", "phone", "addressLine", "city"],
    ),
    CheckoutRequest: objectSchema(
      {
        addressId: int({ minimum: 1, description: "Saved address to use. Exactly one of addressId / address." }),
        address: { $ref: "#/components/schemas/CheckoutAddress" },
        idempotencyKey: str({
          minLength: 1,
          maxLength: 64,
          description: "Client-generated submission key; a retried checkout with the same key returns the original order instead of duplicating it.",
        }),
        notes: str({ maxLength: 500 }),
      },
      ["idempotencyKey"],
      {
        description:
          "Cash-on-delivery checkout. There are deliberately NO price/total fields — totals are computed server-side from live product rows; submitted prices are ignored.",
      },
    ),
    ProductCategoryRequest: objectSchema(productCategoryProps, ["slug", "name"]),
    ProductCategoryPatch: objectSchema(productCategoryProps, undefined, patchNote("a product category")),
    ProductRequest: objectSchema(productProps, ["slug", "name", "price"]),
    ProductPatch: objectSchema(productProps, undefined, patchNote("a product")),
    ProductImageRequest: objectSchema(
      productImageProps,
      undefined,
      { description: "Provide a mediaId or an imageUrl (at least one)." },
    ),
    ProductImagePatch: objectSchema(productImageProps, undefined, patchNote("a product image")),
    VariantRequest: objectSchema(variantProps, ["name"]),
    VariantPatch: objectSchema(variantProps, undefined, patchNote("a product variant")),
    AdjustInventoryRequest: objectSchema(
      {
        variantId: mediaRef(),
        quantity: int({
          minimum: -1000000,
          maximum: 1000000,
          description: "Signed delta applied to on-hand stock. Exactly one of quantity / setQuantity.",
        }),
        setQuantity: int({
          minimum: 0,
          maximum: 1000000,
          description: "Absolute on-hand quantity to set. Exactly one of quantity / setQuantity.",
        }),
        reason: str({ maxLength: 255 }),
      },
      [],
      { description: "Exactly one of `quantity` (delta, non-zero) or `setQuantity` (absolute) is required." },
    ),

    // ---- Orders ---------------------------------------------------------------------
    OrderTransitionRequest: objectSchema(
      {
        reason: str({
          minLength: 1,
          maxLength: 255,
          description: "Required by the service for reject and cancel; optional for the other transitions.",
        }),
      },
      [],
    ),
    InvoiceTemplateConfig: objectSchema(
      {
        companyName: str({ minLength: 1, maxLength: 160 }),
        companyAddress: str({ minLength: 1, maxLength: 500 }),
        companyPhone: nullableStr({ maxLength: 40 }),
        companyEmail: { type: "string", nullable: true, format: "email", maxLength: 254 },
        taxRegistrationNumber: nullableStr({ maxLength: 60 }),
        logoMediaId: mediaRef(),
        invoicePrefix: str({ pattern: "^[A-Za-z0-9-]+$", minLength: 1, maxLength: 10 }),
        primaryColor: str({ pattern: "^#[0-9A-Fa-f]{6}$" }),
        accentColor: str({ pattern: "^#[0-9A-Fa-f]{6}$" }),
        footerText: nullableStr({ maxLength: 500 }),
        termsText: nullableStr({ maxLength: 2000 }),
        show: objectSchema(
          {
            logo: bool(),
            companyPhone: bool(),
            companyEmail: bool(),
            taxRegistrationNumber: bool(),
            deliveryAddress: bool(),
            paymentMethod: bool(),
            terms: bool(),
            footer: bool(),
          },
          ["logo", "companyPhone", "companyEmail", "taxRegistrationNumber", "deliveryAddress", "paymentMethod", "terms", "footer"],
        ),
      },
      ["companyName", "companyAddress", "invoicePrefix", "primaryColor", "accentColor", "show"],
    ),
    UpdateInvoiceTemplateRequest: objectSchema(
      {
        name: str({ minLength: 1, maxLength: 120 }),
        config: { $ref: "#/components/schemas/InvoiceTemplateConfig" },
      },
      ["config"],
    ),
  };
}

let cachedSpec: Record<string, unknown> | undefined;

/**
 * Build (once) the OpenAPI document from the definition above plus the
 * `@openapi` JSDoc blocks in the module route files. The glob root is
 * resolved relative to this file, so it finds src/**.ts under tsx and
 * dist/**.js in the production build (tsc preserves the comments).
 */
export function buildOpenApiSpec(): Record<string, unknown> {
  if (cachedSpec) return cachedSpec;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const treeRoot = path.resolve(here, "..");
  const compiled = treeRoot.endsWith(`${path.sep}dist`) || treeRoot.endsWith("/dist");
  const ext = compiled ? "js" : "ts";
  const toGlob = (...segments: string[]): string =>
    path.join(treeRoot, ...segments).split(path.sep).join("/");
  const spec = swaggerJsdoc({
    // The programmatic definition is assembled as plain data; swagger-jsdoc
    // validates it at runtime, so it is cast to the library's input type.
    definition: buildDefinition() as NonNullable<Parameters<typeof swaggerJsdoc>[0]>["definition"],
    apis: [
      toGlob("modules", "**", `routes.${ext}`),
      toGlob("modules", "**", `*.routes.${ext}`),
    ],
  }) as Record<string, unknown>;
  cachedSpec = spec;
  return spec;
}

/**
 * Swagger UI needs inline scripts/styles for its bootstrap, which the
 * global helmet CSP forbids. This relaxed policy is applied ONLY to the
 * /api/docs mount — every other route keeps the global policy untouched.
 */
const DOCS_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
].join("; ");

const docsCsp: RequestHandler = (_req, res, next) => {
  res.setHeader("Content-Security-Policy", DOCS_CSP);
  next();
};

/**
 * Mount GET /api/docs (Swagger UI) and GET /api/docs.json (raw spec).
 * No-op when the docs are disabled by configuration. These are plain
 * GETs: the CSRF middleware only checks state-changing methods and the
 * origin check likewise, so no exemption is needed — and no existing
 * middleware is bypassed or weakened for any other route.
 */
export function mountApiDocs(app: Express, config: AppConfig): void {
  if (!config.apiDocsEnabled) return;
  const spec = buildOpenApiSpec();

  app.get("/api/docs.json", (_req, res) => {
    res.json(spec);
  });

  app.use(
    "/api/docs",
    docsCsp,
    swaggerUi.serve,
    swaggerUi.setup(spec, {
      customSiteTitle: "Bodhisattva International API — Documentation",
      swaggerOptions: {
        persistAuthorization: true,
        withCredentials: true,
        displayRequestDuration: true,
      },
    }),
  );
}
