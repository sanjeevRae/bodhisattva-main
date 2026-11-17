import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config/env.js";
import { testEnv } from "./helpers.js";

describe("loadConfig", () => {
  it("accepts a valid environment and applies documented defaults", () => {
    const config = loadConfig(testEnv());
    expect(config.nodeEnv).toBe("test");
    expect(config.port).toBe(4000);
    expect(config.appUrl).toBe("http://localhost:5173");
    expect(config.corsOrigins).toEqual(["http://localhost:5173"]);
    expect(config.db).toMatchObject({
      host: "localhost",
      port: 3306,
      name: "bodhisattva_dev",
      user: "bodhisattva",
    });
    expect(config.otpPolicy).toEqual({
      expirySeconds: 600,
      maxAttempts: 5,
      resendCooldownSeconds: 60,
      maxSendsPerHour: 3,
    });
    expect(config.rateLimit.loginMaxFailures).toBe(5);
  });

  it("fails fast when a required secret is missing", () => {
    expect(() => loadConfig(testEnv({ SESSION_SECRET: undefined }))).toThrow(
      ConfigError,
    );
    expect(() => loadConfig(testEnv({ SESSION_SECRET: undefined }))).toThrow(
      /SESSION_SECRET/,
    );
  });

  it("fails fast when a secret is too short", () => {
    expect(() => loadConfig(testEnv({ OTP_HMAC_SECRET: "short" }))).toThrow(
      /OTP_HMAC_SECRET/,
    );
  });

  it("requires DB_PASSWORD when DATABASE_URL is not set", () => {
    expect(() => loadConfig(testEnv({ DB_PASSWORD: undefined }))).toThrow(
      /DB_PASSWORD/,
    );
  });

  it("accepts DATABASE_URL without DB_PASSWORD", () => {
    const config = loadConfig(
      testEnv({
        DB_PASSWORD: undefined,
        DATABASE_URL: "mysql://bodhisattva:pw@localhost:3306/bodhisattva_dev",
      }),
    );
    expect(config.databaseUrl).toContain("mysql://");
  });

  it("rejects placeholder secrets in production", () => {
    expect(() =>
      loadConfig(
        testEnv({
          NODE_ENV: "production",
          SESSION_SECRET: "change-me-session-secret-0000000000000000",
        }),
      ),
    ).toThrow(/SESSION_SECRET/);
  });

  it("rejects a non-numeric PORT", () => {
    expect(() => loadConfig(testEnv({ PORT: "abc" }))).toThrow(ConfigError);
  });

  it("parses an explicit CORS allowlist", () => {
    const config = loadConfig(
      testEnv({ CORS_ORIGINS: "https://a.example, https://b.example" }),
    );
    expect(config.corsOrigins).toEqual(["https://a.example", "https://b.example"]);
  });
});
