import Phaser from 'phaser';
import type { Envelope } from '../../shared/protocol.js';
import { ACHIEVEMENTS, CLASSES, DIALOGUE, MAX_PLAYERS, NPCS } from '../../shared/world.js';
import { CLASS_IDS } from '../../shared/protocol.js';
import { GameScene } from './game.js';
import { command, onEvent, onSnapshot, socket, store } from './net.js';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  pixelArt: true,
  width: 480,
  height: 300,
  backgroundColor: '#0b1426',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [GameScene],
});

if (import.meta.env.DEV) Object.assign(window, { __game: game });

type Screen = 'menu' | 'lobby' | 'game' | 'victory';
let screen: Screen = 'menu';
const show = (s: Screen) => {
  screen = s;
  $('menu').classList.toggle('hidden', s !== 'menu');
  $('lobby').classList.toggle('hidden', s !== 'lobby');
  $('hud').classList.toggle('hidden', s !== 'game' && s !== 'victory');
  $('victory').classList.toggle('hidden', s !== 'victory');
};

const REJECTS: Record<string, string> = {
  room_full: 'That room is full.',
  game_already_started: 'That game already started.',
  only_host_can_start: 'Only the host can start the game.',
  talk_to_npc_first: 'Talk to the villager first.',
  slow_down: 'Slow down a little.',
  quest_not_active: 'This villager has no quest for that present.',
};
const friendly = (r: string) => REJECTS[r] ?? r.replace(/_/g, ' ');

// ---------- menu ----------
const nameInput = $<HTMLInputElement>('name');
nameInput.value = localStorage.getItem('name') ?? '';
const params = new URLSearchParams(location.search);
if (params.get('room')) $<HTMLInputElement>('room').value = params.get('room')!;

if (params.get('spectate')) {
  store.spectator = true;
  store.roomId = params.get('spectate')!;
  socket.emit('spectate', store.roomId);
  show('game');
  $('hud').querySelectorAll('#me,#chat,#help').forEach((e) => e.classList.add('hidden'));
}

$('join').onclick = () => {
  const name = nameInput.value.trim() || 'Player' + Math.floor(Math.random() * 100);
  localStorage.setItem('name', name);
  store.roomId = $<HTMLInputElement>('room').value.trim() || 'xmas';
  $('menuerr').textContent = 'Joining...';
  command('join_room', { name, roomId: store.roomId });
  setTimeout(() => {
    if (screen === 'menu') $('menuerr').textContent = 'No answer from the server yet. Is the broker running?';
  }, 8000);
};

// ---------- lobby ----------
const classesEl = $('classes');
for (const id of CLASS_IDS) {
  const b = document.createElement('button');
  b.className = 'cls';
  b.dataset.id = id;
  b.innerHTML = `<b style="color:#${CLASSES[id].color.toString(16).padStart(6, '0')}">${CLASSES[id].label}</b>${CLASSES[id].blurb}<br>HP ${CLASSES[id].hp}`;
  b.onclick = () => command('select_class', { classId: id });
  classesEl.appendChild(b);
}
$('start').onclick = () => command('start_game');

function renderLobby() {
  const s = store.state;
  const me = s.players[store.me];
  $('roomname').textContent = store.roomId;
  classesEl.querySelectorAll<HTMLElement>('.cls').forEach((b) => b.classList.toggle('sel', b.dataset.id === me?.classId));
  $('plist').innerHTML = Object.values(s.players)
    .map(
      (p) =>
        `<li><span><span class="dot" style="background:#${CLASSES[p.classId].color.toString(16).padStart(6, '0')}"></span>${escapeHtml(p.name)}${p.id === s.hostId ? ' (host)' : ''}${p.id === store.me ? ' (you)' : ''}</span><span>${CLASSES[p.classId].label}</span></li>`,
    )
    .join('');
  const isHost = s.hostId === store.me;
  ($('start') as HTMLButtonElement).disabled = !isHost;
  $('lobbyhint').textContent = isHost
    ? `${Object.keys(s.players).length}/${MAX_PLAYERS} players`
    : 'Waiting for the host to start';
}

// ---------- hud ----------
function renderHud() {
  const s = store.state;
  const me = s.players[store.me];
  if (me) {
    $('mename').textContent = `${me.name} the ${CLASSES[me.classId].label}  ${me.hp}/${me.maxHp}`;
    $('mehp').style.width = `${(100 * me.hp) / me.maxHp}%`;
    $('downed').classList.toggle('hidden', !me.downed);
  }
  const inCave = me?.scene === 'cave' && s.boss.alive;
  $('bossbar').classList.toggle('hidden', !inCave && !store.spectator);
  $('bosshp').style.width = `${(100 * s.boss.hp) / s.boss.maxHp}%`;

  const carried = Object.values(s.presents).filter((p) => p === 'carried').length;
  $('quests').innerHTML =
    (s.boss.alive ? '<li>Defeat the Ice King in the cave</li>' : `<li>Ice King defeated! Carried: ${carried}</li>`) +
    NPCS.map((n) => {
      const q = s.quests[n.id];
      const pr = s.presents[n.presentId];
      const icon = q === 'completed' ? '[x]' : pr === 'carried' ? '[>]' : q === 'active' ? '[~]' : '[ ]';
      return `<li>${icon} ${n.name}${q === 'completed' ? '' : pr === 'carried' ? ' (return it!)' : ''}</li>`;
    }).join('');

  const rows = Object.values(s.players)
    .map((p) => ({ name: p.name, score: s.scores[p.id] ?? 0, ach: s.achievements[p.id]?.length ?? 0 }))
    .sort((a, b) => b.score - a.score);
  $('board').innerHTML = rows.map((r) => `<li>${escapeHtml(r.name)}: ${r.score} pts (${r.ach} ach)</li>`).join('');

  $('chatlog').innerHTML = s.chat
    .slice(-6)
    .map((c) => `<div><b>${escapeHtml(c.name)}:</b> ${escapeHtml(c.text)}</div>`)
    .join('');
}

function toast(text: string, bad = false) {
  const t = document.createElement('div');
  t.className = 'toast' + (bad ? ' bad' : '');
  t.textContent = text;
  $('toasts').appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

// ---------- dialogue ----------
let lines: string[] = [];
let lineIdx = 0;
function openDialogue(who: string, l: string[]) {
  lines = l;
  lineIdx = 0;
  $('dwho').textContent = who;
  $('dtext').textContent = lines[0];
  $('dialogue').classList.remove('hidden');
  store.uiBlocking = true;
}
function advanceDialogue() {
  lineIdx++;
  if (lineIdx >= lines.length) {
    $('dialogue').classList.add('hidden');
    store.uiBlocking = chatInput === document.activeElement;
    return;
  }
  $('dtext').textContent = lines[lineIdx];
}
$('dialogue').onclick = advanceDialogue;

// ---------- chat ----------
const chatInput = $<HTMLInputElement>('chatinput');
chatInput.onfocus = () => (store.uiBlocking = true);
chatInput.onblur = () => (store.uiBlocking = !$('dialogue').classList.contains('hidden'));
window.addEventListener('keydown', (e) => {
  if (screen !== 'game') return;
  if (e.key === 'Enter') {
    if (document.activeElement === chatInput) {
      const text = chatInput.value.trim();
      if (text) command('send_chat_message', { text });
      chatInput.value = '';
      chatInput.blur();
    } else if (!store.spectator) {
      chatInput.focus();
      e.preventDefault();
    }
  } else if (e.key === 'Escape') chatInput.blur();
  else if ((e.key === 'e' || e.key === 'E') && !$('dialogue').classList.contains('hidden')) advanceDialogue();
});

// ---------- events ----------
function refresh() {
  if (screen === 'lobby') renderLobby();
  if (screen === 'game' || screen === 'victory') renderHud();
}

function enterGameIfNeeded() {
  if (screen === 'menu' && store.spectator) return;
  if (store.state.phase === 'playing' && (screen === 'lobby' || screen === 'menu') && store.state.players[store.me]) show('game');
}

onSnapshot(() => refresh());

onEvent((e: Envelope) => {
  const p = e.payload;
  switch (e.type) {
    case 'room_joined':
      if (p.playerId === store.me) {
        show(p.started ? 'game' : 'lobby');
        $('menuerr').textContent = '';
      }
      break;
    case 'game_started':
      if (screen === 'lobby') show('game');
      toast('The Ice King has stolen Christmas! Talk to Santa.');
      break;
    case 'command_rejected':
      if (screen === 'menu') $('menuerr').textContent = friendly(p.reason);
      else if (screen === 'lobby') $('lobbyerr').textContent = friendly(p.reason);
      else toast(friendly(p.reason), true);
      break;
    case 'npc_talked_to': {
      if (p.playerId !== store.me) break;
      const n = NPCS.find((x) => x.id === p.npcId)!;
      const l: string[] = p.lines?.length ? p.lines : DIALOGUE[p.npcId as keyof typeof DIALOGUE].idle;
      openDialogue(n.name, l);
      break;
    }
    case 'quest_started':
      toast(`Quest: ${p.title}`);
      break;
    case 'quest_completed':
      toast(`Quest complete: ${NPCS.find((n) => n.id === p.npcId)?.questTitle ?? p.questId}`);
      break;
    case 'presents_unlocked':
      toast('The presents are free! Collect them in the cave.');
      break;
    case 'boss_defeated':
      toast('The Ice King is defeated!');
      break;
    case 'party_wiped':
      toast('Everyone fell. The Ice King recovers. Try again!', true);
      break;
    case 'boss_phase_changed':
      toast('The Ice King is furious!', true);
      break;
    case 'achievement_unlocked':
      if (p.playerId === store.me) toast(`Achievement: ${ACHIEVEMENTS[p.achievementId]?.title ?? p.achievementId}`);
      break;
    case 'christmas_saved': {
      const s = store.state;
      const mins = Math.floor(p.durationMs / 60000);
      const secs = Math.round((p.durationMs % 60000) / 1000);
      $('vtime').textContent = `Time: ${mins}m ${secs}s`;
      $('vboard').innerHTML = Object.values(s.players)
        .map((pl) => ({ name: pl.name, score: s.scores[pl.id] ?? 0 }))
        .sort((a, b) => b.score - a.score)
        .map((r) => `<li><span>${escapeHtml(r.name)}</span><span>${r.score} pts</span></li>`)
        .join('');
      show('victory');
      break;
    }
  }
  enterGameIfNeeded();
  refresh();
});

socket.on('disconnect', () => toast('Disconnected from server', true));

// ---------- snow ----------
const snow = $<HTMLCanvasElement>('snow');
const ctx = snow.getContext('2d')!;
const flakes = Array.from({ length: 90 }, () => ({ x: Math.random(), y: Math.random(), r: 1 + Math.random() * 2, v: 0.02 + Math.random() * 0.05 }));
function frame() {
  if (snow.width !== innerWidth || snow.height !== innerHeight) {
    snow.width = innerWidth;
    snow.height = innerHeight;
  }
  ctx.clearRect(0, 0, snow.width, snow.height);
  ctx.fillStyle = 'rgba(255,255,255,.8)';
  for (const f of flakes) {
    f.y = (f.y + f.v / 60) % 1;
    f.x = (f.x + Math.sin(f.y * 12) * 0.0004 + 1) % 1;
    ctx.fillRect(f.x * snow.width, f.y * snow.height, f.r, f.r);
  }
  requestAnimationFrame(frame);
}
frame();
