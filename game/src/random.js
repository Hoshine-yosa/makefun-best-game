// A seeded random source: the same seed plays the same game, which is what makes
// the screenshot scenes repeatable. Built on the mulberry32 step, with the small
// helpers the world uses so it never has to scale a raw 0..1 itself.

export function createRandom(seed) {
  let state = seed | 0;

  /** The next value in 0..1. */
  function next() {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  }

  return {
    next,
    /** A value in [min, max). */
    range(min, max) {
      return min + next() * (max - min);
    },
    /** A whole number in [min, max]. */
    int(min, max) {
      return min + Math.floor(next() * (max - min + 1));
    },
    /** One element of `list`, each equally likely. */
    pick(list) {
      return list[Math.floor(next() * list.length)];
    },
    /** True with probability `chance` (0..1). */
    chance(chance) {
      return next() < chance;
    },
  };
}
