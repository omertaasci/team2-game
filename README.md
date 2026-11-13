<div align="center">

<img src="docs/banner.png" alt="Christmas Quest banner" width="100%">

# 🎄 Christmas Quest: Save Christmas! 🎅

### *A 2D multiplayer co-op RPG for the browser*

![Phaser](https://img.shields.io/badge/Phaser-3-8A2BE2?style=for-the-badge)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=node.js&logoColor=white)
![Socket.IO](https://img.shields.io/badge/Socket.IO-010101?style=for-the-badge&logo=socketdotio&logoColor=white)
![Players](https://img.shields.io/badge/Players-2--6-red?style=for-the-badge)
![Status](https://img.shields.io/badge/Status-Playable-brightgreen?style=for-the-badge)

❄️ ❄️ ❄️ ❄️ ❄️ ❄️ ❄️ ❄️ ❄️ ❄️ ❄️ ❄️

</div>

## 📖 Story

The **Ice King** has stolen every Christmas present in town and hidden them deep inside his frozen cave.

Your team arrives in a snowy village and meets five NPCs who each lost something precious. Explore, talk to the villagers, journey to the cave together, defeat the Ice King in a co-op boss fight, and **bring the presents home** to save Christmas!

## ✨ Features

| | Feature |
|---|---|
| 🌐 | Real-time multiplayer for **2–6 players** |
| 🧙 | Four playable classes with character selection |
| 🕹️ | WASD movement with synced players |
| 💬 | NPC dialogue and quests |
| 🎁 | Five collectible Christmas presents |
| ❄️ | Co-op boss fight against the Ice King |
| ❤️ | Basic health and damage system |
| 🗨️ | In-game chat *(maybe)* |

## 🗺️ World

- **🏘️ Christmas Town** – a small snowy village with 5–10 buildings, five quest NPCs and the player spawn.
- **🧊 Ice Cave** – outside the town. Home of the Ice King and the stolen presents.

## 🦸 Characters

### Playable classes

| Class | Role |
|---|---|
| ⚔️ **Warrior** | Strong melee attacks, high health |
| 🔮 **Mage** | Magic attacks |
| 🏹 **Archer** | Ranged attacker |
| 💚 **Healer** | Restores teammates' health |

### NPCs

<div align="center"><img src="docs/snowman.png" width="140" alt="Snowman"></div>


| NPC | Quest |
|---|---|
| 🎅 **Santa** | Gives the main quest |
| 🧝 **Elf** | Lost his gift |
| 🧸 **Toy Maker** | Needs his stolen presents back |
| ⛄ **Snowman** | Wants his magical snow crystal back |
| 🦌 **Reindeer Keeper** | Needs a special gift for his reindeer |

### 👑 Boss

**Ice King** – the only enemy in the game. He stole everything and waits in the cave.

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Game engine | [Phaser 3](https://phaser.io/) |
| Client | TypeScript, Vite, HTML, CSS |
| Gateway and services | Node.js, TypeScript |
| Browser connection | WebSocket ([Socket.IO](https://socket.io/)) |
| Event broker | [Redpanda](https://redpanda.com/) (Kafka-compatible) |

## 🚀 Getting Started

```bash
git clone https://github.com/omertaasci/team2-game.git
cd team2-game
npm install
npm run dev
```

Open http://localhost:5173 in several browser tabs to play together. By default everything runs in one process with an in-memory broker.

To use the shared Redpanda broker, copy `.env.example` to `.env` and set `BROKER=http` and `BROKER_PASSWORD` (ask the team, never commit it). Only one copy of the game should run against the shared broker at a time, because everyone shares the same 8 topics. For development use the default in-memory mode.

### 🐳 Deployment (Docker)

```bash
docker build -t team2-game .
docker run -p 3000:3000 -e BROKER_PASSWORD=... team2-game
```

One container runs the web client, gateway and all services. Open `http://<host>:3000`.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `BROKER_PASSWORD` | yes | | Password of the `team2` broker user (never commit it) |
| `PORT` | no | `3000` | Port the server listens on |
| `BROKER` | no | `http` in Docker | `http` = shared broker, `memory` = no broker |
| `BROKER_URL` | no | `https://edp-broker.codewithpeter.com` | Redpanda REST proxy |
| `BROKER_USER` | no | `team2` | Broker user |
| `BROKER_TOPICS` | no | `multi` | `multi` = the 8 real topics (`team2.lobby`, ...), `single` = fallback over `team2.events` |
| `TOPIC_NS` | no | empty | Leave empty on the shared broker (only the 8 fixed topics exist) |

Players need WebSocket support through any reverse proxy. Startup takes up to about 20 s while consumers connect to the broker.

**Controls:** `WASD` move · `E` talk / pick up · `Space` attack · `F` heal · `Enter` chat

**Tests:** `npm test` (full game flow) and `npm run smoke:http` (shared broker).

## 🗂️ Structure

```
team2-game/
├── broker/      # In-memory and Redpanda REST proxy clients
├── client/      # Phaser 3 game
├── gateway/     # Socket.IO <-> event broker
├── services/    # Event consumers (lobby, world, quest, combat, chat, leaderboard, achievements, replay)
├── shared/      # Command and event types shared by all parts
├── tests/       # End-to-end and broker smoke tests
├── concept.md        # Game concept
├── game_events.md    # Commands, events, topics
└── tech_design.md    # Technical design
```

## 🧭 Roadmap

- [x] Project setup (Vite, TypeScript, Node server)
- [x] Multiplayer in the snowy town
- [x] NPC dialogue and quest tracking
- [x] Ice Cave scene
- [x] Ice King boss fight (shared health, server-authoritative)
- [x] Class abilities
- [x] Return presents and finish the game
- [x] In-game chat

## 🎨 Assets

- 2D Pixel Dungeon Asset Pack v2.0
- Christmas Village Asset Pack
- Enemy Animations Set

Please check each pack's license before publishing the game.

## 📚 Documentation

- [Concept](concept.md)
- [Game events](game_events.md)
- [Technical design](tech_design.md)

## 👥 Team

**Team 2**

| Member | GitHub |
|---|---|
| Ömer | [@omertaasci](https://github.com/omertaasci) |
| Manvi | [@manvibhatt1137-glitch](https://github.com/manvibhatt1137-glitch) |
| Rayan | [@rayanhasasneh](https://github.com/rayanhasasneh) |
| _add the remaining members_ | |

<div align="center">

❄️ *Happy holidays and happy coding!* 🎄

</div>
