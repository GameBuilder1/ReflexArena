import type { Score } from "@reflexarena/shared";

export const scores = new Map<string, Score>();

export function createScore(score: Score): Score {
  scores.set(score.scoreId, score);
  return score;
}

export function getScoreById(scoreId: string): Score | undefined {
  return scores.get(scoreId);
}

export function getScoresByUser(userId: string): Score[] {
  return Array.from(scores.values())
    .filter((score) => score.userId === userId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function getAllScores(): Score[] {
  return Array.from(scores.values());
}
