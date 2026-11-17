// Drawing only: the world's state and the current screen in, pixels out. The 1280x720
// playfield is scaled to fit the window and centred, the margin filled with the backdrop
// colour. Sprites are painted once at boot onto offscreen canvases (a glowing ship,
// jagged meteors, sparkle stars, power-up orbs), so a frame is mostly drawImage calls;
// the starfield scrolls in three parallax layers behind them. The HUD shows score,
// combo, wave, lives and the live power-ups; panels carry the title, pause and
// game-over screens.
import { COMBO, FIELD, FONT, LIVES, PALETTE, POWERUPS } from './config.js';
import { KIND_METEOR, KIND_POWERUP, KIND_STAR } from './world.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_OVER = 'over';

const PANEL = { width: 780, top: 150, line: 36, bottom: 76 };

/** Deterministic 0..1 from two numbers, for stable meteor shapes and starfields. */
function hash(a, b) {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function cachedLabel(prefix) {
  let value = -1;
  let text = '';
  return function label(next) {
    if (next !== value) {
      value = next;
      text = prefix + next;
    }
    return text;
  };
}

export function createRenderer(canvas, particles) {
  const context = canvas.getContext('2d');
  const view = { scale: 1, x: 0, y: 0 };
  const scoreLabel = cachedLabel('SCORE ');
  const bestLabel = cachedLabel('BEST ');
  const finalLabel = cachedLabel('SCORE ');
  let time = 0;
  let shakeAmount = 0;
  let flashAmount = 0;

  // ---- Pre-rendered art -------------------------------------------------
  const background = makeCanvas(FIELD.width, FIELD.height);
  (function paintBackground() {
    const bg = background.getContext('2d');
    const sky = bg.createLinearGradient(0, 0, 0, FIELD.height);
    sky.addColorStop(0, '#05020e');
    sky.addColorStop(0.55, '#0d0624');
    sky.addColorStop(0.85, '#170b2e');
    sky.addColorStop(1, '#241040');
    bg.fillStyle = sky;
    bg.fillRect(0, 0, FIELD.width, FIELD.height);
    // Nebula blobs: soft radial washes of violet, teal and magenta.
    const blobs = [
      [300, 150, 320, 'rgba(88, 40, 180, 0.20)'],
      [950, 110, 280, 'rgba(20, 120, 160, 0.16)'],
      [1150, 480, 300, 'rgba(180, 40, 140, 0.13)'],
      [180, 520, 260, 'rgba(60, 30, 140, 0.16)'],
      [640, 330, 380, 'rgba(40, 20, 90, 0.12)'],
    ];
    for (const [x, y, radius, color] of blobs) {
      const wash = bg.createRadialGradient(x, y, 0, x, y, radius);
      wash.addColorStop(0, color);
      wash.addColorStop(1, 'rgba(0,0,0,0)');
      bg.fillStyle = wash;
      bg.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }
    // Horizon glow along the ship's band.
    const horizon = bg.createLinearGradient(0, FIELD.shipY - 90, 0, FIELD.height);
    horizon.addColorStop(0, 'rgba(120, 70, 220, 0)');
    horizon.addColorStop(1, 'rgba(120, 70, 220, 0.16)');
    bg.fillStyle = horizon;
    bg.fillRect(0, FIELD.shipY - 90, FIELD.width, FIELD.height - FIELD.shipY + 90);
  })();

  // Three parallax star layers, fixed positions from a seeded pattern.
  const starLayers = [
    { speed: 10, size: 1.2, alpha: 0.45, stars: [] },
    { speed: 26, size: 1.8, alpha: 0.7, stars: [] },
    { speed: 55, size: 2.6, alpha: 1, stars: [] },
  ];
  starLayers.forEach((layer, layerIndex) => {
    for (let index = 0; index < 46; index += 1) {
      layer.stars.push({
        x: hash(layerIndex + 1, index * 3 + 1) * FIELD.width,
        y: hash(layerIndex + 1, index * 3 + 2) * FIELD.height,
        phase: hash(layerIndex + 1, index * 3 + 3) * Math.PI * 2,
      });
    }
  });

  function paintMeteorSprite(size) {
    const pad = 14;
    const sprite = makeCanvas(size + pad * 2, size + pad * 2);
    const ctx = sprite.getContext('2d');
    const centre = size / 2 + pad;
    const radius = size / 2;
    ctx.save();
    ctx.shadowColor = '#ff5a4e';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    const points = 9;
    for (let index = 0; index <= points; index += 1) {
      const angle = (index / points) * Math.PI * 2;
      const r = radius * (0.74 + hash(size, index) * 0.26);
      const x = centre + Math.cos(angle) * r;
      const y = centre + Math.sin(angle) * r;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = '#4a2320';
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#ff8a7a';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    // Craters.
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    for (let index = 0; index < 3; index += 1) {
      const cx = centre + (hash(size, index + 20) - 0.5) * radius;
      const cy = centre + (hash(size, index + 40) - 0.5) * radius;
      ctx.beginPath();
      ctx.arc(cx, cy, radius * (0.12 + hash(size, index + 60) * 0.1), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    return sprite;
  }
  const meteorSprites = {
    shard: paintMeteorSprite(40),
    rock: paintMeteorSprite(72),
    boulder: paintMeteorSprite(128),
  };
  const meteorSpriteSize = { shard: 68, rock: 100, boulder: 156 };

  const starSprite = (function paintStar() {
    const sprite = makeCanvas(56, 56);
    const ctx = sprite.getContext('2d');
    ctx.save();
    ctx.translate(28, 28);
    ctx.shadowColor = '#ffd94a';
    ctx.shadowBlur = 10;
    ctx.fillStyle = '#ffd94a';
    ctx.beginPath();
    ctx.moveTo(0, -24);
    ctx.quadraticCurveTo(5, -5, 24, 0);
    ctx.quadraticCurveTo(5, 5, 0, 24);
    ctx.quadraticCurveTo(-5, 5, -24, 0);
    ctx.quadraticCurveTo(-5, -5, 0, -24);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#fff7cc';
    ctx.beginPath();
    ctx.arc(0, 0, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return sprite;
  })();

  const orbSprites = {};
  for (const name of Object.keys(POWERUPS)) {
    const def = POWERUPS[name];
    const sprite = makeCanvas(64, 64);
    const ctx = sprite.getContext('2d');
    ctx.save();
    ctx.translate(32, 32);
    ctx.shadowColor = def.color;
    ctx.shadowBlur = 12;
    ctx.fillStyle = '#14092b';
    ctx.beginPath();
    ctx.arc(0, 0, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = def.color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, 22, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = def.color;
    ctx.font = `700 ${def.mark === 'x2' ? 20 : 26}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(def.mark, 0, 1);
    ctx.restore();
    orbSprites[name] = sprite;
  }

  const shipSprite = (function paintShip() {
    const sprite = makeCanvas(110, 84);
    const ctx = sprite.getContext('2d');
    ctx.save();
    ctx.translate(55, 42);
    ctx.shadowColor = '#39e6ff';
    ctx.shadowBlur = 14;
    // Swept wings and nose, pointing up.
    ctx.fillStyle = '#39e6ff';
    ctx.beginPath();
    ctx.moveTo(0, -34);
    ctx.lineTo(10, -6);
    ctx.lineTo(30, 22);
    ctx.lineTo(12, 16);
    ctx.lineTo(6, 28);
    ctx.lineTo(-6, 28);
    ctx.lineTo(-12, 16);
    ctx.lineTo(-30, 22);
    ctx.lineTo(-10, -6);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#eafcff';
    ctx.beginPath();
    ctx.moveTo(0, -26);
    ctx.lineTo(6, -4);
    ctx.lineTo(0, 8);
    ctx.lineTo(-6, -4);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#0b2b3a';
    ctx.beginPath();
    ctx.arc(0, -8, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return sprite;
  })();

  // ---- Frame helpers ----------------------------------------------------
  function resize() {
    const ratio = window.devicePixelRatio || 1;
    const width = Math.round(window.innerWidth * ratio);
    const height = Math.round(window.innerHeight * ratio);
    canvas.width = width;
    canvas.height = height;
    view.scale = Math.min(width / FIELD.width, height / FIELD.height);
    view.x = (width - FIELD.width * view.scale) / 2;
    view.y = (height - FIELD.height * view.scale) / 2;
  }

  const fonts = new Map();
  function text(value, x, y, size, color, align, weight) {
    const key = `${weight || 400}:${size}`;
    if (!fonts.has(key)) fonts.set(key, `${weight || 400} ${size}px ${FONT}`);
    context.font = fonts.get(key);
    context.fillStyle = color;
    context.textAlign = align;
    context.fillText(value, x, y);
  }

  function panelRect(x, y, width, height, radius) {
    context.beginPath();
    if (typeof context.roundRect === 'function') context.roundRect(x, y, width, height, radius);
    else context.rect(x, y, width, height);
  }

  function drawStarfield() {
    for (const layer of starLayers) {
      context.fillStyle = '#ffffff';
      for (const star of layer.stars) {
        const y = (star.y + time * layer.speed) % FIELD.height;
        const twinkle = 0.55 + 0.45 * Math.sin(time * 2 + star.phase);
        context.globalAlpha = layer.alpha * twinkle;
        context.fillRect(star.x, y, layer.size, layer.size);
      }
    }
    context.globalAlpha = 1;
  }

  function drawItems(state) {
    const items = state.items;
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (!item.active) continue;
      if (item.kind === KIND_METEOR) {
        const sprite = meteorSprites[item.sub];
        const box = meteorSpriteSize[item.sub];
        const scale = item.width / (box - 28);
        const drawSize = box * scale;
        context.save();
        context.translate(item.x + item.width / 2, item.y + item.height / 2);
        context.rotate(item.angle);
        context.drawImage(sprite, -drawSize / 2, -drawSize / 2, drawSize, drawSize);
        context.restore();
      } else if (item.kind === KIND_STAR) {
        const pulse = 1 + 0.12 * Math.sin(time * 5 + item.x);
        const size = item.width * 2 * pulse;
        context.save();
        context.globalAlpha = 0.95;
        context.drawImage(starSprite, item.x + item.width / 2 - size / 2, item.y + item.height / 2 - size / 2, size, size);
        context.restore();
      } else if (item.kind === KIND_POWERUP) {
        const bob = Math.sin(time * 3 + item.x) * 3;
        const size = 58;
        context.drawImage(orbSprites[item.sub], item.x + item.width / 2 - size / 2, item.y + item.height / 2 - size / 2 + bob, size, size);
      }
    }
  }

  function drawShip(state) {
    const ship = state.ship;
    if (ship.invulnerable > 0 && Math.floor(ship.invulnerable * 10) % 2 === 0) {
      // Blink while invulnerable: the ship is there, just hard to see.
      context.globalAlpha = 0.35;
    }
    // Engine flame, flickering.
    const flameLength = 20 + Math.sin(time * 31) * 6 + Math.random() * 5;
    context.save();
    context.globalCompositeOperation = 'lighter';
    const flame = context.createLinearGradient(0, ship.y + ship.height - 6, 0, ship.y + ship.height + flameLength);
    flame.addColorStop(0, 'rgba(255, 220, 120, 0.95)');
    flame.addColorStop(0.5, 'rgba(255, 140, 60, 0.7)');
    flame.addColorStop(1, 'rgba(255, 80, 40, 0)');
    context.fillStyle = flame;
    context.beginPath();
    context.moveTo(ship.x + ship.width / 2 - 9, ship.y + ship.height - 4);
    context.lineTo(ship.x + ship.width / 2 + 9, ship.y + ship.height - 4);
    context.lineTo(ship.x + ship.width / 2, ship.y + ship.height + flameLength);
    context.closePath();
    context.fill();
    context.restore();

    context.save();
    context.translate(ship.x + ship.width / 2, ship.y + ship.height / 2);
    context.rotate(ship.tilt);
    context.drawImage(shipSprite, -55, -42, 110, 84);
    context.restore();

    if (state.shield) {
      const pulse = 0.55 + 0.3 * Math.sin(time * 4);
      context.save();
      context.globalAlpha = pulse;
      context.strokeStyle = '#41d9ff';
      context.lineWidth = 3;
      context.beginPath();
      context.arc(ship.x + ship.width / 2, ship.y + ship.height / 2, 52, 0, Math.PI * 2);
      context.stroke();
      context.restore();
    }
    context.globalAlpha = 1;
  }

  function drawHud(state, best) {
    context.textBaseline = 'top';
    text(scoreLabel(state.score), 26, 20, 30, PALETTE.text, 'left', 700);
    const mult = state.combo >= 2 ? 1 + Math.floor(state.combo / COMBO.perStep) : 1;
    if (state.combo >= 2) {
      const comboText = `COMBO x${mult} · ${state.combo}`;
      text(comboText, 26, 56, 20, '#ffd94a', 'left', 700);
      const fraction = Math.max(0, state.comboTimer / COMBO.window);
      context.fillStyle = 'rgba(255, 217, 74, 0.25)';
      context.fillRect(26, 82, 130, 6);
      context.fillStyle = '#ffd94a';
      context.fillRect(26, 82, 130 * fraction, 6);
    }
    text(`WAVE ${state.wave}`, FIELD.width / 2, 20, 26, PALETTE.muted, 'center', 700);
    const livesLabel = 'LIVES';
    text(livesLabel, FIELD.width - 26 - LIVES * 34 - 76, 22, 22, PALETTE.muted, 'right', 700);
    for (let life = 0; life < LIVES; life += 1) {
      const cx = FIELD.width - 26 - (LIVES - life) * 34 + 17;
      context.save();
      context.translate(cx, 34);
      context.scale(0.32, 0.32);
      context.globalAlpha = life < state.lives ? 1 : 0.18;
      context.drawImage(shipSprite, -55, -42, 110, 84);
      context.restore();
    }
    context.globalAlpha = 1;
    text(bestLabel(best), FIELD.width - 26, 58, 18, PALETTE.muted, 'right', 400);

    // Live power-up chips, each with its remaining time.
    const chips = [];
    if (state.shield) chips.push({ label: 'SHIELD', color: POWERUPS.shield.color, fraction: 1 });
    if (state.magnetTimer > 0) chips.push({ label: 'MAGNET', color: POWERUPS.magnet.color, fraction: state.magnetTimer / POWERUPS.magnet.duration });
    if (state.slowTimer > 0) chips.push({ label: 'SLOW-MO', color: POWERUPS.slow.color, fraction: state.slowTimer / POWERUPS.slow.duration });
    if (state.doubleTimer > 0) chips.push({ label: 'DOUBLE x2', color: POWERUPS.double.color, fraction: state.doubleTimer / POWERUPS.double.duration });
    let chipX = 26;
    for (const chip of chips) {
      context.font = `700 16px ${FONT}`;
      const labelWidth = context.measureText(chip.label).width;
      const width = labelWidth + 24;
      panelRect(chipX, 100, width, 26, 13);
      context.fillStyle = 'rgba(21, 11, 40, 0.85)';
      context.fill();
      context.strokeStyle = chip.color;
      context.lineWidth = 1.5;
      context.stroke();
      context.fillStyle = chip.color;
      context.fillRect(chipX + 6, 100 + 22, (width - 12) * Math.max(0, chip.fraction), 3);
      text(chip.label, chipX + width / 2, 105, 16, chip.color, 'center', 700);
      chipX += width + 10;
    }
  }

  function drawPanel(title, lines, prompt, accent) {
    const height = PANEL.top + lines.length * PANEL.line + PANEL.bottom;
    const x = (FIELD.width - PANEL.width) / 2;
    const y = (FIELD.height - height) / 2;
    context.save();
    context.fillStyle = 'rgba(4, 1, 12, 0.55)';
    context.fillRect(0, 0, FIELD.width, FIELD.height);
    panelRect(x, y, PANEL.width, height, 18);
    context.fillStyle = PALETTE.panel;
    context.fill();
    context.strokeStyle = PALETTE.panelEdge;
    context.lineWidth = 2;
    context.stroke();
    context.textBaseline = 'alphabetic';
    const titleGradient = context.createLinearGradient(x, y, x + PANEL.width, y);
    titleGradient.addColorStop(0, '#39e6ff');
    titleGradient.addColorStop(0.5, '#eafcff');
    titleGradient.addColorStop(1, '#ff5ad1');
    context.save();
    context.shadowColor = accent || '#39e6ff';
    context.shadowBlur = 24;
    text(title, FIELD.width / 2, y + 86, 56, '#ffffff', 'center', 800);
    context.restore();
    context.fillStyle = titleGradient;
    context.font = `800 56px ${FONT}`;
    context.textAlign = 'center';
    context.fillText(title, FIELD.width / 2, y + 86);
    for (let index = 0; index < lines.length; index += 1) {
      text(lines[index], FIELD.width / 2, y + PANEL.top + index * PANEL.line, 22, PALETTE.muted, 'center', 400);
    }
    text(prompt, FIELD.width / 2, y + height - 38, 24, '#ffd94a', 'center', 700);
    context.restore();
  }

  const TITLE_LINES = [
    'Pilot your ship through the meteor storm.',
    'Catch stars to build your combo. Close dodges pay extra.',
    'Grab orbs: Shield · Magnet · Slow-Mo · Double Score.',
    'Steer with ← → / A D or the mouse. P pauses, M mutes.',
    '',
  ];
  const PAUSED_LINES = ['The storm is waiting for you.'];
  const OVER_LINES = ['', '', ''];

  /** Advance the starfield, the shake and the flash by `dt` seconds. */
  function update(dt) {
    time += dt;
    if (shakeAmount > 0) shakeAmount = Math.max(0, shakeAmount - 34 * dt * 14);
    if (flashAmount > 0) flashAmount = Math.max(0, flashAmount - 1.6 * dt);
  }

  function shake(amount) {
    shakeAmount = Math.max(shakeAmount, amount);
  }

  function flash(amount) {
    flashAmount = Math.max(flashAmount, amount);
  }

  /** Paint one frame: the field, then the HUD or a panel for the screen the game is on. */
  function draw(state, screen, best, isNewBest) {
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = PALETTE.backdrop;
    context.fillRect(0, 0, canvas.width, canvas.height);
    const shakeX = shakeAmount > 0 ? (Math.random() - 0.5) * shakeAmount : 0;
    const shakeY = shakeAmount > 0 ? (Math.random() - 0.5) * shakeAmount : 0;
    context.setTransform(view.scale, 0, 0, view.scale, view.x + shakeX * view.scale, view.y + shakeY * view.scale);
    context.drawImage(background, 0, 0);
    drawStarfield();
    drawItems(state);
    if (screen !== SCREEN_TITLE) drawShip(state);
    else {
      // The title screen's ship idles at the centre of the field, engine lit.
      const idle = { ...state.ship, x: (FIELD.width - state.ship.width) / 2 };
      drawShip({ ...state, ship: idle });
    }
    particles.draw(context);
    if (screen === SCREEN_TITLE) {
      TITLE_LINES[4] = bestLabel(best);
      drawPanel('STARFALL', TITLE_LINES, 'Press Space or click to launch');
      return;
    }
    drawHud(state, best);
    if (flashAmount > 0) {
      context.fillStyle = `rgba(255, 60, 50, ${flashAmount * 0.22})`;
      context.fillRect(0, 0, FIELD.width, FIELD.height);
    }
    if (screen === SCREEN_PAUSED) {
      drawPanel('PAUSED', PAUSED_LINES, 'Press P to resume', '#a78bfa');
    } else if (screen === SCREEN_OVER) {
      OVER_LINES[0] = finalLabel(state.score);
      OVER_LINES[1] = bestLabel(best);
      OVER_LINES[2] = isNewBest ? '★ NEW BEST! ★' : '';
      drawPanel('GAME OVER', OVER_LINES, 'Press Space or click to fly again', '#ff5a4e');
    }
  }

  resize();
  window.addEventListener('resize', resize);
  return { draw, update, shake, flash };
}
