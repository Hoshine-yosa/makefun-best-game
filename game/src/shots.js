// The screenshot scenes behind ?shot=start|play|storm|end. Each one plays the real
// rules forward from a fresh world for a fixed number of steps, steered by a simple
// autopilot (look ahead each way the ship could move, keep clear of meteors, chase
// the lowest star or orb when that is safe), so the frame is what a real game
// looks like and the same seed always gives the same frame. The storm scene runs
// longer, into the later waves, and stages a live combo with two power-ups up,
// the way a good run looks at its busiest.
import { FIELD, METEOR, SHIP, STEP } from './config.js';
import { EVENT_OVER, KIND_METEOR } from './world.js';
import { SCREEN_OVER, SCREEN_PLAY, SCREEN_TITLE } from './render.js';

const START_SECONDS = 5;
const PLAY_SECONDS = 24;
const STORM_SECONDS = 58;
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
  return { direction: best, pointerX: null };
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
    placed += 1;
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
      world.step(STEP, { direction: 0, pointerX: null }, true);
    }
    return { screen: SCREEN_TITLE, best: 0 };
  }
  if (name === 'storm') {
    for (let index = 0; index < STORM_SECONDS / STEP; index += 1) {
      world.step(STEP, autopilot(world.state, HORIZON_GOOD), false);
      if (world.state.lives === 0) break;
    }
    // A good run at its busiest: a live combo, two power-ups running, a full sky.
    world.state.combo = 14;
    world.state.comboTimer = 3.5;
    world.state.magnetTimer = 6;
    world.state.doubleTimer = 8;
    crowdSky(world.state, 5, ['rock', 'shard', 'rock', 'boulder', 'shard']);
    return { screen: SCREEN_PLAY, best: world.state.score };
  }
  const limit = name === 'end' ? END_LIMIT_SECONDS : PLAY_SECONDS;
  const horizon = name === 'end' ? HORIZON_END : HORIZON_GOOD;
  for (let index = 0; index < limit / STEP; index += 1) {
    if (world.step(STEP, autopilot(world.state, horizon), false) & EVENT_OVER) break;
  }
  const over = world.state.lives === 0;
  return { screen: over ? SCREEN_OVER : SCREEN_PLAY, best: world.state.score };
}
