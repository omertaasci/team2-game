# Technical Design

## 1. Stack

| Layer | Technology | Why |
|---|---|---|
| Game engine | Phaser 3 | Tilemaps, animation, input and arcade physics built in |
| Client tooling | Vite + TypeScript | Fast reload, type-checked code |
| Server | Node.js + Socket.IO | Simple real-time messaging for 2-6 players |
| Shared | TypeScript types | One definition of every event payload (see `game_events.md`) |

## 2. Architecture

```
 Browser (Phaser)  <-- Socket.IO -->  Node.js server  <-- Socket.IO -->  Browser (Phaser)
  input, rendering                    game state                          input, rendering
  prediction, UI                      rules, validation
```

The server is **authoritative**. Clients send requests (`player_moved`, `attack_used`, `npc_talked_to`). The server validates them, updates the state and broadcasts the results (`boss_damaged`, `quest_completed`). Clients never decide damage, quest progress or present ownership.

## 3. Folder structure

```
team2-game/
├── assets/        sprites, tilesets, UI art
├── client/
│   └── src/
│       ├── scenes/    Boot, Menu, Town, Cave
│       ├── ui/        HUD, dialogue box, quest log, chat
│       ├── net/       Socket.IO wrapper, event handlers
│       └── entities/  Player, Npc, Boss, Projectile
├── server/
│   └── src/
│       ├── rooms/     game room, player registry
│       ├── systems/   movement, combat, quests, boss AI
│       └── index.ts
├── shared/        event names and payload types
├── concept.md
├── game_events.md
└── tech_design.md
```

## 4. Server state

```ts
GameState {
  players: Map<playerId, { name, classId, hp, maxHp, x, y, dir, scene, downed }>
  quests:  Map<questId, { status: "locked" | "active" | "completed", progress }>
  presents: Map<presentId, { location: "cave" | "carried" | "returned", holder? }>
  boss:    { hp, maxHp, phase, x, y, target }
}
```

The state lives in memory in one room (2-6 players). It is lost on restart, which is fine for this project. Reconnecting players get `state_synced`.

## 5. Networking

- **Tick rate:** the server runs at 20 ticks per second and broadcasts `players_updated` each tick.
- **Movement:** the client moves its own player immediately and sends `player_moved`. The server clamps speed and checks collisions. Other players are interpolated between updates to look smooth.
- **Combat:** the server runs all projectiles and hit detection and broadcasts the results.
- **Boss:** a simple state machine on the server (idle, chase, attack, phase change). It targets the nearest player.
- **Disconnects:** the player stays in the state for 30 seconds so they can rejoin.

## 6. Game data

| Class | HP | Attack | Special |
|---|---|---|---|
| Warrior | High | Melee, short range | Takes hits for the team |
| Mage | Medium | Magic bolt | Area damage |
| Archer | Medium | Fast arrows, long range | Keeps distance |
| Healer | Medium | Weak attack | Heals teammates |

Numbers are tuned during playtesting.

## 7. Scenes and maps

- **Town:** one tilemap built from the Christmas village pack. Houses are decorative and block movement. The five NPCs stand next to them.
- **Cave:** one tilemap built from the dungeon tileset. It holds the Ice King arena and the five presents.
- Maps are built in Tiled (JSON) and loaded by Phaser.

## 8. Assets

| Use | Source |
|---|---|
| Town, NPC look-alikes, presents | Christmas Village Asset Pack |
| Cave, props, effects | 2D Pixel Dungeon Asset Pack v2.0 |
| Ice King and enemy animations | Enemy Animations Set (recolored) |

Check each pack's license before publishing.

## 9. Running and deploying

```bash
npm install
npm run dev     # client (Vite) and server (Node) together
npm run build
npm start       # server serves the built client and the sockets
```

One Node process serves both the game and the websockets, so a single host (Render or Railway) is enough.

## 10. Testing

- Open several browser tabs to simulate players.
- Unit tests for server systems (quests, damage, boss logic).
- A script that connects fake clients to check sync and load.

## 11. Risks

| Risk | Mitigation |
|---|---|
| Missing character and NPC art | Recolor existing sprites and use class stats instead of unique animations |
| Desync | Server-authoritative state and `state_synced` on join |
| Scope creep | Chat and extra class abilities are optional and come last |
| Free hosting sleeps | Run locally for demos or use a paid tier |
