# Game Events

The game runs on an **event-driven server** built around an **event broker** (Kafka-compatible, Redpanda).

- Players' browsers are **producers of commands**: they send *commands* to the gateway over WebSocket.
- The **gateway** validates each command and publishes it to the broker.
- Independent **consumers** (services) read commands, apply the game rules and publish **domain events** to topics.
- Other consumers react to those events (state, quests, leaderboard, achievements, replay, chat).
- The gateway also consumes events and pushes them back to the right clients.

## Naming rules

| Kind | Meaning | Naming | Example |
|---|---|---|---|
| **Command** | What a player *asks for*. It may be rejected. | Imperative: `verb_noun` | `talk_to_npc` |
| **Event** | What *happened*. It is a fact and cannot be undone. | Past tense: `noun_verbed` | `npc_talked_to` |

All names are `snake_case`.

## Envelope

Every message uses the same envelope. The payloads in the tables below go in `payload`.

```json
{
  "id": "uuid",
  "type": "boss_damaged",
  "roomId": "room-1",
  "playerId": "p-42",
  "timestamp": "2026-11-13T12:00:00.000Z",
  "payload": { }
}
```

The broker message key is `roomId`, so all events of one room stay in order on one partition.

## Topics

> In this document a topic is written `game.<key>`. On the shared broker the real name is `team2.[ns.]<key>` (for example `team2.lobby`). `ns` is the optional `TOPIC_NS` setting that keeps developers apart.
>
> **Single-topic mode (default):** the shared broker does not create new topics for us, so all topics travel over the existing `team2.events` topic. Every message carries a `_topic` field and each consumer filters on it. Set `BROKER_TOPICS=multi` to use one real broker topic per key once topic creation works.

| Topic | Contains | Key | Written by | Notes |
|---|---|---|---|---|
| `game.commands` | All validated player commands | `roomId` | Gateway | Short retention |
| `game.lobby` | Joining, leaving, class choice, game start | `roomId` | Lobby consumer | |
| `game.world` | Movement and scene changes | `roomId` | World consumer | High volume, short retention |
| `game.quests` | NPC talks, quest progress | `roomId` | Quest consumer | |
| `game.presents` | Present collection and return | `roomId` | Quest consumer | |
| `game.combat` | Attacks, damage, healing, boss events | `roomId` | Combat consumer | |
| `game.chat` | Chat messages | `roomId` | Chat consumer | Optional |
| `game.progress` | Game finished, achievements, leaderboard | `roomId` | Quest, Achievements, Leaderboard consumers | Long retention |

## 1. Commands (client -> gateway -> `game.commands`)

| Command | Sent by | Handled by | Payload |
|---|---|---|---|
| `join_room` | Client | Lobby consumer | `{ name }` |
| `leave_room` | Client | Lobby consumer | `{}` |
| `select_class` | Client | Lobby consumer | `{ classId }` (`warrior`, `mage`, `archer`, `healer`) |
| `start_game` | Client (host) | Lobby consumer | `{}` |
| `move_player` | Client | World consumer | `{ x, y, dir, scene }` |
| `enter_scene` | Client | World consumer | `{ sceneId }` (`town` or `cave`) |
| `talk_to_npc` | Client | Quest consumer | `{ npcId }` (talking also starts that NPC's quest) |
| `collect_present` | Client | Quest consumer | `{ presentId }` |
| `return_present` | Client | Quest consumer | `{ presentId, npcId }` |
| `use_attack` | Client | Combat consumer | `{ x, y, dir }` |
| `heal_player` | Client (Healer) | Combat consumer | `{ targetId?, x, y }` |
| `send_chat_message` | Client | Chat consumer | `{ text }` |

NPC ids: `santa`, `elf`, `toy_maker`, `snowman`, `reindeer_keeper`.

**Movement fast path.** Sending 30 Hz movement through the broker is too slow (a round trip is about 0.5–1.5 s). So the gateway relays `move_player` straight to the other players in the room as a volatile `live_move` message (not an event, not stored). It also publishes a position checkpoint as a command at most every 500 ms, and on every scene change. The World consumer turns that into `player_moved`.

## 2. Events

**Producer** is the consumer service that publishes the event after applying the rules. **Consumers** are the services that react to it. *Gateway* means the event is pushed to the clients in the room.

### `game.lobby`

| Event | Producer | Consumers | Payload |
|---|---|---|---|
| `room_joined` | Lobby | Gateway, Replay | `{ playerId, name, classId, isHost, started }` |
| `room_left` | Lobby | Gateway, World, Replay | `{ playerId, newHostId? }` |
| `class_selected` | Lobby | Gateway, Combat, Replay | `{ playerId, classId, maxHp }` |
| `game_started` | Lobby | Gateway, World, Quest, Combat, Leaderboard, Replay | `{ players: [...], bossMaxHp }` |
| `command_rejected` | Lobby, World, Quest, Combat | Gateway (one client) | `{ command, reason }` |

### `game.world`

| Event | Producer | Consumers | Payload |
|---|---|---|---|
| `player_moved` | World | Gateway, Replay | `{ playerId, x, y, dir, scene }` |
| `scene_entered` | World | Gateway, Combat, Replay | `{ playerId, sceneId, x, y }` |

### `game.quests`

| Event | Producer | Consumers | Payload |
|---|---|---|---|
| `npc_talked_to` | Quest | Gateway (dialogue UI), Achievements, Replay | `{ playerId, npcId, lines: [...] }` |
| `quest_started` | Quest | Gateway, Achievements, Replay | `{ questId, npcId, title, description }` |
| `quest_progressed` | Quest | Gateway, Replay | `{ questId, progress, goal }` |
| `quest_completed` | Quest | Gateway, Leaderboard, Achievements, Replay | `{ questId, npcId, completedBy: [playerIds] }` |

### `game.presents`

| Event | Producer | Consumers | Payload |
|---|---|---|---|
| `presents_unlocked` | Quest | Gateway, Replay | `{ presentIds: [...] }` (after `boss_defeated`) |
| `present_collected` | Quest | Gateway, Leaderboard, Achievements, Replay | `{ presentId, collectedBy, total }` |
| `present_returned` | Quest | Gateway, Leaderboard, Replay | `{ presentId, npcId, returnedBy }` |
| `all_presents_returned` | Quest | Gateway, Achievements, Replay | `{ completedAt }` |

### `game.combat`

| Event | Producer | Consumers | Payload |
|---|---|---|---|
| `attack_used` | Combat | Gateway (animations), Replay | `{ playerId, classId, x, y, dir }` |
| `projectile_spawned` | Combat | Gateway, Replay | `{ projectileId, ownerId, type, x, y, dir, speed }` |
| `boss_damaged` | Combat | Gateway, Leaderboard, Achievements, Replay | `{ attackerId, damage, hp, maxHp }` |
| `boss_attacked` | Combat | Gateway, Replay | `{ attackId, x, y, radius, delayMs }` |
| `boss_phase_changed` | Combat | Gateway, Replay | `{ phase }` |
| `boss_defeated` | Combat | Gateway, Quest, Leaderboard, Achievements, Replay | `{ contributors: [playerIds] }` |
| `player_damaged` | Combat | Gateway, Achievements, Replay | `{ playerId, damage, hp, sourceId }` |
| `player_healed` | Combat | Gateway, Leaderboard, Achievements, Replay | `{ playerId, healerId, amount, hp }` |
| `player_downed` | Combat | Gateway, Achievements, Replay | `{ playerId }` |
| `player_revived` | Combat | Gateway, Replay | `{ playerId, hp }` |
| `party_wiped` | Combat | Gateway, Combat (resets boss), Replay | `{ bossMaxHp }` |

### `game.chat` (optional)

| Event | Producer | Consumers | Payload |
|---|---|---|---|
| `chat_message_sent` | Chat | Gateway, Replay | `{ playerId, name, text }` |

### `game.progress`

| Event | Producer | Consumers | Payload |
|---|---|---|---|
| `christmas_saved` | Quest | Gateway, Leaderboard, Achievements, Replay | `{ players, durationMs }` |
| `achievement_unlocked` | Achievements | Gateway, Leaderboard, Replay | `{ playerId, achievementId }` |
| `leaderboard_updated` | Leaderboard | Gateway | `{ entries: [{ playerId, name, score }] }` |

## 3. Example flow: damage the boss

1. The client sends the command `use_attack`.
2. The gateway validates it and publishes it to `game.commands`.
3. The Combat consumer reads it, checks range and cooldown, and publishes `attack_used` and `boss_damaged` to `game.combat`.
4. The Gateway pushes both events to all clients in the room.
5. The Leaderboard consumer adds damage score. The Replay consumer stores the events.
6. When boss HP reaches 0, Combat publishes `boss_defeated`.
7. The Quest consumer reacts and unlocks the presents. Once they are returned it publishes `christmas_saved`. Achievements reacts and publishes `achievement_unlocked`.

## 4. Rules

- Clients never publish events. Only services publish events.
- A command can fail (`command_rejected`). An event is always true.
- Consumers must be **idempotent**: seeing the same event twice must not change the result (use the envelope `id`).
- Every consumer has its own **consumer group**, so each service reads every event it subscribes to.
- Services do not call each other directly. They talk only through topics.
