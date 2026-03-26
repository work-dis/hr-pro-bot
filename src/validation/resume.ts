import type { Prisma } from "@prisma/client";

export interface ValidatedResume {
  name: string | null;
  phone: string | null;
  city: string | null;
  skills: string[];
  raw: Prisma.InputJsonObject;
}

interface ParseSuccess {
  ok: true;
  value: ValidatedResume;
}

interface ParseFailure {
  ok: false;
  message: string;
}

export type ParseResumeResult = ParseSuccess | ParseFailure;

const MAX_RESUME_TEXT_LENGTH = 12000;
const MAX_SKILLS = 50;

export function parseAndValidateResume(input: string): ParseResumeResult {
  const text = input.trim();

  if (text.length === 0) {
    return { ok: false, message: "Пустое сообщение. Пришлите JSON-резюме одним сообщением." };
  }

  if (text.length > MAX_RESUME_TEXT_LENGTH) {
    return { ok: false, message: "Слишком большой JSON. Сократите сообщение и попробуйте снова." };
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, message: "Не удалось распознать JSON. Проверьте синтаксис и отправьте снова." };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, message: "JSON должен быть объектом с полями кандидата." };
  }

  const record = parsed as Record<string, unknown>;
  const name = normalizeOptionalString(record.name);
  const phone = normalizePhone(record.phone);
  const city = normalizeOptionalString(record.city);
  const skills = normalizeSkills(record.skills);

  if (!name) {
    return { ok: false, message: "Поле `name` обязательно и должно быть строкой." };
  }

  if (!city) {
    return { ok: false, message: "Поле `city` обязательно и должно быть строкой." };
  }

  return {
    ok: true,
    value: {
      name,
      phone,
      city,
      skills,
      raw: {
        ...record,
        name,
        phone,
        city,
        skills,
      } as Prisma.InputJsonObject,
    },
  };
}

export function extractSkills(payload: Prisma.JsonValue | null | undefined): string[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return [];
  }

  const skills = (payload as { skills?: unknown }).skills;
  return normalizeSkills(skills);
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length > 0 ? normalized : null;
}

function normalizePhone(value: unknown): string | null {
  const phone = normalizeOptionalString(value);

  if (!phone) {
    return null;
  }

  const sanitized = phone.replace(/[^\d+]/g, "");
  return sanitized.length >= 7 ? sanitized : null;
}

function normalizeSkills(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const uniqueSkills = new Set<string>();

  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }

    const skill = item.trim().toLowerCase();

    if (skill) {
      uniqueSkills.add(skill);
    }

    if (uniqueSkills.size >= MAX_SKILLS) {
      break;
    }
  }

  return [...uniqueSkills];
}
