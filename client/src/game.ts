import Phaser from 'phaser';
import type { Dir, Envelope, NpcId, SceneId } from '../../shared/protocol.js';
import type { PlayerState } from '../../shared/state.js';
import {
  BOSS,
  CAVE_EXIT,
  CLASSES,
  MOVE_BOUNDS,
  NPCS,
  PRESENT_POSITIONS,
  SCENES,
  TOWN_CAVE_ENTRANCE,
} from '../../shared/world.js';
import { command, onEvent, onLive, onSnapshot, store } from './net.js';

const FRAMES: Record<Dir, number> = { down: 0, up: 4, left: 8, right: 12 };
const PRESENT_TEX = ['present1', 'present2', 'present3', 'present4', 'present1'];
const WALK_SEND_MS = 60;

interface PlayerView {
  box: Phaser.GameObjects.Container;
  sprite: Phaser.GameObjects.Sprite;
  label: Phaser.GameObjects.Text;
  bar: Phaser.GameObjects.Graphics;
  tx: number;
  ty: number;
  dir: Dir;
  moving: boolean;
  lastHp: number;
  lastDowned: boolean;
}

const rect = (r: { x: number; y: number; w: number; h: number }, px: number, py: number) =>
  px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;

export class GameScene extends Phaser.Scene {
  private layer: Phaser.GameObjects.GameObject[] = [];
  private views = new Map<string, PlayerView>();
  private sceneId: SceneId = 'town';
  private built = false;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private boss?: Phaser.GameObjects.Sprite;
  private presents = new Map<string, Phaser.GameObjects.Image>();
  private npcViews = new Map<NpcId, Phaser.GameObjects.Container>();
  private hint?: Phaser.GameObjects.Text;
  private transitioning = false;
  private lastSend = 0;
  private wasMoving = false;
  private lastAttack = 0;
  private lastHeal = 0;
  private pendingCollect = new Set<string>();
  private myPos = { x: 0, y: 0, dir: 'down' as Dir };
  private tick = 0;

  constructor() {
    super('game');
  }

  preload() {
    const a = '/assets/';
    this.load.spritesheet('char', a + 'character.png', { frameWidth: 16, frameHeight: 16 });
    this.load.spritesheet('house', a + 'house1.png', { frameWidth: 80, frameHeight: 64 });
    this.load.spritesheet('dungeon', a + 'Dungeon_Tileset.png', { frameWidth: 16, frameHeight: 16 });
    for (const [k, f] of [
      ['v_idle', 'enemies-vampire_idle.png'],
      ['v_move', 'enemies-vampire_movement.png'],
      ['v_attack', 'enemies-vampire_attack.png'],
      ['v_death', 'enemies-vampire_death.png'],
      ['v_hurt', 'enemies-vampire_take_damage.png'],
    ])
      this.load.spritesheet(k, a + f, { frameWidth: 32, frameHeight: 32 });
    for (const [k, f] of [
      ['snow', 'snow-tilemap.png'],
      ['tree', 'main-tree.png'],
      ['stree', 'small-tree.png'],
      ['lamp', 'lamp-post.png'],
      ['fence', 'fence.png'],
      ['sign', 'sign-post.png'],
      ['bench', 'bench.png'],
      ['snowman', 'snowman1.png'],
      ['present1', 'present1.png'],
      ['present2', 'present2.png'],
      ['present3', 'present3.png'],
      ['present4', 'present4.png'],
      ['house2', 'house2.png'],
      ['wreath', 'wreath.png'],
    ])
      this.load.image(k, a + f);
  }

  create() {
    this.keys = this.input.keyboard!.addKeys('W,A,S,D,UP,LEFT,DOWN,RIGHT,SPACE,E,F', false) as Record<
      string,
      Phaser.Input.Keyboard.Key
    >;
    const anim = (key: string, tex: string, rate: number, repeat = -1) =>
      this.anims.create({ key, frames: this.anims.generateFrameNumbers(tex), frameRate: rate, repeat });
    anim('boss_idle', 'v_idle', 6);
    anim('boss_attack', 'v_attack', 18, 0);
    anim('boss_hurt', 'v_hurt', 14, 0);
    anim('boss_death', 'v_death', 10, 0);

    onSnapshot(() => this.maybeRebuild());
    onEvent((e) => this.onGameEvent(e));
    onLive((m) => {
      const v = this.views.get(m.playerId);
      const p = store.state.players[m.playerId];
      if (!p || m.playerId === store.me) return;
      p.x = m.x;
      p.y = m.y;
      p.dir = m.dir;
      p.scene = m.scene;
      if (v && m.scene === this.sceneId) {
        v.tx = m.x;
        v.ty = m.y;
        v.dir = m.dir;
        v.moving = true;
      }
    });
  }

  private mine(): PlayerState | undefined {
    return store.state.players[store.me];
  }

  private maybeRebuild() {
    if (store.state.phase !== 'playing' && store.state.phase !== 'finished') return;
    const me = this.mine();
    const scene = me?.scene ?? 'town';
    if (me) this.myPos = { x: me.x, y: me.y, dir: me.dir };
    this.build(scene);
  }

  private clear() {
    this.layer.forEach((o) => o.destroy());
    this.layer = [];
    this.views.clear();
    this.presents.clear();
    this.npcViews.clear();
    this.boss = undefined;
    this.hint = undefined;
  }

  private track<T extends Phaser.GameObjects.GameObject>(o: T): T {
    this.layer.push(o);
    return o;
  }

  private build(id: SceneId) {
    this.clear();
    this.sceneId = id;
    this.built = true;
    this.transitioning = false;
    const { width, height } = SCENES[id];
    this.cameras.main.setBounds(0, 0, width, height);
    this.cameras.main.setBackgroundColor(id === 'town' ? '#8fb0d8' : '#120b1c');
    if (id === 'town') this.buildTown(width, height);
    else this.buildCave(width, height);
    this.syncPlayers();
    this.refreshPresents();
    this.hint = this.add_text(0, 0, 'E', '#ffe066').setDepth(5000).setVisible(false);
  }

  private add_text(x: number, y: number, s: string, color = '#fff', size = 7) {
    return this.track(
      this.make
        .text({ x, y, text: s, style: { fontFamily: 'monospace', fontSize: `${size}px`, color, stroke: '#000', strokeThickness: 2, resolution: 3 } }, true)
        .setOrigin(0.5),
    );
  }

  private buildTown(w: number, h: number) {
    this.track(this.add_tileSprite(w, h));
    for (const hx of [100, 320, 540]) this.track(this.sprites('house', hx, 112, hx === 320 ? 1 : hx === 100 ? 0 : 2, 0.5, 1));
    for (const [x, y] of [[30, 60], [610, 60], [30, 400], [610, 400], [240, 70], [410, 70]]) this.track(this.sprites('tree', x, y + 40, undefined, 0.5, 1).setDepth(y + 40));
    for (const [x, y] of [[200, 260], [440, 260], [320, 250], [90, 130], [550, 130]]) this.track(this.sprites('lamp', x, y, undefined, 0.5, 1).setDepth(y));
    for (let x = 16; x < 620; x += 48) this.track(this.sprites('fence', x + 24, 436, undefined, 0.5, 1).setDepth(436));
    this.track(this.sprites('bench', 380, 270, undefined, 0.5, 1));
    this.track(this.sprites('stree', 60, 250, undefined, 0.5, 1).setDepth(250));
    this.track(this.sprites('stree', 590, 290, undefined, 0.5, 1).setDepth(290));

    const e = TOWN_CAVE_ENTRANCE;
    const g = this.track(this.add_graphics());
    g.fillStyle(0x120b1c, 1).fillRect(e.x, e.y, e.w, e.h);
    g.fillStyle(0x3b4660, 1).fillRect(e.x - 4, e.y - 6, e.w + 8, 8);
    g.fillStyle(0x3b4660, 1).fillRect(e.x - 4, e.y, 4, e.h);
    g.setDepth(2);
    this.add_text(e.x + e.w / 2 - 6, e.y - 14, 'Ice Cave', '#9fe0ff').setDepth(3000);

    for (const n of NPCS) this.npcViews.set(n.id, this.makeNpc(n));
  }

  private add_tileSprite(w: number, h: number) {
    return this.add.tileSprite(0, 0, w, h, 'snow').setOrigin(0).setDepth(-10);
  }

  private add_graphics() {
    return this.add.graphics();
  }

  private sprites(tex: string, x: number, y: number, frame: number | undefined, ox: number, oy: number) {
    return this.add.sprite(x, y, tex, frame).setOrigin(ox, oy);
  }

  private makeNpc(n: (typeof NPCS)[number]) {
    const c = this.add.container(n.x, n.y).setDepth(n.y);
    if (n.id === 'snowman') c.add(this.add.image(0, 0, 'snowman').setScale(1.3));
    else {
      const s = this.add.sprite(0, 0, 'char', 0).setTint(n.tint);
      if (n.id === 'santa') s.setScale(1.2);
      c.add(s);
    }
    c.add(this.make.text({ x: 0, y: -14, text: n.name, style: { fontFamily: 'monospace', fontSize: '6px', color: '#fff', stroke: '#000', strokeThickness: 2, resolution: 3 } }, false).setOrigin(0.5));
    c.add(this.make.text({ x: 0, y: -20, text: '!', style: { fontFamily: 'monospace', fontSize: '9px', color: '#ffe066', stroke: '#000', strokeThickness: 2, resolution: 3 } }, false).setOrigin(0.5).setName('mark'));
    this.layer.push(c);
    return c;
  }

  private buildCave(w: number, h: number) {
    const cols = Math.ceil(w / 16);
    const rows = Math.ceil(h / 16);
    const floor = [11, 12, 13, 14, 21, 22, 23, 24, 31, 32, 33, 34];
    const rnd = (a: number[], i: number) => a[(i * 7 + 3) % a.length];
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        let f = rnd(floor, r * cols + c);
        if (r === 0) f = rnd([1, 2, 3, 4], c);
        else if (r === 1) f = rnd([41, 42, 43, 44], c);
        else if (c === 0) f = 10;
        else if (c === cols - 1) f = 15;
        else if (r === rows - 1) f = rnd([41, 42, 43, 44], c);
        const t = this.add.image(c * 16, r * 16, 'dungeon', f).setOrigin(0).setTint(0x9fc8ff).setDepth(-10);
        this.layer.push(t);
      }
    for (const tx of [48, 192, 288, 432]) {
      const t = this.add.image(tx, 38, 'dungeon', 90).setDepth(1);
      this.layer.push(t);
      this.tweens.add({ targets: t, alpha: { from: 0.75, to: 1 }, yoyo: true, repeat: -1, duration: 250 + (tx % 5) * 40 });
    }
    const ex = CAVE_EXIT;
    const g = this.add.graphics().setDepth(2);
    g.fillStyle(0xdff3ff, 0.25).fillRect(ex.x, ex.y, ex.w, ex.h);
    this.layer.push(g);
    this.add_text(ex.x + ex.w / 2, ex.y - 8, 'Exit to village', '#9fe0ff').setDepth(3000);

    if (store.state.boss.alive) {
      this.boss = this.add.sprite(BOSS.x, BOSS.y, 'v_idle').setScale(2.4).setTint(0x7fd0ff).setDepth(BOSS.y);
      this.boss.play('boss_idle');
      this.layer.push(this.boss);
      this.layer.push(this.add.ellipse(BOSS.x, BOSS.y + 24, 60, 14, 0x000000, 0.35).setDepth(1));
    }
  }

  private refreshPresents() {
    for (const [, img] of this.presents) img.destroy();
    this.presents.clear();
    if (this.sceneId !== 'cave') return;
    NPCS.forEach((n, i) => {
      if (store.state.presents[n.presentId] !== 'available') return;
      const pos = PRESENT_POSITIONS[n.presentId];
      const img = this.add.image(pos.x, pos.y, PRESENT_TEX[i]).setScale(2).setDepth(pos.y);
      this.tweens.add({ targets: img, y: pos.y - 3, yoyo: true, repeat: -1, duration: 600 });
      this.presents.set(n.presentId, img);
      this.layer.push(img);
    });
  }

  private syncPlayers() {
    for (const p of Object.values(store.state.players)) {
      if (p.scene !== this.sceneId) continue;
      if (!this.views.has(p.id)) this.makeView(p);
    }
    for (const [id, v] of this.views) {
      const p = store.state.players[id];
      if (!p || p.scene !== this.sceneId) {
        v.box.destroy();
        this.views.delete(id);
      }
    }
  }

  private makeView(p: PlayerState) {
    const isMe = p.id === store.me;
    const x = isMe ? this.myPos.x || p.x : p.x;
    const y = isMe ? this.myPos.y || p.y : p.y;
    const sprite = this.add.sprite(0, 0, 'char', FRAMES[p.dir]).setTint(CLASSES[p.classId].color);
    const label = this.make
      .text({ x: 0, y: -14, text: p.name, style: { fontFamily: 'monospace', fontSize: '6px', color: isMe ? '#ffe066' : '#fff', stroke: '#000', strokeThickness: 2, resolution: 3 } }, false)
      .setOrigin(0.5);
    const bar = this.add.graphics();
    const box = this.add.container(x, y, [sprite, label, bar]).setDepth(y);
    this.layer.push(box);
    const v: PlayerView = { box, sprite, label, bar, tx: x, ty: y, dir: p.dir, moving: false, lastHp: -1, lastDowned: false };
    this.views.set(p.id, v);
    if (isMe) {
      this.myPos = { x, y, dir: p.dir };
      this.cameras.main.startFollow(box, true, 0.12, 0.12);
    }
    return v;
  }

  private drawBar(v: PlayerView, p: PlayerState) {
    if (v.lastHp === p.hp && v.lastDowned === p.downed) return;
    v.lastHp = p.hp;
    v.lastDowned = p.downed;
    v.bar.clear();
    v.bar.fillStyle(0x000000, 0.7).fillRect(-8, -10, 16, 3);
    v.bar.fillStyle(p.downed ? 0x777777 : 0xe84a5f, 1).fillRect(-7.5, -9.5, Math.max(0, (15 * p.hp) / p.maxHp), 2);
    v.sprite.setAlpha(p.downed ? 0.45 : 1).setAngle(p.downed ? 90 : 0);
  }

  private float(x: number, y: number, text: string, color: string) {
    const t = this.make
      .text({ x, y, text, style: { fontFamily: 'monospace', fontSize: '9px', color, stroke: '#000', strokeThickness: 2, resolution: 3 } }, true)
      .setOrigin(0.5)
      .setDepth(9000);
    this.tweens.add({ targets: t, y: y - 22, alpha: 0, duration: 800, onComplete: () => t.destroy() });
  }

  private posOf(id: string) {
    const v = this.views.get(id);
    return v ? { x: v.box.x, y: v.box.y } : undefined;
  }

  private onGameEvent(e: Envelope) {
    const p = e.payload;
    switch (e.type) {
      case 'game_started':
        this.myPos = { x: SCENES.town.spawn.x, y: SCENES.town.spawn.y, dir: 'down' };
        this.build('town');
        break;
      case 'room_joined':
      case 'room_left':
        if (this.built) this.syncPlayers();
        break;
      case 'class_selected':
        this.views.get(p.playerId)?.sprite.setTint(CLASSES[p.classId as keyof typeof CLASSES].color);
        break;
      case 'scene_entered':
        if (p.playerId === store.me) {
          this.myPos = { x: p.x, y: p.y, dir: this.myPos.dir };
          this.build(p.sceneId);
        } else if (this.built) {
          this.syncPlayers();
          const v = this.views.get(p.playerId);
          if (v) {
            v.box.setPosition(p.x, p.y);
            v.tx = p.x;
            v.ty = p.y;
          }
        }
        break;
      case 'presents_unlocked':
      case 'present_collected':
      case 'present_returned':
        this.pendingCollect.delete(p.presentId);
        this.refreshPresents();
        if (e.type === 'present_collected') this.float(this.posOf(p.collectedBy)?.x ?? 0, (this.posOf(p.collectedBy)?.y ?? 0) - 10, 'Present!', '#ffe066');
        break;
      case 'quest_started':
        this.updateNpcMarks();
        break;
      case 'quest_completed':
        this.updateNpcMarks();
        break;
      case 'attack_used': {
        const pos = this.posOf(p.playerId) ?? { x: p.x, y: p.y };
        const off = { up: [0, -12], down: [0, 12], left: [-12, 0], right: [12, 0] }[p.dir as Dir];
        if (p.classId === 'warrior' || p.classId === 'healer') {
          const c = this.add.circle(pos.x + off[0], pos.y + off[1], 9, p.classId === 'warrior' ? 0xffffff : 0xffe066, 0.7).setDepth(9000);
          this.tweens.add({ targets: c, scale: 1.8, alpha: 0, duration: 200, onComplete: () => c.destroy() });
        }
        break;
      }
      case 'projectile_spawned': {
        const c = this.add.circle(p.x, p.y, p.type === 'bolt' ? 4 : 2, p.type === 'bolt' ? 0xc59bff : 0xcaff9b).setDepth(9000);
        this.tweens.add({ targets: c, x: p.toX, y: p.toY, duration: 200, onComplete: () => c.destroy() });
        break;
      }
      case 'boss_damaged':
        if (this.boss) {
          this.boss.setTintFill(0xffffff);
          this.time.delayedCall(70, () => this.boss?.setTint(0x7fd0ff));
          this.float(BOSS.x + (Math.random() - 0.5) * 30, BOSS.y - 36, `-${p.damage}`, '#ffffff');
        }
        break;
      case 'boss_phase_changed':
        this.cameras.main.shake(300, 0.01);
        this.boss?.setTint(0xff9fb0);
        this.time.delayedCall(10, () => this.boss?.setTint(0xb4a0ff));
        break;
      case 'boss_attacked': {
        this.boss?.play('boss_attack');
        this.boss?.once('animationcomplete', () => this.boss?.play('boss_idle'));
        const c = this.add.circle(p.x, p.y, p.radius, 0xff3030, 0.12).setStrokeStyle(1, 0xff6060).setDepth(1500);
        this.tweens.add({
          targets: c,
          fillAlpha: 0.5,
          duration: p.delayMs,
          onComplete: () => {
            this.cameras.main.shake(120, 0.004);
            this.tweens.add({ targets: c, alpha: 0, duration: 150, onComplete: () => c.destroy() });
          },
        });
        this.layer.push(c);
        break;
      }
      case 'boss_defeated':
        if (this.boss) {
          this.boss.play('boss_death');
          this.cameras.main.flash(500, 200, 240, 255);
        }
        break;
      case 'party_wiped':
        if (this.boss) this.boss.play('boss_idle');
        break;
      case 'player_damaged': {
        const pos = this.posOf(p.playerId);
        if (pos) this.float(pos.x, pos.y - 14, `-${p.damage}`, '#ff6b6b');
        if (p.playerId === store.me) this.cameras.main.shake(150, 0.006);
        break;
      }
      case 'player_healed': {
        const pos = this.posOf(p.playerId);
        if (pos) this.float(pos.x, pos.y - 14, `+${p.amount}`, '#7dff9a');
        break;
      }
      case 'player_revived': {
        const pos = this.posOf(p.playerId);
        if (pos) this.float(pos.x, pos.y - 14, 'Revived!', '#7dff9a');
        break;
      }
    }
  }

  private updateNpcMarks() {
    for (const n of NPCS) {
      const mark = this.npcViews.get(n.id)?.getByName('mark') as Phaser.GameObjects.Text | undefined;
      if (!mark) continue;
      const q = store.state.quests[n.id];
      const carried = store.state.presents[n.presentId] === 'carried';
      mark.setText(q === 'completed' ? '' : carried ? '?' : q === 'active' ? '...' : '!').setColor(carried ? '#7dff9a' : '#ffe066');
    }
  }

  update(time: number, delta: number) {
    if (!this.built) {
      if (store.state.phase === 'playing') this.maybeRebuild();
      return;
    }
    const me = this.mine();
    this.syncPlayers();
    const dt = delta / 1000;
    this.tick++;

    if (me && !store.spectator) this.controlMe(me, dt, time);
    else if (store.spectator) {
      const first = Object.values(store.state.players)[0];
      const v = first && this.views.get(first.id);
      if (v) this.cameras.main.startFollow(v.box, true, 0.12, 0.12);
    }

    for (const [id, v] of this.views) {
      const p = store.state.players[id];
      if (!p) continue;
      if (id !== store.me) {
        const dx = v.tx - v.box.x;
        const dy = v.ty - v.box.y;
        const d = Math.hypot(dx, dy);
        v.moving = d > 0.5;
        v.box.x += dx * 0.25;
        v.box.y += dy * 0.25;
      }
      v.box.setDepth(v.box.y);
      const frame = FRAMES[v.dir] + (v.moving ? Math.floor(this.tick / 8) % 4 : 0);
      v.sprite.setFrame(frame);
      this.drawBar(v, p);
    }

    if (this.hint) this.updateHint();
  }

  private blocked() {
    return store.uiBlocking || store.state.phase !== 'playing';
  }

  private controlMe(me: PlayerState, dt: number, now: number) {
    const v = this.views.get(store.me);
    if (!v) return;
    const k = this.keys;
    const blocked = this.blocked() || me.downed || this.transitioning;
    let dx = 0;
    let dy = 0;
    if (!blocked) {
      dx = (k.D.isDown || k.RIGHT.isDown ? 1 : 0) - (k.A.isDown || k.LEFT.isDown ? 1 : 0);
      dy = (k.S.isDown || k.DOWN.isDown ? 1 : 0) - (k.W.isDown || k.UP.isDown ? 1 : 0);
    }
    const moving = dx !== 0 || dy !== 0;
    if (moving) {
      const len = Math.hypot(dx, dy);
      const speed = CLASSES[me.classId].speed;
      const b = MOVE_BOUNDS[this.sceneId];
      this.myPos.x = Math.min(b.maxX, Math.max(b.minX, this.myPos.x + (dx / len) * speed * dt));
      this.myPos.y = Math.min(b.maxY, Math.max(b.minY, this.myPos.y + (dy / len) * speed * dt));
      this.myPos.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
    }
    v.box.setPosition(this.myPos.x, this.myPos.y);
    v.dir = this.myPos.dir;
    v.moving = moving;

    if ((moving && now - this.lastSend > WALK_SEND_MS) || (!moving && this.wasMoving)) {
      this.lastSend = now;
      command('move_player', { x: this.myPos.x, y: this.myPos.y, dir: this.myPos.dir, scene: this.sceneId });
    }
    this.wasMoving = moving;
    if (blocked) return;

    if (this.sceneId === 'town' && rect(TOWN_CAVE_ENTRANCE, this.myPos.x, this.myPos.y)) this.changeScene('cave');
    else if (this.sceneId === 'cave' && rect(CAVE_EXIT, this.myPos.x, this.myPos.y)) this.changeScene('town');

    if (this.sceneId === 'cave') {
      for (const [id, img] of this.presents) {
        if (this.pendingCollect.has(id)) continue;
        if (Math.hypot(img.x - this.myPos.x, img.y - this.myPos.y) < 16) {
          this.pendingCollect.add(id);
          this.time.delayedCall(3000, () => this.pendingCollect.delete(id));
          command('collect_present', { presentId: id });
        }
      }
    }

    if (Phaser.Input.Keyboard.JustDown(k.E)) this.interact();
    if (k.SPACE.isDown) this.attack(now);
    if (k.F.isDown) this.heal(now);
  }

  private changeScene(to: SceneId) {
    this.transitioning = true;
    command('enter_scene', { sceneId: to });
    this.time.delayedCall(2500, () => (this.transitioning = false));
  }

  private nearestNpc() {
    if (this.sceneId !== 'town') return undefined;
    let best: (typeof NPCS)[number] | undefined;
    let bd = 34;
    for (const n of NPCS) {
      const d = Math.hypot(n.x - this.myPos.x, n.y - this.myPos.y);
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    return best;
  }

  private updateHint() {
    const n = !this.blocked() ? this.nearestNpc() : undefined;
    this.hint!.setVisible(!!n);
    if (n) this.hint!.setPosition(n.x, n.y + 14).setText('Press E');
    this.updateNpcMarks();
  }

  private interact() {
    const n = this.nearestNpc();
    if (!n) return;
    command('talk_to_npc', { npcId: n.id });
    if (store.state.presents[n.presentId] === 'carried') command('return_present', { presentId: n.presentId, npcId: n.id });
  }

  private attack(now: number) {
    const me = this.mine();
    if (!me || this.sceneId !== 'cave' || !store.state.boss.alive) return;
    const cls = CLASSES[me.classId];
    if (now - this.lastAttack < cls.cooldownMs) return;
    this.lastAttack = now;
    if (me.classId === 'healer') {
      this.heal(now);
      return;
    }
    const d = Math.hypot(this.myPos.x - BOSS.x, this.myPos.y - BOSS.y);
    if (d > cls.range + BOSS.hitRadius) {
      this.float(this.myPos.x, this.myPos.y - 14, 'Too far!', '#ffb86b');
      this.lastAttack = now - cls.cooldownMs + 300;
      return;
    }
    command('use_attack', { x: this.myPos.x, y: this.myPos.y, dir: this.myPos.dir });
  }

  private heal(now: number) {
    const me = this.mine();
    if (!me || me.classId !== 'healer' || me.downed || now - this.lastHeal < 700) return;
    this.lastHeal = now;
    let target: PlayerState | undefined;
    let bd = 1e9;
    for (const p of Object.values(store.state.players)) {
      if (p.scene !== me.scene || p.id === me.id) continue;
      const needs = p.downed || p.hp < p.maxHp;
      const d = Math.hypot(p.x - this.myPos.x, p.y - this.myPos.y);
      if (needs && d < bd && d < 100) {
        bd = d;
        target = p;
      }
    }
    if (!target && me.hp >= me.maxHp) return;
    command('heal_player', { x: this.myPos.x, y: this.myPos.y, targetId: target?.id });
  }
}
