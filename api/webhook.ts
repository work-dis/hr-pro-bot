import type { VercelRequest, VercelResponse } from "@vercel/node";
import { env } from "../src/config/env";
import { handleUpdate } from "../src/bot/handler";
import { AppError } from "../src/errors/app-error";
import { log } from "../src/utils/logger";

export default async function webhook(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    if (env.telegramWebhookSecret) {
      const secret = req.headers["x-telegram-bot-api-secret-token"];
      const providedSecret = Array.isArray(secret) ? secret[0] : secret;

      if (providedSecret !== env.telegramWebhookSecret) {
        log("warn", "webhook_secret_mismatch");
        return res.status(401).json({ error: "Unauthorized" });
      }
    }

    const parsedBody = parseWebhookBody(req.body);

    if (!parsedBody) {
      return res.status(400).json({ error: "Invalid body" });
    }

    await handleUpdate(parsedBody);
    return res.status(200).json({ ok: true });
  } catch (error) {
    if (error instanceof AppError) {
      log("error", "webhook_app_error", { code: error.code, message: error.message });
      return res.status(error.statusCode).json({ error: error.code });
    }

    log("error", "webhook_unhandled_error", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return res.status(500).json({ error: "INTERNAL_SERVER_ERROR" });
  }
}

function parseWebhookBody(body: unknown): Record<string, unknown> | null {
  if (!body) {
    return null;
  }

  if (typeof body === "object" && !Array.isArray(body)) {
    return body as Record<string, unknown>;
  }

  if (typeof body !== "string") {
    return null;
  }

  try {
    const parsed = JSON.parse(body) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
