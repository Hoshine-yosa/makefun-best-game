// Drawing only: the world's state and the current screen in, pixels out. The 1280x720
// playfield is scaled to fit the window and centred, the margin filled with the backdrop
// colour. Sprites are painted once at boot onto offscreen canvases (a glowing ship,
// jagged meteors, sparkle stars, power-up orbs, the dreadnought), so a frame is mostly
// drawImage calls; the starfield scrolls in three parallax layers behind them. The HUD
// shows score, combo, wave, lives and the live power-ups; panels carry the title,
// pause and game-over screens.
import { CHARGE, COMBO, FIELD, FONT, LIVES, PALETTE, POWERUPS, SHOP, THEMES, WAVE } from './config.js';
import { KIND_BOLT, KIND_BOSS, KIND_EBULLET, KIND_GUNSHIP, KIND_METEOR, KIND_ORE, KIND_POWERUP, KIND_STAR } from './world.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_OVER = 'over';
export const SCREEN_SHOP = 'shop';

/** The shop panel's geometry: drawShop and shopHit share it, so a click buys what is drawn. */
const SHOP_PANEL = { width: 860, top: 150 };
const SHOP_ROW = { height: 56, gap: 8, top: 0 };
const SHOP_CONTINUE = { width: 300, height: 46 };

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
    // Nebula blobs: big soft radial washes of violet, teal, magenta and ember.
    const blobs = [
      [300, 150, 340, 'rgba(96, 44, 200, 0.30)'],
      [950, 110, 300, 'rgba(24, 130, 180, 0.24)'],
      [1150, 480, 320, 'rgba(200, 44, 150, 0.20)'],
      [180, 520, 280, 'rgba(70, 34, 160, 0.24)'],
      [640, 330, 400, 'rgba(44, 22, 100, 0.18)'],
      [700, 80, 260, 'rgba(160, 40, 120, 0.16)'],
      [60, 300, 240, 'rgba(20, 90, 140, 0.18)'],
      [1150, 200, 220, 'rgba(220, 90, 60, 0.12)'],
    ];
    for (const [x, y, radius, color] of blobs) {
      const wash = bg.createRadialGradient(x, y, 0, x, y, radius);
      wash.addColorStop(0, color);
      wash.addColorStop(1, 'rgba(0,0,0,0)');
      bg.fillStyle = wash;
      bg.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }
    // A blazing sun low on the left.
    const sun = bg.createRadialGradient(170, 100, 0, 170, 100, 140);
    sun.addColorStop(0, 'rgba(255, 250, 220, 0.9)');
    sun.addColorStop(0.25, 'rgba(255, 220, 130, 0.45)');
    sun.addColorStop(1, 'rgba(255, 180, 80, 0)');
    bg.fillStyle = sun;
    bg.fillRect(30, -40, 280, 280);
    // A ringed planet high on the right.
    const px = 1020;
    const py = 118;
    const pr = 56;
    const planet = bg.createRadialGradient(px - 18, py - 18, 8, px, py, pr);
    planet.addColorStop(0, '#f0d49a');
    planet.addColorStop(0.6, '#c08a4a');
    planet.addColorStop(1, '#7a4a28');
    bg.fillStyle = planet;
    bg.beginPath();
    bg.arc(px, py, pr, 0, Math.PI * 2);
    bg.fill();
    bg.save();
    bg.translate(px, py);
    bg.rotate(-0.4);
    bg.strokeStyle = 'rgba(216, 184, 120, 0.75)';
    bg.lineWidth = 7;
    bg.beginPath();
    bg.ellipse(0, 0, pr * 1.7, pr * 0.42, 0, 0, Math.PI * 2);
    bg.stroke();
    bg.restore();
    // Horizon glow along the ship's band.
    const horizon = bg.createLinearGradient(0, FIELD.shipY - 90, 0, FIELD.height);
    horizon.addColorStop(0, 'rgba(120, 70, 220, 0)');
    horizon.addColorStop(1, 'rgba(120, 70, 220, 0.24)');
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
    for (let index = 0; index < 80; index += 1) {
      layer.stars.push({
        x: hash(layerIndex + 1, index * 3 + 1) * FIELD.width,
        y: hash(layerIndex + 1, index * 3 + 2) * FIELD.height,
        phase: hash(layerIndex + 1, index * 3 + 3) * Math.PI * 2,
      });
    }
  });
  // A few big sparkle stars with a cross flare.
  const bigStars = [];
  for (let index = 0; index < 7; index += 1) {
    bigStars.push({
      x: hash(7, index * 5 + 1) * FIELD.width,
      y: hash(7, index * 5 + 2) * (FIELD.height - 120) + 40,
      size: 3.5 + hash(7, index * 5 + 3) * 2.5,
      phase: hash(7, index * 5 + 4) * Math.PI * 2,
    });
  }

  function paintRockSprite(size, fill, edge, glow) {
    const pad = 14;
    const sprite = makeCanvas(size + pad * 2, size + pad * 2);
    const ctx = sprite.getContext('2d');
    const centre = size / 2 + pad;
    const radius = size / 2;
    ctx.save();
    ctx.shadowColor = glow;
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
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = edge;
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

  function paintDartSprite(size) {
    const pad = 12;
    const sprite = makeCanvas(size + pad * 2, size + pad * 2);
    const ctx = sprite.getContext('2d');
    ctx.save();
    ctx.translate(size / 2 + pad, size / 2 + pad);
    ctx.shadowColor = '#ffb347';
    ctx.shadowBlur = 12;
    ctx.fillStyle = '#5a2a08';
    ctx.beginPath();
    ctx.moveTo(0, -size / 2);
    ctx.lineTo(size * 0.32, size * 0.1);
    ctx.lineTo(size * 0.5, size * 0.42);
    ctx.lineTo(0, size * 0.2);
    ctx.lineTo(-size * 0.5, size * 0.42);
    ctx.lineTo(-size * 0.32, size * 0.1);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#ffb347';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.fillStyle = '#ffe9b0';
    ctx.beginPath();
    ctx.arc(0, -size * 0.12, size * 0.07, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return sprite;
  }

  const bossSprite = (function paintBoss() {
    const sprite = makeCanvas(280, 220);
    const ctx = sprite.getContext('2d');
    const cx = 140;
    const cy = 110;
    ctx.save();
    ctx.shadowColor = '#ff2a3d';
    ctx.shadowBlur = 24;
    ctx.beginPath();
    const points = 13;
    for (let i = 0; i <= points; i += 1) {
      const angle = (i / points) * Math.PI * 2;
      const r = 95 * (0.72 + hash(999, i) * 0.28);
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r * 0.78;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = '#3a1420';
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#ff6a5a';
    ctx.lineWidth = 4;
    ctx.stroke();
    const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, 44);
    core.addColorStop(0, 'rgba(255, 240, 200, 0.95)');
    core.addColorStop(0.4, 'rgba(255, 90, 60, 0.8)');
    core.addColorStop(1, 'rgba(255, 40, 40, 0)');
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(cx, cy, 44, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    for (let i = 0; i < 5; i += 1) {
      ctx.beginPath();
      ctx.arc(cx + (hash(999, i + 30) - 0.5) * 130, cy + (hash(999, i + 50) - 0.5) * 90, 10 + hash(999, i + 70) * 12, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    return sprite;
  })();

  const meteorSprites = {
    shard: paintRockSprite(40, '#5a2a18', '#ff9a5a', '#ff7a3d'),
    rock: paintRockSprite(72, '#4a2320', '#ff8a7a', '#ff5a4e'),
    boulder: paintRockSprite(128, '#3a1a30', '#ff6a9a', '#e04080'),
    dart: paintDartSprite(44),
    brute: paintRockSprite(132, '#2a1a3a', '#b07dff', '#8a5aff'),
    splitter: paintRockSprite(76, '#1a3a24', '#7dffb0', '#41d97d'),
    weaver: paintRockSprite(56, '#0a3a3a', '#5affd9', '#2affc9'),
  };
  const meteorSpriteSize = { shard: 68, rock: 100, boulder: 156, dart: 68, brute: 160, splitter: 104, weaver: 84 };

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

  const gunshipSprite = (function paintGunship() {
    const sprite = makeCanvas(96, 72);
    const ctx = sprite.getContext('2d');
    ctx.save();
    ctx.translate(48, 36);
    ctx.shadowColor = '#ff2a3d';
    ctx.shadowBlur = 12;
    // A sleek angular hull, pointing down at the player, with red running lights.
    ctx.fillStyle = '#2a1218';
    ctx.beginPath();
    ctx.moveTo(0, 30);
    ctx.lineTo(14, 6);
    ctx.lineTo(38, -14);
    ctx.lineTo(16, -20);
    ctx.lineTo(8, -28);
    ctx.lineTo(-8, -28);
    ctx.lineTo(-16, -20);
    ctx.lineTo(-38, -14);
    ctx.lineTo(-14, 6);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#ff5a4e';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.fillStyle = '#ff2a3d';
    ctx.beginPath();
    ctx.arc(0, 8, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ff8a7a';
    ctx.beginPath();
    ctx.arc(-26, -12, 3.5, 0, Math.PI * 2);
    ctx.arc(26, -12, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return sprite;
  })();

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
    for (const star of bigStars) {
      const twinkle = 0.6 + 0.4 * Math.sin(time * 1.5 + star.phase);
      const s = star.size;
      context.save();
      context.globalAlpha = twinkle;
      context.strokeStyle = '#ffffff';
      context.lineWidth = 1.5;
      context.beginPath();
      context.moveTo(star.x - s * 2, star.y);
      context.lineTo(star.x + s * 2, star.y);
      context.moveTo(star.x, star.y - s * 2);
      context.lineTo(star.x, star.y + s * 2);
      context.stroke();
      context.fillStyle = '#ffffff';
      context.beginPath();
      context.arc(star.x, star.y, s * 0.7, 0, Math.PI * 2);
      context.fill();
      context.restore();
    }
    context.globalAlpha = 1;
  }

  function drawItems(state, screen) {
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
      } else if (item.kind === KIND_BOSS) {
        const drawW = item.width * 1.15;
        const drawH = item.height * 1.05;
        const bossCx = item.x + item.width / 2;
        const bossCy = item.y + item.height / 2;
        // Rotating dashed outer ring, for menace.
        context.save();
        context.translate(bossCx, bossCy);
        context.rotate(time * 0.5);
        context.setLineDash([14, 10]);
        context.lineDashOffset = -time * 30;
        context.strokeStyle = 'rgba(255, 90, 78, 0.55)';
        context.lineWidth = 3;
        context.beginPath();
        context.arc(0, 0, 132, 0, Math.PI * 2);
        context.stroke();
        context.setLineDash([]);
        context.restore();
        // Four glowing turret dots, pulsing as if about to fire.
        const turretPulse = 0.6 + 0.4 * Math.sin(time * 5);
        context.save();
        context.globalCompositeOperation = 'lighter';
        context.fillStyle = '#ff8a7a';
        context.shadowColor = '#ff2a3d';
        context.shadowBlur = 12 * turretPulse;
        for (let t = 0; t < 4; t += 1) {
          const a = (t / 4) * Math.PI * 2 + 0.4;
          context.beginPath();
          context.arc(bossCx + Math.cos(a) * 118, bossCy + Math.sin(a) * 88, 5, 0, Math.PI * 2);
          context.fill();
        }
        context.restore();
        context.save();
        context.translate(bossCx, bossCy);
        context.rotate(Math.sin(time * 0.7) * 0.06);
        context.drawImage(bossSprite, -drawW / 2, -drawH / 2, drawW, drawH);
        context.restore();
        // Health bar above the dreadnought — or below it when it drifts to the
        // far left, where the bar would cover the score. Never over a panel.
        if (screen === SCREEN_OVER || screen === SCREEN_TITLE) {
          // Panels cover the field; a bar peeking from behind one reads as a bug.
        } else {
          const bw = 180;
          const bx = item.x + item.width / 2 - bw / 2;
          const by = item.x + item.width / 2 < 420 ? item.y + item.height + 12 : item.y - 28;
          context.fillStyle = 'rgba(0, 0, 0, 0.6)';
          context.fillRect(bx - 2, by - 2, bw + 4, 12);
          context.fillStyle = '#ff2a3d';
          context.fillRect(bx, by, bw * Math.max(0, state.bossHp / Math.max(1, state.bossMaxHp)), 8);
          context.fillStyle = '#ffd94a';
          context.font = `700 13px ${FONT}`;
          context.textAlign = 'center';
          context.textBaseline = 'alphabetic';
          context.fillText('DREADNOUGHT', item.x + item.width / 2, by - 8);
        }
      } else if (item.kind === KIND_GUNSHIP) {
        context.save();
        context.translate(item.x + item.width / 2, item.y + item.height / 2);
        context.rotate(Math.sin(item.phase) * 0.12);
        context.drawImage(gunshipSprite, -48, -36, 96, 72);
        context.restore();
        // Health pips above the hull.
        const hpw = 44;
        context.fillStyle = 'rgba(0, 0, 0, 0.6)';
        context.fillRect(item.x + item.width / 2 - hpw / 2 - 1, item.y - 12, hpw + 2, 6);
        context.fillStyle = '#ff2a3d';
        context.fillRect(item.x + item.width / 2 - hpw / 2, item.y - 11, hpw * Math.max(0, item.hp / 3), 4);
      } else if (item.kind === KIND_EBULLET) {
        const cx = item.x + item.width / 2;
        const cy = item.y + item.height / 2;
        context.save();
        context.globalCompositeOperation = 'lighter';
        context.shadowColor = '#ff2a3d';
        context.shadowBlur = 12;
        context.fillStyle = '#ff5a4e';
        context.beginPath();
        context.arc(cx, cy, item.width / 2, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = '#ffd0c8';
        context.beginPath();
        context.arc(cx, cy, item.width / 5, 0, Math.PI * 2);
        context.fill();
        context.restore();
      } else if (item.kind === KIND_ORE) {
        const cx = item.x + item.width / 2;
        const cy = item.y + item.height / 2;
        const fade = Math.min(1, item.timer / 1.5);
        context.save();
        context.globalAlpha = fade;
        context.globalCompositeOperation = 'lighter';
        context.shadowColor = '#41d9ff';
        context.shadowBlur = 10;
        context.fillStyle = '#41d9ff';
        context.translate(cx, cy);
        context.rotate(item.angle);
        context.beginPath();
        context.moveTo(0, -10);
        context.lineTo(7, 0);
        context.lineTo(0, 10);
        context.lineTo(-7, 0);
        context.closePath();
        context.fill();
        context.fillStyle = '#eafcff';
        context.beginPath();
        context.moveTo(0, -5);
        context.lineTo(3.5, 0);
        context.lineTo(0, 5);
        context.lineTo(-3.5, 0);
        context.closePath();
        context.fill();
        context.restore();
      } else if (item.kind === KIND_BOLT) {
        const bx = item.x + item.width / 2;
        const pierce = item.sub === 'pierce';
        const half = pierce ? 7 : 3;
        context.save();
        context.globalCompositeOperation = 'lighter';
        context.shadowColor = pierce ? '#ffd94a' : '#7df3ff';
        context.shadowBlur = pierce ? 18 : 12;
        const grad = context.createLinearGradient(bx, item.y, bx, item.y + item.height);
        if (pierce) {
          grad.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
          grad.addColorStop(0.5, '#ffd94a');
          grad.addColorStop(1, 'rgba(255, 150, 40, 0.2)');
        } else {
          grad.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
          grad.addColorStop(0.5, '#7df3ff');
          grad.addColorStop(1, 'rgba(57, 230, 255, 0.2)');
        }
        context.fillStyle = grad;
        context.fillRect(bx - half, item.y, half * 2, item.height);
        context.fillStyle = 'rgba(255, 255, 255, 0.9)';
        context.fillRect(bx - half / 2, item.y + 3, half, item.height - 6);
        context.restore();
      } else if (item.kind === KIND_STAR) {
        const pulse = 1 + 0.16 * Math.sin(time * 5 + item.x);
        const size = item.width * 2 * pulse;
        const cx = item.x + item.width / 2;
        const cy = item.y + item.height / 2;
        context.save();
        context.globalCompositeOperation = 'lighter';
        const halo = context.createRadialGradient(cx, cy, 0, cx, cy, size * 0.9);
        halo.addColorStop(0, 'rgba(255, 217, 74, 0.5)');
        halo.addColorStop(1, 'rgba(255, 217, 74, 0)');
        context.fillStyle = halo;
        context.beginPath();
        context.arc(cx, cy, size * 0.9, 0, Math.PI * 2);
        context.fill();
        context.restore();
        context.save();
        context.globalAlpha = 0.95;
        context.drawImage(starSprite, cx - size / 2, cy - size / 2, size, size);
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
    // Engine flame, flickering, with a hot white core.
    const flameLength = 30 + Math.sin(time * 31) * 8 + Math.random() * 6;
    context.save();
    context.globalCompositeOperation = 'lighter';
    const flame = context.createLinearGradient(0, ship.y + ship.height - 6, 0, ship.y + ship.height + flameLength);
    flame.addColorStop(0, 'rgba(255, 220, 120, 0.95)');
    flame.addColorStop(0.5, 'rgba(255, 140, 60, 0.7)');
    flame.addColorStop(1, 'rgba(255, 80, 40, 0)');
    context.fillStyle = flame;
    context.beginPath();
    context.moveTo(ship.x + ship.width / 2 - 10, ship.y + ship.height - 4);
    context.lineTo(ship.x + ship.width / 2 + 10, ship.y + ship.height - 4);
    context.lineTo(ship.x + ship.width / 2, ship.y + ship.height + flameLength);
    context.closePath();
    context.fill();
    const core = context.createLinearGradient(0, ship.y + ship.height - 6, 0, ship.y + ship.height + flameLength * 0.55);
    core.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
    core.addColorStop(1, 'rgba(255, 200, 90, 0)');
    context.fillStyle = core;
    context.beginPath();
    context.moveTo(ship.x + ship.width / 2 - 5, ship.y + ship.height - 4);
    context.lineTo(ship.x + ship.width / 2 + 5, ship.y + ship.height - 4);
    context.lineTo(ship.x + ship.width / 2, ship.y + ship.height + flameLength * 0.55);
    context.closePath();
    context.fill();
    context.restore();

    // Engine trail: fading dots behind the ship, swaying with a fixed rhythm.
    context.save();
    context.globalCompositeOperation = 'lighter';
    for (let t = 0; t < 5; t += 1) {
      const trailY = ship.y + ship.height + 34 + t * 16;
      const trailX = ship.x + ship.width / 2 + Math.sin(time * 6 + t * 1.3) * (3 + t * 1.5);
      const trailAlpha = 0.5 - t * 0.09;
      context.globalAlpha = Math.max(0, trailAlpha);
      context.fillStyle = t % 2 === 0 ? '#ffb347' : '#39e6ff';
      context.beginPath();
      context.arc(trailX, trailY, 4 - t * 0.5, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();

    context.save();
    context.translate(ship.x + ship.width / 2, ship.y + ship.height / 2);
    context.rotate(ship.tilt);
    context.drawImage(shipSprite, -65, -50, 130, 100);
    context.restore();

    // Wing lights, glowing cyan.
    context.save();
    context.globalCompositeOperation = 'lighter';
    context.fillStyle = '#7df3ff';
    context.shadowColor = '#39e6ff';
    context.shadowBlur = 8;
    for (const side of [-1, 1]) {
      context.beginPath();
      context.arc(ship.x + ship.width / 2 + side * 34, ship.y + ship.height / 2 + 24, 4, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();

    if (state.shield) {
      const pulse = 0.55 + 0.3 * Math.sin(time * 4);
      context.save();
      context.globalAlpha = pulse;
      context.strokeStyle = '#41d9ff';
      context.lineWidth = 3;
      context.beginPath();
      context.arc(ship.x + ship.width / 2, ship.y + ship.height / 2, 58, 0, Math.PI * 2);
      context.stroke();
      context.restore();
    }

    // Charge meter: fills gold while holding fire, red while overheated.
    if (state.overheat > 0) {
      const bw = 64;
      const bx = ship.x + ship.width / 2 - bw / 2;
      const by = ship.y + ship.height + 14;
      context.fillStyle = 'rgba(0, 0, 0, 0.6)';
      context.fillRect(bx - 2, by - 2, bw + 4, 10);
      context.fillStyle = '#ff2a3d';
      context.fillRect(bx, by, bw * Math.max(0, state.overheat / CHARGE.lockout), 6);
      context.font = `700 13px ${FONT}`;
      context.textAlign = 'center';
      context.fillStyle = '#ff5a4e';
      context.fillText('OVERHEATED!', ship.x + ship.width / 2, by + 24);
    } else if (state.charge > 0.05) {
      const fraction = Math.min(1, state.charge / CHARGE.full);
      const bw = 64;
      const bx = ship.x + ship.width / 2 - bw / 2;
      const by = ship.y + ship.height + 14;
      context.fillStyle = 'rgba(0, 0, 0, 0.6)';
      context.fillRect(bx - 2, by - 2, bw + 4, 10);
      context.fillStyle = fraction >= 1 ? '#ff9a3d' : '#7df3ff';
      context.fillRect(bx, by, bw * fraction, 6);
      if (fraction >= 0.5) {
        context.font = `700 13px ${FONT}`;
        context.textAlign = 'center';
        context.fillStyle = '#ffd94a';
        context.fillText('CHARGED!', ship.x + ship.width / 2, by + 24);
      }
    }
    context.globalAlpha = 1;
  }

  function drawHud(state, best) {
    context.textBaseline = 'top';
    text(scoreLabel(state.score), 26, 18, 34, PALETTE.text, 'left', 800);
    const mult = state.combo >= 1 ? 1 + Math.floor(state.combo / COMBO.perStep) : 1;
    if (state.combo >= 1) {
      const comboText = `COMBO x${mult} · ${state.combo}`;
      // A fresh multiplier tier flashes the combo big and bright.
      const flash = Math.max(0, state.comboFlash || 0) / 0.5;
      if (flash > 0) {
        context.save();
        context.shadowColor = '#ffd94a';
        context.shadowBlur = 18 * flash;
        text(comboText, 26, 58, 22 + flash * 8, '#ffd94a', 'left', 800);
        context.restore();
      } else {
        text(comboText, 26, 58, 22, '#ffd94a', 'left', 800);
      }
      // The combo window drains visibly, gold to red as it empties.
      const fraction = Math.max(0, state.comboTimer / COMBO.window);
      const barColor = fraction > 0.5 ? '#ffd94a' : fraction > 0.25 ? '#ff9a3d' : '#ff5a4e';
      context.fillStyle = 'rgba(255, 217, 74, 0.25)';
      context.fillRect(26, 88, 170, 7);
      context.fillStyle = barColor;
      context.fillRect(26, 88, 170 * fraction, 7);
    }
    text(`WAVE ${state.wave}`, FIELD.width / 2, 18, 28, PALETTE.muted, 'center', 800);
    if (state.theme) text(THEMES[state.theme].name, FIELD.width / 2, 50, 15, '#a78bfa', 'center', 700);
    // Wave progress bar.
    const waveFrac = (state.elapsed % WAVE.seconds) / WAVE.seconds;
    context.fillStyle = 'rgba(167, 139, 250, 0.3)';
    context.fillRect(FIELD.width / 2 - 60, 70, 120, 5);
    context.fillStyle = '#a78bfa';
    context.fillRect(FIELD.width / 2 - 60, 70, 120 * waveFrac, 5);
    if (state.boss) {
      text('⚠ DREADNOUGHT ⚠', FIELD.width / 2, 84, 20, '#ff5a4e', 'center', 800);
    }
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
    if (state.spreadTimer > 0) chips.push({ label: 'SPREAD x3', color: POWERUPS.spread.color, fraction: state.spreadTimer / POWERUPS.spread.duration });
    if (state.frenzyTimer > 0) chips.push({ label: 'FRENZY!', color: POWERUPS.frenzy.color, fraction: state.frenzyTimer / POWERUPS.frenzy.duration });
    let chipX = 26;
    for (const chip of chips) {
      context.font = `700 16px ${FONT}`;
      const labelWidth = context.measureText(chip.label).width;
      const width = labelWidth + 24;
      panelRect(chipX, 108, width, 26, 13);
      context.fillStyle = 'rgba(21, 11, 40, 0.85)';
      context.fill();
      context.strokeStyle = chip.color;
      context.lineWidth = 1.5;
      context.stroke();
      context.fillStyle = chip.color;
      context.fillRect(chipX + 6, 108 + 22, (width - 12) * Math.max(0, chip.fraction), 3);
      text(chip.label, chipX + width / 2, 113, 16, chip.color, 'center', 700);
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
    context.shadowBlur = 22 + 10 * Math.sin(time * 2);
    text(title, FIELD.width / 2, y + 88, 64, '#ffffff', 'center', 800);
    context.restore();
    context.fillStyle = titleGradient;
    context.font = `800 64px ${FONT}`;
    context.textAlign = 'center';
    context.fillText(title, FIELD.width / 2, y + 88);
    for (let index = 0; index < lines.length; index += 1) {
      text(lines[index], FIELD.width / 2, y + PANEL.top + index * PANEL.line, 22, PALETTE.muted, 'center', 400);
    }
    text(prompt, FIELD.width / 2, y + height - 38, 24, '#ffd94a', 'center', 700);
    context.restore();
  }

  /** The black hole: a dark disc with a bright spinning accretion ring. */
  function drawBlackHole(state) {
    const hole = state.hole;
    if (!hole || !hole.active) return;
    context.save();
    const disc = context.createRadialGradient(hole.x, hole.y, 0, hole.x, hole.y, 52);
    disc.addColorStop(0, 'rgba(0, 0, 0, 1)');
    disc.addColorStop(0.75, 'rgba(10, 2, 24, 0.95)');
    disc.addColorStop(0.9, 'rgba(176, 123, 255, 0.55)');
    disc.addColorStop(1, 'rgba(176, 123, 255, 0)');
    context.fillStyle = disc;
    context.beginPath();
    context.arc(hole.x, hole.y, 52, 0, Math.PI * 2);
    context.fill();
    // A bright accretion ring, spinning.
    context.save();
    context.translate(hole.x, hole.y);
    context.rotate(time * 1.2);
    context.setLineDash([26, 14]);
    context.lineDashOffset = -time * 60;
    context.strokeStyle = 'rgba(255, 150, 60, 0.85)';
    context.lineWidth = 5;
    context.beginPath();
    context.arc(0, 0, 62, 0, Math.PI * 2);
    context.stroke();
    context.setLineDash([10, 18]);
    context.strokeStyle = 'rgba(176, 123, 255, 0.7)';
    context.lineWidth = 3;
    context.beginPath();
    context.arc(0, 0, 74, 0, Math.PI * 2);
    context.stroke();
    context.restore();
    context.restore();
  }

  /** The upgrade shop's row rectangles, in field coordinates, for drawing and clicks. */
  function shopRows(panelY) {
    const rows = [];
    const x = (FIELD.width - SHOP_PANEL.width) / 2 + 40;
    const width = SHOP_PANEL.width - 80;
    let y = panelY + SHOP_PANEL.top + 10;
    for (let index = 0; index < SHOP.length; index += 1) {
      rows.push({ x, y, width, height: SHOP_ROW.height });
      y += SHOP_ROW.height + SHOP_ROW.gap;
    }
    return rows;
  }

  /** Which shop row (or the continue button) a field point lands on, or null. */
  function shopHit(x, y) {
    const panelY = (FIELD.height - shopPanelHeight()) / 2;
    const rows = shopRows(panelY);
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      if (x >= row.x && x <= row.x + row.width && y >= row.y && y <= row.y + row.height) return { type: 'buy', index };
    }
    const cx = (FIELD.width - SHOP_CONTINUE.width) / 2;
    const cy = panelY + shopPanelHeight() - 66;
    if (x >= cx && x <= cx + SHOP_CONTINUE.width && y >= cy && y <= cy + SHOP_CONTINUE.height) return { type: 'continue' };
    return null;
  }

  function shopPanelHeight() {
    return SHOP_PANEL.top + SHOP.length * (SHOP_ROW.height + SHOP_ROW.gap) + 96;
  }

  /** The between-wave shop: five upgrades for score, then continue. */
  function drawShop(state, shop) {
    const height = shopPanelHeight();
    const x = (FIELD.width - SHOP_PANEL.width) / 2;
    const y = (FIELD.height - height) / 2;
    context.save();
    context.fillStyle = 'rgba(4, 1, 12, 0.6)';
    context.fillRect(0, 0, FIELD.width, FIELD.height);
    panelRect(x, y, SHOP_PANEL.width, height, 18);
    context.fillStyle = PALETTE.panel;
    context.fill();
    context.strokeStyle = PALETTE.panelEdge;
    context.lineWidth = 2;
    context.stroke();
    context.textBaseline = 'alphabetic';
    text(`WAVE ${state.wave} CLEARED — UPGRADE SHOP`, FIELD.width / 2, y + 58, 34, '#ffffff', 'center', 800);
    text(`SCORE ${shop.score}  ·  Press 1-5 or click to buy, Enter to continue`, FIELD.width / 2, y + 96, 20, PALETTE.muted, 'center', 400);
    const rows = shopRows(y);
    for (let index = 0; index < shop.items.length; index += 1) {
      const item = shop.items[index];
      const row = rows[index];
      panelRect(row.x, row.y, row.width, row.height, 10);
      context.fillStyle = item.canBuy ? 'rgba(59, 35, 112, 0.9)' : 'rgba(21, 11, 40, 0.85)';
      context.fill();
      context.strokeStyle = item.canBuy ? '#ffd94a' : PALETTE.panelEdge;
      context.lineWidth = 1.5;
      context.stroke();
      text(`[${index + 1}]`, row.x + 16, row.y + 35, 22, item.canBuy ? '#ffd94a' : PALETTE.muted, 'left', 800);
      text(item.name, row.x + 70, row.y + 26, 22, '#ffffff', 'left', 800);
      text(item.desc, row.x + 70, row.y + 48, 16, PALETTE.muted, 'left', 400);
      // Level pips.
      for (let p = 0; p < item.maxLevel; p += 1) {
        context.fillStyle = p < item.level ? '#7dffb0' : 'rgba(255, 255, 255, 0.18)';
        context.beginPath();
        context.arc(row.x + row.width - 200 + p * 22, row.y + 28, 7, 0, Math.PI * 2);
        context.fill();
      }
      const right = item.note || `$${item.cost}`;
      text(right, row.x + row.width - 16, row.y + 35, 22, item.canBuy ? '#ffd94a' : item.note ? '#7dffb0' : '#ff5a4e', 'right', 800);
    }
    const cx = (FIELD.width - SHOP_CONTINUE.width) / 2;
    const cy = y + height - 66;
    panelRect(cx, cy, SHOP_CONTINUE.width, SHOP_CONTINUE.height, 12);
    context.fillStyle = '#ffd94a';
    context.fill();
    text('CONTINUE  [Enter]', FIELD.width / 2, cy + 31, 22, '#14092b', 'center', 800);
    context.restore();
  }

  const TITLE_LINES = [
    'Pilot your ship through the meteor storm.',
    'Catch stars to build your combo. Close dodges pay extra.',
    'SPACE or CLICK to fire — shatter meteors, down the dreadnought.',
    'Grab orbs: Shield · Magnet · Slow-Mo · Double · Spread · Frenzy · Bomb.',
    'Steer with ← → / A D or the mouse. P pauses, M mutes.',
    '',
  ];
  const PAUSED_LINES = ['The storm is waiting for you.'];
  const OVER_LINES = ['', '', '', '', ''];

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
  function draw(state, screen, best, isNewBest, shop) {
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = PALETTE.backdrop;
    context.fillRect(0, 0, canvas.width, canvas.height);
    const shakeX = shakeAmount > 0 ? (Math.random() - 0.5) * shakeAmount : 0;
    const shakeY = shakeAmount > 0 ? (Math.random() - 0.5) * shakeAmount : 0;
    context.setTransform(view.scale, 0, 0, view.scale, view.x + shakeX * view.scale, view.y + shakeY * view.scale);
    context.drawImage(background, 0, 0);
    drawStarfield();
    drawBlackHole(state);
    drawItems(state, screen);
    if (screen !== SCREEN_TITLE) drawShip(state);
    else {
      // The title screen's ship idles at the centre of the field, engine lit.
      const idle = { ...state.ship, x: (FIELD.width - state.ship.width) / 2 };
      drawShip({ ...state, ship: idle });
    }
    particles.draw(context);
    if (screen === SCREEN_TITLE) {
      // Shooting-star streaks sweeping the sky behind the panel.
      context.save();
      context.globalCompositeOperation = 'lighter';
      for (let s = 0; s < 3; s += 1) {
        const cycle = (time * 0.35 + s * 0.33) % 1;
        const sx = 150 + s * 420 + cycle * 500;
        const sy = 60 + s * 130 - cycle * 260;
        const streak = context.createLinearGradient(sx, sy, sx - 110, sy + 44);
        streak.addColorStop(0, `rgba(255, 255, 255, ${0.85 * (1 - cycle)})`);
        streak.addColorStop(1, 'rgba(255, 255, 255, 0)');
        context.strokeStyle = streak;
        context.lineWidth = 2.5;
        context.beginPath();
        context.moveTo(sx, sy);
        context.lineTo(sx - 110, sy + 44);
        context.stroke();
      }
      context.restore();
      TITLE_LINES[5] = bestLabel(best);
      drawPanel('STARFALL', TITLE_LINES, 'Press Space or click to launch');
      // The seven power-up orbs in a row, under the instructions.
      const panelHeight = PANEL.top + TITLE_LINES.length * PANEL.line + PANEL.bottom;
      const panelY = (FIELD.height - panelHeight) / 2;
      const orbY = panelY + panelHeight - 92;
      const orbNames = Object.keys(POWERUPS);
      const orbSize = 34;
      const orbGap = 52;
      const orbStartX = FIELD.width / 2 - ((orbNames.length - 1) * orbGap) / 2;
      for (let o = 0; o < orbNames.length; o += 1) {
        const bob = Math.sin(time * 3 + o * 0.9) * 3;
        context.drawImage(orbSprites[orbNames[o]], orbStartX + o * orbGap - orbSize / 2, orbY + bob, orbSize, orbSize);
      }
      return;
    }
    drawHud(state, best);
    // Vignette: darkened corners, so the action pops in the middle.
    const vignette = context.createRadialGradient(
      FIELD.width / 2, FIELD.height / 2, FIELD.height * 0.45,
      FIELD.width / 2, FIELD.height / 2, FIELD.height * 0.95,
    );
    vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vignette.addColorStop(1, 'rgba(2, 0, 10, 0.42)');
    context.fillStyle = vignette;
    context.fillRect(0, 0, FIELD.width, FIELD.height);
    // Danger pulse: red edges closing in on the last life.
    if (screen === SCREEN_PLAY && state.lives === 1) {
      const danger = 0.14 + 0.1 * Math.sin(time * 3);
      const edge = context.createRadialGradient(
        FIELD.width / 2, FIELD.height / 2, FIELD.height * 0.42,
        FIELD.width / 2, FIELD.height / 2, FIELD.height * 0.85,
      );
      edge.addColorStop(0, 'rgba(255, 42, 61, 0)');
      edge.addColorStop(1, `rgba(255, 42, 61, ${danger})`);
      context.fillStyle = edge;
      context.fillRect(0, 0, FIELD.width, FIELD.height);
    }
    if (flashAmount > 0) {
      context.fillStyle = `rgba(255, 60, 50, ${flashAmount * 0.22})`;
      context.fillRect(0, 0, FIELD.width, FIELD.height);
    }
    if (screen === SCREEN_PAUSED) {
      drawPanel('PAUSED', PAUSED_LINES, 'Press P to resume', '#a78bfa');
    } else if (screen === SCREEN_SHOP && shop) {
      drawShop(state, shop);
    } else if (screen === SCREEN_OVER) {
      OVER_LINES[0] = finalLabel(state.score);
      OVER_LINES[1] = bestLabel(best);
      OVER_LINES[2] = isNewBest ? '★ NEW BEST! ★' : '';
      OVER_LINES[3] = `STARS ${state.stats.stars}  ·  NEAR MISSES ${state.stats.near}  ·  KILLS ${state.stats.kills}`;
      const overMult = state.stats.maxCombo >= 2 ? 1 + Math.floor(state.stats.maxCombo / COMBO.perStep) : 1;
      OVER_LINES[4] = `MAX COMBO x${overMult} (${state.stats.maxCombo})  ·  REACHED WAVE ${state.wave}`;
      drawPanel('GAME OVER', OVER_LINES, 'Press Space or click to fly again', '#ff5a4e');
    }
  }

  resize();
  window.addEventListener('resize', resize);
  return { draw, update, shake, flash, shopHit };
}
