type LogLevel = "info" | "warn" | "error";

export function log(level: LogLevel, event: string, meta: Record<string, unknown> = {}) {
  const payload = {
    level,
    event,
    ...meta,
    timestamp: new Date().toISOString(),
  };

  console[level](JSON.stringify(payload));
}
