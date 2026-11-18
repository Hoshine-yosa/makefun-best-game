// Starfall: every tuning number and colour in one place. The playfield is a fixed
// 1280x720 logical area; the renderer scales it to the window, so no rule below
// depends on the screen size. The ship flies along the lower band (SHIP_Y) while
// meteors, stars and power-ups rain down from the top of the sky.

export const FIELD = { width: 1280, height: 720, shipY: 648 };

/** The simulation's fixed step, in seconds: 60 updates a second whatever the display's rate. */
export const STEP = 1 / 60;

/** One wave lasts this long; each wave raises speed and spawn density. */
export const WAVE = { seconds: 15, max: 20 };

export const SHIP = {
  width: 72,
  height: 46,
  speed: 660,
  /** Seconds of flashing safety after a hit. */
  invulnerable: 1.6,
  /** How fast the ship eases toward the pointer when steered by mouse. */
  mouseEase: 14,
};

export const LIVES = 3;

/**
 * The rocks. A shard is small and quick, a rock is the middle of the road,
 * a boulder is wide and slow and worth more for slipping past. Darts zigzag
 * fast across the field, brutes are big and take three bolts, splitters burst
 * into two shards when shot, and weavers sine-weave across the field as they
 * fall. Each wave unlocks the next kind and quickens all.
 */
export const METEOR = {
  shard: { minSize: 22, maxSize: 30, speed: 300, speedPerWave: 26, interval: 0.9, dodgePoints: 2, unlockWave: 1, hp: 1, killPoints: 15 },
  rock: { minSize: 40, maxSize: 62, speed: 235, speedPerWave: 22, interval: 0.62, dodgePoints: 1, unlockWave: 1, hp: 2, killPoints: 25 },
  boulder: { minSize: 84, maxSize: 116, speed: 165, speedPerWave: 16, interval: 1.9, dodgePoints: 3, unlockWave: 3, hp: 3, killPoints: 50 },
  dart: { minSize: 24, maxSize: 30, speed: 420, speedPerWave: 30, interval: 1.6, dodgePoints: 4, unlockWave: 2, hp: 1, killPoints: 30 },
  brute: { minSize: 96, maxSize: 120, speed: 130, speedPerWave: 12, interval: 4.5, dodgePoints: 5, unlockWave: 4, hp: 3, killPoints: 80 },
  splitter: { minSize: 52, maxSize: 64, speed: 210, speedPerWave: 20, interval: 2.8, dodgePoints: 3, unlockWave: 3, hp: 1, killPoints: 40 },
  weaver: { minSize: 30, maxSize: 38, speed: 320, speedPerWave: 24, interval: 2.2, dodgePoints: 4, unlockWave: 6, hp: 2, killPoints: 45 },
  /** Extra sideways drift for meteors from wave 4 on, in pixels per second. */
  driftSpeed: 46,
  driftWave: 4,
  /** Jitter added to every spawned meteor's speed. */
  speedJitter: 70,
};

/** The ship's guns: speed, cooldown, and what a spread shot adds. */
export const BOLT = {
  width: 8, height: 22, speed: 900, cooldown: 0.2, frenzyCooldown: 0.1, damage: 1,
};

/** Hold to charge a piercing shot: full in 1s, then 0.5s of grace before the gun overheats and locks for 2s. Below 50% charge a release fires a normal bolt; charging only starts after 0.35s of holding, so taps still spray. */
export const CHARGE = {
  full: 1.0, grace: 0.5, lockout: 2, startAt: 0.35,
  pierceDamage: 3, pierceCount: 3, width: 16, height: 34,
};

/** Gunships: enemy ships that drift down and fire aimed shots at the player. */
export const GUNSHIP = {
  unlockWave: 4, width: 64, height: 40, speed: 120, speedPerWave: 8,
  hp: 3, killPoints: 100, fireInterval: 1.5, bulletSpeed: 260,
  /** Seconds between gunship spawns; the patrol theme spawns faster. */
  interval: 8, patrolInterval: 4,
  /** How many gunships a wave may spawn (patrol waves get one more). */
  perWave: 2, patrolPerWave: 3,
};

/** Enemy bullets: slow red orbs the gunships aim at the ship. Shoot them down for a few points. */
export const EBULLET = { size: 12, points: 5 };

/** Ore shards: boulders burst into three of these when shattered. Drift slowly, fade after 6s. */
export const ORE = { size: 16, speed: 60, life: 6, points: 25 };

/** The black hole: one per wave from wave 3, warned 2s before it opens, pulling everything nearby for 8s. */
export const BLACKHOLE = {
  unlockWave: 3, duration: 8, warnBefore: 2,
  pullRadius: 420, pullMax: 200, shipPullMax: 160, horizon: 46,
  spawnDelayMin: 4, spawnDelayMax: 9,
};

/** The between-wave upgrade shop: score is the currency, upgrades last the run. */
export const SHOP = [
  { id: 'fire', name: 'RAPID FIRE', desc: '+15% fire rate', costs: [500, 1000, 2000] },
  { id: 'spread', name: 'EXTRA BOLT', desc: '+1 bolt per shot', costs: [800, 1600] },
  { id: 'magnet', name: 'BIG MAGNET', desc: '+50% magnet radius', costs: [400, 800] },
  { id: 'life', name: 'EXTRA LIFE', desc: '+1 life (max 5)', costs: [1500], perVisit: true },
  { id: 'shield', name: 'SHIELD', desc: 'Shield for the next wave', costs: [600], perVisit: true },
];

/**
 * Wave themes, fixed per wave number so every run plays the same. Boss waves
 * keep the old mix; the rest cycle shower / swarm / patrol / calm.
 */
export const THEMES = {
  shower: { name: 'METEOR SHOWER', meteorMul: 0.67, gunships: false },
  swarm: { name: 'SWARM', shardMul: 0.5, boulderMul: 2, gunships: false },
  patrol: { name: 'GUNSHIP PATROL', meteorMul: 1.3, gunships: true, gunshipInterval: 4 },
  calm: { name: 'CALM', meteorMul: 1.3, starMul: 0.7, gunships: false },
  boss: { name: 'BOSS', meteorMul: 1, gunships: false },
};

/** The boss: a dreadnought that arrives on waves 5, 10, 15 and 20. */
export const BOSS = {
  width: 220, height: 150, hp: 20, speed: 90, killPoints: 500, dropCount: 3,
  waves: [5, 10, 15, 20],
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
 * each catch and on each kill, and the combo is lost when it runs out or the ship
 * is hit. The HUD shows the window draining, gold to red.
 */
export const COMBO = { window: 3, perStep: 4, maxMultiplier: 8 };

/** The seven power-ups: what they do, how long they last, their colour and mark. The bomb is instant: it clears every meteor on screen the moment it is caught. */
export const POWERUPS = {
  shield: { duration: 0, color: '#41d9ff', mark: 'S', interval: 26, label: 'SHIELD' },
  magnet: { duration: 8, color: '#ff5ad1', mark: 'M', interval: 21, label: 'MAGNET' },
  slow: { duration: 6, color: '#a78bfa', mark: 'T', interval: 24, label: 'SLOW-MO' },
  double: { duration: 10, color: '#ffc94a', mark: 'x2', interval: 19, label: 'DOUBLE SCORE' },
  spread: { duration: 10, color: '#7dffb0', mark: '3', interval: 23, label: 'SPREAD SHOT' },
  frenzy: { duration: 8, color: '#ff9a3d', mark: '!', interval: 27, label: 'FRENZY!' },
  bomb: { duration: 0, color: '#ff2a6d', mark: 'B', interval: 25, label: 'NOVA BOMB' },
};
export const POWERUP_ORDER = ['shield', 'magnet', 'slow', 'double', 'spread', 'frenzy', 'bomb'];
export const POWERUP = { size: 30, speed: 170, jitter: 60 };

/** How many falling things, particles and floating texts can exist at once. */
export const POOL = { items: 180, particles: 360, popups: 20, rings: 10 };

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
