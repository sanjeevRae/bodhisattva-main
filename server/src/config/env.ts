/**
 * Environment configuration (ARCHITECTURE.md §4.2 `config/`,
 * DEPLOYMENT_REQUIREMENTS.md §7.2).
 *
 * All configuration comes from environment variables, parsed and validated
 * with Zod at boot. Loading fails fast: a misconfigured server exits with a
 * readable list of problems instead of running in a broken state. No real
 * secrets exist in code — see server/.env.example for the full variable list.
 */
import { z } from "zod";

export class ConfigError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(
      `Invalid environment configuration:\n${issues.map((i) => `  - ${i}`).join("\n")}`,
    );
    this.name = "ConfigError";
    this.issues = issues;
  }
}

/** Placeholder markers from .env.example — never acceptable in production. */
const PLACEHOLDER_MARKERS = ["change-me", "placeholder", "example-secret"];

function secretField(name: string) {
  return z
    .string({ required_error: `${name} is required` })
    .min(32, `${name} must be at least 32 characters`);
}

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    APP_URL: z.string().url().default("http://localhost:5173"),
    CORS_ORIGINS: z.string().optional(),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),

    // Interactive API documentation (Swagger UI at /api/docs, raw spec at
    // /api/docs.json). Optional boolean: when unset it defaults to enabled
    // outside production and disabled in production, so the docs surface
    // is never exposed publicly unless an operator opts in explicitly.
    API_DOCS_ENABLED: z
      .enum(["true", "false"])
      .optional()
      .transform((value) =>
        value === undefined ? undefined : value === "true",
      ),

    // Database: DATABASE_URL (option A) or the discrete DB_* set (option B).
    DATABASE_URL: z.string().min(1).optional(),
    DB_HOST: z.string().default("localhost"),
    DB_PORT: z.coerce.number().int().min(1).max(65535).default(3306),
    DB_NAME: z.string().default("bodhisattva_dev"),
    DB_USER: z.string().default("bodhisattva"),
    // Per-worker pool size. Passenger may run several workers, so the
    // aggregate budget is workers x DB_POOL_LIMIT — keep it conservative
    // on shared hosting (Phase 1 review, ChatGPT F2).
    DB_POOL_LIMIT: z.coerce.number().int().min(1).max(50).default(5),
    DB_PASSWORD: z.string().min(1).optional(),

    // Secrets — distinct keys per purpose, unique per environment.
    SESSION_SECRET: secretField("SESSION_SECRET"),
    OTP_HMAC_SECRET: secretField("OTP_HMAC_SECRET"),
    TOTP_ENCRYPTION_KEY: secretField("TOTP_ENCRYPTION_KEY"),

    // SMTP (local default is a mail catcher such as Mailpit).
    SMTP_HOST: z.string().default("localhost"),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(1025),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    SMTP_FROM: z.string().default("Bodhisattva Museum <no-reply@localhost>"),

    UPLOAD_DIRECTORY: z.string().default("../private-storage"),

    // OTP policy (spec Part 7.1) — server-configuration only.
    OTP_POLICY_EXPIRY_SECONDS: z.coerce.number().int().positive().default(600),
    OTP_POLICY_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
    OTP_POLICY_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().nonnegative().default(60),
    OTP_POLICY_MAX_SENDS_PER_HOUR: z.coerce.number().int().positive().default(3),

    // Rate-limit policy (spec §15.3) — server-configuration only.
    RATE_LIMIT_LOGIN_MAX_FAILURES: z.coerce.number().int().positive().default(5),
    RATE_LIMIT_LOGIN_WINDOW_MINUTES: z.coerce.number().int().positive().default(15),
    RATE_LIMIT_ADMIN_LOGIN_MAX_FAILURES: z.coerce.number().int().positive().default(3),
    RATE_LIMIT_REGISTRATION_PER_HOUR: z.coerce.number().int().positive().default(3),
    RATE_LIMIT_RECOVERY_PER_HOUR: z.coerce.number().int().positive().default(3),

    // About-page contact form (server-side only — none of these may ever
    // be exposed to the frontend). The visitor can never choose the
    // sender or recipient: both come from here.
    CONTACT_TO_EMAIL: z
      .string()
      .email()
      .default("info@bodhisattvainternational.com"),
    CONTACT_FROM_EMAIL: z
      .string()
      .email()
      .default("alerts@bodhisattvainternational.com"),
    CONTACT_FROM_NAME: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .default("Bodhisattva International Website"),
    // Cloudflare Turnstile secret key (OPTIONAL). When unset, contact-form
    // bot protection is rate limiting + honeypot only, and production
    // boot logs a warning (server.ts) — it never fails startup and never
    // weakens the mail transport. The matching SITE key is public and
    // lives in the frontend's own configuration, never here.
    TURNSTILE_SECRET_KEY: z.string().min(1).optional(),
    // Optional overrides for the contact short-window IP limit
    // (defaults: 3 submissions per 10 minutes; the hourly caps are
    // fixed policy in the contact service).
    CONTACT_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().optional(),
    CONTACT_RATE_LIMIT_MAX: z.coerce.number().int().positive().optional(),
  })
  .superRefine((env, ctx) => {
    // The three secrets serve different purposes and must never be reused
    // across purposes (Phase 1 review, ChatGPT F3).
    const secretValues = [
      ["SESSION_SECRET", env.SESSION_SECRET],
      ["OTP_HMAC_SECRET", env.OTP_HMAC_SECRET],
      ["TOTP_ENCRYPTION_KEY", env.TOTP_ENCRYPTION_KEY],
    ] as const;
    for (let i = 0; i < secretValues.length; i++) {
      for (let j = i + 1; j < secretValues.length; j++) {
        if (secretValues[i][1] === secretValues[j][1]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [secretValues[j][0]],
            message: `${secretValues[j][0]} must differ from ${secretValues[i][0]} — one secret per purpose`,
          });
        }
      }
    }
    // The TOTP key encrypts with AES-256-GCM: it must decode to exactly
    // 32 bytes (64 hex chars, or base64 decoding to 32 bytes) — a character
    // count alone does not prove key size.
    const totpKey = env.TOTP_ENCRYPTION_KEY;
    const decoded =
      /^[0-9a-fA-F]{64}$/.test(totpKey)
        ? Buffer.from(totpKey, "hex")
        : Buffer.from(totpKey, "base64");
    if (decoded.length !== 32) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["TOTP_ENCRYPTION_KEY"],
        message:
          "TOTP_ENCRYPTION_KEY must decode to exactly 32 bytes (64 hex characters or base64 of 32 bytes) for AES-256",
      });
    }
    if (!env.DATABASE_URL && !env.DB_PASSWORD) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["DB_PASSWORD"],
        message: "DB_PASSWORD is required when DATABASE_URL is not set",
      });
    }
    if (env.NODE_ENV === "production") {
      const secretNames = [
        "SESSION_SECRET",
        "OTP_HMAC_SECRET",
        "TOTP_ENCRYPTION_KEY",
      ] as const;
      for (const name of secretNames) {
        const value = env[name].toLowerCase();
        if (PLACEHOLDER_MARKERS.some((marker) => value.includes(marker))) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [name],
            message: `${name} still contains a placeholder value; generate a unique secret for production`,
          });
        }
      }
    }
  });

export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  isProduction: boolean;
  port: number;
  appUrl: string;
  corsOrigins: string[];
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";
  /** Whether Swagger UI (/api/docs) and the raw spec (/api/docs.json) are served. */
  apiDocsEnabled: boolean;
  /** Full connection URL when DATABASE_URL is used (option A). */
  databaseUrl?: string;
  db: {
    host: string;
    port: number;
    name: string;
    user: string;
    password?: string;
    poolLimit: number;
  };
  secrets: {
    sessionSecret: string;
    otpHmacSecret: string;
    totpEncryptionKey: string;
  };
  smtp: {
    host: string;
    port: number;
    user?: string;
    password?: string;
    from: string;
  };
  uploadDirectory: string;
  otpPolicy: {
    expirySeconds: number;
    maxAttempts: number;
    resendCooldownSeconds: number;
    maxSendsPerHour: number;
  };
  rateLimit: {
    loginMaxFailures: number;
    loginWindowMinutes: number;
    adminLoginMaxFailures: number;
    registrationPerHour: number;
    recoveryPerHour: number;
  };
  contact: {
    /** Mailbox that receives contact-form messages. */
    toEmail: string;
    /** Authenticated sending identity for contact-form mail. */
    fromEmail: string;
    fromName: string;
    /** Short-window IP limit: max submissions per windowMs. */
    rateLimitWindowMs: number;
    rateLimitMax: number;
  };
  /** Turnstile secret; undefined → server-side verification is skipped. */
  turnstileSecretKey?: string;
}

/**
 * Parse and validate configuration from an environment map (defaults to
 * `process.env`). Pure and side-effect free so tests can exercise it with
 * synthetic environments. Throws ConfigError listing every problem.
 */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new ConfigError(
      result.error.issues.map(
        (issue) => `${issue.path.map(String).join(".") || "(env)"}: ${issue.message}`,
      ),
    );
  }
  const env = result.data;
  const corsOrigins = env.CORS_ORIGINS
    ? env.CORS_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean)
    : [env.APP_URL];

  return {
    nodeEnv: env.NODE_ENV,
    isProduction: env.NODE_ENV === "production",
    port: env.PORT,
    appUrl: env.APP_URL,
    corsOrigins,
    logLevel: env.LOG_LEVEL,
    apiDocsEnabled: env.API_DOCS_ENABLED ?? env.NODE_ENV !== "production",
    databaseUrl: env.DATABASE_URL,
    db: {
      host: env.DB_HOST,
      port: env.DB_PORT,
      name: env.DB_NAME,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      poolLimit: env.DB_POOL_LIMIT,
    },
    secrets: {
      sessionSecret: env.SESSION_SECRET,
      otpHmacSecret: env.OTP_HMAC_SECRET,
      totpEncryptionKey: env.TOTP_ENCRYPTION_KEY,
    },
    smtp: {
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      user: env.SMTP_USER,
      password: env.SMTP_PASSWORD,
      from: env.SMTP_FROM,
    },
    uploadDirectory: env.UPLOAD_DIRECTORY,
    otpPolicy: {
      expirySeconds: env.OTP_POLICY_EXPIRY_SECONDS,
      maxAttempts: env.OTP_POLICY_MAX_ATTEMPTS,
      resendCooldownSeconds: env.OTP_POLICY_RESEND_COOLDOWN_SECONDS,
      maxSendsPerHour: env.OTP_POLICY_MAX_SENDS_PER_HOUR,
    },
    rateLimit: {
      loginMaxFailures: env.RATE_LIMIT_LOGIN_MAX_FAILURES,
      loginWindowMinutes: env.RATE_LIMIT_LOGIN_WINDOW_MINUTES,
      adminLoginMaxFailures: env.RATE_LIMIT_ADMIN_LOGIN_MAX_FAILURES,
      registrationPerHour: env.RATE_LIMIT_REGISTRATION_PER_HOUR,
      recoveryPerHour: env.RATE_LIMIT_RECOVERY_PER_HOUR,
    },
    contact: {
      toEmail: env.CONTACT_TO_EMAIL,
      fromEmail: env.CONTACT_FROM_EMAIL,
      fromName: env.CONTACT_FROM_NAME,
      rateLimitWindowMs: env.CONTACT_RATE_LIMIT_WINDOW_MS ?? 600_000,
      rateLimitMax: env.CONTACT_RATE_LIMIT_MAX ?? 3,
    },
    turnstileSecretKey: env.TURNSTILE_SECRET_KEY,
  };
}

let cached: AppConfig | undefined;

/** Memoised config for the running server process. */
export function getConfig(): AppConfig {
  cached ??= loadConfig();
  return cached;
}
