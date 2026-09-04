const { defineConfig, globalIgnores } = require("eslint/config");

const globals = require("globals");
const prettier = require("eslint-config-prettier");
const tseslint = require("typescript-eslint");
const unusedImports = require("eslint-plugin-unused-imports");

module.exports = defineConfig([
    {
        files: ["**/*.{ts,tsx}"],
        languageOptions: {
            parser: tseslint.parser,
            parserOptions: {
                ecmaFeatures: {
                    jsx: true,
                },
                ecmaVersion: "latest",
                sourceType: "module",
            },
        },
        plugins: {
            "@typescript-eslint": tseslint.plugin,
        },
    },
    {
        files: ["**/*.{js,mjs,cjs,ts,tsx}"],
        languageOptions: {
            globals: {
                ...globals.browser,
                ...globals.node,
                ...globals.jest,
            },
        },
        plugins: {
            "unused-imports": unusedImports,
        },
        rules: {
            "no-console": [
                "error",
                {
                    allow: ["warn", "error"],
                },
            ],
            "unused-imports/no-unused-imports": "error",
            "@typescript-eslint/ban-ts-comment": "off",
            // Express module augmentation is required for req.auth typing.
            "@typescript-eslint/no-namespace": "off",
        },
    },
    prettier,
    globalIgnores([
        "**/node_modules/",
        "**/coverage/",
        "**/dist/",
    ]),
]);
