/**
 * Compression policy (unit) — 2026-11-26 admin speed-up.
 *
 * Exercises the REAL compression middleware + shouldCompress filter
 * on a minimal Express app (the production app has no SSE route, so
 * the stream/range exclusions are pinned here against synthetic
 * routes with the same shapes):
 *  - JSON above the threshold gzips when the client asks;
 *  - application/pdf is never compressed;
 *  - HTTP 206 / Content-Range responses are never compressed;
 *  - an x-no-compression request header opts out;
 *  - an SSE response is never compressed AND its first event is
 *    delivered immediately (no buffering until stream end).
 */
import compression from "compression";
import express from "express";
import { get } from "node:http";
import type { Server } from "node:http";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { shouldCompress } from "../src/middleware/compression.js";

const BIG_JSON = { data: "x".repeat(4096) };

function buildApp() {
  const app = express();
  app.use(compression({ filter: shouldCompress }));
  app.get("/json", (_req, res) => {
    res.json(BIG_JSON);
  });
  app.get("/pdf", (_req, res) => {
    res.setHeader("Content-Type", "application/pdf");
    res.send(Buffer.concat([Buffer.from("%PDF-1.4 "), Buffer.alloc(4096, 7)]));
  });
  app.get("/range", (_req, res) => {
    res.status(206);
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Range", "bytes 0-4095/8192");
    res.send(JSON.stringify(BIG_JSON));
  });
  app.get("/sse", (_req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.write("data: first\n\n");
    const timer = setTimeout(() => {
      res.write("data: second\n\n");
      res.end();
    }, 5000);
    res.on("close", () => clearTimeout(timer));
  });
  return app;
}

describe("compression policy", () => {
  let server: Server;
  let port = 0;

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server = buildApp().listen(0, "127.0.0.1", () => {
        const addr = server.address();
        port = typeof addr === "object" && addr ? addr.port : 0;
        resolve();
      });
    });
  });

  afterAll(() => {
    server?.close();
  });

  it("gzips JSON when the client asks", async () => {
    const res = await request(server)
      .get("/json")
      .set("Accept-Encoding", "gzip");
    expect(res.status).toBe(200);
    expect(res.headers["content-encoding"]).toBe("gzip");
    expect(res.body).toEqual(BIG_JSON);
  });

  it("never compresses PDFs", async () => {
    const res = await request(server)
      .get("/pdf")
      .set("Accept-Encoding", "gzip")
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers["content-encoding"]).toBeUndefined();
    expect((res.body as Buffer).subarray(0, 4).toString()).toBe("%PDF");
  });

  it("never compresses partial (206 / Content-Range) responses", async () => {
    const res = await request(server)
      .get("/range")
      .set("Accept-Encoding", "gzip");
    expect(res.status).toBe(206);
    expect(res.headers["content-range"]).toBe("bytes 0-4095/8192");
    expect(res.headers["content-encoding"]).toBeUndefined();
  });

  it("honours an explicit x-no-compression request header", async () => {
    const res = await request(server)
      .get("/json")
      .set("Accept-Encoding", "gzip")
      .set("x-no-compression", "1");
    expect(res.status).toBe(200);
    expect(res.headers["content-encoding"]).toBeUndefined();
  });

  it("streams SSE uncompressed, first event immediately", async () => {
    const started = Date.now();
    const firstChunk = await new Promise<{ headers: Record<string, unknown>; text: string }>(
      (resolve, reject) => {
        const req = get(
          {
            host: "127.0.0.1",
            port,
            path: "/sse",
            headers: { "Accept-Encoding": "gzip" },
          },
          (res) => {
            res.once("data", (chunk: Buffer) => {
              const out = {
                headers: res.headers as Record<string, unknown>,
                text: chunk.toString(),
              };
              req.destroy();
              resolve(out);
            });
          },
        );
        req.on("error", reject);
      },
    );
    expect(Date.now() - started).toBeLessThan(2000);
    expect(firstChunk.headers["content-type"]).toContain("text/event-stream");
    expect(firstChunk.headers["content-encoding"]).toBeUndefined();
    expect(firstChunk.text).toContain("data: first");
  });
});
