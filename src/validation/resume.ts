import type { Prisma } from "@prisma/client";

const MAX_ITEMS = 50;

export function extractSkills(payload: Prisma.JsonValue | null | undefined): string[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return [];
  }

  const skills = (payload as { skills?: unknown }).skills;
  return normalizeUnknownStringArray(skills, MAX_ITEMS);
}

export function parseName(input: string): string | null {
  const value = normalizeOptionalString(input);
  return value && value.length >= 2 ? value : null;
}

export function parseAge(input: string): number | null {
  const value = input.trim();

  if (!/^\d{1,3}$/.test(value)) {
    return null;
  }

  const age = Number.parseInt(value, 10);
  return age >= 16 && age <= 100 ? age : null;
}

export function parseCity(input: string): string | null {
  return normalizeOptionalString(input);
}

export function parseOptionalFilter(input: string): string | null {
  const normalized = input.trim().toLowerCase();
  if (normalized === "" || ["нет", "не важно", "любой", "пропустить", "-", "any"].includes(normalized)) {
    return null;
  }

  return normalizeOptionalString(input);
}

export function parseDocumentTypes(input: string): string[] {
  return normalizeDelimitedString(input, MAX_ITEMS);
}

export function parseSkillsText(input: string): string[] {
  return normalizeDelimitedString(input, MAX_ITEMS);
}

export function shouldSkipSkills(input: string): boolean {
  const normalized = input.trim().toLowerCase();
  return normalized === "" || ["нет", "не знаю", "пропустить", "skip", "-", "n/a"].includes(normalized);
}

export function buildCandidateResume(payload: {
  name: string;
  age: number | null;
  city: string | null;
  documentTypes: string[];
  skills: string[];
}): Prisma.InputJsonObject {
  return {
    name: payload.name,
    age: payload.age,
    city: payload.city,
    documentTypes: payload.documentTypes,
    skills: payload.skills,
  };
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length > 0 ? normalized : null;
}

function normalizeDelimitedString(input: string, maxItems: number): string[] {
  return input
    .split(/[,\n;|]/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .filter((item, index, source) => source.indexOf(item) === index)
    .slice(0, maxItems);
}

function normalizeUnknownStringArray(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .filter((item, index, source) => source.indexOf(item) === index)
    .slice(0, maxItems);
}
