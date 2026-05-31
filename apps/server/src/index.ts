import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { createGameServer } from "./createGameServer.js";

loadEnv();
loadEnv({ path: fileURLToPath(new URL("../.env", import.meta.url)), override: false });

const port = Number(process.env.PORT ?? 3001);
const { httpServer, logger } = (() => {
  try {
    return createGameServer();
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
})();

process.on("uncaughtException", (error) => {
  logger.error("process.uncaught_exception", { error });
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  logger.error("process.unhandled_rejection", {
    error: reason instanceof Error ? reason : new Error(String(reason))
  });
});

process.on("SIGTERM", () => {
  logger.info("process.sigterm");
  httpServer.close(() => process.exit(0));
});

process.on("SIGINT", () => {
  logger.info("process.sigint");
  httpServer.close(() => process.exit(0));
});

httpServer.listen(port, () => {
  logger.info("server.started", { port });
});

httpServer.on("error", (error) => {
  logger.error("server.listen_failed", { error, port });
  process.exit(1);
});
