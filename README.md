# HR Pro Bot

Production-ready Telegram bot backend for job matching on Vercel using:

- Node.js + TypeScript
- Vercel Serverless Functions
- PostgreSQL + Prisma
- webhook-based Telegram integration

## Structure

```text
api/
  webhook.ts
src/
  bot/
    commands.ts
    handler.ts
  config/
    env.ts
  db/
    prisma.ts
  repositories/
    candidate.repo.ts
    vacancy.repo.ts
  services/
    matching.service.ts
    telegram.service.ts
  types/
    telegram.ts
  utils/
    logger.ts
prisma/
  schema.prisma
```

## What the bot does

- handles Telegram webhook updates on `/api/webhook`
- saves Telegram users into PostgreSQL
- accepts resume JSON from candidates
- matches by `city` and `skills`
- returns top 3 vacancies

## Resume JSON format

Send one message to the bot with JSON like:

```json
{
  "name": "Ivan Ivanov",
  "phone": "+375291234567",
  "city": "Minsk",
  "skills": ["sales", "excel", "crm"]
}
```

## Environment variables

Create `.env.local`:

```bash
BOT_TOKEN=your_telegram_bot_token
DATABASE_URL=postgresql://user:password@host:5432/dbname?schema=public
TELEGRAM_WEBHOOK_SECRET=your_random_secret
```

## Local run

1. Install dependencies:

```bash
npm install
```

2. Generate Prisma client:

```bash
npm run prisma:generate
```

3. Push schema to PostgreSQL:

```bash
npm run prisma:push
```

4. Run locally:

```bash
npm run dev
```

Vercel local dev will expose the webhook endpoint at:

```text
http://localhost:3000/api/webhook
```

To test with Telegram locally, use a tunnel such as `ngrok` or `cloudflared`.

## Deploy to Vercel

1. Create a PostgreSQL database compatible with Vercel deployment.
   Recommended: Vercel Postgres, Neon, Supabase, or any managed PostgreSQL.
2. Import the project into Vercel.
3. Set environment variables in Vercel:
   - `BOT_TOKEN`
   - `DATABASE_URL`
4. Run Prisma schema deployment:

```bash
npx prisma db push
```

For managed environments with migrations, prefer:

```bash
npm run prisma:migrate:deploy
```

5. Deploy.

Your webhook URL will be:

```text
https://your-domain.vercel.app/api/webhook
```

## Set Telegram webhook

Use this request after deployment:

```bash
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=https://your-domain.vercel.app/api/webhook&secret_token=<YOUR_SECRET>"
```

Check webhook info:

```bash
curl "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getWebhookInfo"
```

## Notes

- The function is stateless and serverless-safe.
- The webhook responds immediately after processing one update.
- No polling or background workers are used.
- Matching is intentionally simple and fast.
- Duplicate Telegram updates are ignored through persistent `update_id` tracking.
- Webhook secret validation is supported through `TELEGRAM_WEBHOOK_SECRET`.
