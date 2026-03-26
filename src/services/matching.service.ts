import type { Prisma } from "@prisma/client";
import { VacancyRepository, type VacancyWithAgency } from "../repositories/vacancy.repo";
import { extractSkills } from "../validation/resume";

export interface MatchCandidateInput {
  city?: string | null;
  resume?: Prisma.JsonValue | null;
}

export interface VacancyMatch {
  vacancy: VacancyWithAgency;
  score: number;
}

export class MatchingService {
  constructor(private readonly vacancyRepository: VacancyRepository) {}

  async matchCandidate(input: MatchCandidateInput): Promise<VacancyMatch[]> {
    const vacancies = await this.vacancyRepository.findRelevant(input.city);
    const candidateSkills = extractSkills(input.resume);
    const candidateSkillSet = new Set(candidateSkills);
    const normalizedCity = input.city?.trim().toLowerCase() ?? null;

    return vacancies
      .map((vacancy) => {
        const vacancySkills = extractSkills(vacancy.tags as Prisma.JsonValue | null);
        const skillMatches = vacancySkills.filter((skill) => candidateSkillSet.has(skill)).length;
        const cityScore = normalizedCity && vacancy.city.trim().toLowerCase() === normalizedCity ? 3 : 0;
        const score = cityScore + skillMatches;

        return {
          vacancy,
          score,
        };
      })
      .filter((item) => item.score > 0 || !normalizedCity)
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }

        return left.vacancy.title.localeCompare(right.vacancy.title);
      })
      .slice(0, 3);
  }
}
