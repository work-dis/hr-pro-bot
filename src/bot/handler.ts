import { Prisma, type Candidate } from "@prisma/client";
import { ApplicationRepository } from "../repositories/application.repo";
import { CandidateRepository } from "../repositories/candidate.repo";
import { ProcessedUpdateRepository } from "../repositories/processed-update.repo";
import { VacancyRepository, type VacancyWithAgency } from "../repositories/vacancy.repo";
import { MatchingService } from "../services/matching.service";
import { answerCallbackQuery, sendTelegramMessage } from "../services/telegram.service";
import type { TelegramCallbackQuery, TelegramMessage, TelegramReplyMarkup, TelegramUpdate } from "../types/telegram";
import { log } from "../utils/logger";
import {
  buildCandidateResume,
  parseAge,
  parseCity,
  parseDocumentTypes,
  parseName,
  parseOptionalFilter,
  parseSkillsText,
  shouldSkipSkills,
} from "../validation/resume";
import { QUESTIONS, SEARCH_COMMAND, START_COMMAND, START_MESSAGE } from "./commands";

const candidateRepository = new CandidateRepository();
const applicationRepository = new ApplicationRepository();
const processedUpdateRepository = new ProcessedUpdateRepository();
const vacancyRepository = new VacancyRepository();
const matchingService = new MatchingService(vacancyRepository);

export async function handleUpdate(update: unknown): Promise<void> {
  if (!isTelegramUpdate(update) || (!update.message && !update.callback_query)) {
    log("warn", "invalid_update_payload");
    return;
  }

  const updateId = BigInt(update.update_id);
  const claimPayload = update.callback_query
    ? {
        updateId,
        chatId: update.callback_query.message ? BigInt(update.callback_query.message.chat.id) : null,
        messageId: update.callback_query.message ? BigInt(update.callback_query.message.message_id) : null,
      }
    : {
        updateId,
        chatId: BigInt(update.message!.chat.id),
        messageId: BigInt(update.message!.message_id),
      };

  const claimed = await processedUpdateRepository.claim(claimPayload);

  if (!claimed) {
    log("info", "duplicate_update_skipped", { updateId: update.update_id });
    return;
  }

  try {
    if (update.callback_query) {
      await handleCallbackQuery(update.callback_query);
      await processedUpdateRepository.markProcessed(updateId);
      return;
    }

    const message = update.message;

    if (!message?.text || !message.from) {
      log("warn", "unsupported_message", { updateId: update.update_id });
      await processedUpdateRepository.markProcessed(updateId);
      return;
    }

    const response = message.text.startsWith(START_COMMAND)
      ? { text: await handleStartCommand(message) }
      : message.text.startsWith(SEARCH_COMMAND)
        ? { text: await startSearchFlow(message) }
        : await handleCandidateMessage(message);

    await sendTelegramMessage({
      chatId: message.chat.id,
      text: response.text,
      replyMarkup: response.replyMarkup,
    });

    await processedUpdateRepository.markProcessed(updateId);
  } catch (error) {
    await processedUpdateRepository.markFailed(
      updateId,
      error instanceof Error ? error.message : "Unknown processing error",
    );
    throw error;
  }
}

async function handleStartCommand(message: TelegramMessage): Promise<string> {
  const from = message.from;

  if (!from) {
    return "Не удалось определить отправителя. Попробуйте еще раз.";
  }

  await candidateRepository.upsertByTelegramUser({
    telegramUserId: BigInt(from.id),
    telegramUsername: from.username ?? null,
    name: buildDisplayName(from),
    age: null,
    city: null,
    documentTypes: [],
    skills: [],
    onboardingStep: "WAITING_NAME",
    searchCountry: null,
    searchCity: null,
    searchActivity: null,
    resume: null,
  });

  return `${START_MESSAGE}\n\n${QUESTIONS.name}`;
}

async function startSearchFlow(message: TelegramMessage): Promise<string> {
  const from = message.from;

  if (!from) {
    return "Не удалось определить отправителя. Попробуйте еще раз.";
  }

  const telegramUserId = BigInt(from.id);
  const candidate =
    (await candidateRepository.findByTelegramUserId(telegramUserId)) ??
    (await candidateRepository.upsertByTelegramUser({
      telegramUserId,
      telegramUsername: from.username ?? null,
      name: buildDisplayName(from),
      age: null,
      city: null,
      documentTypes: [],
      skills: [],
      onboardingStep: "IDLE",
      searchCountry: null,
      searchCity: null,
      searchActivity: null,
      resume: null,
    }));

  await candidateRepository.updateByTelegramUserId(candidate.telegramUserId, {
    onboardingStep: "WAITING_SEARCH_COUNTRY",
    searchCountry: null,
    searchCity: null,
    searchActivity: null,
  });

  return QUESTIONS.searchCountry;
}

async function handleCandidateMessage(
  message: TelegramMessage,
): Promise<{ text: string; replyMarkup?: TelegramReplyMarkup }> {
  const from = message.from;

  if (!from) {
    return { text: "Не удалось определить отправителя. Попробуйте еще раз." };
  }

  const telegramUserId = BigInt(from.id);
  const candidate =
    (await candidateRepository.findByTelegramUserId(telegramUserId)) ??
    (await candidateRepository.upsertByTelegramUser({
      telegramUserId,
      telegramUsername: from.username ?? null,
      name: buildDisplayName(from),
      age: null,
      city: null,
      documentTypes: [],
      skills: [],
      onboardingStep: "WAITING_NAME",
      searchCountry: null,
      searchCity: null,
      searchActivity: null,
      resume: null,
    }));

  return handleCandidateState(candidate, message.text ?? "");
}

async function handleCandidateState(
  candidate: Candidate,
  input: string,
): Promise<{ text: string; replyMarkup?: TelegramReplyMarkup }> {
  switch (candidate.onboardingStep) {
    case "WAITING_NAME":
      return { text: await saveName(candidate, input) };
    case "WAITING_AGE":
      return { text: await saveAge(candidate, input) };
    case "WAITING_CITY":
      return { text: await saveCity(candidate, input) };
    case "WAITING_DOCUMENTS":
      return { text: await saveDocuments(candidate, input) };
    case "WAITING_SKILLS":
      return saveSkillsAndMatch(candidate, input);
    case "WAITING_SEARCH_COUNTRY":
      return { text: await saveSearchCountry(candidate, input) };
    case "WAITING_SEARCH_CITY":
      return { text: await saveSearchCity(candidate, input) };
    case "WAITING_SEARCH_ACTIVITY":
      return runManualSearch(candidate, input);
    case "COMPLETED":
    case "IDLE":
    default:
      return {
        text: "Профиль уже сохранен. Отправьте /search для ручного поиска вакансий или /start для повторного заполнения анкеты.",
      };
  }
}

async function handleCallbackQuery(callbackQuery: TelegramCallbackQuery): Promise<void> {
  const data = callbackQuery.data ?? "";

  if (!data.startsWith("apply:")) {
    await answerCallbackQuery(callbackQuery.id, "Неизвестное действие");
    return;
  }

  const vacancyId = data.slice("apply:".length);
  const telegramUserId = BigInt(callbackQuery.from.id);
  const candidate = await candidateRepository.findByTelegramUserId(telegramUserId);

  if (!candidate) {
    await answerCallbackQuery(callbackQuery.id, "Сначала заполните профиль через /start");
    return;
  }

  const vacancy = await vacancyRepository.findById(vacancyId);

  if (!vacancy) {
    await answerCallbackQuery(callbackQuery.id, "Вакансия не найдена");
    return;
  }

  await applicationRepository.createOrGet(candidate.id, vacancy.id);

  if (vacancy.agency.hrChatId) {
    await sendTelegramMessage({
      chatId: Number(vacancy.agency.hrChatId),
      text: renderHrNotification(candidate, vacancy),
    });
  }

  if (callbackQuery.message) {
    await sendTelegramMessage({
      chatId: callbackQuery.message.chat.id,
      text: vacancy.agency.hrChatId
        ? `Резюме отправлено HR по вакансии "${vacancy.title}".`
        : `Вакансия "${vacancy.title}" выбрана, но у агентства пока не настроен HR-чат.`,
    });
  }

  await answerCallbackQuery(callbackQuery.id, "Отклик отправлен");
}

async function saveName(candidate: Candidate, input: string): Promise<string> {
  const name = parseName(input);
  if (!name) return "Напишите имя и фамилию обычным текстом.";

  await candidateRepository.updateByTelegramUserId(candidate.telegramUserId, {
    name,
    onboardingStep: "WAITING_AGE",
  });
  return QUESTIONS.age;
}

async function saveAge(candidate: Candidate, input: string): Promise<string> {
  const age = parseAge(input);
  if (!age) return "Напишите возраст числом, например: 27";

  await candidateRepository.updateByTelegramUserId(candidate.telegramUserId, {
    age,
    onboardingStep: "WAITING_CITY",
  });
  return QUESTIONS.city;
}

async function saveCity(candidate: Candidate, input: string): Promise<string> {
  const city = parseCity(input);
  if (!city) return "Напишите город обычным текстом, например: Варшава";

  await candidateRepository.updateByTelegramUserId(candidate.telegramUserId, {
    city,
    onboardingStep: "WAITING_DOCUMENTS",
  });
  return QUESTIONS.documents;
}

async function saveDocuments(candidate: Candidate, input: string): Promise<string> {
  const documentTypes = parseDocumentTypes(input);
  if (documentTypes.length === 0) {
    return "Напишите документы через запятую, например: паспорт, виза, карта побыту";
  }

  await candidateRepository.updateByTelegramUserId(candidate.telegramUserId, {
    documentTypes,
    onboardingStep: "WAITING_SKILLS",
  });
  return QUESTIONS.skills;
}

async function saveSkillsAndMatch(
  candidate: Candidate,
  input: string,
): Promise<{ text: string; replyMarkup?: TelegramReplyMarkup }> {
  const skills = shouldSkipSkills(input) ? [] : parseSkillsText(input);

  const updatedCandidate = await candidateRepository.updateByTelegramUserId(candidate.telegramUserId, {
    skills,
    onboardingStep: "COMPLETED",
    resume: buildCandidateResume({
      name: candidate.name,
      age: candidate.age,
      city: candidate.city,
      documentTypes: candidate.documentTypes,
      skills,
    }),
  });

  const matches = await matchingService.matchCandidate({
    city: updatedCandidate.city,
    skills: updatedCandidate.skills,
    resume: updatedCandidate.resume as Prisma.JsonValue | null,
  });

  return {
    text:
      matches.length > 0
        ? `Профиль сохранен.\n\n${renderMatches(matches)}\n\nДля ручного поиска отправьте /search`
        : "Профиль сохранен. Для ручного поиска вакансий отправьте /search",
  };
}

async function saveSearchCountry(candidate: Candidate, input: string): Promise<string> {
  const country = parseCity(input);
  if (!country) return "Напишите страну обычным текстом, например: Польша";

  await candidateRepository.updateByTelegramUserId(candidate.telegramUserId, {
    onboardingStep: "WAITING_SEARCH_CITY",
    searchCountry: country,
    searchCity: null,
    searchActivity: null,
  });
  return QUESTIONS.searchCity;
}

async function saveSearchCity(candidate: Candidate, input: string): Promise<string> {
  const city = parseOptionalFilter(input);

  await candidateRepository.updateByTelegramUserId(candidate.telegramUserId, {
    onboardingStep: "WAITING_SEARCH_ACTIVITY",
    searchCity: city,
  });
  return QUESTIONS.searchActivity;
}

async function runManualSearch(
  candidate: Candidate,
  input: string,
): Promise<{ text: string; replyMarkup?: TelegramReplyMarkup }> {
  const activity = parseOptionalFilter(input);
  const updatedCandidate = await candidateRepository.updateByTelegramUserId(candidate.telegramUserId, {
    onboardingStep: "COMPLETED",
    searchActivity: activity,
  });

  const vacancies = await vacancyRepository.search({
    country: updatedCandidate.searchCountry,
    city: updatedCandidate.searchCity,
    activity: updatedCandidate.searchActivity,
  });

  if (vacancies.length === 0) {
    return {
      text: "По выбранным фильтрам вакансий не найдено. Отправьте /search, чтобы попробовать другой поиск.",
    };
  }

  return {
    text: renderSearchResults(vacancies),
    replyMarkup: buildVacancyKeyboard(vacancies.map((vacancy) => ({ id: vacancy.id, title: vacancy.title }))),
  };
}

function buildVacancyKeyboard(vacancies: Array<{ id: string; title: string }>): TelegramReplyMarkup {
  return {
    inline_keyboard: vacancies.map((vacancy) => [
      {
        text: `Отправить резюме: ${vacancy.title}`,
        callback_data: `apply:${vacancy.id}`,
      },
    ]),
  };
}

function renderMatches(matches: Awaited<ReturnType<MatchingService["matchCandidate"]>>): string {
  const lines = ["Топ-3 вакансии:"];
  for (const [index, match] of matches.entries()) {
    lines.push(
      `${index + 1}. ${match.vacancy.title} | ${match.vacancy.country}, ${match.vacancy.city} | ${match.vacancy.activity} | ${match.vacancy.salary} | ${match.vacancy.agency.name}`,
    );
  }
  return lines.join("\n");
}

function renderSearchResults(vacancies: Awaited<ReturnType<VacancyRepository["search"]>>): string {
  const lines = ["Найденные вакансии:"];
  for (const [index, vacancy] of vacancies.entries()) {
    lines.push(
      `${index + 1}. ${vacancy.title} | ${vacancy.country}, ${vacancy.city} | ${vacancy.activity} | ${vacancy.salary} | ${vacancy.agency.name}`,
    );
  }
  lines.push("");
  lines.push("Нажмите кнопку под сообщением, чтобы отправить резюме на выбранную вакансию.");
  return lines.join("\n");
}

function renderHrNotification(
  candidate: Candidate,
  vacancy: VacancyWithAgency,
): string {
  return [
    "Новый отклик на вакансию",
    `Вакансия: ${vacancy.title}`,
    `Агентство: ${vacancy.agency.name}`,
    `Кандидат: ${candidate.name}`,
    `Возраст: ${candidate.age ?? "не указан"}`,
    `Город: ${candidate.city ?? "не указан"}`,
    `Документы: ${candidate.documentTypes.length > 0 ? candidate.documentTypes.join(", ") : "не указаны"}`,
    `Навыки: ${candidate.skills.length > 0 ? candidate.skills.join(", ") : "не указаны"}`,
    `Telegram: ${candidate.telegramUsername ? `@${candidate.telegramUsername}` : candidate.telegramUserId.toString()}`,
  ].join("\n");
}

function buildDisplayName(user: NonNullable<TelegramMessage["from"]>): string {
  return [user.first_name, user.last_name].filter(Boolean).join(" ").trim() || `user-${user.id}`;
}

function isTelegramUpdate(payload: unknown): payload is TelegramUpdate {
  return Boolean(
    payload &&
      typeof payload === "object" &&
      "update_id" in payload &&
      typeof (payload as TelegramUpdate).update_id === "number",
  );
}
