// Particles and floating score popups, drawn by the renderer but owned here:
// bursts when a star is caught or a meteor shatters, the ship's engine trail,
// and the short texts that float up from each event. Two fixed pools, allocated
// once, so a frame never allocates.
import { POOL } from './config.js';

const PARTICLE_LIFE = 0.7;
const POPUP_LIFE = 1.1;

export function createParticles() {
  const sparks = [];
  for (let index = 0; index < POOL.particles; index += 1) {
    sparks.push({ active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1, size: 2, color: '#ffffff', drag: 0 });
  }
  const popups = [];
  for (let index = 0; index < POOL.popups; index += 1) {
    popups.push({ active: false, x: 0, y: 0, text: '', color: '#ffffff', life: 0, maxLife: POPUP_LIFE, size: 22 });
  }
  const rings = [];
  for (let index = 0; index < POOL.rings; index += 1) {
    rings.push({ active: false, x: 0, y: 0, radius: 0, maxRadius: 100, life: 0, maxLife: 0.5, color: '#ffffff' });
  }

  function freeSpark() {
    for (let index = 0; index < sparks.length; index += 1) {
      if (!sparks[index].active) return sparks[index];
    }
    return null;
  }

  function freePopup() {
    for (let index = 0; index < popups.length; index += 1) {
      if (!popups[index].active) return popups[index];
    }
    return null;
  }

  function freeRing() {
    for (let index = 0; index < rings.length; index += 1) {
      if (!rings[index].active) return rings[index];
    }
    return null;
  }

  /** An expanding shockwave ring, for shatters and boss kills. */
  function ring(x, y, color, maxRadius) {
    const wave = freeRing();
    if (wave === null) return;
    wave.active = true;
    wave.x = x;
    wave.y = y;
    wave.radius = 6;
    wave.maxRadius = maxRadius || 110;
    wave.life = 0.5;
    wave.maxLife = 0.5;
    wave.color = color;
  }

  /** A radial burst of `count` sparks. `speed` is the fastest spark, in px/s. */
  function burst(x, y, color, count, speed, size) {
    for (let n = 0; n < count; n += 1) {
      const spark = freeSpark();
      if (spark === null) return;
      const angle = Math.random() * Math.PI * 2;
      const power = speed * (0.35 + Math.random() * 0.65);
      spark.active = true;
      spark.x = x;
      spark.y = y;
      spark.vx = Math.cos(angle) * power;
      spark.vy = Math.sin(angle) * power - 40;
      spark.life = PARTICLE_LIFE * (0.6 + Math.random() * 0.6);
      spark.maxLife = spark.life;
      spark.size = size * (0.6 + Math.random() * 0.8);
      spark.color = color;
      spark.drag = 2.2;
    }
  }

  /** One engine ember behind the ship. */
  function ember(x, y, color) {
    const spark = freeSpark();
    if (spark === null) return;
    spark.active = true;
    spark.x = x + (Math.random() - 0.5) * 8;
    spark.y = y;
    spark.vx = (Math.random() - 0.5) * 30;
    spark.vy = 90 + Math.random() * 60;
    spark.life = 0.35;
    spark.maxLife = 0.35;
    spark.size = 2.5 + Math.random() * 2;
    spark.color = color;
    spark.drag = 0;
  }

  function popup(x, y, text, color, size) {
    const note = freePopup();
    if (note === null) return;
    note.active = true;
    note.x = x;
    note.y = y;
    note.text = text;
    note.color = color;
    note.life = POPUP_LIFE;
    note.maxLife = POPUP_LIFE;
    note.size = size || 22;
  }

  /**
   * Turn the world's feed entries into bursts and popups, then switch them off.
   * The world never knows about particles; this is the one place the two meet.
   */
  function drainFeed(feed) {
    for (let index = 0; index < feed.length; index += 1) {
      const note = feed[index];
      if (!note.active) continue;
      note.active = false;
      if (note.type === 'star') {
        burst(note.x, note.y, '#ffd94a', 10, 190, 3);
        popup(note.x, note.y - 8, note.text, note.color, 22);
      } else if (note.type === 'near') {
        burst(note.x, note.y, '#7dffb0', 6, 130, 2.5);
        popup(note.x, note.y - 6, note.text, note.color, 24);
      } else if (note.type === 'power') {
        burst(note.x, note.y, note.color, 18, 240, 3.5);
        popup(note.x, note.y - 10, note.text, note.color, 26);
      } else if (note.type === 'hit') {
        burst(note.x, note.y + 20, '#ff5a4e', 26, 320, 4);
        ring(note.x, note.y + 20, '#ff5a4e', 90);
        popup(note.x, note.y - 6, note.text, note.color, 28);
      } else if (note.type === 'kill') {
        burst(note.x, note.y, '#ff9a3d', 16, 260, 3.5);
        burst(note.x, note.y, '#ffd94a', 8, 180, 3);
        ring(note.x, note.y, '#ff9a3d', 70);
        popup(note.x, note.y - 8, note.text, note.color, 24);
      } else if (note.type === 'bigkill') {
        burst(note.x, note.y, '#ff9a3d', 22, 320, 4.5);
        burst(note.x, note.y, '#ffd94a', 12, 220, 3.5);
        ring(note.x, note.y, '#ff9a3d', 110);
        popup(note.x, note.y - 8, note.text, note.color, 32);
      } else if (note.type === 'bomb') {
        burst(note.x, note.y, '#ff2a6d', 30, 420, 5);
        burst(note.x, note.y, '#ffd94a', 20, 320, 4);
        ring(note.x, note.y, '#ff2a6d', 260);
        ring(note.x, note.y, '#ffd94a', 180);
        popup(note.x, note.y - 10, note.text, note.color, 32);
      } else if (note.type === 'boss') {
        burst(note.x, note.y, '#ff5a4e', 30, 420, 5);
        burst(note.x, note.y, '#ffd94a', 20, 320, 4);
        burst(note.x, note.y, '#ff5ad1', 14, 260, 4);
        ring(note.x, note.y, '#ff5a4e', 220);
        ring(note.x, note.y, '#ffd94a', 160);
        popup(note.x, note.y - 10, note.text, note.color, 30);
      } else if (note.type === 'block') {
        burst(note.x, note.y + 10, '#41d9ff', 16, 240, 3);
        popup(note.x, note.y - 6, note.text, note.color, 26);
      } else if (note.type === 'wave') {
        popup(note.x, note.y, note.text, note.color, 34);
      } else if (note.type === 'perfect') {
        burst(note.x, note.y, '#7dffb0', 24, 320, 4);
        ring(note.x, note.y, '#7dffb0', 150);
        popup(note.x, note.y, note.text, note.color, 36);
      } else if (note.type === 'streak') {
        burst(note.x, note.y, '#ff2a6d', 16, 280, 4);
        popup(note.x, note.y, note.text, note.color, 28);
      }
    }
  }

  function update(dt) {
    for (let index = 0; index < sparks.length; index += 1) {
      const spark = sparks[index];
      if (!spark.active) continue;
      spark.life -= dt;
      if (spark.life <= 0) {
        spark.active = false;
        continue;
      }
      const drag = Math.max(0, 1 - spark.drag * dt);
      spark.vx *= drag;
      spark.vy *= drag;
      spark.x += spark.vx * dt;
      spark.y += spark.vy * dt;
    }
    for (let index = 0; index < popups.length; index += 1) {
      const note = popups[index];
      if (!note.active) continue;
      note.life -= dt;
      note.y -= 42 * dt;
      if (note.life <= 0) note.active = false;
    }
    for (let index = 0; index < rings.length; index += 1) {
      const wave = rings[index];
      if (!wave.active) continue;
      wave.life -= dt;
      const fraction = 1 - Math.max(0, wave.life / wave.maxLife);
      wave.radius = 6 + (wave.maxRadius - 6) * fraction;
      if (wave.life <= 0) wave.active = false;
    }
  }

  /** Sparks additively, rings as expanding strokes, popups as text; the caller sets the transform. */
  function draw(context) {
    context.save();
    context.globalCompositeOperation = 'lighter';
    for (let index = 0; index < sparks.length; index += 1) {
      const spark = sparks[index];
      if (!spark.active) continue;
      context.globalAlpha = Math.max(0, spark.life / spark.maxLife);
      context.fillStyle = spark.color;
      context.fillRect(spark.x - spark.size / 2, spark.y - spark.size / 2, spark.size, spark.size);
    }
    for (let index = 0; index < rings.length; index += 1) {
      const wave = rings[index];
      if (!wave.active) continue;
      context.globalAlpha = Math.max(0, wave.life / wave.maxLife) * 0.9;
      context.strokeStyle = wave.color;
      context.lineWidth = 4;
      context.beginPath();
      context.arc(wave.x, wave.y, wave.radius, 0, Math.PI * 2);
      context.stroke();
    }
    context.restore();
    for (let index = 0; index < popups.length; index += 1) {
      const note = popups[index];
      if (!note.active) continue;
      context.globalAlpha = Math.max(0, Math.min(1, (note.life / note.maxLife) * 1.6));
      context.font = `700 ${note.size}px system-ui, sans-serif`;
      context.textAlign = 'center';
      context.textBaseline = 'alphabetic';
      context.fillStyle = note.color;
      context.fillText(note.text, note.x, note.y);
    }
    context.globalAlpha = 1;
  }

  return { burst, ember, popup, ring, drainFeed, update, draw };
}
