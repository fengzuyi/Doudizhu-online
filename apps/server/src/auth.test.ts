import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server as HttpServer } from "node:http";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGameServerWithOptions } from "./createGameServer.js";
import type { AuthManager } from "./authManager.js";

async function postJson(baseUrl: string, path: string, body: unknown, token?: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(body)
  });

  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>
  };
}

async function getJson(baseUrl: string, path: string, token?: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : undefined
  });

  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>
  };
}

describe("auth API", () => {
  let httpServer: HttpServer;
  let baseUrl = "";
  let tempDir = "";
  let authStorePath = "";
  let authManager: AuthManager;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "doudizhu-auth-"));
    authStorePath = join(tempDir, "auth-store.json");
    const created = createGameServerWithOptions({ authStorePath });
    httpServer = created.httpServer;
    authManager = created.authManager;

    await new Promise<void>((resolve) => {
      httpServer.listen(0, resolve);
    });

    const address = httpServer.address() as AddressInfo;
    baseUrl = `http://localhost:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("registers an account and returns a token with profile", async () => {
    const result = await postJson(baseUrl, "/api/auth/register", {
      account: "player001",
      nickname: "玩家一号",
      password: "secret"
    });

    expect(result.status).toBe(200);
    expect(result.body.token).toEqual(expect.any(String));
    expect(result.body.profile).toEqual({
      account: "player001",
      nickname: "玩家一号",
      mode: "account"
    });
  });

  it("rejects duplicate registration", async () => {
    await postJson(baseUrl, "/api/auth/register", {
      account: "player001",
      nickname: "玩家一号",
      password: "secret"
    });

    const result = await postJson(baseUrl, "/api/auth/register", {
      account: "player001",
      nickname: "玩家一号",
      password: "secret"
    });

    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({ code: "ACCOUNT_EXISTS" });
  });

  it("logs in with a registered account", async () => {
    await postJson(baseUrl, "/api/auth/register", {
      account: "player001",
      nickname: "玩家一号",
      password: "secret"
    });

    const result = await postJson(baseUrl, "/api/auth/login", {
      account: "player001",
      password: "secret"
    });

    expect(result.status).toBe(200);
    expect(result.body.token).toEqual(expect.any(String));
    expect(result.body.profile).toMatchObject({ account: "player001", nickname: "玩家一号" });
  });

  it("keeps registered accounts after recreating the server with the same store file", async () => {
    await postJson(baseUrl, "/api/auth/register", {
      account: "player001",
      nickname: "玩家一号",
      password: "secret"
    });

    await new Promise<void>((resolve) => httpServer.close(() => resolve()));

    const restarted = createGameServerWithOptions({ authStorePath });
    httpServer = restarted.httpServer;
    await new Promise<void>((resolve) => {
      httpServer.listen(0, resolve);
    });
    const address = httpServer.address() as AddressInfo;
    baseUrl = `http://localhost:${address.port}`;

    const result = await postJson(baseUrl, "/api/auth/login", {
      account: "player001",
      password: "secret"
    });

    expect(result.status).toBe(200);
    expect(result.body.profile).toMatchObject({ account: "player001", nickname: "玩家一号" });
  });

  it("rejects empty credentials and wrong passwords", async () => {
    const emptyAccount = await postJson(baseUrl, "/api/auth/login", { account: "", password: "secret" });
    expect(emptyAccount.status).toBe(400);
    expect(emptyAccount.body).toMatchObject({ code: "ACCOUNT_REQUIRED" });

    const emptyPassword = await postJson(baseUrl, "/api/auth/login", { account: "player001", password: "" });
    expect(emptyPassword.status).toBe(400);
    expect(emptyPassword.body).toMatchObject({ code: "PASSWORD_REQUIRED" });

    await postJson(baseUrl, "/api/auth/register", {
      account: "player001",
      nickname: "玩家一号",
      password: "secret"
    });

    const wrongPassword = await postJson(baseUrl, "/api/auth/login", {
      account: "player001",
      password: "wrong"
    });
    expect(wrongPassword.status).toBe(401);
    expect(wrongPassword.body).toMatchObject({ code: "INVALID_PASSWORD" });
  });

  it("returns the current profile for a valid token and rejects invalid tokens", async () => {
    const registered = await postJson(baseUrl, "/api/auth/register", {
      account: "player001",
      nickname: "玩家一号",
      password: "secret"
    });
    const token = String(registered.body.token);

    const valid = await getJson(baseUrl, "/api/auth/me", token);
    expect(valid.status).toBe(200);
    expect(valid.body.profile).toMatchObject({ account: "player001", nickname: "玩家一号" });

    const invalid = await getJson(baseUrl, "/api/auth/me", "bad-token");
    expect(invalid.status).toBe(401);
    expect(invalid.body).toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("invalidates a token after logout", async () => {
    const registered = await postJson(baseUrl, "/api/auth/register", {
      account: "player001",
      nickname: "玩家一号",
      password: "secret"
    });
    const token = String(registered.body.token);

    const loggedOut = await postJson(baseUrl, "/api/auth/logout", {}, token);
    expect(loggedOut.status).toBe(200);
    expect(loggedOut.body).toEqual({ ok: true });

    const me = await getJson(baseUrl, "/api/auth/me", token);
    expect(me.status).toBe(401);
    expect(me.body).toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("creates and prunes auth store backups", async () => {
    await postJson(baseUrl, "/api/auth/register", {
      account: "player001",
      nickname: "玩家一号",
      password: "secret"
    });

    const first = authManager.backupAccounts({
      keep: 1,
      now: new Date("2026-05-27T00:00:00.000Z")
    });
    const second = authManager.backupAccounts({
      keep: 1,
      now: new Date("2026-05-27T00:01:00.000Z")
    });

    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(existsSync(second!.path)).toBe(true);
    expect(readdirSync(join(tempDir, "backups")).filter((name) => name.endsWith(".bak"))).toHaveLength(1);
  });
});
