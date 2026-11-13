import { newId, type ClassId, type CommandPayloads, type SceneId } from '../shared/protocol.js';
import { BOSS, CLASSES, HEAL, MOVE_BOUNDS, bossMaxHp } from '../shared/world.js';
import type { Service, ServiceContext } from './runtime.js';

interface CPlayer {
  classId: ClassId;
  hp: number;
  maxHp: number;
  x: number;
  y: number;
  scene: SceneId;
  downed: boolean;
  downedAt: number;
  lastAttack: number;
  lastHeal: number;
}

interface PendingAttack {
  id: string;
  x: number;
  y: number;
  radius: number;
  damage: number;
  at: number;
}

interface Room {
  started: boolean;
  players: Map<string, CPlayer>;
  boss: { hp: number; maxHp: number; phase: number; alive: boolean; nextAttackAt: number };
  pending: PendingAttack[];
  contributors: Set<string>;
}

const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);
const clampPos = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));

export function createCombat(): Service & { rooms: Map<string, Room> } {
  const rooms = new Map<string, Room>();
  const roomOf = (id: string) => {
    let r = rooms.get(id);
    if (!r) {
      r = {
        started: false,
        players: new Map(),
        boss: { hp: 1, maxHp: 1, phase: 1, alive: true, nextAttackAt: 0 },
        pending: [],
        contributors: new Set(),
      };
      rooms.set(id, r);
    }
    return r;
  };

  const newPlayer = (classId: ClassId): CPlayer => ({
    classId,
    hp: CLASSES[classId].hp,
    maxHp: CLASSES[classId].hp,
    x: 0,
    y: 0,
    scene: 'town',
    downed: false,
    downedAt: 0,
    lastAttack: 0,
    lastHeal: 0,
  });

  function down(roomId: string, r: Room, id: string, p: CPlayer, ctx: ServiceContext, now: number) {
    p.hp = 0;
    p.downed = true;
    p.downedAt = now;
    ctx.emit('player_downed', roomId, { playerId: id });
    checkWipe(roomId, r, ctx);
  }

  function checkWipe(roomId: string, r: Room, ctx: ServiceContext) {
    if (!r.started || !r.players.size || !r.boss.alive) return;
    if (![...r.players.values()].every((p) => p.downed)) return;
    r.boss.hp = r.boss.maxHp;
    r.boss.phase = 1;
    r.boss.nextAttackAt = Date.now() + 3000;
    r.pending = [];
    r.contributors.clear();
    ctx.emit('party_wiped', roomId, { bossMaxHp: r.boss.maxHp });
    for (const [id, p] of r.players) {
      p.downed = false;
      p.hp = Math.round(p.maxHp / 2);
      ctx.emit('player_revived', roomId, { playerId: id, hp: p.hp });
    }
  }

  const service: Service & { rooms: Map<string, Room> } = {
    name: 'combat',
    topics: ['commands', 'lobby', 'world'],
    tickMs: 250,
    rooms,
    handle(topic, env, ctx) {
      const roomId = env.roomId;

      if (topic === 'lobby') {
        const p = env.payload;
        if (env.type === 'room_joined') roomOf(roomId).players.set(p.playerId, newPlayer(p.classId));
        else if (env.type === 'class_selected') {
          const pl = rooms.get(roomId)?.players.get(p.playerId);
          if (pl) Object.assign(pl, newPlayer(p.classId));
        } else if (env.type === 'room_left') {
          const r = rooms.get(roomId);
          r?.players.delete(p.playerId);
          if (r && !r.players.size) rooms.delete(roomId);
          else if (r) checkWipe(roomId, r, ctx);
        } else if (env.type === 'game_started') {
          const r = roomOf(roomId);
          r.started = true;
          r.boss = { hp: p.bossMaxHp, maxHp: p.bossMaxHp, phase: 1, alive: true, nextAttackAt: 0 };
          r.pending = [];
          r.contributors.clear();
          for (const [id, m] of r.players) {
            const cls = (p.players as { id: string; classId: ClassId }[]).find((x) => x.id === id)?.classId ?? m.classId;
            Object.assign(m, newPlayer(cls));
          }
        }
        return;
      }

      if (topic === 'world') {
        const pl = rooms.get(roomId)?.players.get(env.payload.playerId);
        if (!pl) return;
        if (env.type === 'player_moved') Object.assign(pl, { x: env.payload.x, y: env.payload.y, scene: env.payload.scene });
        else if (env.type === 'scene_entered')
          Object.assign(pl, { x: env.payload.x, y: env.payload.y, scene: env.payload.sceneId });
        return;
      }

      const r = rooms.get(roomId);
      const pid = env.playerId;
      const me = pid ? r?.players.get(pid) : undefined;
      if (!r || !pid || !me || !r.started) return;
      const now = Date.now();

      if (env.type === 'use_attack') {
        const a = env.payload as CommandPayloads['use_attack'];
        const cls = CLASSES[me.classId];
        if (me.downed || me.scene !== 'cave' || !r.boss.alive) return;
        if (now - me.lastAttack < cls.cooldownMs * 0.9) return;
        me.lastAttack = now;
        const b = MOVE_BOUNDS.cave;
        const x = clampPos(a?.x, b.minX, b.maxX);
        const y = clampPos(a?.y, b.minY, b.maxY);
        const dir = a?.dir ?? 'up';
        ctx.emit('attack_used', roomId, { playerId: pid, classId: me.classId, x, y, dir }, { playerId: pid });
        const inRange = dist(x, y, BOSS.x, BOSS.y) <= cls.range + BOSS.hitRadius;
        if (me.classId === 'mage' || me.classId === 'archer') {
          ctx.emit(
            'projectile_spawned',
            roomId,
            {
              projectileId: newId(),
              ownerId: pid,
              type: me.classId === 'mage' ? 'bolt' : 'arrow',
              x,
              y,
              toX: inRange ? BOSS.x : x + (dir === 'left' ? -cls.range : dir === 'right' ? cls.range : 0),
              toY: inRange ? BOSS.y : y + (dir === 'up' ? -cls.range : dir === 'down' ? cls.range : 0),
            },
            { playerId: pid },
          );
        }
        if (!inRange) return;
        r.boss.hp = Math.max(0, r.boss.hp - cls.damage);
        r.contributors.add(pid);
        ctx.emit(
          'boss_damaged',
          roomId,
          { attackerId: pid, damage: cls.damage, hp: r.boss.hp, maxHp: r.boss.maxHp },
          { playerId: pid },
        );
        if (r.boss.hp <= 0) {
          r.boss.alive = false;
          r.pending = [];
          ctx.emit('boss_defeated', roomId, { contributors: [...r.contributors] });
        } else if (r.boss.phase === 1 && r.boss.hp / r.boss.maxHp <= BOSS.phase2At) {
          r.boss.phase = 2;
          ctx.emit('boss_phase_changed', roomId, { phase: 2 });
        }
      } else if (env.type === 'heal_player') {
        const h = env.payload as CommandPayloads['heal_player'];
        if (me.classId !== 'healer' || me.downed) return;
        if (now - me.lastHeal < HEAL.cooldownMs * 0.9) return;
        const targetId = h?.targetId && r.players.has(h.targetId) ? h.targetId : pid;
        const target = r.players.get(targetId)!;
        if (target.scene !== me.scene) return;
        if (targetId !== pid && dist(clampPos(h.x, 0, 700), clampPos(h.y, 0, 500), target.x, target.y) > HEAL.range + 40)
          return ctx.reject(env, 'combat', 'target_out_of_range');
        if (target.downed) {
          me.lastHeal = now;
          target.downed = false;
          target.hp = Math.round(target.maxHp / 2);
          ctx.emit('player_revived', roomId, { playerId: targetId, hp: target.hp }, { playerId: pid });
          return;
        }
        if (target.hp >= target.maxHp) return;
        me.lastHeal = now;
        const amount = Math.min(HEAL.amount, target.maxHp - target.hp);
        target.hp += amount;
        ctx.emit('player_healed', roomId, { playerId: targetId, healerId: pid, amount, hp: target.hp }, { playerId: pid });
      }
    },

    tick(ctx, now) {
      for (const [roomId, r] of rooms) {
        if (!r.started) continue;

        for (const [id, p] of r.players) {
          if (p.downed && now - p.downedAt >= BOSS.reviveAfterMs) {
            p.downed = false;
            p.hp = Math.round(p.maxHp / 2);
            ctx.emit('player_revived', roomId, { playerId: id, hp: p.hp });
          }
        }

        const inCave = [...r.players].filter(([, p]) => p.scene === 'cave' && !p.downed);
        if (!r.boss.alive) continue;
        if (!inCave.length) {
          r.boss.nextAttackAt = now + 2500;
          continue;
        }

        if (now >= r.boss.nextAttackAt) {
          const idx = r.boss.phase - 1;
          for (let i = 0; i < r.boss.phase; i++) {
            const [, target] = inCave[Math.floor(Math.random() * inCave.length)];
            const atk: PendingAttack = {
              id: newId(),
              x: target.x + (Math.random() - 0.5) * 20,
              y: target.y + (Math.random() - 0.5) * 20,
              radius: BOSS.radius[idx],
              damage: BOSS.damage[idx],
              at: now + BOSS.telegraphMs,
            };
            r.pending.push(atk);
            ctx.emit('boss_attacked', roomId, {
              attackId: atk.id,
              x: Math.round(atk.x),
              y: Math.round(atk.y),
              radius: atk.radius,
              delayMs: BOSS.telegraphMs,
            });
          }
          r.boss.nextAttackAt = now + BOSS.attackIntervalMs[idx];
        }

        const due = r.pending.filter((a) => a.at <= now);
        r.pending = r.pending.filter((a) => a.at > now);
        for (const atk of due) {
          for (const [id, p] of r.players) {
            if (p.scene !== 'cave' || p.downed || dist(atk.x, atk.y, p.x, p.y) > atk.radius) continue;
            p.hp = Math.max(0, p.hp - atk.damage);
            ctx.emit('player_damaged', roomId, { playerId: id, damage: atk.damage, hp: p.hp, sourceId: 'ice_king' });
            if (p.hp <= 0) down(roomId, r, id, p, ctx, now);
          }
        }
      }
    },
  };
  return service;
}

export { bossMaxHp };
