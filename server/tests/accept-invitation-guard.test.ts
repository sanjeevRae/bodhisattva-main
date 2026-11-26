/**
 * Accept-invitation route guard (2026-11-26).
 *
 * The bug: the invitation email links to {APP_URL}/accept-invitation,
 * the accept API existed and was tested, but the public SPA never had
 * the page — its catch-all route bounced invitees to the homepage, so
 * no invited admin could ever accept. This source-scan test keeps the
 * wiring in place: the router must register the route, the page must
 * post to the accept endpoint, and the entrance bypass must keep the
 * path. (The accept API itself is covered by the auth integration
 * suite; the page's behaviour is covered by the dev-stack browser
 * check recorded with the fix.)
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

function read(rel: string): string {
  return readFileSync(path.join(repoRoot, rel), "utf8");
}

describe("accept-invitation wiring", () => {
  it("the public router registers /accept-invitation", () => {
    const app = read("src/app/App.tsx");
    expect(app).toContain('path="/accept-invitation"');
    expect(app).toContain("AcceptInvitationPage");
  });

  it("the page posts to the accept endpoint", () => {
    const pages = read("src/app/pages/PasswordPages.tsx");
    expect(pages).toContain("AcceptInvitationPage");
    expect(pages).toContain("/api/auth/invitations/accept");
  });

  it("the entrance bypass covers the emailed-link account pages", () => {
    const intro = read("src/app/components/EntranceIntro.tsx");
    expect(intro).toContain('"/accept-invitation"');
    expect(intro).toContain('"/forgot-password"');
    expect(intro).toContain('"/reset-password"');
  });
});
