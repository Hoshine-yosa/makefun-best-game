// Starfall: every tuning number and colour in one place. The playfield is a fixed
// 1280x720 logical area; the renderer scales it to the window, so no rule below
// depends on the screen size. The ship flies along the lower band (SHIP_Y) while
// meteors, stars and power-ups rain down from the top of the sky.

export const FIELD = { width: 1280, height: 720, shipY: 648 };

/** The simulation's fixed step, in seconds: 60 updates a second whatever the display's rate. */
export const STEP = 1 / 60;

/** One wave lasts this long; each wave raises speed and spawn density. */
export const WAVE = { seconds: 15, max: 10 };

export const SHIP = {
  width: 66,
  height: 42,
  speed: 640,
  /** Seconds of flashing safety after a hit. */
  invulnerable: 1.6,
  /** How fast the ship eases toward the pointer when steered by mouse. */
  mouseEase: 14,
};

export const LIVES = 3;

/**
 * The three rocks. A shard is small and quick, a rock is the middle of the road,
 * a boulder is wide and slow and worth more for slipping past. Each wave unlocks
 * the next kind and quickens all of them.
 */
export const METEOR = {
  shard: { minSize: 22, maxSize: 30, speed: 300, speedPerWave: 26, interval: 0.9, dodgePoints: 2, unlockWave: 1 },
  rock: { minSize: 40, maxSize: 62, speed: 235, speedPerWave: 22, interval: 0.62, dodgePoints: 1, unlockWave: 1 },
  boulder: { minSize: 84, maxSize: 116, speed: 165, speedPerWave: 16, interval: 1.9, dodgePoints: 3, unlockWave: 3 },
  /** Extra sideways drift for meteors from wave 4 on, in pixels per second. */
  driftSpeed: 46,
  driftWave: 4,
  /** Jitter added to every spawned meteor's speed. */
  speedJitter: 70,
};

/** A caught star: points before the combo multiplier is applied. */
export const STAR = {
  size: 26,
  speed: 205,
  speedPerWave: 12,
  interval: 1.15,
  intervalJitter: 0.7,
  points: 10,
};

/** Dodging a meteor within this many pixels of the ship is a near miss. */
export const NEAR_MISS = { margin: 30, points: 5 };

/**
 * Combo: every star caught inside the window adds one; the window refreshes on
 * each catch and the combo is lost when it runs out or the ship is hit.
 */
export const COMBO = { window: 4, perStep: 4, maxMultiplier: 8 };

/** The four power-ups: what they do, how long they last, their colour and mark. */
export const POWERUPS = {
  shield: { duration: 0, color: '#41d9ff', mark: 'S', interval: 26, label: 'SHIELD' },
  magnet: { duration: 8, color: '#ff5ad1', mark: 'M', interval: 21, label: 'MAGNET' },
  slow: { duration: 6, color: '#a78bfa', mark: 'T', interval: 24, label: 'SLOW-MO' },
  double: { duration: 10, color: '#ffc94a', mark: 'x2', interval: 19, label: 'DOUBLE SCORE' },
};
export const POWERUP_ORDER = ['shield', 'magnet', 'slow', 'double'];
export const POWERUP = { size: 30, speed: 170, jitter: 60 };

/** How many falling things, particles and floating texts can exist at once. */
export const POOL = { items: 96, particles: 260, popups: 16 };

/** Screen shake: how far the view jumps on a hit, and how fast it settles. */
export const SHAKE = { hit: 14, decay: 34 };

export const PALETTE = {
  backdrop: '#070312',
  nebula: '#170b2e',
  horizon: '#2a1150',
  ship: '#39e6ff',
  shipCore: '#eafcff',
  flame: '#ffb347',
  meteor: '#ff5a4e',
  meteorDark: '#a8322c',
  meteorEdge: '#ffb3ab',
  star: '#ffd94a',
  starCore: '#fff7cc',
  panel: '#150b28',
  panelEdge: '#3b2370',
  text: '#f2f6ff',
  muted: '#9a8fc0',
  danger: '#ff5a4e',
  good: '#7dffb0',
};

export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/** Where the best score is kept between visits (this browser only). */
export const BEST_KEY = 'starfall.best';
