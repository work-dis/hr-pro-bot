import { Prisma, type ApplicationStatus, type Candidate, type HrUser } from "@prisma/client";
import { ApplicationRepository } from "../repositories/application.repo";
import { CandidateRepository } from "../repositories/candidate.repo";
import { HrUserRepository } from "../repositories/hr-user.repo";
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
  parseSkillsText,
  shouldSkipSkills,
} from "../validation/resume";
import {
  HISTORY_COMMAND,
  HR_ADD_VACANCY_COMMAND,
  HR_COMMAND,
  QUESTIONS,
  SEARCH_COMMAND,
  START_COMMAND,
  START_MESSAGE,
} from "./commands";

const candidateRepository = new CandidateRepository();
const hrUserRepository = new HrUserRepository();
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
        ? await startSearchFlow(message)
        : message.text.startsWith(HISTORY_COMMAND)
          ? { text: await handleHistoryCommand(message) }
          : message.text.startsWith(HR_ADD_VACANCY_COMMAND)
            ? await startHrVacancyFlow(message)
            : message.text.startsWith(HR_COMMAND)
              ? await handleHrCabinetCommand(message)
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

async function startSearchFlow(message: TelegramMessage): Promise<{ text: string; replyMarkup?: TelegramReplyMarkup }> {
  const from = message.from;

  if (!from) {
    return { text: "Не удалось определить отправителя. Попробуйте еще раз." };
  }

  const telegramUserId = BigInt(from.id);
  const candidate = await candidateRepository.findByTelegramUserId(telegramUserId);

  if (!candidate) {
    return {
      text: "Сначала заполните анкету через /start.",
    };
  }

  await candidateRepository.updateByTelegramUserId(candidate.telegramUserId, {
    onboardingStep: "WAITING_SEARCH_COUNTRY",
    searchCountry: null,
    searchCity: null,
    searchActivity: null,
  });

  const countries = await vacancyRepository.findAvailableCountries();

  if (countries.length === 0) {
    return {
      text: "В базе пока нет вакансий для ручного поиска.",
    };
  }

  return {
    text: QUESTIONS.searchCountry,
    replyMarkup: buildSearchCountryKeyboard(countries),
  };
}

async function handleHistoryCommand(message: TelegramMessage): Promise<string> {
  const from = message.from;

  if (!from) {
    return "Не удалось определить отправителя. Попробуйте еще раз.";
  }

  const candidate = await candidateRepository.findByTelegramUserId(BigInt(from.id));

  if (!candidate) {
    return "История откликов пока пуста. Сначала заполните профиль через /start.";
  }

  const applications = await applicationRepository.listByCandidateId(candidate.id);

  if (applications.length === 0) {
    return "У вас пока нет откликов. Найдите вакансии через /search.";
  }

  return renderApplicationHistory(applications);
}

async function handleHrCabinetCommand(message: TelegramMessage): Promise<{ text: string; replyMarkup?: TelegramReplyMarkup }> {
  const from = message.from;

  if (!from) {
    return { text: "Не удалось определить отправителя. Попробуйте еще раз." };
  }

  const hrUser = await hrUserRepository.findByTelegramUserId(BigInt(from.id));

  if (!hrUser?.isActive || !hrUser.canManageVacancies) {
    return { text: "HR-доступ не найден. HR можно добавлять только напрямую в базу данных." };
  }

  const vacancies = await vacancyRepository.listByAgencyId(hrUser.agencyId);
  return {
    text: renderHrCabinet(hrUser, vacancies),
    replyMarkup: buildHrCabinetKeyboard(vacancies),
  };
}

async function startHrVacancyFlow(message: TelegramMessage): Promise<{ text: string; replyMarkup?: TelegramReplyMarkup }> {
  const from = message.from;

  if (!from) {
    return { text: "Не удалось определить отправителя. Попробуйте еще раз." };
  }

  const hrUser = await hrUserRepository.findByTelegramUserId(BigInt(from.id));

  if (!hrUser?.isActive || !hrUser.canManageVacancies) {
    return { text: "У вас нет прав на добавление вакансий." };
  }

  await hrUserRepository.updateByTelegramUserId(hrUser.telegramUserId, {
    onboardingStep: "WAITING_VACANCY_TITLE",
    vacancyDraft: Prisma.JsonNull,
  });

  return {
    text: "Добавление вакансии. Отправьте название вакансии.",
  };
}

async function handleCandidateMessage(
  message: TelegramMessage,
): Promise<{ text: string; replyMarkup?: TelegramReplyMarkup }> {
  const from = message.from;

  if (!from) {
    return { text: "Не удалось определить отправителя. Попробуйте еще раз." };
  }

  const telegramUserId = BigInt(from.id);
  const hrUser = await hrUserRepository.findByTelegramUserId(telegramUserId);

  if (hrUser && hrUser.isActive && hrUser.canManageVacancies && hrUser.onboardingStep !== "IDLE") {
    return handleHrState(hrUser, message.text ?? "");
  }

  if (hrUser?.isActive) {
    return { text: "Для управления вакансиями используйте /hr." };
  }

  const candidate = await candidateRepository.findByTelegramUserId(telegramUserId);

  if (!candidate) {
    return { text: "Чтобы зарегистрироваться как кандидат, отправьте /start." };
  }

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
  const telegramUserId = BigInt(callbackQuery.from.id);

  if (data.startsWith("search_country:")) {
    await handleSearchCountryCallback(callbackQuery, telegramUserId, data);
    return;
  }

  if (data.startsWith("search_city:")) {
    await handleSearchCityCallback(callbackQuery, telegramUserId, data);
    return;
  }

  if (data.startsWith("search_activity:")) {
    await handleSearchActivityCallback(callbackQuery, telegramUserId, data);
    return;
  }

  if (data.startsWith("hr_accept:")) {
    await handleHrDecisionCallback(callbackQuery, data, "ACCEPTED");
    return;
  }

  if (data.startsWith("hr_reject:")) {
    await handleHrDecisionCallback(callbackQuery, data, "REJECTED");
    return;
  }

  if (data.startsWith("hr_vacancy_toggle:")) {
    await handleHrVacancyToggleCallback(callbackQuery, data);
    return;
  }

  if (data.startsWith("hr_vacancy_delete:")) {
    await handleHrVacancyDeleteCallback(callbackQuery, data);
    return;
  }

  if (!data.startsWith("apply:")) {
    await answerCallbackQuery(callbackQuery.id, "Неизвестное действие");
    return;
  }

  const vacancyId = data.slice("apply:".length);
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

  if (!vacancy.isActive) {
    await answerCallbackQuery(callbackQuery.id, "Вакансия уже неактивна");
    return;
  }

  const application = await applicationRepository.createOrGet(candidate.id, vacancy.id);

  if (vacancy.agency.hrChatId) {
    await sendTelegramMessage({
      chatId: Number(vacancy.agency.hrChatId),
      text: renderHrNotification(candidate, vacancy),
      replyMarkup: buildHrDecisionKeyboard(application.id),
    });
  }

  if (callbackQuery.message) {
    await sendTelegramMessage({
      chatId: callbackQuery.message.chat.id,
      text: vacancy.agency.hrChatId
        ? `Резюме отправлено HR по вакансии "${vacancy.title}". Проверить статус можно через /history.`
        : `Вакансия "${vacancy.title}" выбрана, но у агентства пока не настроен HR-чат.`,
    });
  }

  await answerCallbackQuery(callbackQuery.id, "Отклик отправлен");
}

async function handleHrDecisionCallback(
  callbackQuery: TelegramCallbackQuery,
  data: string,
  status: ApplicationStatus,
): Promise<void> {
  const prefix = status === "ACCEPTED" ? "hr_accept:" : "hr_reject:";
  const applicationId = data.slice(prefix.length);
  const application = await applicationRepository.findById(applicationId);

  if (!application) {
    await answerCallbackQuery(callbackQuery.id, "Отклик не найден");
    return;
  }

  if (!application.vacancy.agency.hrChatId || !callbackQuery.message) {
    await answerCallbackQuery(callbackQuery.id, "HR-чат не определен");
    return;
  }

  if (BigInt(callbackQuery.message.chat.id) !== application.vacancy.agency.hrChatId) {
    await answerCallbackQuery(callbackQuery.id, "Это действие недоступно в этом чате");
    return;
  }

  if (application.status !== "SENT") {
    if (application.status === "ACCEPTED") {
      await sendTelegramMessage({
        chatId: callbackQuery.message.chat.id,
        text: `Кандидат уже принят по вакансии "${application.vacancy.title}".`,
        replyMarkup: buildContactCandidateKeyboard(application.candidate.telegramUserId),
      });
    }

    await answerCallbackQuery(
      callbackQuery.id,
      application.status === "ACCEPTED" ? "Кандидат уже принят" : "Кандидат уже отклонен",
    );
    return;
  }

  const updatedApplication = await applicationRepository.updateStatus(application.id, status);

  await sendTelegramMessage({
    chatId: Number(updatedApplication.candidate.telegramUserId),
    text:
      status === "ACCEPTED"
        ? `Работодатель принял ваш отклик на вакансию "${updatedApplication.vacancy.title}". Проверить историю можно через /history.`
        : `Работодатель отклонил ваш отклик на вакансию "${updatedApplication.vacancy.title}". Проверить историю можно через /history.`,
  });

  await sendTelegramMessage({
    chatId: callbackQuery.message.chat.id,
    text:
      status === "ACCEPTED"
        ? `Кандидат принят по вакансии "${updatedApplication.vacancy.title}".`
        : `Кандидат отклонен по вакансии "${updatedApplication.vacancy.title}".`,
    replyMarkup:
      status === "ACCEPTED"
        ? buildContactCandidateKeyboard(updatedApplication.candidate.telegramUserId)
        : undefined,
  });

  await answerCallbackQuery(
    callbackQuery.id,
    status === "ACCEPTED" ? "Кандидат принят" : "Кандидат отклонен",
  );
}

async function handleHrVacancyToggleCallback(callbackQuery: TelegramCallbackQuery, data: string): Promise<void> {
  const hrUser = await hrUserRepository.findByTelegramUserId(BigInt(callbackQuery.from.id));

  if (!hrUser?.isActive || !hrUser.canManageVacancies || !callbackQuery.message) {
    await answerCallbackQuery(callbackQuery.id, "У вас нет доступа к кабинету HR");
    return;
  }

  const vacancyId = data.slice("hr_vacancy_toggle:".length);
  const vacancy = await vacancyRepository.toggleActiveForAgency(vacancyId, hrUser.agencyId);

  if (!vacancy) {
    await answerCallbackQuery(callbackQuery.id, "Вакансия не найдена");
    return;
  }

  const vacancies = await vacancyRepository.listByAgencyId(hrUser.agencyId);
  await sendTelegramMessage({
    chatId: callbackQuery.message.chat.id,
    text: renderHrCabinet(hrUser, vacancies),
    replyMarkup: buildHrCabinetKeyboard(vacancies),
  });

  await answerCallbackQuery(callbackQuery.id, vacancy.isActive ? "Вакансия активирована" : "Вакансия деактивирована");
}

async function handleHrVacancyDeleteCallback(callbackQuery: TelegramCallbackQuery, data: string): Promise<void> {
  const hrUser = await hrUserRepository.findByTelegramUserId(BigInt(callbackQuery.from.id));

  if (!hrUser?.isActive || !hrUser.canManageVacancies || !callbackQuery.message) {
    await answerCallbackQuery(callbackQuery.id, "У вас нет доступа к кабинету HR");
    return;
  }

  const vacancyId = data.slice("hr_vacancy_delete:".length);
  const deletedVacancy = await vacancyRepository.deleteForAgency(vacancyId, hrUser.agencyId);

  if (!deletedVacancy) {
    await answerCallbackQuery(callbackQuery.id, "Вакансия не найдена");
    return;
  }

  const vacancies = await vacancyRepository.listByAgencyId(hrUser.agencyId);
  await sendTelegramMessage({
    chatId: callbackQuery.message.chat.id,
    text: renderHrCabinet(hrUser, vacancies),
    replyMarkup: buildHrCabinetKeyboard(vacancies),
  });

  await answerCallbackQuery(callbackQuery.id, "Вакансия удалена");
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

async function handleHrState(
  hrUser: Awaited<ReturnType<HrUserRepository["findByTelegramUserId"]>>,
  input: string,
): Promise<{ text: string; replyMarkup?: TelegramReplyMarkup }> {
  if (!hrUser) {
    return { text: "HR-пользователь не найден." };
  }

  const value = parseCity(input);

  switch (hrUser.onboardingStep) {
    case "WAITING_VACANCY_TITLE":
      if (!value) return { text: "Отправьте название вакансии обычным текстом." };
      await hrUserRepository.updateByTelegramUserId(hrUser.telegramUserId, {
        onboardingStep: "WAITING_VACANCY_COUNTRY",
        vacancyDraft: {
          title: value,
        },
      });
      return { text: "Укажите страну вакансии." };
    case "WAITING_VACANCY_COUNTRY":
      if (!value) return { text: "Укажите страну обычным текстом." };
      await hrUserRepository.updateByTelegramUserId(hrUser.telegramUserId, {
        onboardingStep: "WAITING_VACANCY_CITY",
        vacancyDraft: mergeHrDraft(hrUser.vacancyDraft as Prisma.JsonValue | null, { country: value }),
      });
      return { text: "Укажите город вакансии." };
    case "WAITING_VACANCY_CITY":
      if (!value) return { text: "Укажите город обычным текстом." };
      await hrUserRepository.updateByTelegramUserId(hrUser.telegramUserId, {
        onboardingStep: "WAITING_VACANCY_ACTIVITY",
        vacancyDraft: mergeHrDraft(hrUser.vacancyDraft as Prisma.JsonValue | null, { city: value }),
      });
      return { text: "Укажите вид деятельности." };
    case "WAITING_VACANCY_ACTIVITY":
      if (!value) return { text: "Укажите вид деятельности обычным текстом." };
      await hrUserRepository.updateByTelegramUserId(hrUser.telegramUserId, {
        onboardingStep: "WAITING_VACANCY_SALARY",
        vacancyDraft: mergeHrDraft(hrUser.vacancyDraft as Prisma.JsonValue | null, { activity: value }),
      });
      return { text: "Укажите зарплату или диапазон." };
    case "WAITING_VACANCY_SALARY":
      if (!value) return { text: "Укажите зарплату обычным текстом." };
      return finalizeHrVacancy(hrUser, value);
    case "IDLE":
    default:
      return { text: "Откройте /hr или начните добавление вакансии через /hr_add." };
  }
}

async function finalizeHrVacancy(
  hrUser: NonNullable<Awaited<ReturnType<HrUserRepository["findByTelegramUserId"]>>>,
  salary: string,
): Promise<{ text: string; replyMarkup?: TelegramReplyMarkup }> {
  const draft = mergeHrDraft(hrUser.vacancyDraft as Prisma.JsonValue | null, { salary }) as HrVacancyDraft;

  if (!draft.title || !draft.country || !draft.city || !draft.activity || !draft.salary) {
    await hrUserRepository.updateByTelegramUserId(hrUser.telegramUserId, {
      onboardingStep: "IDLE",
      vacancyDraft: Prisma.JsonNull,
    });
    return { text: "Черновик вакансии поврежден. Начните заново через /hr_add." };
  }

  await vacancyRepository.createForAgency({
    agencyId: hrUser.agencyId,
    title: draft.title,
    country: draft.country,
    city: draft.city,
    activity: draft.activity,
    salary: draft.salary,
  });

  const updatedHrUser = await hrUserRepository.updateByTelegramUserId(hrUser.telegramUserId, {
    onboardingStep: "IDLE",
    vacancyDraft: Prisma.JsonNull,
  });

  const vacancies = await vacancyRepository.listByAgencyId(hrUser.agencyId);
  return {
    text: `Вакансия добавлена.\n\n${renderHrCabinet(updatedHrUser, vacancies)}`,
    replyMarkup: buildHrCabinetKeyboard(vacancies),
  };
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
  return "Для ручного поиска используйте кнопки под сообщением. Отправьте /search, чтобы начать заново.";
}

async function saveSearchCity(candidate: Candidate, input: string): Promise<string> {
  return "Город для ручного поиска нужно выбирать кнопкой. Отправьте /search, чтобы открыть список заново.";
}

async function runManualSearch(
  candidate: Candidate,
  input: string,
): Promise<{ text: string; replyMarkup?: TelegramReplyMarkup }> {
  return {
    text: "Вид деятельности для ручного поиска нужно выбирать кнопкой. Отправьте /search, чтобы открыть список заново.",
  };
}

async function handleSearchCountryCallback(
  callbackQuery: TelegramCallbackQuery,
  telegramUserId: bigint,
  data: string,
): Promise<void> {
  const candidate = await candidateRepository.findByTelegramUserId(telegramUserId);

  if (!candidate) {
    await answerCallbackQuery(callbackQuery.id, "Сначала заполните профиль через /start");
    return;
  }

  const countries = await vacancyRepository.findAvailableCountries();
  const country = resolveIndexedOption(data, "search_country:", countries);

  if (!country) {
    await answerCallbackQuery(callbackQuery.id, "Страна больше недоступна. Запустите /search заново");
    return;
  }

  const cities = await vacancyRepository.findAvailableCities(country);

  await candidateRepository.updateByTelegramUserId(candidate.telegramUserId, {
    onboardingStep: "WAITING_SEARCH_CITY",
    searchCountry: country,
    searchCity: null,
    searchActivity: null,
  });

  if (!callbackQuery.message) {
    await answerCallbackQuery(callbackQuery.id, "Страна выбрана");
    return;
  }

  await sendTelegramMessage({
    chatId: callbackQuery.message.chat.id,
    text: `${QUESTIONS.searchCity}\n\nСтрана: ${country}`,
    replyMarkup: buildSearchCityKeyboard(cities),
  });

  await answerCallbackQuery(callbackQuery.id, `Страна: ${country}`);
}

async function handleSearchCityCallback(
  callbackQuery: TelegramCallbackQuery,
  telegramUserId: bigint,
  data: string,
): Promise<void> {
  const candidate = await candidateRepository.findByTelegramUserId(telegramUserId);

  if (!candidate?.searchCountry) {
    await answerCallbackQuery(callbackQuery.id, "Сначала выберите страну через /search");
    return;
  }

  const cities = await vacancyRepository.findAvailableCities(candidate.searchCountry);
  const city = data === "search_city:any" ? null : resolveIndexedOption(data, "search_city:", cities);

  if (data !== "search_city:any" && !city) {
    await answerCallbackQuery(callbackQuery.id, "Город больше недоступен. Запустите /search заново");
    return;
  }

  const activities = await vacancyRepository.findAvailableActivities({
    country: candidate.searchCountry,
    city,
  });

  await candidateRepository.updateByTelegramUserId(candidate.telegramUserId, {
    onboardingStep: "WAITING_SEARCH_ACTIVITY",
    searchCity: city,
    searchActivity: null,
  });

  if (!callbackQuery.message) {
    await answerCallbackQuery(callbackQuery.id, "Город выбран");
    return;
  }

  await sendTelegramMessage({
    chatId: callbackQuery.message.chat.id,
    text: [
      QUESTIONS.searchActivity,
      `Страна: ${candidate.searchCountry}`,
      `Город: ${city ?? "любой"}`,
    ].join("\n"),
    replyMarkup: buildSearchActivityKeyboard(activities),
  });

  await answerCallbackQuery(callbackQuery.id, `Город: ${city ?? "любой"}`);
}

async function handleSearchActivityCallback(
  callbackQuery: TelegramCallbackQuery,
  telegramUserId: bigint,
  data: string,
): Promise<void> {
  const candidate = await candidateRepository.findByTelegramUserId(telegramUserId);

  if (!candidate?.searchCountry) {
    await answerCallbackQuery(callbackQuery.id, "Сначала выберите страну через /search");
    return;
  }

  const activities = await vacancyRepository.findAvailableActivities({
    country: candidate.searchCountry,
    city: candidate.searchCity,
  });
  const activity = data === "search_activity:any"
    ? null
    : resolveIndexedOption(data, "search_activity:", activities);

  if (data !== "search_activity:any" && !activity) {
    await answerCallbackQuery(callbackQuery.id, "Категория больше недоступна. Запустите /search заново");
    return;
  }

  const updatedCandidate = await candidateRepository.updateByTelegramUserId(candidate.telegramUserId, {
    onboardingStep: "COMPLETED",
    searchActivity: activity,
  });

  const vacancies = await vacancyRepository.search({
    country: updatedCandidate.searchCountry,
    city: updatedCandidate.searchCity,
    activity: updatedCandidate.searchActivity,
  });

  if (callbackQuery.message) {
    await sendTelegramMessage({
      chatId: callbackQuery.message.chat.id,
      text:
        vacancies.length > 0
          ? renderSearchResults(vacancies)
          : "По выбранным фильтрам вакансий не найдено. Отправьте /search, чтобы попробовать другой поиск.",
      replyMarkup:
        vacancies.length > 0
          ? buildVacancyKeyboard(vacancies.map((vacancy) => ({ id: vacancy.id, title: vacancy.title })))
          : undefined,
    });
  }

  await answerCallbackQuery(callbackQuery.id, `Вид деятельности: ${activity ?? "любой"}`);
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

function buildHrDecisionKeyboard(applicationId: string): TelegramReplyMarkup {
  return {
    inline_keyboard: [
      [
        { text: "Принять", callback_data: `hr_accept:${applicationId}` },
        { text: "Отклонить", callback_data: `hr_reject:${applicationId}` },
      ],
    ],
  };
}

function buildContactCandidateKeyboard(telegramUserId: bigint): TelegramReplyMarkup {
  return {
    inline_keyboard: [
      [
        {
          text: "Связаться с кандидатом",
          url: `tg://user?id=${telegramUserId.toString()}`,
        },
      ],
    ],
  };
}

function buildHrCabinetKeyboard(vacancies: Array<{ id: string; title: string; isActive: boolean }>): TelegramReplyMarkup | undefined {
  if (vacancies.length === 0) {
    return undefined;
  }

  return {
    inline_keyboard: vacancies.flatMap((vacancy) => [
      [
        {
          text: vacancy.isActive ? `Деактивировать: ${vacancy.title}` : `Активировать: ${vacancy.title}`,
          callback_data: `hr_vacancy_toggle:${vacancy.id}`,
        },
      ],
      [
        {
          text: `Удалить: ${vacancy.title}`,
          callback_data: `hr_vacancy_delete:${vacancy.id}`,
        },
      ],
    ]),
  };
}

function buildSearchCountryKeyboard(countries: string[]): TelegramReplyMarkup {
  return {
    inline_keyboard: buildOptionRows(
      countries.map((country, index) => ({
        text: country,
        callback_data: `search_country:${index}`,
      })),
    ),
  };
}

function buildSearchCityKeyboard(cities: string[]): TelegramReplyMarkup {
  return {
    inline_keyboard: [
      ...buildOptionRows(
        cities.map((city, index) => ({
          text: city,
          callback_data: `search_city:${index}`,
        })),
      ),
      [{ text: "Любой город", callback_data: "search_city:any" }],
    ],
  };
}

function buildSearchActivityKeyboard(activities: string[]): TelegramReplyMarkup {
  return {
    inline_keyboard: [
      ...buildOptionRows(
        activities.map((activity, index) => ({
          text: activity,
          callback_data: `search_activity:${index}`,
        })),
      ),
      [{ text: "Любая деятельность", callback_data: "search_activity:any" }],
    ],
  };
}

function buildOptionRows(buttons: Array<{ text: string; callback_data: string }>): TelegramReplyMarkup["inline_keyboard"] {
  const rows: TelegramReplyMarkup["inline_keyboard"] = [];

  for (let index = 0; index < buttons.length; index += 2) {
    rows.push(buttons.slice(index, index + 2));
  }

  return rows;
}

function resolveIndexedOption(data: string, prefix: string, options: string[]): string | null {
  const rawIndex = data.slice(prefix.length);
  const index = Number.parseInt(rawIndex, 10);

  if (!Number.isInteger(index) || index < 0 || index >= options.length) {
    return null;
  }

  return options[index] ?? null;
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

function renderApplicationHistory(
  applications: Awaited<ReturnType<ApplicationRepository["listByCandidateId"]>>,
): string {
  const lines = ["История откликов:"];

  for (const [index, application] of applications.entries()) {
    const decisionDate = application.reviewedAt ?? application.createdAt;
    lines.push(
      `${index + 1}. ${application.vacancy.title} | ${application.vacancy.country}, ${application.vacancy.city} | ${application.vacancy.activity} | ${application.vacancy.agency.name}`,
    );
    lines.push(`Статус: ${renderApplicationStatus(application.status)} | Обновлено: ${formatDateTime(decisionDate)}`);
  }

  return lines.join("\n");
}

type HrVacancyDraft = {
  title?: string;
  country?: string;
  city?: string;
  activity?: string;
  salary?: string;
};

function mergeHrDraft(current: Prisma.JsonValue | null, next: Partial<HrVacancyDraft>): Prisma.InputJsonObject {
  const base = current && typeof current === "object" && !Array.isArray(current)
    ? (current as HrVacancyDraft)
    : {};

  return {
    ...base,
    ...next,
  };
}

function renderHrCabinet(
  hrUser: { agency: { name: string } },
  vacancies: Array<{ title: string; country: string; city: string; activity: string; salary: string; isActive: boolean }>,
): string {
  const lines = [
    `HR кабинет: ${hrUser.agency.name}`,
    "Команды: /hr_add для добавления вакансии, /hr для обновления списка.",
  ];

  if (vacancies.length === 0) {
    lines.push("У агентства пока нет вакансий.");
    return lines.join("\n");
  }

  lines.push("Ваши вакансии:");

  for (const [index, vacancy] of vacancies.entries()) {
    lines.push(
      `${index + 1}. ${vacancy.title} | ${vacancy.country}, ${vacancy.city} | ${vacancy.activity} | ${vacancy.salary} | ${vacancy.isActive ? "активна" : "неактивна"}`,
    );
  }

  return lines.join("\n");
}

function renderApplicationStatus(status: ApplicationStatus): string {
  switch (status) {
    case "ACCEPTED":
      return "принят";
    case "REJECTED":
      return "отклонен";
    case "SENT":
    default:
      return "отправлен";
  }
}

function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat("ru-RU", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Minsk",
  }).format(date);
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
