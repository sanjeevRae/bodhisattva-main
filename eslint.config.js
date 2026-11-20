// Frontend lint — deliberately scoped to ONE rule for now:
// react-hooks/rules-of-hooks. A hook placed below the page editor's
// loading early-return blanked the editor on 2026-11-20 ("Rendered
// more hooks than during the previous render"); this rule catches
// that whole class at commit time. Broader rulesets (exhaustive-deps
// etc.) can be layered on later without this config changing shape.
import reactHooks from "eslint-plugin-react-hooks";
import tsParser from "typescript-eslint";

export default [
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: { parser: tsParser.parser },
    linterOptions: { reportUnusedDisableDirectives: "off" },
    plugins: { "react-hooks": reactHooks },
    rules: { "react-hooks/rules-of-hooks": "error" },
  },
];
