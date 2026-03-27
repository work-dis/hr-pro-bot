import { AppError } from "../errors/app-error";
import { env } from "../config/env";
import type { TelegramReplyMarkup } from "../types/telegram";

interface SendMessageInput {
  chatId: number;
  text: string;
  replyMarkup?: TelegramReplyMarkup;
}

export async function sendTelegramMessage(input: SendMessageInput): Promise<void> {
  const response = await fetch(`https://api.telegram.org/bot${env.botToken}/sendMessage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chat_id: input.chatId,
      text: input.text,
      reply_markup: input.replyMarkup,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new AppError(`Telegram API error: ${response.status} ${body}`, 502, "TELEGRAM_API_ERROR");
  }
}

export async function answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
  const response = await fetch(`https://api.telegram.org/bot${env.botToken}/answerCallbackQuery`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      callback_query_id: callbackQueryId,
      text,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new AppError(`Telegram API error: ${response.status} ${body}`, 502, "TELEGRAM_API_ERROR");
  }
}
