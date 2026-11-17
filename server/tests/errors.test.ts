import { AppError, errorResponseFor } from "@bodhisattva/shared/errors";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { testConfig } from "./helpers.js";

describe("error envelope", () => {
  it("unknown routes return the NOT_FOUND envelope with a request id", async () => {
    const app = createApp({ config: testConfig() });
    const res = await request(app).get("/no-such-route");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
    expect(typeof res.body.error.message).toBe("string");
    expect(res.body.error.requestId).toBe(res.headers["x-request-id"]);
  });

  it("malformed JSON bodies return VALIDATION_FAILED, not a stack trace", async () => {
    const app = createApp({ config: testConfig() });
    const res = await request(app)
      .post("/health")
      .set("Content-Type", "application/json")
      .send("{not json");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
    expect(JSON.stringify(res.body)).not.toContain("SyntaxError");
  });

  it("AppError carries the catalogue HTTP status", () => {
    expect(new AppError("INSUFFICIENT_STOCK").httpStatus).toBe(422);
    expect(new AppError("INVALID_STATE_TRANSITION").httpStatus).toBe(422);
    expect(new AppError("RATE_LIMITED").httpStatus).toBe(429);
    expect(AppError.notFound().code).toBe("NOT_FOUND");
    expect(AppError.forbidden().httpStatus).toBe(403);
  });

  it("errorResponseFor renders the exact envelope shape", () => {
    const { status, body } = errorResponseFor(
      AppError.validation([{ field: "email", issue: "Invalid email address" }]),
      "req_test",
    );
    expect(status).toBe(400);
    expect(body).toEqual({
      error: {
        code: "VALIDATION_FAILED",
        message: "The submitted data is invalid.",
        details: [{ field: "email", issue: "Invalid email address" }],
        requestId: "req_test",
      },
    });
  });

  it("errorResponseFor hides unknown errors behind INTERNAL", () => {
    const { status, body } = errorResponseFor(
      new Error("db password is hunter2"),
      "req_test",
    );
    expect(status).toBe(500);
    expect(body.error.code).toBe("INTERNAL");
    expect(body.error.message).not.toContain("hunter2");
  });
});
