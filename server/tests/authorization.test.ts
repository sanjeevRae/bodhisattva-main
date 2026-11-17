/**
 * Authorization middleware tests: 401/403 envelope behaviour of
 * requirePermission (via the injectable-resolver factory), the step-up
 * window, and the ownership assertion (cross-owner = 404, amendment A6).
 */
import { AppError } from "@bodhisattva/shared/errors";
import type { Permission } from "@bodhisattva/shared/permissions";
import express, { type Request } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import type { AuthContext } from "../src/middleware/auth.js";
import {
  assertOwnership,
  createRequirePermission,
  requireStepUp,
} from "../src/middleware/authorization.js";
import { errorHandler } from "../src/middleware/error-handler.js";

function authContext(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: 42,
    sessionId: 7,
    authLevel: "full",
    roles: ["ADMIN"],
    isAdmin: true,
    email: "admin@example.com",
    fullName: "Admin",
    stepUpAt: new Date(),
    ...overrides,
  };
}

function appWith(
  auth: AuthContext | undefined,
  granted: Permission[],
  gate: express.RequestHandler,
) {
  const app = express();
  app.use((req: Request, _res, next) => {
    if (auth) req.auth = auth;
    next();
  });
  app.get("/guarded", gate, (_req, res) => {
    res.status(200).json({ ok: true });
  });
  app.use(errorHandler);
  return app;
}

const resolverFor =
  (granted: Permission[]) =>
  async (): Promise<ReadonlySet<Permission>> =>
    new Set(granted);

describe("requirePermission", () => {
  it("401s when unauthenticated", async () => {
    const app = appWith(
      undefined,
      [],
      createRequirePermission(resolverFor([]))("roles.read"),
    );
    const res = await request(app).get("/guarded");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("403s with the FORBIDDEN envelope when the permission is absent", async () => {
    const app = appWith(
      authContext(),
      ["pages.read"],
      createRequirePermission(resolverFor(["pages.read"]))("roles.read"),
    );
    const res = await request(app).get("/guarded");
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("passes when the permission is present", async () => {
    const app = appWith(
      authContext(),
      ["roles.read"],
      createRequirePermission(resolverFor(["roles.read"]))("roles.read"),
    );
    const res = await request(app).get("/guarded");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

describe("requireStepUp", () => {
  it("passes with a fresh step-up", async () => {
    const app = appWith(authContext({ stepUpAt: new Date() }), [], requireStepUp());
    const res = await request(app).get("/guarded");
    expect(res.status).toBe(200);
  });

  it("403s with a stale step-up (older than 15 minutes)", async () => {
    const stale = new Date(Date.now() - 16 * 60_000);
    const app = appWith(authContext({ stepUpAt: stale }), [], requireStepUp());
    const res = await request(app).get("/guarded");
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("403s when the session never stepped up", async () => {
    const app = appWith(authContext({ stepUpAt: null }), [], requireStepUp());
    const res = await request(app).get("/guarded");
    expect(res.status).toBe(403);
  });
});

describe("assertOwnership", () => {
  it("passes for the owner (number or string ids)", () => {
    expect(() => assertOwnership(5, 5)).not.toThrow();
    expect(() => assertOwnership("5", 5)).not.toThrow();
  });

  it("throws NOT_FOUND for a different owner (existence is not leaked)", () => {
    try {
      assertOwnership(5, 6);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe("NOT_FOUND");
      expect((err as AppError).httpStatus).toBe(404);
    }
  });
});
