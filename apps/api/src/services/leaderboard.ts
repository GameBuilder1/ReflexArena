Build a leaderboard service.

Inputs:
profiles map

Return:
Array of
{
 rank
 userId
 username
 bestScore
 averageReactionMs
}

Sort profiles by bestScore descending.

Assign ranks starting from 1.

Export function getGlobalLeaderboard().
