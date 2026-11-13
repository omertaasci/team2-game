# Game Events

All events are named in **past tense** (`snake_case`): they describe something that has already happened.

**Producers and consumers**

- **Client** – a player's browser (Phaser game).
- **Server** – the authoritative Node.js + Socket.IO server. It validates client events and broadcasts the results.
- **UI** – HUD, dialogue box, quest log and chat panel on the client.
- **Scene** – the Phaser Town or Cave scene.

Client events are *requests* that the server checks. Server events are the *truth* that all clients apply.

## 1. Connection and lobby

| Event | Producer | Consumer | Payload |
|---|---|---|---|
| `player_joined` | Server | All clients | `{ playerId, name, classId, x, y }` |
| `player_left` | Server | All clients | `{ playerId }` |
| `class_selected` | Client | Server | `{ playerId, classId }` (`warrior`, `mage`, `archer`, `healer`) |
| `class_assigned` | Server | All clients | `{ playerId, classId, maxHp }` |
| `game_started` | Server | All clients | `{ sceneId: "town", players: [...], questState }` |
| `state_synced` | Server | One client (on join or rejoin) | `{ players, questState, bossState, presentsCollected }` |

## 2. Movement

| Event | Producer | Consumer | Payload |
|---|---|---|---|
| `player_moved` | Client | Server | `{ playerId, x, y, dir, seq }` |
| `players_updated` | Server (about 20 times a second) | All clients (Scene) | `{ players: [{ playerId, x, y, dir }], tick }` |
| `scene_entered` | Server | All clients (Scene) | `{ playerId, sceneId }` (`town` or `cave`) |

## 3. NPCs and quests

| Event | Producer | Consumer | Payload |
|---|---|---|---|
| `npc_talked_to` | Client | Server | `{ playerId, npcId }` |
| `dialogue_started` | Server | The talking client (UI) | `{ playerId, npcId, lines: [...] }` |
| `quest_started` | Server | All clients (UI) | `{ questId, npcId, title, description }` |
| `quest_progressed` | Server | All clients (UI) | `{ questId, progress, goal }` |
| `quest_completed` | Server | All clients (UI) | `{ questId, npcId, completedBy: [playerIds] }` |
| `reward_granted` | Server | All clients (UI) | `{ questId, reward }` |

NPC ids: `santa`, `elf`, `toy_maker`, `snowman`, `reindeer_keeper`.

## 4. Presents

| Event | Producer | Consumer | Payload |
|---|---|---|---|
| `present_collected` | Server (after a client request) | All clients (Scene, UI) | `{ presentId, collectedBy, total }` |
| `present_returned` | Server (after a client request) | All clients (UI) | `{ presentId, npcId, returnedBy }` |
| `all_presents_returned` | Server | All clients | `{ completedAt }` |

## 5. Combat

| Event | Producer | Consumer | Payload |
|---|---|---|---|
| `attack_used` | Client | Server | `{ playerId, abilityId, x, y, dir }` |
| `projectile_spawned` | Server | All clients (Scene) | `{ projectileId, ownerId, type, x, y, dir, speed }` |
| `boss_damaged` | Server | All clients (UI, Scene) | `{ damage, hp, maxHp, attackerId }` |
| `player_damaged` | Server | All clients (UI) | `{ playerId, damage, hp, sourceId }` |
| `player_healed` | Server | All clients (UI) | `{ playerId, amount, hp, healerId }` |
| `player_downed` | Server | All clients (Scene, UI) | `{ playerId }` |
| `player_revived` | Server | All clients (Scene, UI) | `{ playerId, hp }` |
| `boss_attacked` | Server | All clients (Scene) | `{ attackId, x, y, radius, delayMs }` |
| `boss_phase_changed` | Server | All clients (Scene, UI) | `{ phase }` |
| `boss_defeated` | Server | All clients | `{ defeatedAt, contributors: [playerIds] }` |
| `party_wiped` | Server | All clients | `{}` (everyone is down, the boss fight restarts) |

## 6. Chat (optional)

| Event | Producer | Consumer | Payload |
|---|---|---|---|
| `chat_message_sent` | Client | Server | `{ playerId, text }` |
| `chat_message_received` | Server | All clients (UI) | `{ playerId, name, text, timestamp }` |

## 7. Game end

| Event | Producer | Consumer | Payload |
|---|---|---|---|
| `christmas_saved` | Server | All clients (UI) | `{ players, durationMs }` |
| `game_reset` | Server | All clients | `{}` |

## Main flow example

1. `class_selected` -> `class_assigned` -> `game_started`
2. `npc_talked_to` -> `dialogue_started` -> `quest_started`
3. `scene_entered` (cave) -> `attack_used` -> `projectile_spawned` -> `boss_damaged` -> `boss_defeated`
4. `present_collected` (x5) -> `present_returned` -> `quest_completed` -> `all_presents_returned` -> `christmas_saved`
