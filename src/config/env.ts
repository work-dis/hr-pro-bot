function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value.trim();
}

export const env = {
  botToken: requireEnv("BOT_TOKEN"),
  databaseUrl: requireEnv("DATABASE_URL"),
  telegramWebhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET?.trim() || null,
  nodeEnv: process.env.NODE_ENV?.trim() || "development",
};
