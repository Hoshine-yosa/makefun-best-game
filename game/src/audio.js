// All sound is synthesised with WebAudio: short oscillator blips for every event
// and a quiet arpeggio loop for music. No audio file is loaded, so the game
// stays offline. The context is created on the first user gesture; until then
// every call is a silent no-op, which also keeps the screenshot scenes quiet.
export function createAudio() {
  let context = null;
  let master = null;
  let musicGain = null;
  let muted = false;
  let musicStep = 0;
  let nextNoteTime = 0;

  /** A minor-pentatonic walk, one note per eighth, at 112 bpm. */
  const MELODY = [220, 261.63, 293.66, 329.63, 392, 329.63, 293.66, 261.63];
  const BASS = [110, 110, 130.81, 98];
  const STEP_SECONDS = 60 / 112 / 2;

  /** Create (or wake) the context. Call from a user gesture. */
  function unlock() {
    if (context === null) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      context = new AudioContext();
      master = context.createGain();
      master.gain.value = muted ? 0 : 0.9;
      master.connect(context.destination);
      musicGain = context.createGain();
      musicGain.gain.value = 0.05;
      musicGain.connect(master);
      nextNoteTime = context.currentTime + 0.1;
    }
    if (context.state === 'suspended') void context.resume();
  }

  function setMuted(value) {
    muted = value;
    if (master !== null) master.gain.value = muted ? 0 : 0.9;
  }

  function isMuted() {
    return muted;
  }

  /** One oscillator note: frequency, seconds from now, length, shape, loudness. */
  function tone(frequency, delay, length, shape, loudness, destination) {
    if (context === null) return;
    const start = context.currentTime + delay;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = shape;
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(loudness, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
    oscillator.connect(gain);
    gain.connect(destination || master);
    oscillator.start(start);
    oscillator.stop(start + length + 0.05);
  }

  /** A quick pitch slide, for whooshes and falls. */
  function slide(from, to, delay, length, shape, loudness) {
    if (context === null) return;
    const start = context.currentTime + delay;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = shape;
    oscillator.frequency.setValueAtTime(from, start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, to), start + length);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(loudness, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
    oscillator.connect(gain);
    gain.connect(master);
    oscillator.start(start);
    oscillator.stop(start + length + 0.05);
  }

  /** A short burst of filtered noise, for impacts. */
  function noise(delay, length, loudness, frequency) {
    if (context === null) return;
    const start = context.currentTime + delay;
    const size = Math.floor(context.sampleRate * length);
    const buffer = context.createBuffer(1, size, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < size; index += 1) data[index] = (Math.random() * 2 - 1) * (1 - index / size);
    const source = context.createBufferSource();
    source.buffer = buffer;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = frequency;
    const gain = context.createGain();
    gain.gain.value = loudness;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start(start);
  }

  /** A star caught: a bright blip that climbs a semitone per combo step. */
  function star(combo) {
    const step = Math.min(combo, 24);
    const base = 660 * 2 ** (step / 12);
    tone(base, 0, 0.14, 'sine', 0.22);
    tone(base * 1.5, 0.05, 0.12, 'sine', 0.14);
  }

  function nearMiss() {
    slide(900, 1600, 0, 0.12, 'triangle', 0.12);
  }

  function hit() {
    slide(160, 42, 0, 0.28, 'sawtooth', 0.3);
    noise(0, 0.2, 0.25, 900);
  }

  function shieldBlock() {
    tone(1244, 0, 0.16, 'square', 0.1);
    tone(1866, 0.03, 0.2, 'sine', 0.14);
  }

  function powerup() {
    tone(523.25, 0, 0.12, 'triangle', 0.2);
    tone(659.25, 0.07, 0.12, 'triangle', 0.2);
    tone(783.99, 0.14, 0.2, 'triangle', 0.22);
  }

  function wave() {
    tone(392, 0, 0.18, 'sine', 0.16);
    tone(587.33, 0.09, 0.24, 'sine', 0.14);
  }

  function gameOver() {
    tone(392, 0, 0.22, 'triangle', 0.2);
    tone(311.13, 0.18, 0.22, 'triangle', 0.2);
    tone(233.08, 0.36, 0.5, 'triangle', 0.22);
  }

  function start() {
    tone(261.63, 0, 0.12, 'triangle', 0.18);
    tone(392, 0.08, 0.12, 'triangle', 0.18);
    tone(523.25, 0.16, 0.2, 'triangle', 0.2);
  }

  /** Schedule the music a little ahead, called once a frame while playing. */
  function updateMusic() {
    if (context === null || context.state !== 'running') return;
    while (nextNoteTime < context.currentTime + 0.25) {
      const step = musicStep % 8;
      tone(MELODY[step], nextNoteTime - context.currentTime, 0.22, 'sine', 0.5, musicGain);
      if (step % 2 === 0) tone(BASS[(musicStep / 2) % 4 | 0], nextNoteTime - context.currentTime, 0.4, 'sine', 0.6, musicGain);
      musicStep += 1;
      nextNoteTime += STEP_SECONDS;
    }
  }

  return {
    unlock, setMuted, isMuted,
    star, nearMiss, hit, shieldBlock, powerup, wave, gameOver, start,
    updateMusic,
  };
}
