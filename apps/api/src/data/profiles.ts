import type { Profile } from "@reflexarena/shared";

export const profiles = new Map<string, Profile>();

export function createProfile(profile: Profile): Profile {
  profiles.set(profile.userId, profile);
  return profile;
}

export function getProfileByUserId(userId: string): Profile | undefined {
  return profiles.get(userId);
}

export function updateProfile(
  userId: string,
  updates: Partial<Pick<Profile, "username" | "avatarUrl" | "bestScore" | "averageReactionMs" | "accuracyPct" | "rank" | "wins" | "losses" | "updatedAt">>
): Profile | undefined {
  const existing = profiles.get(userId);
  if (!existing) return undefined;

  const updated: Profile = {
    ...existing,
    ...updates,
    updatedAt: updates.updatedAt ?? new Date().toISOString(),
  };

  profiles.set(userId, updated);
  return updated;
}

export function getAllProfiles(): Profile[] {
  return Array.from(profiles.values());
}
