const url = process.env.DEV_SERVER_HEALTH_URL ?? "http://127.0.0.1:3001/health";
const timeoutMs = Number(process.env.DEV_SERVER_WAIT_TIMEOUT_MS ?? 60_000);
const intervalMs = 500;
const startedAt = Date.now();

process.stdout.write(`[dev] Waiting for server: ${url}\n`);

while (Date.now() - startedAt < timeoutMs) {
  try {
    const response = await fetch(url);
    if (response.ok) {
      process.stdout.write("[dev] Server is ready.\n");
      process.exit(0);
    }
  } catch {
    // Server is still starting.
  }

  await new Promise((resolve) => setTimeout(resolve, intervalMs));
}

process.stderr.write(`[dev] Timed out waiting for server after ${timeoutMs}ms.\n`);
process.exit(1);
