import type { Service } from './runtime.js';

interface Room {
  names: Map<string, string>;
  scores: Map<string, number>;
  dirty: boolean;
  lastFlush: number;
}

export const SCORE = { damagePerHit: 1, heal: 1, collected: 50, returned: 100, questCompleted: 50, victory: 200, downed: -10 };

export function createLeaderboard(): Service {
  const rooms = new Map<string, Room>();
  const roomOf = (id: string) => {
    let r = rooms.get(id);
    if (!r) rooms.set(id, (r = { names: new Map(), scores: new Map(), dirty: false, lastFlush: 0 }));
    return r;
  };
  const add = (r: Room, id: string | undefined, pts: number) => {
    if (!id || !r.names.has(id)) return;
    r.scores.set(id, (r.scores.get(id) ?? 0) + pts);
    r.dirty = true;
  };

  const flush = (roomId: string, r: Room, ctx: Parameters<NonNullable<Service['tick']>>[0], now: number) => {
    r.dirty = false;
    r.lastFlush = now;
    const entries = [...r.names]
      .map(([playerId, name]) => ({ playerId, name, score: Math.max(0, Math.round(r.scores.get(playerId) ?? 0)) }))
      .sort((a, b) => b.score - a.score);
    ctx.emit('leaderboard_updated', roomId, { entries });
  };

  return {
    name: 'leaderboard',
    topics: ['lobby', 'quests', 'presents', 'combat', 'progress'],
    tickMs: 500,
    handle(_topic, env) {
      const p = env.payload;
      switch (env.type) {
        case 'room_joined':
          roomOf(env.roomId).names.set(p.playerId, p.name);
          roomOf(env.roomId).dirty = true;
          break;
        case 'room_left': {
          const r = rooms.get(env.roomId);
          if (!r) break;
          r.names.delete(p.playerId);
          r.scores.delete(p.playerId);
          r.dirty = true;
          if (!r.names.size) rooms.delete(env.roomId);
          break;
        }
        case 'game_started': {
          const r = roomOf(env.roomId);
          r.scores.clear();
          r.dirty = true;
          break;
        }
        case 'boss_damaged':
          add(roomOf(env.roomId), p.attackerId, p.damage * SCORE.damagePerHit);
          break;
        case 'player_healed':
          add(roomOf(env.roomId), p.healerId, p.amount * SCORE.heal);
          break;
        case 'player_downed':
          add(roomOf(env.roomId), p.playerId, SCORE.downed);
          break;
        case 'present_collected':
          add(roomOf(env.roomId), p.collectedBy, SCORE.collected);
          break;
        case 'present_returned':
          add(roomOf(env.roomId), p.returnedBy, SCORE.returned);
          break;
        case 'quest_completed':
          for (const id of p.completedBy) add(roomOf(env.roomId), id, SCORE.questCompleted);
          break;
        case 'christmas_saved': {
          const r = roomOf(env.roomId);
          for (const pl of p.players) add(r, pl.id, SCORE.victory);
          break;
        }
      }
    },
    tick(ctx, now) {
      for (const [roomId, r] of rooms) if (r.dirty && now - r.lastFlush >= 1000) flush(roomId, r, ctx, now);
    },
  };
}
