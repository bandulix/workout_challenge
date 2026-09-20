import {defineConfig} from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// CRA used .js files that contain JSX. Vite's React plugin only
// transforms .jsx unless we teach esbuild to treat src/**/*.js as JSX.
export default defineConfig(({mode}) => ({
    plugins: [react()],
    envPrefix: ["REACT_APP_", "VITE_"],
    publicDir: "public",
    build: {
        outDir: "build",
        // 'hidden' once CI uploads maps to Sentry; until then emitting
        // them would just publish readable source under guessable names.
        sourcemap: false,
        emptyOutDir: true,
        rollupOptions: {
            output: {
                manualChunks: {
                    "vendor-react": ["react", "react-dom", "react-router-dom"],
                    "vendor-redux": ["@reduxjs/toolkit", "react-redux"],
                    "vendor-icons": ["lucide-react"],
                },
            },
        },
    },
    server: {
        port: 3000,
    },
    define: {
        "process.env.NODE_ENV": JSON.stringify(mode === "production" ? "production" : "development"),
        "process.env.REACT_APP_BACKEND_URL": JSON.stringify(process.env.REACT_APP_BACKEND_URL || ""),
    },
    esbuild: {
        loader: "jsx",
        include: /src\/.*\.js$/,
        exclude: [],
    },
    optimizeDeps: {
        esbuildOptions: {
            loader: {".js": "jsx"},
        },
    },
    resolve: {
        alias: {
            src: path.resolve(__dirname, "src"),
        },
    },
    test: {
        // node stays the default (pure-logic tests); component tests opt
        // in per-file via `// @vitest-environment jsdom` so the API layer
        // never drags a DOM into the fast suite.
        environment: "node",
        environmentMatchGlobs: [],
        setupFiles: ["src/setupTests.js"],
        include: ["src/**/*.test.js"],
    },
}));
