// Starfall's rules and state, with no drawing and no browser in it: the ship, the
// rain of meteors, stars and power-ups, combos, waves, shields and score. step()
// advances one fixed step and returns what happened as bit flags; anything the
// screens should show (a popup, a sound cue) is written to the feed ring, which
// the loop drains. Nothing here allocates after createWorld returns.
import {
  COMBO,
  FIELD,
  LIVES,
  METEOR,
  NEAR_MISS,
  POOL,
  POWERUP,
  POWERUP_ORDER,
  POWERUPS,
  SHIP,
  STAR,
  WAVE,
} from './config.js';

export const KIND_METEOR = 0;
export const KIND_STAR = 1;
export const KIND_POWERUP = 2;

export const EVENT_HIT = 1;
export const EVENT_STAR = 2;
export const EVENT_POWERUP = 4;
export const EVENT_OVER = 8;
export const EVENT_NEAR = 16;
export const EVENT_WAVE = 32;
export const EVENT_BLOCKED = 64;

function overlaps(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/** The ship's collision box is a little smaller than its sprite: grazes feel fair. */
function shipBox(ship) {
  const padX = 10;
  const padY = 6;
  return { x: ship.x + padX, y: ship.y + padY, width: ship.width - padX * 2, height: ship.height - padY * 2 };
}

export function createWorld(random) {
  const ship = { x: 0, y: FIELD.shipY, width: SHIP.width, height: SHIP.height, invulnerable: 0, tilt: 0 };
  const items = [];
  for (let index = 0; index < POOL.items; index += 1) {
    items.push({
      active: false, kind: KIND_METEOR, sub: 'rock',
      x: 0, y: 0, width: 0, height: 0, speed: 0, vx: 0,
      spin: 0, angle: 0, counted: false, nearMissed: false,
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
    meteorTimers: { shard: 0, rock: 0, boulder: 0 },
    starTimer: 0, powerTimer: 0, powerIndex: 0,
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
    state.meteorTimers.shard = METEOR.shard.interval;
    state.meteorTimers.rock = METEOR.rock.interval;
    state.meteorTimers.boulder = METEOR.boulder.interval;
    state.starTimer = STAR.interval;
    state.powerTimer = POWERUPS.magnet.interval;
    state.powerIndex = 0;
  }

  /** The current score multiplier: the combo ladder, doubled while DOUBLE SCORE runs. */
  function multiplier() {
    const ladder = Math.min(COMBO.maxMultiplier, 1 + Math.floor(state.combo / COMBO.perStep));
    return state.doubleTimer > 0 ? ladder * 2 : ladder;
  }

  function freeItem() {
    for (let index = 0; index < items.length; index += 1) {
      if (!items[index].active) return items[index];
    }
    return null;
  }

  function meteorInterval(kind) {
    const base = METEOR[kind].interval;
    const scaled = base * 0.92 ** (state.wave - 1);
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
  }

  function spawnPowerup() {
    const item = freeItem();
    if (item === null) return;
    const name = POWERUP_ORDER[state.powerIndex % POWERUP_ORDER.length];
    state.powerIndex += 1;
    item.active = true;
    item.kind = KIND_POWERUP;
    item.sub = name;
    item.width = POWERUP.size;
    item.height = POWERUP.size;
    item.x = random.range(0, FIELD.width - POWERUP.size);
    item.y = -POWERUP.size;
    item.speed = POWERUP.speed;
    item.vx = 0;
    item.spin = 0;
    item.angle = 0;
    item.counted = false;
    item.nearMissed = false;
  }

  function grantPowerup(name) {
    const def = POWERUPS[name];
    if (name === 'shield') state.shield = true;
    else if (name === 'magnet') state.magnetTimer = def.duration;
    else if (name === 'slow') state.slowTimer = def.duration;
    else if (name === 'double') state.doubleTimer = def.duration;
    return def;
  }

  function loseCombo() {
    state.combo = 0;
    state.comboTimer = 0;
  }

  /**
   * One fixed step. `steer` is { direction: -1|0|1, pointerX: number|null }.
   * With `harmless` set (the title screen's backdrop) things fall but nothing
   * touches the ship and nothing scores.
   */
  function step(dt, steer, harmless) {
    let events = 0;
    state.elapsed += dt;

    const wave = Math.min(WAVE.max, 1 + Math.floor(state.elapsed / WAVE.seconds));
    if (!harmless && wave !== state.wave) {
      state.wave = wave;
      const bonus = 50 * wave;
      state.score += bonus;
      events |= EVENT_WAVE;
      post('wave', FIELD.width / 2, FIELD.height / 2 - 60, `WAVE ${wave}  +${bonus}`, '#a78bfa');
    }

    // The ship: keyboard steers at full speed; the pointer is eased toward.
    const target = steer.pointerX === null ? null : Math.max(0, Math.min(FIELD.width - ship.width, steer.pointerX - ship.width / 2));
    const beforeX = ship.x;
    if (target !== null) {
      ship.x += (target - ship.x) * Math.min(1, SHIP.mouseEase * dt);
    } else {
      ship.x = Math.min(FIELD.width - ship.width, Math.max(0, ship.x + steer.direction * SHIP.speed * dt));
    }
    const velocity = (ship.x - beforeX) / dt;
    ship.tilt += (Math.max(-1, Math.min(1, velocity / SHIP.speed)) * 0.32 - ship.tilt) * Math.min(1, 10 * dt);
    if (ship.invulnerable > 0) ship.invulnerable = Math.max(0, ship.invulnerable - dt);

    // Combo window and power-up clocks.
    if (state.comboTimer > 0) {
      state.comboTimer -= dt;
      if (state.comboTimer <= 0) loseCombo();
    }
    if (state.magnetTimer > 0) state.magnetTimer -= dt;
    if (state.slowTimer > 0) state.slowTimer -= dt;
    if (state.doubleTimer > 0) state.doubleTimer -= dt;

    const slowFactor = state.slowTimer > 0 ? 0.5 : 1;
    const box = shipBox(ship);

    // Spawning.
    for (const kind of ['shard', 'rock', 'boulder']) {
      if (state.wave < METEOR[kind].unlockWave) continue;
      state.meteorTimers[kind] -= dt;
      if (state.meteorTimers[kind] <= 0) {
        spawnMeteor(kind);
        state.meteorTimers[kind] += meteorInterval(kind);
      }
    }
    state.starTimer -= dt;
    if (state.starTimer <= 0) {
      spawnStar();
      state.starTimer += STAR.interval + random.range(0, STAR.intervalJitter);
    }
    if (!harmless) {
      state.powerTimer -= dt;
      if (state.powerTimer <= 0) {
        spawnPowerup();
        const next = POWERUP_ORDER[state.powerIndex % POWERUP_ORDER.length];
        state.powerTimer += POWERUPS[next].interval;
      }
    }

    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (!item.active) continue;

      item.angle += item.spin * dt;
      item.x += item.vx * dt;
      if (item.x < -item.width) item.x = -item.width;
      if (item.x > FIELD.width) item.x = FIELD.width;

      // A magnet bends nearby stars toward the ship.
      if (item.kind === KIND_STAR && state.magnetTimer > 0) {
        const dx = ship.x + ship.width / 2 - (item.x + item.width / 2);
        const dy = ship.y + ship.height / 2 - (item.y + item.height / 2);
        const distance = Math.hypot(dx, dy);
        if (distance > 1 && distance < 280) {
          const pull = 520 * (1 - distance / 280);
          item.x += (dx / distance) * pull * dt;
          item.y += (dy / distance) * pull * dt;
        }
      }

      item.y += item.speed * slowFactor * dt;

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
        state.combo += 1;
        state.comboTimer = COMBO.window;
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
        if (state.shield) {
          state.shield = false;
          ship.invulnerable = 1;
          events |= EVENT_BLOCKED;
          post('block', ship.x + ship.width / 2, ship.y - 18, 'SHIELD!', '#41d9ff');
        } else {
          state.lives -= 1;
          ship.invulnerable = SHIP.invulnerable;
          loseCombo();
          events |= EVENT_HIT;
          post('hit', ship.x + ship.width / 2, ship.y - 18, 'HIT!', '#ff5a4e');
          if (state.lives === 0) {
            events |= EVENT_OVER;
            break;
          }
        }
      }
    }
    return events;
  }

  reset();
  return { state, reset, step, multiplier };
}
