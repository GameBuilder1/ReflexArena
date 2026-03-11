import "dotenv/config";
import express from "express";
import cors from "cors";
import scoresRouter from "./routes/scores";

import authRouter from "./routes/auth";
import profileRouter from "./routes/profile";
import scoresRouter from "./routes/scores";
import leaderboardRouter from "./routes/leaderboard";
import friendsRouter from "./routes/friends";
import challengesRouter from "./routes/challenges";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use(authRouter);
app.use(profileRouter);
app.use(scoresRouter);
app.use(leaderboardRouter);
app.use(friendsRouter);
app.use(challengesRouter);

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});
