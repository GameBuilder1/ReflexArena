import type { Challenge } from "@reflexarena/shared";

export const challenges = new Map<string, Challenge>();

export function createChallenge(challenge: Challenge): Challenge {
  challenges.set(challenge.challengeId, challenge);
  return challenge;
}

export function getChallengeById(challengeId: string): Challenge | undefined {
  return challenges.get(challengeId);
}

export function updateChallenge(
  challengeId: string,
  updates: Partial<
    Pick<Challenge, "status" | "completedScoreId" | "updatedAt" | "expiresAt">
  >
): Challenge | undefined {
  const existing = challenges.get(challengeId);
  if (!existing) return undefined;

  const updated: Challenge = {
    ...existing,
    ...updates,
    updatedAt: updates.updatedAt ?? new Date().toISOString(),
  };

  challenges.set(challengeId, updated);
  return updated;
}

export function getChallengesForUser(userId: string): {
  incoming: Challenge[];
  outgoing: Challenge[];
} {
  const all = Array.from(challenges.values());

  return {
    incoming: all.filter((c) => c.toUserId === userId),
    outgoing: all.filter((c) => c.fromUserId === userId),
  };
}
