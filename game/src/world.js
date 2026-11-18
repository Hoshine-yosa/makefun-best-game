// Starfall's rules and state, with no drawing and no browser in it: the ship, the
// rain of meteors, stars and power-ups, combos, waves, shields and score. step()
// advances one fixed step and returns what happened as bit flags; anything the
// screens should show (a popup, a sound cue) is written to the feed ring, which
// the loop drains. Nothing here allocates after createWorld returns.
import {
  BLACKHOLE,
  BOLT,
  BOSS,
  CHARGE,
  COMBO,
  EBULLET,
  FIELD,
  GUNSHIP,
  LIVES,
  METEOR,
  NEAR_MISS,
  ORE,
  POOL,
  POWERUP,
  POWERUP_ORDER,
  POWERUPS,
  SHIP,
  SHOP,
  STAR,
  THEMES,
  WAVE,
} from './config.js';

export const KIND_METEOR = 0;
export const KIND_STAR = 1;
export const KIND_POWERUP = 2;
export const KIND_BOLT = 3;
export const KIND_BOSS = 4;
export const KIND_GUNSHIP = 5;
export const KIND_EBULLET = 6;
export const KIND_ORE = 7;

export const EVENT_HIT = 1;
export const EVENT_STAR = 2;
export const EVENT_POWERUP = 4;
export const EVENT_OVER = 8;
export const EVENT_NEAR = 16;
export const EVENT_WAVE = 32;
export const EVENT_BLOCKED = 64;
export const EVENT_SHOOT = 128;
export const EVENT_KILL = 256;
export const EVENT_BOSS = 512;
export const EVENT_BOMB = 1024;
export const EVENT_OVERHEAT = 2048;
export const EVENT_HOLE = 4096;
export const EVENT_ORE = 8192;

function overlaps(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/** The ship's collision box is a little smaller than its sprite: grazes feel fair. */
function shipBox(ship) {
  const padX = 10;
  const padY = 6;
  return { x: ship.x + padX, y: ship.y + padY, width: ship.width - padX * 2, height: ship.height - padY * 2 };
}

/** Every meteor kind that actually spawns (the tuning table also holds scalars). */
const METEOR_KINDS = Object.keys(METEOR).filter((kind) => typeof METEOR[kind].interval === 'number');

export function createWorld(random) {
  const ship = { x: 0, y: FIELD.shipY, width: SHIP.width, height: SHIP.height, invulnerable: 0, tilt: 0 };
  const items = [];
  for (let index = 0; index < POOL.items; index += 1) {
    items.push({
      active: false, kind: KIND_METEOR, sub: 'rock',
      x: 0, y: 0, width: 0, height: 0, speed: 0, vx: 0,
      spin: 0, angle: 0, counted: false, nearMissed: false,
      hp: 1, phase: 0, timer: 0, mark: 0, seq: 0,
    });
  }
  const feed = [];
  for (let index = 0; index < POOL.popups; index += 1) {
    feed.push({ active: false, type: '', x: 0, y: 0, text: '', color: '#ffffff' });
  }
  const state = {
    ship, items, feed,
    score: 0, lives: LIVES, wave: 1, elapsed: 0,
    combo: 0, comboTimer: 0,
    shield: false, magnetTimer: 0, slowTimer: 0, doubleTimer: 0,
    spreadTimer: 0, frenzyTimer: 0, fireCooldown: 0,
    meteorTimers: {},
    starTimer: 0, powerTimer: 0, powerIndex: 0,
    boss: null, bossHp: 0, bossMaxHp: 0,
    stats: { stars: 0, near: 0, kills: 0, shots: 0, maxCombo: 0, ore: 0 },
    /** Hit-stop: fixed steps the world stays frozen after a big kill. */
    hitStop: 0,
    /** Slow-mo: seconds of game time left at 0.3x speed (the boss's death). */
    slowmo: 0,
    /** Combo flash: seconds left of the glow when the multiplier tier rises. */
    comboFlash: 0,
    /** Hits taken in the current wave (for the PERFECT WAVE bonus). */
    hitsThisWave: 0,
    /** Consecutive kills since the last hit taken (for the streak bonus). */
    killStreak: 0,
    /** Events raised by helpers that cannot reach step()'s local flags. */
    pendingEvents: 0,
    /** Shop upgrades bought this run: fire rate, extra bolts, magnet radius. */
    upgrades: { fire: 0, spread: 0, magnet: 0 },
    /** One-per-visit shop flags (a life and a shield each visit at most). */
    shopLifeBought: false,
    shopShieldBought: false,
    /** Gunship spawner: time to the next one, and how many this wave may send. */
    gunshipTimer: GUNSHIP.interval,
    gunshipsSpawned: 0,
    /** The black hole: one per wave from wave 3, warned 2s before it opens. */
    hole: { active: false, x: 0, y: 0, age: 0, warned: false, done: false, at: 0 },
    /** Charge shot: 0..1.5 while held; overheat locks the guns for 2s. */
    charge: 0,
    overheat: 0,
    prevFiring: false,
    /** The wave's theme (shower / swarm / patrol / calm / boss). */
    theme: 'shower',
    /** Unique id handed to each bolt, so a piercing bolt never hits one target twice. */
    boltSeq: 0,
  };

  function post(type, x, y, text, color) {
    for (let index = 0; index < feed.length; index += 1) {
      if (!feed[index].active) {
        feed[index].active = true;
        feed[index].type = type;
        feed[index].x = x;
        feed[index].y = y;
        feed[index].text = text;
        feed[index].color = color;
        return;
      }
    }
  }

  function reset() {
    ship.x = (FIELD.width - ship.width) / 2;
    ship.y = FIELD.shipY;
    ship.invulnerable = 0;
    ship.tilt = 0;
    for (const item of items) item.active = false;
    for (const note of feed) note.active = false;
    state.score = 0;
    state.lives = LIVES;
    state.wave = 1;
    state.elapsed = 0;
    state.combo = 0;
    state.comboTimer = 0;
    state.shield = false;
    state.magnetTimer = 0;
    state.slowTimer = 0;
    state.doubleTimer = 0;
    state.spreadTimer = 0;
    state.frenzyTimer = 0;
    state.fireCooldown = 0;
    for (const kind of METEOR_KINDS) state.meteorTimers[kind] = METEOR[kind].interval;
    state.starTimer = STAR.interval;
    state.powerTimer = POWERUPS.magnet.interval;
    state.powerIndex = 0;
    state.boss = null;
    state.bossHp = 0;
    state.bossMaxHp = 0;
    state.hitStop = 0;
    state.slowmo = 0;
    state.comboFlash = 0;
    state.hitsThisWave = 0;
    state.killStreak = 0;
    state.pendingEvents = 0;
    state.upgrades.fire = 0;
    state.upgrades.spread = 0;
    state.upgrades.magnet = 0;
    state.shopLifeBought = false;
    state.shopShieldBought = false;
    state.gunshipTimer = GUNSHIP.interval;
    state.gunshipsSpawned = 0;
    state.hole.active = false;
    state.hole.x = 0;
    state.hole.y = 0;
    state.hole.age = 0;
    state.hole.warned = false;
    state.hole.done = false;
    state.hole.at = 0;
    state.charge = 0;
    state.overheat = 0;
    state.prevFiring = false;
    state.theme = 'shower';
    state.boltSeq = 0;
    state.stats.stars = 0;
    state.stats.near = 0;
    state.stats.kills = 0;
    state.stats.shots = 0;
    state.stats.maxCombo = 0;
    state.stats.ore = 0;
  }

  /** The wave's theme, fixed per wave number so every run plays the same. */
  function themeForWave(wave) {
    if (BOSS.waves.includes(wave)) return 'boss';
    switch ((wave - 1) % 4) {
      case 0: return 'shower';
      case 1: return 'swarm';
      case 2: return wave >= GUNSHIP.unlockWave ? 'patrol' : 'shower';
      default: return 'calm';
    }
  }

  /** The current score multiplier: the combo ladder, doubled while DOUBLE SCORE or FRENZY runs. */
  function multiplier() {
    const ladder = Math.min(COMBO.maxMultiplier, 1 + Math.floor(state.combo / COMBO.perStep));
    return state.doubleTimer > 0 || state.frenzyTimer > 0 ? ladder * 2 : ladder;
  }

  /** The shop catalogue with live levels, costs and buyability for this run. */
  function shopItems() {
    return SHOP.map((def, index) => {
      let level = 0;
      let maxLevel = def.costs.length;
      let cost = def.costs[0];
      let canBuy = false;
      let note = '';
      if (def.id === 'life') {
        level = state.shopLifeBought ? 1 : 0;
        maxLevel = 1;
        canBuy = !state.shopLifeBought && state.lives < 5 && state.score >= cost;
        note = state.lives >= 5 ? 'MAX LIVES' : state.shopLifeBought ? 'BOUGHT' : '';
      } else if (def.id === 'shield') {
        level = state.shopShieldBought ? 1 : 0;
        maxLevel = 1;
        canBuy = !state.shopShieldBought && !state.shield && state.score >= cost;
        note = state.shield ? 'ACTIVE' : state.shopShieldBought ? 'BOUGHT' : '';
      } else {
        level = state.upgrades[def.id];
        cost = def.costs[level];
        canBuy = level < def.costs.length && state.score >= cost;
        note = level >= def.costs.length ? 'MAX' : '';
      }
      return { index, id: def.id, name: def.name, desc: def.desc, cost, level, maxLevel, canBuy, note };
    });
  }

  /** Buy one shop item with score. Returns false when it cannot be bought. */
  function buyUpgrade(index) {
    const item = shopItems()[index];
    if (!item || !item.canBuy) return false;
    state.score -= item.cost;
    if (item.id === 'life') {
      state.lives = Math.min(5, state.lives + 1);
      state.shopLifeBought = true;
    } else if (item.id === 'shield') {
      state.shield = true;
      state.shopShieldBought = true;
    } else {
      state.upgrades[item.id] += 1;
    }
    return true;
  }

  /** A new shop visit: the one-per-visit life and shield are on sale again. */
  function openShop() {
    state.shopLifeBought = false;
    state.shopShieldBought = false;
  }

  /** The gun's cooldown with the RAPID FIRE upgrade (and FRENZY's own speed). */
  function fireCooldown() {
    const base = state.frenzyTimer > 0 ? BOLT.frenzyCooldown : BOLT.cooldown;
    return base * 0.85 ** state.upgrades.fire;
  }

  /** The magnet's reach with the BIG MAGNET upgrade. */
  function magnetRadius() {
    return 280 * 1.5 ** state.upgrades.magnet;
  }

  /** One kill in a row without taking a hit; every 10th pays a bonus. */
  function registerKill(x, y) {
    state.killStreak += 1;
    if (state.killStreak % 10 === 0) {
      const streakBonus = 100 * multiplier();
      state.score += streakBonus;
      post('streak', x, y - 10, `STREAK x${state.killStreak}! +${streakBonus}`, '#ff2a6d');
    }
  }

  function freeItem() {
    for (let index = 0; index < items.length; index += 1) {
      if (!items[index].active) return items[index];
    }
    return null;
  }

  function meteorInterval(kind) {
    const base = METEOR[kind].interval;
    const theme = THEMES[state.theme];
    let scaled = base * 0.92 ** (state.wave - 1);
    if (theme.meteorMul) scaled *= theme.meteorMul;
    if (kind === 'shard' && theme.shardMul) scaled *= theme.shardMul;
    if (kind === 'boulder' && theme.boulderMul) scaled *= theme.boulderMul;
    return Math.max(0.3, scaled);
  }

  function spawnMeteor(kind) {
    const item = freeItem();
    if (item === null) return;
    const def = METEOR[kind];
    const size = random.range(def.minSize, def.maxSize);
    item.active = true;
    item.kind = KIND_METEOR;
    item.sub = kind;
    item.width = size;
    item.height = size;
    item.x = random.range(0, FIELD.width - size);
    item.y = -size;
    item.speed = def.speed + def.speedPerWave * (state.wave - 1) + random.range(0, METEOR.speedJitter);
    item.vx = state.wave >= METEOR.driftWave && random.chance(0.4)
      ? random.pick([-1, 1]) * random.range(0.4, 1) * METEOR.driftSpeed
      : 0;
    item.spin = random.range(-2.4, 2.4);
    item.angle = random.range(0, Math.PI * 2);
    item.counted = false;
    item.nearMissed = false;
    item.hp = def.hp;
    item.phase = random.range(0, Math.PI * 2);
    item.timer = 0;
    item.mark = 0;
    item.seq = 0;
  }

  function spawnShardAt(x, y) {
    const item = freeItem();
    if (item === null) return;
    const size = random.range(METEOR.shard.minSize, METEOR.shard.maxSize);
    item.active = true;
    item.kind = KIND_METEOR;
    item.sub = 'shard';
    item.width = size;
    item.height = size;
    item.x = Math.max(0, Math.min(FIELD.width - size, x));
    item.y = y;
    item.speed = METEOR.shard.speed + random.range(0, 60);
    item.vx = random.pick([-1, 1]) * random.range(40, 90);
    item.spin = random.range(-3, 3);
    item.angle = random.range(0, Math.PI * 2);
    item.counted = false;
    item.nearMissed = false;
    item.hp = 1;
    item.phase = random.range(0, Math.PI * 2);
    item.timer = 0;
    item.mark = 0;
    item.seq = 0;
  }

  function spawnStar() {
    const item = freeItem();
    if (item === null) return;
    item.active = true;
    item.kind = KIND_STAR;
    item.sub = 'star';
    item.width = STAR.size;
    item.height = STAR.size;
    item.x = random.range(0, FIELD.width - STAR.size);
    item.y = -STAR.size;
    item.speed = STAR.speed + STAR.speedPerWave * (state.wave - 1);
    item.vx = 0;
    item.spin = 0;
    item.angle = 0;
    item.counted = false;
    item.nearMissed = false;
    item.hp = 1;
    item.phase = 0;
    item.timer = 0;
    item.mark = 0;
    item.seq = 0;
  }

  function spawnPowerup() {
    const item = freeItem();
    if (item === null) return;
    const name = POWERUP_ORDER[state.powerIndex % POWERUP_ORDER.length];
    state.powerIndex += 1;
    spawnPowerupAt(item, name, random.range(0, FIELD.width - POWERUP.size), -POWERUP.size);
  }

  function spawnPowerupAt(item, name, x, y) {
    item.active = true;
    item.kind = KIND_POWERUP;
    item.sub = name;
    item.width = POWERUP.size;
    item.height = POWERUP.size;
    item.x = x;
    item.y = y;
    item.speed = POWERUP.speed;
    item.vx = 0;
    item.spin = 0;
    item.angle = 0;
    item.counted = false;
    item.nearMissed = false;
    item.hp = 1;
    item.phase = 0;
    item.timer = 0;
    item.mark = 0;
    item.seq = 0;
  }

  function spawnBoss() {
    const item = freeItem();
    if (item === null) return;
    item.active = true;
    item.kind = KIND_BOSS;
    item.sub = 'boss';
    item.width = BOSS.width;
    item.height = BOSS.height;
    item.x = (FIELD.width - BOSS.width) / 2;
    item.y = 80;
    item.speed = 0;
    item.vx = 0;
    item.spin = 0;
    item.angle = 0;
    item.counted = true;
    item.nearMissed = true;
    item.hp = BOSS.hp;
    item.phase = 0;
    item.timer = 0;
    item.mark = 0;
    item.seq = 0;
    state.boss = item;
    state.bossHp = BOSS.hp;
    state.bossMaxHp = BOSS.hp;
  }

  function spawnGunship() {
    const item = freeItem();
    if (item === null) return;
    item.active = true;
    item.kind = KIND_GUNSHIP;
    item.sub = 'gunship';
    item.width = GUNSHIP.width;
    item.height = GUNSHIP.height;
    item.x = random.range(0, FIELD.width - GUNSHIP.width);
    item.y = -GUNSHIP.height;
    item.speed = GUNSHIP.speed + GUNSHIP.speedPerWave * (state.wave - 1);
    item.vx = random.pick([-1, 1]) * random.range(10, 40);
    item.spin = 0;
    item.angle = 0;
    item.counted = true;
    item.nearMissed = true;
    item.hp = GUNSHIP.hp;
    item.phase = random.range(0, Math.PI * 2);
    item.timer = random.range(0.8, GUNSHIP.fireInterval);
    item.mark = 0;
    item.seq = 0;
    state.gunshipsSpawned += 1;
  }

  /** One aimed enemy bullet, fired from (x, y) at the ship's centre. `owner` is the gunship's pool index, so its bullets die with it. */
  function spawnEnemyBullet(x, y, tx, ty, owner) {
    const item = freeItem();
    if (item === null) return;
    const dx = tx - x;
    const dy = ty - y;
    const distance = Math.hypot(dx, dy) || 1;
    item.active = true;
    item.kind = KIND_EBULLET;
    item.sub = 'ebullet';
    item.width = EBULLET.size;
    item.height = EBULLET.size;
    item.x = x - EBULLET.size / 2;
    item.y = y - EBULLET.size / 2;
    item.speed = (dy / distance) * GUNSHIP.bulletSpeed;
    item.vx = (dx / distance) * GUNSHIP.bulletSpeed;
    item.spin = 0;
    item.angle = 0;
    item.counted = true;
    item.nearMissed = true;
    item.hp = 1;
    item.phase = 0;
    item.timer = 0;
    item.mark = 0;
    item.seq = owner;
  }

  /** One ore shard from a shattered boulder: slow, glowing, fades after 6s. */
  function spawnOre(x, y) {
    const item = freeItem();
    if (item === null) return;
    item.active = true;
    item.kind = KIND_ORE;
    item.sub = 'ore';
    item.width = ORE.size;
    item.height = ORE.size;
    item.x = Math.max(0, Math.min(FIELD.width - ORE.size, x));
    item.y = y;
    item.speed = ORE.speed + random.range(0, 30);
    item.vx = random.pick([-1, 1]) * random.range(10, 50);
    item.spin = random.range(-2, 2);
    item.angle = random.range(0, Math.PI * 2);
    item.counted = true;
    item.nearMissed = true;
    item.hp = 1;
    item.phase = random.range(0, Math.PI * 2);
    item.timer = ORE.life;
    item.mark = 0;
    item.seq = 0;
  }

  function killBoss() {
    const boss = state.boss;
    const points = BOSS.killPoints * multiplier();
    state.score += points;
    state.stats.kills += 1;
    // The death lands hard: a brief hit-stop, then a second of slow motion.
    state.hitStop = 6;
    state.slowmo = 1;
    if (boss) {
      post('boss', boss.x + boss.width / 2, boss.y + boss.height / 2, `DREADNOUGHT DOWN +${points}`, '#ff5a4e');
      // It bursts into power-ups.
      const names = [POWERUP_ORDER[state.powerIndex % POWERUP_ORDER.length], POWERUP_ORDER[(state.powerIndex + 1) % POWERUP_ORDER.length], POWERUP_ORDER[(state.powerIndex + 2) % POWERUP_ORDER.length]];
      state.powerIndex += 3;
      for (let index = 0; index < BOSS.dropCount; index += 1) {
        const drop = freeItem();
        if (drop === null) break;
        spawnPowerupAt(drop, names[index], boss.x + 20 + index * 70, boss.y + 40);
      }
      boss.active = false;
    }
    state.boss = null;
    state.bossHp = 0;
  }

  /** A bolt destroyed a meteor: score it, and splitters burst into two shards while boulders burst into three ore shards. A kill refreshes the combo window. Big kills freeze the world for a few steps (hit-stop) and get a bigger popup. */
  function killMeteor(item) {
    const points = METEOR[item.sub].killPoints * multiplier();
    state.score += points;
    state.stats.kills += 1;
    registerKill(item.x + item.width / 2, item.y);
    if (state.combo > 0) state.comboTimer = COMBO.window;
    if (item.sub === 'brute' || item.sub === 'splitter') state.hitStop = 4;
    if (item.sub === 'brute') post('bigkill', item.x + item.width / 2, item.y + item.height / 2, `+${points}`, '#ff9a3d');
    else post('kill', item.x + item.width / 2, item.y + item.height / 2, `+${points}`, '#ff9a3d');
    if (item.sub === 'splitter') {
      spawnShardAt(item.x - 10, item.y);
      spawnShardAt(item.x + item.width - 20, item.y);
    }
    if (item.sub === 'boulder') {
      spawnOre(item.x + item.width / 2 - 24, item.y + item.height / 2);
      spawnOre(item.x + item.width / 2, item.y + item.height / 2 + 10);
      spawnOre(item.x + item.width / 2 + 24, item.y + item.height / 2);
    }
    item.active = false;
  }

  /** A gunship is down: worth 100, and its bullets die with it. */
  function killGunship(item) {
    const points = GUNSHIP.killPoints * multiplier();
    state.score += points;
    state.stats.kills += 1;
    registerKill(item.x + item.width / 2, item.y);
    if (state.combo > 0) state.comboTimer = COMBO.window;
    post('kill', item.x + item.width / 2, item.y + item.height / 2, `GUNSHIP DOWN +${points}`, '#ff5a4e');
    const owner = items.indexOf(item);
    for (let index = 0; index < items.length; index += 1) {
      const bullet = items[index];
      if (bullet.active && bullet.kind === KIND_EBULLET && bullet.seq === owner) bullet.active = false;
    }
    item.active = false;
  }

  /** The black hole ate a meteor: it scores, quietly, with no hit-stop and no shards. */
  function holeKill(item) {
    const points = METEOR[item.sub].killPoints * multiplier();
    state.score += points;
    state.stats.kills += 1;
    registerKill(item.x + item.width / 2, item.y);
    post('hole', item.x + item.width / 2, item.y, `+${points}`, '#b07dff');
    item.active = false;
  }

  /** Fire the ship's guns: one bolt, three while SPREAD SHOT runs, plus one per EXTRA BOLT upgrade, fanned evenly. */
  function fire() {
    const centre = ship.x + ship.width / 2;
    const count = (state.spreadTimer > 0 ? 3 : 1) + state.upgrades.spread;
    let fired = 0;
    for (let i = 0; i < count; i += 1) {
      const vx = count === 1 ? 0 : (i / (count - 1) - 0.5) * 300;
      const bolt = freeItem();
      if (bolt === null) break;
      state.boltSeq += 1;
      bolt.active = true;
      bolt.kind = KIND_BOLT;
      bolt.sub = 'bolt';
      bolt.width = BOLT.width;
      bolt.height = BOLT.height;
      bolt.x = centre - BOLT.width / 2;
      bolt.y = ship.y - 8;
      bolt.speed = -BOLT.speed;
      bolt.vx = vx;
      bolt.spin = 0;
      bolt.angle = 0;
      bolt.counted = true;
      bolt.nearMissed = true;
      bolt.hp = 0;
      bolt.phase = 0;
      bolt.timer = 0;
      bolt.mark = 0;
      bolt.seq = state.boltSeq;
      fired += 1;
    }
    state.stats.shots += fired;
  }

  /** A fully charged shot: one wide bolt that pierces up to three targets for 3 damage each. */
  function firePierce() {
    const bolt = freeItem();
    if (bolt === null) return;
    state.boltSeq += 1;
    bolt.active = true;
    bolt.kind = KIND_BOLT;
    bolt.sub = 'pierce';
    bolt.width = CHARGE.width;
    bolt.height = CHARGE.height;
    bolt.x = ship.x + ship.width / 2 - CHARGE.width / 2;
    bolt.y = ship.y - 8;
    bolt.speed = -BOLT.speed * 1.1;
    bolt.vx = 0;
    bolt.spin = 0;
    bolt.angle = 0;
    bolt.counted = true;
    bolt.nearMissed = true;
    bolt.hp = CHARGE.pierceCount;
    bolt.phase = 0;
    bolt.timer = 0;
    bolt.mark = 0;
    bolt.seq = state.boltSeq;
    state.stats.shots += 1;
    state.fireCooldown = fireCooldown();
  }

  /** The nova bomb: every meteor on screen shatters at once, and the dreadnought takes 5 damage. Cleared meteors score as if shot; splitters still burst into shards. */
  function detonateBomb() {
    let cleared = 0;
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (!item.active || item.kind !== KIND_METEOR) continue;
      killMeteor(item);
      cleared += 1;
    }
    if (state.boss !== null && state.boss.active) {
      state.bossHp -= 5;
      state.boss.hp = state.bossHp;
      if (state.bossHp <= 0) {
        killBoss();
        state.pendingEvents |= EVENT_BOSS;
      }
    }
    post('bomb', ship.x + ship.width / 2, ship.y - 40, `NOVA BOMB!  ${cleared} CLEARED`, '#ff2a6d');
    state.pendingEvents |= EVENT_BOMB;
  }

  function grantPowerup(name) {
    const def = POWERUPS[name];
    if (name === 'shield') state.shield = true;
    else if (name === 'magnet') state.magnetTimer = def.duration;
    else if (name === 'slow') state.slowTimer = def.duration;
    else if (name === 'double') state.doubleTimer = def.duration;
    else if (name === 'spread') state.spreadTimer = def.duration;
    else if (name === 'frenzy') state.frenzyTimer = def.duration;
    else if (name === 'bomb') detonateBomb();
    return def;
  }

  function loseCombo() {
    state.combo = 0;
    state.comboTimer = 0;
  }

  /** The ship takes a hit: the shield eats it, or a life is lost. Returns event flags. */
  function damageShip() {
    state.hitsThisWave += 1;
    state.killStreak = 0;
    if (state.shield) {
      state.shield = false;
      ship.invulnerable = 1;
      post('block', ship.x + ship.width / 2, ship.y - 18, 'SHIELD!', '#41d9ff');
      return EVENT_BLOCKED;
    }
    state.lives -= 1;
    ship.invulnerable = SHIP.invulnerable;
    loseCombo();
    post('hit', ship.x + ship.width / 2, ship.y - 18, 'HIT!', '#ff5a4e');
    if (state.lives === 0) return EVENT_HIT | EVENT_OVER;
    return EVENT_HIT;
  }

  /**
   * One fixed step. `steer` is { direction: -1|0|1, pointerX: number|null, firing: boolean }.
   * With `harmless` set (the title screen's backdrop) things fall but nothing
   * touches the ship and nothing scores.
   */
  function step(dt, steer, harmless) {
    let events = 0;
    // Hit-stop: a big kill freezes the world for a few fixed steps; the
    // renderer and particles keep running, so the freeze reads as impact.
    if (state.hitStop > 0) {
      state.hitStop -= 1;
      return 0;
    }
    // Slow-mo: the boss's death stretches a second of game time to 0.3x.
    // The clock counts real game time, so the slow-mo lasts about a second.
    if (state.slowmo > 0) state.slowmo = Math.max(0, state.slowmo - dt);
    const sdt = state.slowmo > 0 ? dt * 0.3 : dt;
    state.elapsed += sdt;

    const wave = Math.min(WAVE.max, 1 + Math.floor(state.elapsed / WAVE.seconds));
    if (!harmless && wave !== state.wave) {
      // A wave cleared without a single hit pays a PERFECT bonus.
      if (state.hitsThisWave === 0) {
        const perfectBonus = 250 * multiplier();
        state.score += perfectBonus;
        post('perfect', FIELD.width / 2, FIELD.height / 2 - 110, `PERFECT WAVE! +${perfectBonus}`, '#7dffb0');
      }
      state.hitsThisWave = 0;
      state.wave = wave;
      state.theme = themeForWave(wave);
      state.gunshipsSpawned = 0;
      state.gunshipTimer = GUNSHIP.interval;
      // The black hole opens once per wave from wave 3, a few seconds in.
      if (wave >= BLACKHOLE.unlockWave) {
        state.hole.at = state.elapsed + random.range(BLACKHOLE.spawnDelayMin, BLACKHOLE.spawnDelayMax);
        state.hole.done = false;
        state.hole.warned = false;
        state.hole.active = false;
      } else {
        state.hole.at = 0;
        state.hole.active = false;
      }
      const bonus = 50 * wave;
      state.score += bonus;
      events |= EVENT_WAVE;
      post('wave', FIELD.width / 2, FIELD.height / 2 - 60, `WAVE ${wave} — ${THEMES[state.theme].name}`, '#a78bfa');
      post('wave', FIELD.width / 2, FIELD.height / 2 - 20, `+${bonus}`, '#9a8fc0');
      if (BOSS.waves.includes(wave) && state.boss === null) {
        spawnBoss();
        post('boss', FIELD.width / 2, 200, '⚠ DREADNOUGHT INCOMING ⚠', '#ff5a4e');
      }
    }

    // The black hole's schedule: warned 2s before it opens, gone after 8s.
    if (!harmless) {
      if (state.hole.at > 0 && !state.hole.active && !state.hole.done && !state.hole.warned && state.elapsed >= state.hole.at - BLACKHOLE.warnBefore) {
        state.hole.warned = true;
        post('hole', FIELD.width / 2, 200, '⚠ BLACK HOLE DETECTED ⚠', '#b07dff');
        state.pendingEvents |= EVENT_HOLE;
      }
      if (state.hole.at > 0 && !state.hole.active && !state.hole.done && state.elapsed >= state.hole.at) {
        state.hole.active = true;
        state.hole.x = random.range(180, FIELD.width - 180);
        state.hole.y = random.range(140, 420);
        state.hole.age = 0;
        state.hole.done = true;
      }
      if (state.hole.active) {
        state.hole.age += sdt;
        if (state.hole.age >= BLACKHOLE.duration) state.hole.active = false;
      }
    }

    // The ship: keyboard steers at full speed; the pointer is eased toward.
    const target = steer.pointerX === null ? null : Math.max(0, Math.min(FIELD.width - ship.width, steer.pointerX - ship.width / 2));
    const beforeX = ship.x;
    if (target !== null) {
      ship.x += (target - ship.x) * Math.min(1, SHIP.mouseEase * sdt);
    } else {
      ship.x = Math.min(FIELD.width - ship.width, Math.max(0, ship.x + steer.direction * SHIP.speed * sdt));
    }
    const velocity = (ship.x - beforeX) / sdt;
    ship.tilt += (Math.max(-1, Math.min(1, velocity / SHIP.speed)) * 0.32 - ship.tilt) * Math.min(1, 10 * sdt);
    if (ship.invulnerable > 0) ship.invulnerable = Math.max(0, ship.invulnerable - sdt);

    // The black hole drags the ship toward it; touch the horizon and it bites.
    if (state.hole.active && !harmless) {
      const scx = ship.x + ship.width / 2;
      const scy = ship.y + ship.height / 2;
      const hdx = state.hole.x - scx;
      const hdy = state.hole.y - scy;
      const hdist = Math.hypot(hdx, hdy);
      if (hdist < BLACKHOLE.pullRadius && hdist > 1) {
        const pull = 40 + BLACKHOLE.shipPullMax * (1 - hdist / BLACKHOLE.pullRadius);
        ship.x = Math.max(0, Math.min(FIELD.width - ship.width, ship.x + (hdx / hdist) * pull * sdt));
        ship.y = Math.max(FIELD.shipY - 260, Math.min(FIELD.shipY, ship.y + (hdy / hdist) * pull * sdt));
      }
      if (hdist < BLACKHOLE.horizon && ship.invulnerable === 0) {
        events |= damageShip();
        ship.x = Math.max(0, Math.min(FIELD.width - ship.width, ship.x - Math.sign(hdx || 1) * 160));
        ship.y = FIELD.shipY;
      }
    } else if (ship.y < FIELD.shipY) {
      // Eased back down to the flight band once the hole is gone.
      ship.y = Math.min(FIELD.shipY, ship.y + 200 * sdt);
    }

    // Combo window and power-up clocks.
    if (state.comboTimer > 0) {
      state.comboTimer -= sdt;
      if (state.comboTimer <= 0) loseCombo();
    }
    if (state.comboFlash > 0) state.comboFlash = Math.max(0, state.comboFlash - sdt);
    if (state.magnetTimer > 0) state.magnetTimer -= sdt;
    if (state.slowTimer > 0) state.slowTimer -= sdt;
    if (state.doubleTimer > 0) state.doubleTimer -= sdt;
    if (state.spreadTimer > 0) state.spreadTimer -= sdt;
    if (state.frenzyTimer > 0) state.frenzyTimer -= sdt;
    if (state.fireCooldown > 0) state.fireCooldown -= sdt;

    // Charge shot: hold to charge, release to fire. The first 0.35s of a hold
    // still sprays normal bolts, so taps feel the same as before; past that the
    // guns charge instead. A release at 50% or more fires a piercing bolt, a
    // shorter hold fires one normal bolt, and holding a full second past full
    // overheats the gun for two seconds.
    if (state.overheat > 0) {
      state.overheat = Math.max(0, state.overheat - sdt);
      state.charge = 0;
    } else if (!harmless) {
      if (steer.firing) {
        state.charge = Math.min(CHARGE.full + CHARGE.grace + 0.01, state.charge + sdt);
        if (state.charge > CHARGE.full + CHARGE.grace) {
          state.overheat = CHARGE.lockout;
          state.charge = 0;
          state.fireCooldown = CHARGE.lockout;
          post('overheat', ship.x + ship.width / 2, ship.y - 40, 'OVERHEATED!', '#ff5a4e');
          events |= EVENT_OVERHEAT;
        }
      } else if (state.prevFiring) {
        if (state.charge >= CHARGE.full * 0.5) {
          firePierce();
          events |= EVENT_SHOOT;
        } else if (state.charge >= CHARGE.startAt) {
          fire();
          state.fireCooldown = fireCooldown();
          events |= EVENT_SHOOT;
        }
        state.charge = 0;
      }
    }
    state.prevFiring = steer.firing;

    // Hold fire to shoot; FRENZY fires twice as fast. While charging, the
    // normal guns stay quiet.
    if (!harmless && steer.firing && state.overheat <= 0 && state.charge < CHARGE.startAt && state.fireCooldown <= 0) {
      fire();
      state.fireCooldown = fireCooldown();
      events |= EVENT_SHOOT;
    }

    const slowFactor = state.slowTimer > 0 ? 0.5 : 1;
    const box = shipBox(ship);

    // Spawning.
    for (const kind of METEOR_KINDS) {
      if (state.wave < METEOR[kind].unlockWave) continue;
      state.meteorTimers[kind] -= sdt;
      if (state.meteorTimers[kind] <= 0) {
        spawnMeteor(kind);
        state.meteorTimers[kind] += meteorInterval(kind);
      }
    }
    state.starTimer -= sdt;
    if (state.starTimer <= 0) {
      spawnStar();
      const starMul = THEMES[state.theme].starMul || 1;
      state.starTimer += (STAR.interval + random.range(0, STAR.intervalJitter)) * starMul;
    }
    // Gunships: from wave 4, a couple per wave (one more on patrol waves).
    if (!harmless && state.wave >= GUNSHIP.unlockWave) {
      const quota = state.theme === 'patrol' ? GUNSHIP.patrolPerWave : GUNSHIP.perWave;
      if (state.gunshipsSpawned < quota) {
        state.gunshipTimer -= sdt;
        if (state.gunshipTimer <= 0) {
          spawnGunship();
          state.gunshipTimer = state.theme === 'patrol' ? GUNSHIP.patrolInterval : GUNSHIP.interval;
        }
      }
    }
    if (!harmless) {
      state.powerTimer -= sdt;
      if (state.powerTimer <= 0) {
        spawnPowerup();
        const next = POWERUP_ORDER[state.powerIndex % POWERUP_ORDER.length];
        state.powerTimer += POWERUPS[next].interval;
      }
    }

    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (!item.active) continue;

      item.angle += item.spin * sdt;
      // Darts weave across the field as they fall.
      if (item.kind === KIND_METEOR && item.sub === 'dart') {
        item.phase += sdt * 5;
        item.x += Math.sin(item.phase) * 200 * sdt;
      }
      // Weavers sweep wider and slower, a broad sine across the field.
      if (item.kind === KIND_METEOR && item.sub === 'weaver') {
        item.phase += sdt * 3.2;
        item.x += Math.sin(item.phase) * 300 * sdt;
      }
      item.x += item.vx * sdt;
      if (item.x < -item.width) item.x = -item.width;
      if (item.x > FIELD.width) item.x = FIELD.width;

      // A magnet bends nearby stars and ore toward the ship.
      if ((item.kind === KIND_STAR || item.kind === KIND_ORE) && state.magnetTimer > 0) {
        const dx = ship.x + ship.width / 2 - (item.x + item.width / 2);
        const dy = ship.y + ship.height / 2 - (item.y + item.height / 2);
        const distance = Math.hypot(dx, dy);
        const radius = magnetRadius();
        if (distance > 1 && distance < radius) {
          const pull = 520 * (1 - distance / radius);
          item.x += (dx / distance) * pull * sdt;
          item.y += (dy / distance) * pull * sdt;
        }
      }

      item.y += item.speed * slowFactor * sdt;

      // The black hole pulls things in; anything crossing the horizon is eaten.
      if (state.hole.active && !harmless && (item.kind === KIND_METEOR || item.kind === KIND_STAR || item.kind === KIND_POWERUP || item.kind === KIND_ORE || item.kind === KIND_GUNSHIP)) {
        const hdx = state.hole.x - (item.x + item.width / 2);
        const hdy = state.hole.y - (item.y + item.height / 2);
        const hdist = Math.hypot(hdx, hdy);
        if (hdist < BLACKHOLE.pullRadius && hdist > 1) {
          const pull = 60 + 260 * (1 - hdist / BLACKHOLE.pullRadius);
          item.x += (hdx / hdist) * pull * sdt;
          item.y += (hdy / hdist) * pull * sdt;
        }
        if (hdist < BLACKHOLE.horizon) {
          if (item.kind === KIND_METEOR) holeKill(item);
          else if (item.kind === KIND_GUNSHIP) killGunship(item);
          else item.active = false;
          continue;
        }
      }

      // --- Bolts fly up and smash things. A piercing bolt passes through up to
      // three targets for 3 damage each and never hits one target twice. ---
      if (item.kind === KIND_BOLT) {
        if (item.y < -40) {
          item.active = false;
          continue;
        }
        const pierce = item.sub === 'pierce';
        let spent = false;
        for (let j = 0; j < items.length; j += 1) {
          const target = items[j];
          if (!target.active) continue;
          if (target.kind !== KIND_METEOR && target.kind !== KIND_GUNSHIP && target.kind !== KIND_EBULLET) continue;
          if (target.mark === item.seq) continue;
          if (!overlaps(item, target)) continue;
          target.mark = item.seq;
          if (target.kind === KIND_EBULLET) {
            target.active = false;
            state.score += EBULLET.points * multiplier();
          } else if (target.kind === KIND_GUNSHIP) {
            target.hp -= pierce ? CHARGE.pierceDamage : BOLT.damage;
            if (target.hp <= 0) {
              killGunship(target);
              events |= EVENT_KILL;
            }
          } else {
            target.hp -= pierce ? CHARGE.pierceDamage : BOLT.damage;
            if (target.hp <= 0) {
              killMeteor(target);
              events |= EVENT_KILL;
            }
          }
          if (!pierce) {
            item.active = false;
            spent = true;
          } else {
            item.hp -= 1;
            if (item.hp <= 0) {
              item.active = false;
              spent = true;
            }
          }
          break;
        }
        if (!spent && state.boss !== null && state.boss.active && overlaps(item, state.boss)) {
          if (state.boss.mark !== item.seq) {
            state.boss.mark = item.seq;
            state.bossHp -= pierce ? CHARGE.pierceDamage : BOLT.damage;
            state.boss.hp = state.bossHp;
            if (state.bossHp <= 0) {
              killBoss();
              events |= EVENT_BOSS;
            } else {
              events |= EVENT_KILL;
            }
          }
          if (!pierce) {
            item.active = false;
          } else {
            item.hp -= 1;
            if (item.hp <= 0) item.active = false;
          }
        }
        continue;
      }

      // --- The dreadnought hovers at the top, sweeping side to side. ---
      if (item.kind === KIND_BOSS) {
        item.y = 80 + Math.sin(state.elapsed * 0.8) * 22;
        item.x = (FIELD.width - item.width) / 2 + Math.sin(state.elapsed * 0.45) * 380;
        if (!harmless && ship.invulnerable === 0 && overlaps(item, box)) {
          events |= damageShip();
          if (events & EVENT_OVER) break;
        }
        continue;
      }

      // --- Gunships drift down, weaving, and fire aimed shots at the ship. ---
      if (item.kind === KIND_GUNSHIP) {
        item.phase += sdt * 2;
        item.x += Math.sin(item.phase) * 60 * sdt;
        item.timer -= sdt;
        if (item.timer <= 0 && !harmless) {
          spawnEnemyBullet(item.x + item.width / 2, item.y + item.height, ship.x + ship.width / 2, ship.y + ship.height / 2, index);
          item.timer = GUNSHIP.fireInterval;
        }
        if (item.y > FIELD.height + 40) {
          item.active = false;
          continue;
        }
        if (!harmless && ship.invulnerable === 0 && overlaps(item, box)) {
          killGunship(item);
          events |= damageShip() | EVENT_KILL;
          if (events & EVENT_OVER) break;
        }
        continue;
      }

      // --- Enemy bullets: slow red orbs, gone off the field or on impact. ---
      if (item.kind === KIND_EBULLET) {
        if (item.x < -20 || item.x > FIELD.width + 20 || item.y < -20 || item.y > FIELD.height + 20) {
          item.active = false;
          continue;
        }
        if (!harmless && ship.invulnerable === 0 && overlaps(item, box)) {
          item.active = false;
          events |= damageShip();
          if (events & EVENT_OVER) break;
        }
        continue;
      }

      // --- Ore shards: fade after 6s, or pay out when the ship sweeps them up. ---
      if (item.kind === KIND_ORE) {
        item.timer -= sdt;
        if (item.timer <= 0 || item.y > FIELD.height + 40) {
          item.active = false;
          continue;
        }
        if (!harmless && overlaps(item, box)) {
          item.active = false;
          const points = ORE.points * multiplier();
          state.score += points;
          state.stats.ore += 1;
          events |= EVENT_ORE;
          post('ore', item.x + item.width / 2, item.y, `+${points}`, '#41d9ff');
        }
        continue;
      }

      // Passed the ship line: a dodge, or a near miss just beside the ship.
      if (item.kind === KIND_METEOR && !item.counted && item.y > ship.y + ship.height) {
        item.counted = true;
        if (!harmless) {
          const gap = Math.min(
            Math.abs(item.x + item.width - ship.x),
            Math.abs(ship.x + ship.width - item.x),
          );
          if (!item.nearMissed && gap <= NEAR_MISS.margin) {
            item.nearMissed = true;
            state.stats.near += 1;
            const points = NEAR_MISS.points * multiplier();
            state.score += points;
            events |= EVENT_NEAR;
            post('near', ship.x + ship.width / 2, ship.y - 18, `CLOSE! +${points}`, '#7dffb0');
          } else {
            state.score += METEOR[item.sub].dodgePoints * multiplier();
          }
        }
      }

      if (item.y > FIELD.height + 40) {
        item.active = false;
        continue;
      }
      if (harmless || !overlaps(item, box)) continue;

      if (item.kind === KIND_STAR) {
        item.active = false;
        const multBefore = Math.min(COMBO.maxMultiplier, 1 + Math.floor(state.combo / COMBO.perStep));
        state.combo += 1;
        state.stats.stars += 1;
        state.stats.maxCombo = Math.max(state.stats.maxCombo, state.combo);
        state.comboTimer = COMBO.window;
        const multAfter = Math.min(COMBO.maxMultiplier, 1 + Math.floor(state.combo / COMBO.perStep));
        if (multAfter > multBefore) state.comboFlash = 0.5;
        const points = STAR.points * multiplier();
        state.score += points;
        events |= EVENT_STAR;
        post('star', item.x + item.width / 2, item.y, `+${points}`, '#ffd94a');
      } else if (item.kind === KIND_POWERUP) {
        item.active = false;
        const def = grantPowerup(item.sub);
        events |= EVENT_POWERUP;
        post('power', item.x + item.width / 2, item.y, def.label, def.color);
      } else if (ship.invulnerable === 0) {
        item.active = false;
        events |= damageShip();
        if (events & EVENT_OVER) break;
      }
    }
    events |= state.pendingEvents;
    state.pendingEvents = 0;
    return events;
  }

  reset();
  return { state, reset, step, multiplier, shopItems, buyUpgrade, openShop };
}
