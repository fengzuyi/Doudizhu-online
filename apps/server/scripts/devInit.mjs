import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const serverDir = resolve(scriptDir, "..");
const rootDir = resolve(serverDir, "../..");
const prismaClientEntry = resolve(rootDir, "node_modules/.prisma/client/index.js");
const runner = process.platform === "win32" ? "npx.cmd" : "npx";

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: serverDir,
    stdio: "inherit",
    env: process.env
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

await import("./ensureDatabase.mjs");

if (!existsSync(prismaClientEntry)) {
  process.stdout.write("[db:init] Prisma Client is missing; generating it now.\n");
  run(runner, ["prisma", "generate"]);
} else {
  process.stdout.write("[db:init] Prisma Client already exists; skipping generate.\n");
}

run(runner, ["prisma", "migrate", "deploy"]);
