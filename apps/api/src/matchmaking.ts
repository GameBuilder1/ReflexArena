import type { AuthedClient } from "./ws";
import { MatchEngine } from "./matchEngine";

export class MatchmakingQueue {
  private queue: AuthedClient[] = [];
  private inQueue = new Set<string>(); // userId

  constructor(private engine: MatchEngine) {}

  join(client: AuthedClient): { ok: true } | { ok: false; code: string } {
    // prevent double queue
    if (this.inQueue.has(client.userId)) return { ok: false, code: "ALREADY_QUEUED" };
    // prevent overlap (already in a match)
    if (this.engine.getUserMatch(client.userId)) return { ok: false, code: "IN_MATCH" };

    this.queue.push(client);
    this.inQueue.add(client.userId);

    this.tryMatch();
    return { ok: true };
  }

  leave(userId: string) {
    if (!this.inQueue.has(userId)) return;
    this.inQueue.delete(userId);
    this.queue = this.queue.filter((c) => c.userId !== userId);
  }

  onDisconnect(userId: string) {
    // if queued, remove
    this.leave(userId);
  }

  private tryMatch() {
    while (this.queue.length >= 2) {
      const a = this.queue.shift()!;
      const b = this.queue.shift()!;
      this.inQueue.delete(a.userId);
      this.inQueue.delete(b.userId);

      // sanity: avoid self-match
      if (a.userId === b.userId) continue;

      this.engine.createMatch(a, b);
    }
  }
}
