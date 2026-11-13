// Serialized into the hash-verified HOST settings patch by its generator.
// No configuration or credentials are written here: commit changes one draft.
export function createSettingsReorder({ handle, row, selector, commit, delay = 400 }) {
  const doc = handle.ownerDocument;
  const win = doc.defaultView;
  const list = row.parentElement;
  const rows = () => [...list.querySelectorAll(selector)].filter(item => item.parentElement === list);
  const original = rows();
  let active = false, stopped = false, timer, frame, target, half;
  let x, y, startX, startY, pointerId;
  const oldOutline = row.style.outline;
  const oldOpacity = row.style.opacity;
  let targetShadow;
  function clearTarget() {
    if (target) target.style.boxShadow = targetShadow;
    target = undefined;
  }
  function locate() {
    clearTarget();
    const bounds = list.getBoundingClientRect();
    if (x < bounds.left - 40 || x > bounds.right + 40) return;
    const candidates = rows().filter(item => item !== row && item.getBoundingClientRect().height > 0);
    target = candidates.find(item => y < item.getBoundingClientRect().bottom) ?? candidates.at(-1);
    if (!target) return;
    const rect = target.getBoundingClientRect();
    half = y < rect.top + rect.height / 2 ? 'before' : 'after';
    targetShadow = target.style.boxShadow;
    target.style.boxShadow = `inset 0 ${half === 'before' ? 3 : -3}px 0 var(--dsw-alias-label-primary, #679cff)`;
  }
  const scrollParent = () => {
    for (let node = list; node && node !== doc.documentElement; node = node.parentElement) {
      if (node.scrollHeight > node.clientHeight && /auto|scroll/.test(win.getComputedStyle(node).overflowY)) return node;
    }
    return doc.scrollingElement;
  };
  function tick() {
    if (!active || stopped) return;
    const scroll = scrollParent();
    if (scroll) {
      const viewport = scroll === doc.scrollingElement;
      const rect = viewport ? { top: 0, bottom: win.innerHeight } : scroll.getBoundingClientRect();
      const top = Math.max(0, rect.top), bottom = Math.min(win.innerHeight, rect.bottom);
      const speed = y < top + 56 ? -Math.min(14, (top + 56 - y) / 3) : y > bottom - 56 ? Math.min(14, (y - bottom + 56) / 3) : 0;
      if (speed) { scroll.scrollTop += speed; locate(); }
    }
    frame = win.requestAnimationFrame(tick);
  }
  function cancel() { finish(false); }
  function move(event) {
    if (event.pointerId !== pointerId) { cancel(); return; }
    x = event.clientX; y = event.clientY;
    if (!active) {
      // A swipe before activation is never interpreted as a reorder.
      if (Math.hypot(x - startX, y - startY) > 10) cancel();
      return;
    }
    event.preventDefault();
    locate();
  }
  function up(event) {
    if (event.pointerId !== pointerId) return;
    if (Number.isFinite(event.clientX)) x = event.clientX;
    if (Number.isFinite(event.clientY)) y = event.clientY;
    if (active) locate();
    finish(true);
  }
  function escape(event) { if (event.key === 'Escape') { event.preventDefault(); cancel(); } }
  function context(event) { event.preventDefault(); }
  function finish(save) {
    if (stopped) return;
    stopped = true;
    win.clearTimeout(timer); win.cancelAnimationFrame(frame);
    doc.removeEventListener('pointermove', move, true);
    doc.removeEventListener('pointerup', up, true);
    doc.removeEventListener('pointercancel', cancel, true);
    doc.removeEventListener('pointerdown', secondPointer, true);
    doc.removeEventListener('keydown', escape, true);
    doc.removeEventListener('contextmenu', context, true);
    win.removeEventListener('blur', cancel);
    doc.removeEventListener('visibilitychange', cancel);
    const destination = target;
    clearTarget(); row.style.outline = oldOutline; row.style.opacity = oldOpacity;
    if (handle.hasPointerCapture?.(pointerId)) handle.releasePointerCapture(pointerId);
    const current = rows();
    // Do not apply an offset to a list changed by another control while held.
    if (!save || !active || !destination || current.length !== original.length || current.some((item, index) => item !== original[index])) return;
    const from = current.indexOf(row), at = current.indexOf(destination);
    const insertion = at + (half === 'after' ? 1 : 0);
    const to = insertion > from ? insertion - 1 : insertion;
    if (from >= 0 && to >= 0 && to !== from) commit(to - from);
  }
  function secondPointer(event) { if (event.pointerId !== pointerId) cancel(); }
  return {
    start(event) {
      if (event.button !== 0 || event.isPrimary === false) return;
      pointerId = event.pointerId; x = startX = event.clientX; y = startY = event.clientY;
      handle.setPointerCapture?.(pointerId);
      doc.addEventListener('pointermove', move, { capture: true, passive: false });
      doc.addEventListener('pointerup', up, true);
      doc.addEventListener('pointercancel', cancel, true);
      doc.addEventListener('pointerdown', secondPointer, true);
      doc.addEventListener('keydown', escape, true);
      doc.addEventListener('contextmenu', context, true);
      win.addEventListener('blur', cancel);
      doc.addEventListener('visibilitychange', cancel);
      timer = win.setTimeout(() => {
        if (stopped || !row.isConnected) { cancel(); return; }
        active = true;
        row.style.outline = '2px solid var(--dsw-alias-label-primary, #679cff)';
        row.style.opacity = '0.65';
        locate(); tick();
      }, delay);
    }, cancel
  };
}

export function useSettingsReorder(config) {
  const latest = (0, react.useRef)(config);
  latest.current = config;
  const gesture = (0, react.useRef)();
  (0, react.useEffect)(() => {
    if (config.disabled) gesture.current?.cancel();
    return () => gesture.current?.cancel();
  }, [config.disabled]);
  return id => ({
    draggable: false,
    style: { minWidth: 44, minHeight: 44, touchAction: 'none', userSelect: 'none', WebkitTouchCallout: 'none', cursor: 'grab', flexShrink: 0 },
    onContextMenu: event => event.preventDefault(),
    onClick: event => { event.preventDefault(); event.stopPropagation(); },
    onPointerDown: event => {
      if (latest.current.disabled || event.button !== 0 || event.isPrimary === false) return;
      gesture.current?.cancel();
      const handle = event.currentTarget;
      const row = handle.closest(latest.current.selector);
      if (!row) return;
      gesture.current = createSettingsReorder({ handle, row, selector: latest.current.selector, commit: offset => {
        if (!latest.current.disabled) latest.current.move(id, offset);
      } });
      gesture.current.start(event);
    },
    onLostPointerCapture: () => gesture.current?.cancel(),
    onKeyDown: event => {
      if (latest.current.disabled || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
      event.preventDefault(); event.stopPropagation();
      latest.current.move(id, event.key === 'ArrowUp' ? -1 : 1);
    }
  });
}
