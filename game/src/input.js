// Keyboard and pointer input. Held keys give a steering direction; moving the
// pointer steers the ship toward it instead, and the last device used wins.
// One-shot presses (start or restart, pause, mute) are queued as bit flags and
// taken once by the loop, so a press between two frames is never lost and never
// counted twice.

export const ACTION_CONFIRM = 1;
export const ACTION_PAUSE = 2;
export const ACTION_MUTE = 4;

const LEFT = new Set(['ArrowLeft', 'KeyA']);
const RIGHT = new Set(['ArrowRight', 'KeyD']);
const CONFIRM = new Set(['Space', 'Enter']);
const PAUSE = new Set(['KeyP', 'Escape']);
const MUTE = new Set(['KeyM']);

export function createInput(target) {
  let left = false;
  let right = false;
  let actions = 0;
  /** The pointer's x in field coordinates, or null when the keyboard steers. */
  let pointerX = null;

  window.addEventListener('keydown', (event) => {
    if (LEFT.has(event.code)) {
      left = true;
      pointerX = null;
    } else if (RIGHT.has(event.code)) {
      right = true;
      pointerX = null;
    } else if (CONFIRM.has(event.code)) {
      if (!event.repeat) actions |= ACTION_CONFIRM;
    } else if (PAUSE.has(event.code)) {
      if (!event.repeat) actions |= ACTION_PAUSE;
    } else if (MUTE.has(event.code)) {
      if (!event.repeat) actions |= ACTION_MUTE;
    } else return;
    event.preventDefault();
  });
  window.addEventListener('keyup', (event) => {
    if (LEFT.has(event.code)) left = false;
    else if (RIGHT.has(event.code)) right = false;
  });
  // A key released while the tab is hidden never sends keyup: let go of everything on blur.
  window.addEventListener('blur', () => {
    left = false;
    right = false;
  });
  target.addEventListener('pointerdown', (event) => {
    actions |= ACTION_CONFIRM;
    pointerX = pointerFieldX(event);
  });
  target.addEventListener('pointermove', (event) => {
    if (event.buttons > 0 || event.pointerType === 'mouse') pointerX = pointerFieldX(event);
  });

  /** The pointer's x mapped into the 1280-wide field the game simulates. */
  function pointerFieldX(event) {
    const rect = target.getBoundingClientRect();
    const scale = Math.min(rect.width / 1280, rect.height / 720);
    const offsetX = (rect.width - 1280 * scale) / 2;
    return (event.clientX - rect.left - offsetX) / scale;
  }

  return {
    /** -1 for left, 1 for right, 0 for neither or both. */
    direction() {
      return (right ? 1 : 0) - (left ? 1 : 0);
    },
    /** The pointer target, or null when the keyboard is steering. */
    pointerTarget() {
      return pointerX;
    },
    /** The one-shot presses since the last call, as ACTION_* flags. */
    takeActions() {
      const taken = actions;
      actions = 0;
      return taken;
    },
  };
}
