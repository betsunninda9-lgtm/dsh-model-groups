import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { createSettingsReorder, useSettingsReorder } from '../scripts/settings-reorder.mjs';

// The fake keeps geometry, pointer capture and the clock independent. It never
// calls commit itself, so these assertions exercise the production gesture.
class Events {
  listeners = new Map();
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  emit(type, fields = {}) {
    const event = { prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...fields };
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
    return event;
  }
  get listenerCount() { return [...this.listeners.values()].reduce((sum, listeners) => sum + listeners.size, 0); }
}

function fixture({ index = 1, nested = false, viewport = false } = {}) {
  const doc = new Events();
  const win = new Events();
  const timers = new Map(), frames = new Map();
  let now = 0, sequence = 0;
  Object.assign(win, {
    innerHeight: 300,
    setTimeout(fn, delay) { const id = ++sequence; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    requestAnimationFrame(fn) { const id = ++sequence; frames.set(id, fn); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    getComputedStyle(node) { return { overflowY: node.overflowY ?? 'visible' }; },
  });
  function advance(ms) {
    const until = now + ms;
    for (;;) {
      const next = [...timers].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      timers.delete(next[0]); now = next[1].at; next[1].fn();
    }
    now = until;
  }
  function frame() {
    const pending = [...frames.values()]; frames.clear();
    for (const callback of pending) callback(now);
  }
  const root = { parentElement: null };
  const scroller = { scrollTop: 100, scrollHeight: 900, clientHeight: 300, parentElement: root };
  Object.assign(doc, { defaultView: win, documentElement: root, scrollingElement: scroller });
  const list = {
    parentElement: root, overflowY: viewport ? 'visible' : 'auto',
    scrollHeight: 900, clientHeight: 300, scrollTop: 100,
    getBoundingClientRect: () => ({ left: 0, right: 300, top: 0, bottom: 300, height: 300 }),
    querySelectorAll: () => candidates,
  };
  const rows = Array.from({ length: 3 }, (_, position) => ({
    id: position, parentElement: list, isConnected: true,
    style: { outline: `outline-${position}`, opacity: `opacity-${position}`, boxShadow: `shadow-${position}` },
    getBoundingClientRect: () => ({ top: position * 100, bottom: (position + 1) * 100, height: 100 }),
  }));
  const candidates = [...rows];
  if (nested) candidates.splice(2, 0, {
    parentElement: rows[0], style: { boxShadow: 'nested-shadow' },
    getBoundingClientRect: () => ({ top: 100, bottom: 300, height: 200 }),
  });
  let captured;
  const handle = {
    ownerDocument: doc, closest: () => rows[index],
    setPointerCapture(id) { captured = id; },
    hasPointerCapture(id) { return captured === id; },
    releasePointerCapture(id) { assert.equal(captured, id); captured = undefined; },
  };
  const commits = [];
  const gesture = createSettingsReorder({ handle, row: rows[index], selector: '[data-row]', commit: offset => commits.push(offset) });
  const pointer = (x = 150, y = index * 100 + 50, fields = {}) => ({ pointerId: 7, button: 0, isPrimary: true, clientX: x, clientY: y, ...fields });
  const start = (fields = {}) => gesture.start(pointer(undefined, undefined, fields));
  let lastX = 150, lastY = index * 100 + 50;
  const move = (x, y, fields) => {
    lastX = x; lastY = y;
    return doc.emit('pointermove', pointer(x, y, fields));
  };
  const up = (x = lastX, y = lastY) => doc.emit('pointerup', pointer(x, y));
  function clean() {
    assert.equal(doc.listenerCount, 0, 'document listeners removed');
    assert.equal(win.listenerCount, 0, 'window listeners removed');
    assert.equal(timers.size, 0, 'hold timer removed');
    assert.equal(frames.size, 0, 'animation frame removed');
    assert.equal(captured, undefined, 'pointer capture released');
    assert.equal(rows[index].style.outline, `outline-${index}`);
    assert.equal(rows[index].style.opacity, `opacity-${index}`);
    for (const row of rows) assert.equal(row.style.boxShadow, `shadow-${row.id}`, 'drop preview restored');
  }
  return { doc, win, rows, candidates, list, scroller, handle, commits, gesture, pointer, start, move, up, advance, frame, timers, frames, clean };
}

test('the default 400ms hold previews a destination but commits only on pointerup', () => {
  const f = fixture();
  f.start(); f.advance(399);
  assert.equal(f.rows[1].style.opacity, 'opacity-1');
  assert.equal(f.frames.size, 0);
  assert.deepEqual(f.commits, []);
  f.advance(1);
  assert.equal(f.rows[1].style.opacity, '0.65');
  assert.equal(f.frames.size, 1);
  const moved = f.move(150, 10);
  assert.equal(moved.prevented, true);
  assert.match(f.rows[0].style.boxShadow, /inset 0 3px/);
  assert.deepEqual(f.commits, []);
  f.up();
  assert.deepEqual(f.commits, [-1]);
  f.clean();
  f.up(); f.gesture.cancel();
  assert.deepEqual(f.commits, [-1], 'termination is idempotent');
});

test('pointerup resolves its final coordinates even when the browser delivers no final pointermove', () => {
  for (const [releaseX, releaseY, expected] of [[150, 10, [-1]], [150, 290, [1]], [341, 10, []]]) {
    const f = fixture(); f.start(); f.advance(400);
    f.move(150, 10);
    assert.deepEqual(f.commits, []);
    f.up(releaseX, releaseY);
    assert.deepEqual(f.commits, expected, `release at ${releaseX}, ${releaseY}`);
    f.clean();
  }
  const noMove = fixture(); noMove.start(); noMove.advance(400); noMove.up(150, 290);
  assert.deepEqual(noMove.commits, [1], 'release can supply the first post-hold destination');
  noMove.clean();
  const missing = fixture(); missing.start(); missing.advance(400); missing.move(150, 10);
  missing.up(Number.NaN, Number.NaN);
  assert.deepEqual(missing.commits, [-1], 'invalid release coordinates retain the last known position');
  missing.clean();
});

test('short presses and pre-hold scrolling never reorder', () => {
  for (const swipe of [false, true]) {
    const f = fixture();
    f.start(); f.advance(100);
    if (swipe) {
      assert.equal(f.move(150, 161).prevented, false, 'a pre-hold swipe remains available to scrolling');
      f.clean();
    } else f.up();
    f.advance(1000); f.up();
    assert.deepEqual(f.commits, []);
    f.clean();
  }
  const f = fixture();
  f.start(); f.move(156, 158); // Exactly 10px: ordinary finger jitter.
  f.advance(400); f.move(150, 290); f.up();
  assert.deepEqual(f.commits, [1]);
  f.clean();
});

test('before/after midpoints calculate offsets in both directions and skip no-op drops', () => {
  for (const [index, y, expected] of [
    [0, 110, 0], [0, 160, 1], [0, 210, 1], [0, 260, 2],
    [2, 10, -2], [2, 60, -1], [2, 110, -1], [2, 160, 0],
  ]) {
    const f = fixture({ index });
    f.start(); f.advance(400); f.move(150, y); f.up();
    assert.deepEqual(f.commits, expected ? [expected] : [], `row ${index}, y ${y}`);
    f.clean();
  }
});

test('drop targets remain direct children of the same list and leaving its horizontal bounds cancels the target', () => {
  const f = fixture({ index: 0, nested: true });
  f.start(); f.advance(400); f.move(150, 290); f.up();
  assert.deepEqual(f.commits, [2], 'a matching nested row cannot consume the destination');
  f.clean();
  for (const x of [-41, 341]) {
    const outside = fixture();
    outside.start(); outside.advance(400); outside.move(150, 10); outside.move(x, 10); outside.up();
    assert.deepEqual(outside.commits, []);
    outside.clean();
  }
});

test('pointer cancellation, Escape, blur, hidden document, second pointer and unmount cancellation restore all resources', () => {
  const cancellations = [
    f => f.doc.emit('pointercancel', f.pointer()),
    f => assert.equal(f.doc.emit('keydown', { key: 'Escape' }).prevented, true),
    f => f.win.emit('blur'),
    f => f.doc.emit('visibilitychange'),
    f => f.doc.emit('pointerdown', f.pointer(150, 10, { pointerId: 8 })),
    f => f.move(150, 10, { pointerId: 8 }),
    f => f.gesture.cancel(),
  ];
  for (const cancel of cancellations) for (const held of [false, true]) {
    const f = fixture(); f.start();
    if (held) { f.advance(400); f.move(150, 10); }
    cancel(f); f.clean(); f.advance(1000); f.up();
    assert.deepEqual(f.commits, []);
  }
});

test('non-primary input is ignored and an unrelated pointerup does not finish an active drag', () => {
  for (const fields of [{ button: 2 }, { isPrimary: false }]) {
    const f = fixture(); f.start(fields); f.advance(400);
    assert.deepEqual(f.commits, []); f.clean();
  }
  const f = fixture(); f.start(); f.advance(400); f.move(150, 10);
  f.doc.emit('pointerup', f.pointer(150, 10, { pointerId: 8 }));
  assert.deepEqual(f.commits, []);
  assert.equal(f.frames.size, 1);
  f.up(); assert.deepEqual(f.commits, [-1]); f.clean();
});

test('edge scrolling advances only the active scroll container and stops after release', () => {
  for (const viewport of [false, true]) for (const [y, direction] of [[1, -1], [299, 1]]) {
    const f = fixture({ viewport });
    f.start(); f.advance(400);
    f.move(150, y);
    const scroller = viewport ? f.scroller : f.list;
    const other = viewport ? f.list : f.scroller;
    const before = scroller.scrollTop;
    f.frame();
    assert.equal(scroller.scrollTop - before, direction * 14);
    assert.equal(other.scrollTop, 100);
    f.gesture.cancel(); f.clean();
    f.frame(); assert.equal(scroller.scrollTop, before + direction * 14);
  }
  const centered = fixture(); centered.start(); centered.advance(400); centered.frame();
  assert.equal(centered.list.scrollTop, 100, 'no scroll away from the edge');
  centered.gesture.cancel(); centered.clean();
});

test('changed row membership or order prevents an offset from being committed against stale rows', () => {
  for (const change of [
    f => f.candidates.push({ ...f.rows[0], id: 3 }),
    f => f.candidates.splice(0, 1),
    f => f.candidates.splice(0, 2, f.rows[1], f.rows[0]),
    f => f.candidates.splice(0, 1, { ...f.rows[0] }),
  ]) {
    const f = fixture(); f.start(); f.advance(400); f.move(150, 10);
    change(f); f.up(); assert.deepEqual(f.commits, []); f.clean();
  }
  const detached = fixture(); detached.start(); detached.rows[1].isConnected = false;
  detached.advance(400); assert.deepEqual(detached.commits, []); detached.clean();
});

// Evaluate the exported hook with isolated React stubs so lost capture and
// effect cleanup use the same handlers as the generated settings editor.
function hook(config) {
  const cleanups = [];
  const react = {
    useRef: current => ({ current }),
    useEffect(effect) { const cleanup = effect(); if (cleanup) cleanups.push(cleanup); },
  };
  const make = vm.runInNewContext(`(${useSettingsReorder.toString()})`, { react, createSettingsReorder });
  return { handlers: make(config)('entry'), cleanup: () => cleanups.forEach(cleanup => cleanup()) };
}

test('hook lostpointercapture and effect unmount cleanup cancel a gesture without saving', () => {
  for (const reason of ['capture', 'unmount']) {
    const f = fixture();
    const control = hook({ selector: '[data-row]', move: (_id, offset) => f.commits.push(offset) });
    control.handlers.onPointerDown({ ...f.pointer(), currentTarget: f.handle });
    f.advance(400); f.move(150, 10);
    if (reason === 'capture') control.handlers.onLostPointerCapture();
    else control.cleanup();
    f.clean(); f.up(); assert.deepEqual(f.commits, []);
  }
});

test('hook disables native drag, exposes a touch handle and retains keyboard reordering', () => {
  const moves = [];
  const control = hook({ selector: '[data-row]', move: (id, offset) => moves.push([id, offset]) });
  assert.equal(control.handlers.draggable, false);
  assert.equal(control.handlers.style.touchAction, 'none');
  assert.equal(control.handlers.style.minHeight, 44);
  assert.equal(control.handlers.style.minWidth, 44);
  for (const key of ['ArrowUp', 'ArrowDown']) {
    const event = { key, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
    control.handlers.onKeyDown(event);
    assert.equal(event.prevented, true); assert.equal(event.stopped, true);
  }
  assert.deepEqual(moves, [['entry', -1], ['entry', 1]]);
  const f = fixture();
  const disabled = hook({ disabled: true, selector: '[data-row]', move: () => assert.fail('disabled handle moved') });
  disabled.handlers.onPointerDown({ ...f.pointer(), currentTarget: f.handle });
  disabled.handlers.onKeyDown({ key: 'ArrowDown' });
  f.advance(400); f.clean();
});
