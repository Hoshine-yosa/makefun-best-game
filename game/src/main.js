// Boot and the one loop: input is read every frame, the world advances in fixed 1/60 s
// steps (several in a slow frame, none in a fast one), and the renderer paints what is
// there. The game moves between four screens: title, play, paused and game over. Every
// event the world reports gets its sound and its shake here, and the world's feed is
// drained into particles once a frame.
//
// ?seed=N fixes the falling pattern. ?shot=start|play|storm|end (with &seed=N) stages
// that scene instead of running the loop, paints it twice and sets window.__shotReady
// for a screenshot.
import { BEST_KEY, LIVES, SHAKE, STEP } from './config.js';
import { createRandom } from './random.js';
import {
  createWorld,
  EVENT_BLOCKED,
  EVENT_BOMB,
  EVENT_BOSS,
  EVENT_HIT,
  EVENT_KILL,
  EVENT_NEAR,
  EVENT_OVER,
  EVENT_POWERUP,
  EVENT_SHOOT,
  EVENT_STAR,
  EVENT_WAVE,
  KIND_STAR,
} from './world.js';
import { ACTION_CONFIRM, ACTION_MUTE, ACTION_PAUSE, createInput } from './input.js';
import { createRenderer, SCREEN_OVER, SCREEN_PAUSED, SCREEN_PLAY, SCREEN_TITLE } from './render.js';
import { createParticles } from './particles.js';
import { createAudio } from './audio.js';
import { stageShot } from './shots.js';

/** The longest frame the loop catches up on; a longer stall (a hidden tab) is dropped, not replayed. */
const MAX_FRAME = 0.25;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const world = createWorld(createRandom(seed));
const particles = createParticles();
const renderer = createRenderer(canvas, particles);
const audio = createAudio();

function readBest() {
  try {
    return Number.parseInt(window.localStorage.getItem(BEST_KEY) ?? '0', 10) || 0;
  } catch {
    return 0;
  }
}

function saveBest(value) {
  try {
    window.localStorage.setItem(BEST_KEY, String(value));
  } catch {
    // Storage can be off (private windows): the best score then lasts this visit only.
  }
}

function runShot(name) {
  const scene = stageShot(name, world);
  // The feed holds the opening seconds' notes; the shot frames its own moment.
  for (const note of world.state.feed) note.active = false;
  if (name === 'play' || name === 'storm') {
    // A couple of live star bursts, so the frame shows the catch feedback too.
    let bursts = 0;
    for (let index = world.state.items.length - 1; index >= 0 && bursts < 2; index -= 1) {
      const item = world.state.items[index];
      if (item.active && item.kind === KIND_STAR) {
        particles.burst(item.x + item.width / 2, item.y + item.height / 2, '#ffd94a', 10, 190, 3);
        bursts += 1;
      }
    }
  }
  if (name === 'storm' && world.state.boss !== null && world.state.boss.active) {
    // The dreadnought mid-explosion: a big burst and a shockwave ring at its hull.
    const boss = world.state.boss;
    const bx = boss.x + boss.width / 2;
    const by = boss.y + boss.height / 2;
    particles.burst(bx, by, '#ff5a4e', 26, 380, 5);
    particles.burst(bx, by, '#ffd94a', 16, 300, 4);
    particles.ring(bx, by, '#ff5a4e', 200);
    particles.ring(bx, by, '#ffd94a', 140);
  }
  let painted = 0;
  function paint() {
    renderer.update(STEP);
    particles.update(STEP);
    // The end scene's best is the run's own score, so it is a new best by construction.
    renderer.draw(world.state, scene.screen, scene.best, scene.screen === SCREEN_OVER);
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  const input = createInput(canvas);
  let screen = SCREEN_TITLE;
  let best = readBest();
  let isNewBest = false;
  let accumulator = 0;
  let last = performance.now();

  // Sound needs a gesture: the first key or click wakes the audio context.
  window.addEventListener('keydown', () => audio.unlock(), { once: false });
  canvas.addEventListener('pointerdown', () => audio.unlock(), { once: false });

  // Screen readers (and anyone watching the page's text) hear the screen changes and each hit.
  function announce(message) {
    status.textContent = message;
  }

  function startGame() {
    world.reset();
    particles.update(0);
    isNewBest = false;
    accumulator = 0;
    screen = SCREEN_PLAY;
    audio.unlock();
    audio.start();
    announce(`Playing. ${LIVES} lives.`);
  }

  function endGame() {
    screen = SCREEN_OVER;
    if (world.state.score > best) {
      best = world.state.score;
      isNewBest = true;
      saveBest(best);
    }
    audio.gameOver();
    announce(`Game over. Score ${world.state.score}. Best ${best}.`);
  }

  function handleActions() {
    const actions = input.takeActions();
    if (actions & ACTION_MUTE) {
      audio.setMuted(!audio.isMuted());
      announce(audio.isMuted() ? 'Sound off.' : 'Sound on.');
    }
    if (actions & ACTION_CONFIRM && (screen === SCREEN_TITLE || screen === SCREEN_OVER)) startGame();
    else if (actions & ACTION_PAUSE && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      announce('Paused.');
    } else if (actions & (ACTION_PAUSE | ACTION_CONFIRM) && screen === SCREEN_PAUSED) {
      screen = SCREEN_PLAY;
      announce('Playing.');
    }
  }

  /** One world's event, as sound and as a jolt. */
  function react(events) {
    if (events & EVENT_STAR) audio.star(world.state.combo);
    if (events & EVENT_NEAR) audio.nearMiss();
    if (events & EVENT_SHOOT) audio.shoot();
    if (events & EVENT_KILL) {
      audio.explode();
      renderer.shake(4);
    }
    if (events & EVENT_BOMB) {
      audio.explode();
      renderer.shake(SHAKE.hit * 2);
      renderer.flash(1);
    }
    if (events & EVENT_BOSS) {
      audio.bossDie();
      renderer.shake(SHAKE.hit * 2);
      renderer.flash(1);
    }
    if (events & EVENT_HIT) {
      audio.hit();
      renderer.shake(SHAKE.hit);
      renderer.flash(1);
    }
    if (events & EVENT_BLOCKED) {
      audio.shieldBlock();
      renderer.shake(6);
    }
    if (events & EVENT_POWERUP) audio.powerup();
    if (events & EVENT_WAVE) audio.wave();
    if (events & EVENT_OVER) endGame();
    else if (events & EVENT_HIT) {
      announce(world.state.lives === 1 ? 'Hit. 1 life left.' : `Hit. ${world.state.lives} lives left.`);
    }
  }

  function step() {
    if (screen === SCREEN_TITLE) {
      world.step(STEP, { direction: 0, pointerX: null, firing: false }, true);
      return;
    }
    const events = world.step(STEP, { direction: input.direction(), pointerX: input.pointerTarget(), firing: input.firing() }, false);
    react(events);
  }

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    handleActions();
    if (screen === SCREEN_TITLE || screen === SCREEN_PLAY) {
      accumulator += dt;
      while (accumulator >= STEP && (screen === SCREEN_TITLE || screen === SCREEN_PLAY)) {
        step();
        accumulator -= STEP;
      }
    } else {
      accumulator = 0;
    }
    particles.drainFeed(world.state.feed);
    particles.update(dt);
    renderer.update(dt);
    if (screen === SCREEN_PLAY) {
      const ship = world.state.ship;
      particles.ember(ship.x + ship.width / 2, ship.y + ship.height - 2, '#ffb347');
      particles.ember(ship.x + ship.width / 2, ship.y + ship.height - 2, '#39e6ff');
      audio.updateMusic(world.state.wave, world.state.boss !== null);
    }
    renderer.draw(world.state, screen, best, isNewBest);
  }

  // Leaving the tab pauses a running game rather than letting meteors fall unseen.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      announce('Paused.');
    }
  });

  announce('Starfall. Press Space or click to launch.');
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
