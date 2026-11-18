// The screenshot scenes behind ?shot=start|play|storm|end. Each one plays the real
// rules forward from a fresh world for a fixed number of steps, steered by a simple
// autopilot (look ahead each way the ship could move, keep clear of meteors, chase
// the lowest star or orb when that is safe) that also holds the trigger down, so the
// frame is what a real game looks like and the same seed always gives the same
// frame. The storm scene runs into wave 5, where the dreadnought arrives, and stages
// a live combo with power-ups up, the way a good run looks at its busiest.
import { BOLT, FIELD, METEOR, POWERUP, SHIP, STEP } from './config.js';
import { EVENT_OVER, KIND_BOLT, KIND_BOSS, KIND_METEOR, KIND_POWERUP, KIND_STAR } from './world.js';
import { SCREEN_OVER, SCREEN_PLAY, SCREEN_TITLE } from './render.js';

const START_SECONDS = 5;
const PLAY_SECONDS = 40;
const STORM_SECONDS = 72;
const END_LIMIT_SECONDS = 600;
/**
 * How far ahead, in seconds, the autopilot checks each way it could move: the
 * play and storm pilots look well ahead and keep their lives; the end scene's
 * looks only a moment ahead, so it is caught out once the storm quickens, as a
 * hurried player is.
 */
const HORIZON_GOOD = 0.7;
const HORIZON_END = 0.25;
const SAMPLE = 1 / 30;
const DIRECTIONS = [0, -1, 1];
/** Extra room, each side, it keeps between the ship and a meteor. */
const MARGIN = 12;

/** Seconds until moving in `direction` (-1, 0, 1) runs the ship into a meteor; Infinity when it never does. */
function timeToHit(state, direction, horizon) {
  const ship = state.ship;
  for (let t = SAMPLE; t <= horizon; t += SAMPLE) {
    const x = Math.min(FIELD.width - ship.width, Math.max(0, ship.x + direction * SHIP.speed * t));
    for (let index = 0; index < state.items.length; index += 1) {
      const item = state.items[index];
      if (!item.active || item.kind !== KIND_METEOR) continue;
      const y = item.y + item.speed * t;
      const itemX = item.x + item.vx * t;
      if (y + item.height > ship.y && y < ship.y + ship.height && itemX < x + ship.width + MARGIN && itemX + item.width > x - MARGIN) return t;
    }
  }
  return Infinity;
}

/** Of the safe ways to move, the one toward the lowest star or orb (or the centre); else the one that is hit last. */
function autopilot(state, horizon) {
  const ship = state.ship;
  let target = null;
  for (let index = 0; index < state.items.length; index += 1) {
    const item = state.items[index];
    if (!item.active || item.kind === KIND_METEOR) continue;
    if (target === null || item.y > target.y) target = item;
  }
  const aim = target === null ? FIELD.width / 2 : target.x + target.width / 2;
  const centre = ship.x + ship.width / 2;
  const wanted = aim > centre + 8 ? 1 : aim < centre - 8 ? -1 : 0;
  let best = wanted;
  let bestTime = timeToHit(state, wanted, horizon);
  for (let index = 0; index < DIRECTIONS.length && bestTime !== Infinity; index += 1) {
    const time = timeToHit(state, DIRECTIONS[index], horizon);
    if (time > bestTime) {
      bestTime = time;
      best = DIRECTIONS[index];
    }
  }
  return { direction: best, pointerX: null, firing: true };
}

/** Fill a few empty item slots with meteors high in the sky, for a crowded frame. */
function crowdSky(state, count, kinds) {
  let placed = 0;
  for (let index = 0; index < state.items.length && placed < count; index += 1) {
    const item = state.items[index];
    if (item.active) continue;
    const kind = kinds[placed % kinds.length];
    const def = METEOR[kind];
    const size = (def.minSize + def.maxSize) / 2;
    item.active = true;
    item.kind = KIND_METEOR;
    item.sub = kind;
    item.width = size;
    item.height = size;
    item.x = ((placed * 271 + 90) % (FIELD.width - size));
    item.y = 40 + placed * 46;
    item.speed = def.speed + def.speedPerWave * (state.wave - 1);
    item.vx = 0;
    item.spin = 0.6;
    item.angle = placed * 0.8;
    item.counted = false;
    item.nearMissed = true;
    item.hp = def.hp;
    item.phase = placed * 0.8;
    placed += 1;
  }
}

/** Stage a few glowing stars in the upper field, for a livelier frame. */
function stageStars(state, count) {
  let placed = 0;
  for (let index = 0; index < state.items.length && placed < count; index += 1) {
    const item = state.items[index];
    if (item.active) continue;
    item.active = true;
    item.kind = KIND_STAR;
    item.sub = 'star';
    item.width = 26;
    item.height = 26;
    item.x = 140 + placed * 330;
    item.y = 110 + placed * 95;
    item.speed = 205;
    item.vx = 0;
    item.spin = 0;
    item.angle = 0;
    item.counted = false;
    item.nearMissed = false;
    item.hp = 1;
    item.phase = 0;
    placed += 1;
  }
}

/** Stage bolts mid-flight above the ship, so the frame shows the guns firing. */
function stageBolts(state, count) {
  let placed = 0;
  for (let index = 0; index < state.items.length && placed < count; index += 1) {
    const item = state.items[index];
    if (item.active) continue;
    item.active = true;
    item.kind = KIND_BOLT;
    item.sub = 'bolt';
    item.width = BOLT.width;
    item.height = BOLT.height;
    item.x = state.ship.x + state.ship.width / 2 - BOLT.width / 2 + (placed - 1) * 56;
    item.y = state.ship.y - 130 - placed * 80;
    item.speed = -BOLT.speed;
    item.vx = 0;
    item.spin = 0;
    item.angle = 0;
    item.counted = true;
    item.nearMissed = true;
    item.hp = 0;
    item.phase = 0;
    placed += 1;
  }
}

/** Stage one power-up orb at a fixed spot, for a livelier frame. */
function stagePowerup(state, name, x, y) {
  for (let index = 0; index < state.items.length; index += 1) {
    const item = state.items[index];
    if (item.active) continue;
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
    return;
  }
}

/** Force a damaged dreadnought into the frame (the sim's own boss may already be dead). */
function stageBoss(state) {
  if (state.boss !== null && state.boss.active) {
    // Pin it to the left of the planet, so the bar never collides with the HUD
    // and the ringed planet stays visible beside it, not behind it.
    state.boss.x = 330;
    state.boss.y = 110;
    state.bossHp = 8;
    state.boss.hp = 8;
    return;
  }
  for (let index = 0; index < state.items.length; index += 1) {
    const item = state.items[index];
    if (item.active) continue;
    item.active = true;
    item.kind = KIND_BOSS;
    item.sub = 'boss';
    item.width = 220;
    item.height = 150;
    item.x = 330;
    item.y = 110;
    item.speed = 0;
    item.vx = 0;
    item.spin = 0;
    item.angle = 0;
    item.counted = true;
    item.nearMissed = true;
    item.hp = 8;
    item.phase = 0;
    state.boss = item;
    state.bossHp = 8;
    state.bossMaxHp = 20;
    return;
  }
}

/**
 * Set `world` to the named scene (start, play, storm or end; any other name is
 * start) and return the screen to draw over it and the best score to show.
 */
export function stageShot(name, world) {
  world.reset();
  if (name !== 'play' && name !== 'storm' && name !== 'end') {
    for (let index = 0; index < START_SECONDS / STEP; index += 1) {
      world.step(STEP, { direction: 0, pointerX: null, firing: false }, true);
    }
    crowdSky(world.state, 4, ['rock', 'shard', 'rock', 'boulder']);
    stageStars(world.state, 3);
    return { screen: SCREEN_TITLE, best: 0 };
  }
  if (name === 'storm') {
    for (let index = 0; index < STORM_SECONDS / STEP; index += 1) {
      world.step(STEP, autopilot(world.state, HORIZON_GOOD), false);
      if (world.state.lives === 0) break;
    }
    // A good run at its busiest: a live combo, power-ups running, a full sky, the boss.
    world.state.combo = 18;
    world.state.comboTimer = 3.5;
    world.state.shield = true;
    world.state.magnetTimer = 6;
    world.state.slowTimer = 5;
    world.state.doubleTimer = 8;
    world.state.spreadTimer = 8;
    world.state.frenzyTimer = 6;
    crowdSky(world.state, 10, ['rock', 'shard', 'dart', 'weaver', 'boulder', 'splitter', 'brute', 'shard', 'rock', 'weaver']);
    stageStars(world.state, 4);
    stageBolts(world.state, 3);
    stagePowerup(world.state, 'bomb', 950, 320);
    stageBoss(world.state);
    return { screen: SCREEN_PLAY, best: world.state.score };
  }
  const limit = name === 'end' ? END_LIMIT_SECONDS : PLAY_SECONDS;
  const horizon = name === 'end' ? HORIZON_END : HORIZON_GOOD;
  for (let index = 0; index < limit / STEP; index += 1) {
    if (world.step(STEP, autopilot(world.state, horizon), false) & EVENT_OVER) break;
  }
  if (name === 'play') {
    world.state.combo = 8;
    world.state.comboTimer = 3;
    world.state.magnetTimer = 6;
    crowdSky(world.state, 4, ['rock', 'shard', 'dart', 'rock']);
    stageStars(world.state, 3);
    stageBolts(world.state, 2);
  }
  if (name === 'end' && world.state.boss !== null) {
    // The boss is gone by the time the panel goes up; a health bar peeking
    // from behind the panel reads as a bug, as does its warning banner.
    world.state.boss.active = false;
    world.state.boss = null;
    world.state.bossHp = 0;
  }
  const over = world.state.lives === 0;
  return { screen: over ? SCREEN_OVER : SCREEN_PLAY, best: world.state.score };
}
