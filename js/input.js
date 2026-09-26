// Split-screen touch steering:
//   left half  -> steer left      right half -> steer right
//   both halves at once -> brake; hold at a full stop -> reverse.
// Mouse and keyboard mirror the same semantics for desktop.

export const input = { left: false, right: false };

const touches = new Map();   // touch identifier -> 'left' | 'right'
let mouseZone = null;        // 'left' | 'right' | null
const keyZones = new Set();  // 'left' | 'right' held via keyboard

function zoneForX(x) {
  return x < window.innerWidth / 2 ? 'left' : 'right';
}

function recompute() {
  const zones = new Set([...touches.values(), ...keyZones]);
  if (mouseZone) zones.add(mouseZone);
  input.left = zones.has('left');
  input.right = zones.has('right');
}

export function initInput(canvas) {
  const opts = { passive: false };

  canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) touches.set(t.identifier, zoneForX(t.clientX));
    recompute();
  }, opts);

  canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (touches.has(t.identifier)) touches.set(t.identifier, zoneForX(t.clientX));
    }
    recompute();
  }, opts);

  const endTouch = (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) touches.delete(t.identifier);
    recompute();
  };
  canvas.addEventListener('touchend', endTouch, opts);
  canvas.addEventListener('touchcancel', endTouch, opts);

  // mouse: press-and-hold a half (desktop testing)
  canvas.addEventListener('mousedown', (e) => {
    mouseZone = zoneForX(e.clientX);
    recompute();
  });
  window.addEventListener('mouseup', () => { mouseZone = null; recompute(); });

  // keyboard: Left/Right or A/D steer; Space/Down/S = brake (counts as both)
  const keys = new Set();
  window.addEventListener('keydown', (e) => {
    if (['ArrowLeft', 'ArrowRight', 'ArrowDown', ' '].includes(e.key)) e.preventDefault();
    keys.add(e.key);
    syncKeys();
  });
  window.addEventListener('keyup', (e) => { keys.delete(e.key); syncKeys(); });
  window.addEventListener('blur', () => { keys.clear(); syncKeys(); });

  function syncKeys() {
    keyZones.clear();
    if (keys.has('ArrowLeft') || keys.has('a') || keys.has('A')) keyZones.add('left');
    if (keys.has('ArrowRight') || keys.has('d') || keys.has('D')) keyZones.add('right');
    if (keys.has(' ') || keys.has('ArrowDown') || keys.has('s') || keys.has('S')) {
      keyZones.add('left'); keyZones.add('right');   // brake = both halves
    }
    recompute();
  }
}
