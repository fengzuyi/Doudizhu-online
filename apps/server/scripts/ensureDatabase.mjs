import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import mysql from "mysql2/promise";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const serverDir = resolve(scriptDir, "..");
const envPath = resolve(serverDir, ".env");

if (existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config();
}

const rawDatabaseUrl = process.env.DATABASE_URL;

if (!rawDatabaseUrl) {
  console.error("[db:init] Missing DATABASE_URL.");
  console.error("[db:init] Create apps/server/.env from apps/server/env.example and fill in your MySQL account/password.");
  process.exit(1);
}

let databaseUrl;
try {
  databaseUrl = new URL(rawDatabaseUrl);
} catch {
  console.error("[db:init] DATABASE_URL is not a valid URL.");
  process.exit(1);
}

if (databaseUrl.protocol !== "mysql:") {
  console.error("[db:init] DATABASE_URL must start with mysql://.");
  process.exit(1);
}

const databaseName = decodeURIComponent(databaseUrl.pathname.replace(/^\/+/, ""));
if (!databaseName) {
  console.error("[db:init] DATABASE_URL must include a database name, for example mysql://user:pass@127.0.0.1:3306/doudizhu.");
  process.exit(1);
}

if (rawDatabaseUrl.includes("CHANGE_ME")) {
  console.error("[db:init] Please edit apps/server/.env and replace CHANGE_ME with your real MySQL password.");
  process.exit(1);
}

const connection = await mysql.createConnection({
  host: databaseUrl.hostname || "127.0.0.1",
  port: databaseUrl.port ? Number(databaseUrl.port) : 3306,
  user: decodeURIComponent(databaseUrl.username),
  password: decodeURIComponent(databaseUrl.password),
  multipleStatements: false
});

const escapedDatabaseName = databaseName.replace(/`/g, "``");
await connection.execute(`CREATE DATABASE IF NOT EXISTS \`${escapedDatabaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
await connection.end();

console.log(`[db:init] Database "${databaseName}" is ready.`);
