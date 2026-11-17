import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { testConfig } from "./helpers.js";

describe("health endpoints", () => {
  it("GET /health returns liveness without any database", async () => {
    const app = createApp({ config: testConfig() });
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("GET /health/ready succeeds when the database probe passes", async () => {
    const app = createApp({
      config: testConfig(),
      database: { ping: async () => undefined },
    });
    const res = await request(app).get("/health/ready");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ready", database: "ok" });
  });

  it("GET /health/ready returns the 503 envelope when the database is down", async () => {
    const app = createApp({
      config: testConfig(),
      database: {
        ping: async () => {
          throw new Error("connect ECONNREFUSED");
        },
      },
    });
    const res = await request(app).get("/health/ready");
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("SERVICE_UNAVAILABLE");
    expect(res.body.error.requestId).toMatch(/^req_/);
    expect(res.body.error.message).not.toContain("ECONNREFUSED");
  });

  it("GET /health/ready returns 503 when no database is configured", async () => {
    const app = createApp({ config: testConfig() });
    const res = await request(app).get("/health/ready");
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("SERVICE_UNAVAILABLE");
  });
});
