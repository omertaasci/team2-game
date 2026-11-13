import type { Service } from './runtime.js';

export function createChat(): Service {
  const names = new Map<string, Map<string, string>>();
  const last = new Map<string, number>();

  return {
    name: 'chat',
    topics: ['commands', 'lobby'],
    handle(topic, env, ctx) {
      if (topic === 'lobby') {
        if (env.type === 'room_joined') {
          if (!names.has(env.roomId)) names.set(env.roomId, new Map());
          names.get(env.roomId)!.set(env.payload.playerId, env.payload.name);
        } else if (env.type === 'room_left') {
          const room = names.get(env.roomId);
          room?.delete(env.payload.playerId);
          last.delete(env.payload.playerId);
          if (room && !room.size) names.delete(env.roomId);
        }
        return;
      }
      if (env.type !== 'send_chat_message' || !env.playerId) return;
      const name = names.get(env.roomId)?.get(env.playerId);
      if (!name) return;
      const text = String(env.payload?.text ?? '')
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .trim()
        .slice(0, 200);
      if (!text) return;
      const now = Date.now();
      if (now - (last.get(env.playerId) ?? 0) < 400) return ctx.reject(env, 'chat', 'slow_down');
      last.set(env.playerId, now);
      ctx.emit('chat_message_sent', env.roomId, { playerId: env.playerId, name, text }, { playerId: env.playerId });
    },
  };
}
