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
        sourcemap: false,
        emptyOutDir: true,
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
        environment: "node",
        include: ["src/**/*.test.js"],
    },
}));
