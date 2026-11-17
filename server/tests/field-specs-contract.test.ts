/**
 * Schema-drift contract (Phase 4 review fix) — client field specs vs the
 * server registry.
 *
 * The PageEditor inspector is driven by hand-written field specs in
 * `src/admin/field-specs.ts` (SECTION_SPECS) that mirror the server-side
 * section registry, the source of truth. The specs live in the frontend
 * bundle, so this test reads the file as TEXT and extracts the spec keys
 * statically: every registry section type must have a client spec (or the
 * editor cannot render an inspector for it) and every client spec must
 * name a real registry type (or the editor offers a section the server
 * will reject at save). Either direction of drift fails this suite.
 *
 * Extraction relies on the file's stable formatting — SECTION_SPECS is a
 * single top-level object literal whose entries are `  <key>: {` at
 * two-space indent, closed by a `};` line at column zero (verified
 * against the file; nested spec content is always indented deeper).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SECTION_TYPES } from "../src/modules/cms/registry.js";

const fieldSpecsPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../src/admin/field-specs.ts",
);

function extractSectionSpecKeys(source: string): string[] {
  const lines = source.split("\n");
  const start = lines.findIndex((line) =>
    line.startsWith("export const SECTION_SPECS"),
  );
  if (start < 0) throw new Error("SECTION_SPECS declaration not found");
  const keys: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line === "};") return keys;
    const match = /^ {2}([A-Za-z][A-Za-z0-9_]*)\s*:/.exec(line);
    if (match) keys.push(match[1]);
  }
  throw new Error("SECTION_SPECS closing brace not found");
}

describe("admin field specs ↔ server registry contract", () => {
  const clientKeys = extractSectionSpecKeys(readFileSync(fieldSpecsPath, "utf8"));

  it("extracts a non-trivial set of client spec keys", () => {
    expect(clientKeys.length).toBeGreaterThanOrEqual(19);
    expect(new Set(clientKeys).size).toBe(clientKeys.length);
  });

  it("has a client field spec for every server section type", () => {
    const missing = SECTION_TYPES.filter((t) => !clientKeys.includes(t));
    expect(missing).toEqual([]);
  });

  it("has no client field spec for a type the server does not know", () => {
    const serverTypes = new Set<string>(SECTION_TYPES);
    const unknown = clientKeys.filter((k) => !serverTypes.has(k));
    expect(unknown).toEqual([]);
  });

  it("client and server type sets are exactly equal", () => {
    expect([...clientKeys].sort()).toEqual([...SECTION_TYPES].sort());
  });
});
