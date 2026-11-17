import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Tests run against the shared package's TypeScript sources (always fresh,
// no build step required). Production code resolves @bodhisattva/shared
// through its package exports → dist/.
const sharedSrcDir = fileURLToPath(new URL("../shared/src", import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@bodhisattva\/shared\/(.+)$/,
        replacement: `${sharedSrcDir}/$1.ts`,
      },
      { find: /^@bodhisattva\/shared$/, replacement: `${sharedSrcDir}/index.ts` },
    ],
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
