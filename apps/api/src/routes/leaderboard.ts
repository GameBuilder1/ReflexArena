import express from "express";
import { getAllProfiles } from "../data/profiles";

const router = express.Router();

router.get("/leaderboard", (_req, res) => {
  const profiles = getAllProfiles();

  const leaderboard = profiles
    .slice()
    .sort((a, b) => b.bestScore - a.bestScore)
    .map((profile, index) => ({
      rank: index + 1,
      userId: profile.userId,
      username: profile.username,
      bestScore: profile.bestScore,
      averageReactionMs: profile.averageReactionMs,
      accuracyPct: profile.accuracyPct,
      wins: profile.wins,
      losses: profile.losses
    }));

  res.json(leaderboard);
});

export default router;
