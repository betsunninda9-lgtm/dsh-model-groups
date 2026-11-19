// Read-only projection for the existing picker and its fallback. Neither input
// form is written: the backend owns projection, revision checks and rollback.
export function createBridgeProvidersForm(nativeForm, bridgeForm) {
  const unavailable = Object.freeze({ status: 'unavailable', value: {} });
  const listeners = new Set();
  const disposers = [];
  let disposed = false;
  let heldNative, heldBridge, previousNative, previousBridge, snapshot = unavailable;
  const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const read = form => {
    try { return form?.getSnapshot?.() ?? unavailable; } catch { return unavailable; }
  };
  const bridgeProviders = value => record(value?.providers) ? value.providers : value?.value?.providers;
  const safeEntry = id => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(id)
    && !['__proto__', 'prototype', 'constructor'].includes(id);
  const copy = value => JSON.parse(JSON.stringify(value));
  function routedEntries(state) {
    if (state.routing === undefined) return state.keyEntries;
    if (!record(state.routing)) return {};
    const rank = entry => Number.isSafeInteger(entry?.sortOrder) && entry.sortOrder >= 0 ? entry.sortOrder : Infinity;
    const order = new Map(Object.entries(state.keyEntries).sort(([, a], [, b]) => rank(a) - rank(b)).map(([id], index) => [id, index]));
    const mapped = [];
    for (const [token, id] of Object.entries(state.routing)) {
      if (!safeEntry(token)) continue;
      if (id === null) {
        if (Array.isArray(state.rootModels)) mapped.push({ token, root: true, entry: {
          name: '原单密钥（兼容旧会话）', models: copy(state.rootModels),
        } });
      } else if (safeEntry(id) && Object.hasOwn(state.keyEntries, id) && record(state.keyEntries[id])) {
        mapped.push({ token, id, root: false, entry: copy(state.keyEntries[id]) });
      }
    }
    mapped.sort((a, b) => Number(a.root) - Number(b.root) || (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity));
    return Object.fromEntries(mapped.map(({ token, entry }, index) => [token, { ...entry, sortOrder: index }]));
  }
  function refresh() {
    if (disposed) return snapshot;
    const incomingNative = read(nativeForm);
    const incomingBridge = read(bridgeForm);
    if (incomingNative.status === 'ready' && record(incomingNative.value)) heldNative = incomingNative;
    else if (!['loading', 'idle'].includes(incomingNative.status)) heldNative = undefined;
    if (incomingBridge.status === 'ready' && record(bridgeProviders(incomingBridge))) heldBridge = incomingBridge;
    else if (!['loading', 'idle'].includes(incomingBridge.status)) heldBridge = undefined;
    const native = ['loading', 'idle'].includes(incomingNative.status) && heldNative ? heldNative : incomingNative;
    const bridge = ['loading', 'idle'].includes(incomingBridge.status) && heldBridge ? heldBridge : incomingBridge;
    if (native === previousNative && bridge === previousBridge) return snapshot;
    previousNative = native;
    previousBridge = bridge;
    let next = native;
    if (native.status === 'ready' && record(native.value) && bridge.status === 'ready') {
      let providers;
      for (const [route, state] of Object.entries(bridgeProviders(bridge) ?? {})) {
        if (['__proto__', 'prototype', 'constructor'].includes(route)
          || state?.enabled !== true || state?.active !== true || state?.confirmed !== true
          || !record(state.keyEntries)) continue;
        providers ??= { ...native.value.providers };
        const original = Object.hasOwn(providers, route) ? providers[route] : {};
        Object.defineProperty(providers, route, { enumerable: true, configurable: true, writable: true,
          value: { ...original, multiKey: true, bridgeRouting: true, keyEntries: routedEntries(state) } });
      }
      if (providers) next = { ...native, value: { ...native.value, providers } };
    }
    snapshot = next;
    return snapshot;
  }
  function changed() {
    if (disposed) return;
    const previous = snapshot;
    refresh();
    if (snapshot !== previous) for (const listener of [...listeners]) listener();
  }
  refresh();
  for (const form of [nativeForm, bridgeForm]) {
    if (typeof form?.subscribe === 'function') disposers.push(form.subscribe(changed));
  }
  // Cover updates between the initial read and subscription registration.
  refresh();
  return {
    getSnapshot: () => disposed ? snapshot : refresh(),
    subscribe(listener) {
      if (disposed) return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const dispose of disposers) dispose?.();
      listeners.clear();
      heldNative = heldBridge = undefined;
      // A retained face must not keep advertising a bridge that was unloaded.
      snapshot = read(nativeForm);
    },
  };
}
