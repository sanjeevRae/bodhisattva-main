/**
 * Test helpers: build valid configurations from synthetic environments so
 * the suite never needs a real .env file or a running database.
 */
import { loadConfig, type AppConfig } from "../src/config/env.js";

export function testEnv(
  overrides: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    SESSION_SECRET: "test-session-secret-0123456789abcdef",
    OTP_HMAC_SECRET: "test-otp-hmac-secret-0123456789abcdef",
    TOTP_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    DB_PASSWORD: "test-db-password",
    ...overrides,
  };
}

export function testConfig(
  overrides: Record<string, string | undefined> = {},
): AppConfig {
  return loadConfig(testEnv(overrides));
}
