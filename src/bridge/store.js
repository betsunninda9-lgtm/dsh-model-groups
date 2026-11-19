const INITIAL_BRIDGE_SNAPSHOT = Object.freeze({ status: 'loading', revision: 0, writable: false, providers: {} });

/** A single owner API orchestrates both Settings namespaces. */
export function createBridgeStore({ fetch: request = globalThis.fetch, endpoint = '/dsh-model-groups/bridge', forms = [] } = {}) {
  let current = INITIAL_BRIDGE_SNAPSHOT;
  let disposed = false, refreshing, refreshAgain = false, sequence = 0;
  const listeners = new Set();
  const publish = value => {
    if (disposed) return;
    current = value;
    for (const listener of [...listeners]) listener();
  };
  const body = async response => {
    const result = await response.json();
    if (!response.ok || result?.ok !== true) {
      const error = new Error(result?.error?.message ?? '操作未完成。');
      error.code = result?.error?.code ?? (response.status === 403 ? 'FORBIDDEN' : 'FAILED');
      throw error;
    }
    return result.value;
  };
  async function refresh() {
    if (disposed) return;
    if (refreshing) { refreshAgain = true; return refreshing; }
    const observed = sequence;
    refreshing = Promise.resolve().then(() => request(endpoint, { credentials: 'same-origin', cache: 'no-store' }))
      .then(body).then(async value => {
        if (observed !== sequence || disposed) return;
        if (value.initializationRequired) value = await post({ action: 'initialize' });
        if (observed === sequence && !disposed) publish(value);
      })
      .catch(error => {
        if (observed !== sequence) return;
        publish({ ...current, status: error.code === 'FORBIDDEN' ? 'forbidden' : 'error', writable: false, error: error.message });
      }).finally(() => {
        refreshing = undefined;
        if (refreshAgain && !disposed) { refreshAgain = false; refresh(); }
      });
    return refreshing;
  }
  async function post(input) {
    return body(await request(endpoint, { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) }));
  }
  const subscriptions = forms.filter(Boolean).map(form => form.subscribe(() => { refresh(); }));
  return {
    getSnapshot: () => current,
    subscribe(listener) { if (disposed) return () => {}; listeners.add(listener); return () => listeners.delete(listener); },
    refresh,
    async save(provider, draft, expectedRevision) {
      // Invalidate any GET started before this write; it cannot replace the
      // freshly committed snapshot with a stale revision.
      sequence++;
      try {
        const value = await post({ action: 'save', provider, draft, expectedRevision });
        sequence++;
        publish(value);
        return { ok: true };
      } catch (error) {
        await refresh();
        return { ok: false, code: error.code, error: error.message };
      }
    },
    async setCredential(ref, value) {
      try { return await post({ action: 'credential', ref, value }); }
      catch (error) { return { ok: false, code: error.code, error: error.message }; }
    },
    async discover(provider, entryId, draft, { apiKey, shared } = {}) {
      try { return await post({ action: 'discover', provider, entryId, draft, ...(shared === undefined ? {} : { shared }), ...(apiKey === undefined ? {} : { apiKey }) }); }
      catch (error) { return { ok: false, code: error.code, error: error.message }; }
    },
    dispose() {
      disposed = true;
      sequence++;
      listeners.clear();
      for (const unsubscribe of subscriptions) unsubscribe?.();
    },
  };
}
