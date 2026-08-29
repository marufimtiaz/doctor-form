import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "node_modules", "coverage"] },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Vite's fast refresh only handles files that export components.
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      // Underscore-prefixed args are the codebase's marker for deliberately
      // unused parameters.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Fires on every fetch-on-mount in the app (auth, AgentPage, AdminPage,
      // LocationInput, NameplateInput). Worth seeing, but these predate the
      // rule and reworking them is its own task - a warning keeps them visible
      // without failing the build.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  {
    // shadcn generates these, and they export variant helpers next to the
    // component by design.
    files: ["src/components/ui/**"],
    rules: { "react-refresh/only-export-components": "off" },
  },
  {
    files: ["**/*.test.ts"],
    languageOptions: { globals: globals.node },
  },
);
