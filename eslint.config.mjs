import { defineConfig, globalIgnores } from "eslint/config";
import js from "@eslint/js";
import nextPlugin from "@next/eslint-plugin-next";
import prettier from "eslint-config-prettier";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import unusedImports from "eslint-plugin-unused-imports";
import globals from "globals";
import tseslint from "typescript-eslint";

const rootTypeScriptParser = {
  meta: tseslint.parser.meta,
  parseForESLint(code, options) {
    return tseslint.parser.parseForESLint(code, {
      ...options,
      project: false,
      projectService: false,
      tsconfigRootDir: import.meta.dirname,
    });
  },
};

const typescriptConfigs = tseslint.configs.recommended.map((config) => ({
  ...config,
  files: config.files ?? ["**/*.{ts,tsx,mts,cts}"],
  languageOptions: {
    ...config.languageOptions,
    parser: rootTypeScriptParser,
    parserOptions: {
      ...(config.languageOptions?.parserOptions ?? {}),
      project: false,
      projectService: false,
      tsconfigRootDir: import.meta.dirname,
    },
  },
}));

const nextConfig = {
  ...nextPlugin.configs["core-web-vitals"],
  files: [
    "examples/reference-product/apps/web/**/*.{js,jsx,ts,tsx}",
    "templates/saas-product/apps/web/**/*.{js,jsx,ts,tsx}",
  ],
  settings: {
    react: { version: "19.2" },
    next: {
      rootDir: [
        "examples/reference-product/apps/web/",
        "templates/saas-product/apps/web/",
      ],
    },
  },
};

export default defineConfig([
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: rootTypeScriptParser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
        ecmaVersion: "latest",
        project: false,
        projectService: false,
        sourceType: "module",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { "@typescript-eslint": tseslint.plugin },
  },
  js.configs.recommended,
  ...typescriptConfigs,
  {
    files: ["**/*.{js,jsx,mjs,cjs,ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node, ...globals.jest },
      parserOptions: {
        project: false,
        projectService: false,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
      "unused-imports": unusedImports,
      react,
      "react-hooks": reactHooks,
    },
    settings: { react: { version: "19.2" } },
    rules: {
      "no-console": ["error", { allow: ["warn", "error"] }],
      "unused-imports/no-unused-imports": "error",
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-namespace": "off",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      ...react.configs.recommended.rules,
      "react/react-in-jsx-scope": "off",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "prefer-const": "off",
    },
  },
  {
    files: ["**/scripts/**/*.{js,mjs,cjs,ts}"],
    rules: { "no-console": "off" },
  },
  {
    files: [
      "examples/reference-product/apps/web/**/*.{js,jsx,ts,tsx}",
      "templates/saas-product/apps/web/**/*.{js,jsx,ts,tsx}",
    ],
    rules: { "react-hooks/set-state-in-effect": "off" },
  },
  nextConfig,
  prettier,
  globalIgnores([
    "**/node_modules/",
    "**/.next/",
    "**/dist/",
    "**/coverage/",
    "**/out/",
    "**/.source/",
    "**/drizzle/",
    "**/eslint.config.*",
    "**/next-env.d.ts",
    "**/src/db/schema/auth.generated.ts",
  ]),
]);
