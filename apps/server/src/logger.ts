import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

type LogLevel = "info" | "warn" | "error";

export interface AppLogger {
  info: (event: string, data?: Record<string, unknown>) => void;
  warn: (event: string, data?: Record<string, unknown>) => void;
  error: (event: string, data?: Record<string, unknown>) => void;
}

interface LoggerOptions {
  logDir?: string;
  logToFile?: boolean;
  silent?: boolean;
}

function defaultLogDir() {
  return process.env.LOG_DIR ?? fileURLToPath(new URL("../logs", import.meta.url));
}

function todayLogFile(logDir: string) {
  return join(logDir, `${new Date().toISOString().slice(0, 10)}.log`);
}

function sanitize(data: Record<string, unknown> | undefined) {
  if (!data) {
    return undefined;
  }

  return JSON.parse(
    JSON.stringify(data, (_key, value: unknown) => {
      if (value instanceof Error) {
        return {
          name: value.name,
          message: value.message,
          stack: value.stack
        };
      }
      return value;
    })
  ) as Record<string, unknown>;
}

export function createLogger(options: LoggerOptions = {}): AppLogger {
  const logDir = options.logDir ?? defaultLogDir();
  const logToFile = options.logToFile ?? (process.env.LOG_TO_FILE !== "false" && process.env.NODE_ENV !== "test");
  const silent = options.silent ?? (process.env.LOG_SILENT === "true" || process.env.NODE_ENV === "test");

  if (logToFile) {
    mkdirSync(logDir, { recursive: true });
  }

  function writeConsole(level: LogLevel, line: string) {
    try {
      if (level === "error") {
        process.stderr.write(line);
      } else {
        process.stdout.write(line);
      }
    } catch (error) {
      // Console pipes can be closed by parent tools/process managers during dev.
      // Logging must never be able to crash the game server.
    }
  }

  function write(level: LogLevel, event: string, data?: Record<string, unknown>) {
    const entry = {
      at: new Date().toISOString(),
      level,
      event,
      ...sanitize(data)
    };
    const line = `${JSON.stringify(entry)}\n`;

    if (!silent) {
      writeConsole(level, line);
    }

    if (logToFile) {
      appendFileSync(todayLogFile(logDir), line, "utf8");
    }
  }

  return {
    info: (event, data) => write("info", event, data),
    warn: (event, data) => write("warn", event, data),
    error: (event, data) => write("error", event, data)
  };
}
