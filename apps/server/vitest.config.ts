import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { defineConfig } from "vitest/config";

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@doudizhu/shared": resolve(here, "../../packages/shared/src/index.ts")
    }
  },
  test: {
    environment: "node"
  }
});
