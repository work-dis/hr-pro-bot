import type { Prisma } from "@prisma/client";
import { CandidateRepository } from "../repositories/candidate.repo";
import { ProcessedUpdateRepository } from "../repositories/processed-update.repo";
import { VacancyRepository } from "../repositories/vacancy.repo";
import { MatchingService } from "../services/matching.service";
import { sendTelegramMessage } from "../services/telegram.service";
import type { TelegramMessage, TelegramUpdate } from "../types/telegram";
import { log } from "../utils/logger";
import { parseAndValidateResume } from "../validation/resume";
import { START_COMMAND, START_MESSAGE } from "./commands";

const candidateRepository = new CandidateRepository();
const processedUpdateRepository = new ProcessedUpdateRepository();
const vacancyRepository = new VacancyRepository();
const matchingService = new MatchingService(vacancyRepository);

export async function handleUpdate(update: unknown): Promise<void> {
  if (!isTelegramUpdate(update) || !update.message) {
    log("warn", "invalid_update_payload");
    return;
  }

  const message = update.message;
  const updateId = BigInt(update.update_id);
  const claimed = await processedUpdateRepository.claim({
    updateId: BigInt(update.update_id),
    chatId: BigInt(message.chat.id),
    messageId: BigInt(message.message_id),
  });

  if (!claimed) {
    log("info", "duplicate_update_skipped", { updateId: update.update_id });
    return;
  }

  try {
    if (!message.text || !message.from) {
      log("warn", "unsupported_message", { updateId: update.update_id });
      await processedUpdateRepository.markProcessed(updateId);
      return;
    }

    if (message.text.startsWith(START_COMMAND)) {
      await handleStartCommand(message);
      await processedUpdateRepository.markProcessed(updateId);
      return;
    }

    await handleResumeMessage(message);
    await processedUpdateRepository.markProcessed(updateId);
  } catch (error) {
    await processedUpdateRepository.markFailed(
      updateId,
      error instanceof Error ? error.message : "Unknown processing error",
    );
    throw error;
  }
}

async function handleStartCommand(message: TelegramMessage): Promise<void> {
  const from = message.from;

  await candidateRepository.upsertByTelegramUser({
    telegramUserId: BigInt(from.id),
    telegramUsername: from.username ?? null,
    name: buildDisplayName(from),
  });

  await sendTelegramMessage({
    chatId: message.chat.id,
    text: START_MESSAGE,
  });
}

async function handleResumeMessage(message: TelegramMessage): Promise<void> {
  const from = message.from;
  const parsedResume = parseAndValidateResume(message.text ?? "");

  if (!parsedResume.ok) {
    await sendTelegramMessage({
      chatId: message.chat.id,
      text: parsedResume.message,
    });
    return;
  }

  const resume = parsedResume.value;
  const candidate = await candidateRepository.upsertByTelegramUser({
    telegramUserId: BigInt(from.id),
    telegramUsername: from.username ?? null,
    name: resume.name ?? buildDisplayName(from),
    phone: resume.phone,
    city: resume.city,
    resume: resume.raw,
  });

  const matches = await matchingService.matchCandidate({
    city: candidate.city,
    resume: candidate.resume as Prisma.JsonValue | null,
  });

  const responseText =
    matches.length > 0
      ? renderMatches(matches)
      : "Подходящих вакансий пока не найдено. Попробуйте обновить город или список навыков в JSON-резюме.";

  await sendTelegramMessage({
    chatId: message.chat.id,
    text: responseText,
  });
}

function buildDisplayName(user: NonNullable<TelegramMessage["from"]>): string {
  return [user.first_name, user.last_name].filter(Boolean).join(" ").trim() || `user-${user.id}`;
}

function renderMatches(matches: Awaited<ReturnType<MatchingService["matchCandidate"]>>): string {
  const lines = ["Топ-3 вакансии:"];

  for (const [index, match] of matches.entries()) {
    lines.push(
      `${index + 1}. ${match.vacancy.title} | ${match.vacancy.city} | ${match.vacancy.salary} | ${match.vacancy.agency.name}`,
    );
  }

  return lines.join("\n");
}

function isTelegramUpdate(payload: unknown): payload is TelegramUpdate {
  return Boolean(
    payload &&
      typeof payload === "object" &&
      "update_id" in payload &&
      typeof (payload as TelegramUpdate).update_id === "number",
  );
}
