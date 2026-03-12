import type { Friendship } from "@reflexarena/shared";

export const friendships = new Map<string, Friendship>();

export function createFriendship(friendship: Friendship): Friendship {
  friendships.set(friendship.friendshipId, friendship);
  return friendship;
}

export function getFriendshipById(friendshipId: string): Friendship | undefined {
  return friendships.get(friendshipId);
}

export function updateFriendship(
  friendshipId: string,
  updates: Partial<Pick<Friendship, "status" | "updatedAt">>
): Friendship | undefined {
  const existing = friendships.get(friendshipId);
  if (!existing) return undefined;

  const updated: Friendship = {
    ...existing,
    ...updates,
    updatedAt: updates.updatedAt ?? new Date().toISOString(),
  };

  friendships.set(friendshipId, updated);
  return updated;
}

export function getFriendshipsForUser(userId: string): Friendship[] {
  return Array.from(friendships.values()).filter(
    (f) => f.requesterUserId === userId || f.addresseeUserId === userId
  );
}

export function getAcceptedFriendsForUser(userId: string): Friendship[] {
  return getFriendshipsForUser(userId).filter((f) => f.status === "ACCEPTED");
}
