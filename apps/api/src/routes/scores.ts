import express from "express";
import { z } from "zod";
import { randomUUID } from "crypto";

import { Score } from "@reflexarena/shared";
import { scores, createScore, getScoresByUser } from "../data/scores";
import { getProfileByUserId, updateProfile } from "../data/profiles";
import { getAllProfiles } from "../data/profiles";

const router = express.Router();

const SubmitScoreSchema = z.object({
  userId: z.string(),
  score: z.number(),
  validHits: z.number(),
  trapHits: z.number(),
  misses: z.number(),
  averageReactionMs: z.number(),
  durationSec: z.number()
});

function calculateAccuracy(validHits: number, trapHits: number, misses: number) {
  const total = validHits + trapHits + misses;
  if (total === 0) return 0;
  return Math.round((validHits / total) * 100);
}

function computeRank(userId: string) {
  const profiles = getAllProfiles();

  const sorted = profiles
    .slice()
    .sort((a, b) => b.bestScore - a.bestScore);

  const index = sorted.findIndex(p => p.userId === userId);
  return index === -1 ? null : index + 1;
}

router.post("/scores", (req, res) => {
  const parsed = SubmitScoreSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: "BAD_REQUEST",
      message: parsed.error.message
    });
  }

  const {
    userId,
    score,
    validHits,
    trapHits,
    misses,
    averageReactionMs,
    durationSec
  } = parsed.data;

  const profile = getProfileByUserId(userId);

  if (!profile) {
    return res.status(404).json({
      error: "USER_NOT_FOUND"
    });
  }

  const accuracyPct = calculateAccuracy(validHits, trapHits, misses);

  const newScore: Score = {
    scoreId: randomUUID(),
    userId,
    challengeType: "REFLEX_TAP_V1",
    score,
    validHits,
    trapHits,
    misses,
    accuracyPct,
    averageReactionMs,
    durationSec,
    createdAt: new Date().toISOString()
  };

  createScore(newScore);

  // Update best score
  const bestScore = Math.max(profile.bestScore, score);

  // Compute average reaction time from last 10 scores
  const userScores = getScoresByUser(userId).slice(0, 10);

  const avgReaction =
    userScores.reduce((sum, s) => sum + s.averageReactionMs, 0) /
    userScores.length;

  updateProfile(userId, {
    bestScore,
    averageReactionMs: Math.round(avgReaction),
    accuracyPct
  });

  const rank = computeRank(userId);

  res.json({
    scoreId: newScore.scoreId,
    bestScore,
    rank
  });
});

export default router;
