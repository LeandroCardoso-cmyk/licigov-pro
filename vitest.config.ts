import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  root: path.resolve(import.meta.dirname),
  resolve: {
    alias: {
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@": path.resolve(import.meta.dirname, "client/src"),
    },
  },
  test: {
    environment: "node",
    include: [
      "server/**/*.test.ts",
      "server/**/*.spec.ts",
      // Testes de lógica pura do frontend (sem DOM) — ex.: tema, identidade institucional.
      "client/src/**/*.test.ts",
    ],
    env: {
      APP_ENV: "development",
    },
  },
});
