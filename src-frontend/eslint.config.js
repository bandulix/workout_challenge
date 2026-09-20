import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";

// Deliberately narrow: hooks correctness (the bugs this codebase actually
// produces) + unused vars. Broad rule packs would drown the signal in
// pre-existing style noise.
export default [
    {
        ignores: ["build/**", "node_modules/**", "public/**", "android/**", "coverage/**"],
    },
    {
        files: ["src/**/*.{js,jsx}"],
        plugins: {"react-hooks": reactHooks},
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "module",
            parserOptions: {ecmaFeatures: {jsx: true}},
            globals: {...globals.browser, ...globals.es2021},
        },
        rules: {
            // The signal this codebase needs: hook order + effect deps.
            // (no-unused-vars stays off - without eslint-plugin-react it
            // false-flags every JSX-only component usage.)
            "react-hooks/rules-of-hooks": "error",
            "react-hooks/exhaustive-deps": "warn",
        },
    },
];
