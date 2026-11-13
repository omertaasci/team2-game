# Contributing (Team 2)

Everyone needs commits and at least one consumer they own. Each consumer is one file in `services/`, reads events from topics and emits new past-tense events. `services/achievements.ts` is the best example to read first.

## Workflow

```
git clone https://github.com/omertaasci/team2-game.git
cd team2-game
npm install
git checkout -b feature/<your-name>-<task>
npm run dev          # in-memory broker, no password needed
npx vitest run       # tests must pass
git add . && git commit -m "Add <what you did>"
git push -u origin feature/<your-name>-<task>
```

Then open a Pull Request on GitHub. `main` is protected, so a teammate must approve it. Never commit the broker password.

## Starter tasks

### Manvi (owns the **achievements** consumer, `services/achievements.ts`)
1. Add 2-3 new achievements (for example `chatterbox` after 5 chat messages, `team_player` after healing 3 different players). Each one emits `achievement_unlocked`.
2. Add the new achievement names and texts to `shared/` and to the achievements table in `game_events.md`.
3. Add a test in `tests/` that unlocks one.

### Rayan (owns the **leaderboard** consumer, `services/leaderboard.ts`)
1. Add a new stat to the leaderboard (for example most healing done, or fastest boss kill time).
2. Show it in the client victory screen (`client/src/main.ts`).
3. Add a test in `tests/` and update `game_events.md` if the payload changes.

### Both
- Add your name and role to the team table in `README.md`.
- Fix typos or improve the docs (`concept.md`, `tech_design.md`).
- Ask in the team chat before changing a shared event in `shared/protocol.ts`, because other consumers depend on it.
