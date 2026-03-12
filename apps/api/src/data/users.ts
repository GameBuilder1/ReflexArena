import type { User } from "@reflexarena/shared";

export const users = new Map<string, User>();

export function createUser(user: User): User {
  users.set(user.userId, user);
  return user;
}

export function getUserById(userId: string): User | undefined {
  return users.get(userId);
}

export function getAllUsers(): User[] {
  return Array.from(users.values());
}
