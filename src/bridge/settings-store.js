const clone = value => value === undefined ? undefined : structuredClone(value);

/** Adapt the public Settings service without touching a profile file directly. */
export function createBridgeSettingsStore(settings, { namespace = 'model-groups', path = ['bridge', 'providers'] } = {}) {
  const descriptor = () => {
    const value = settings.describe().find(item => item.ns === namespace);
    if (!value) throw Object.assign(new Error('SETTINGS_UNAVAILABLE'), { code: 'SETTINGS_UNAVAILABLE' });
    return value;
  };
  return {
    async read() {
      const current = descriptor();
      const providers = path.reduce((value, key) => value?.[key], current.value) ?? {};
      return { revision: current.revision, providers: clone(providers) };
    },
    async readIgnoredProviders() {
      const current = descriptor();
      const live = path.reduce((value, key) => value?.[key], current.value) ?? {};
      const configured = path.reduce((value, key) => value?.[key], current.user) ?? {};
      return clone(Object.fromEntries(Object.entries(configured).filter(([route]) => !Object.hasOwn(live, route))));
    },
    async writeProvider(route, value, expectedRevision) {
      if (typeof route !== 'string' || !route || ['__proto__', 'constructor', 'prototype'].includes(route)) throw new Error('INVALID_PROVIDER');
      const operation = { op: value === undefined ? 'unset' : 'set', path: [...path, route] };
      if (value !== undefined) operation.value = clone(value);
      try { await settings.mutate(namespace, [operation], expectedRevision); }
      catch (error) {
        const rules = [
          [/^HMR transactions cannot be nested$/, 'HMR_MIGRATION_DEFERRED'],
          [/^Configuration for .+ is overridden by a home patch or command-line overlay$/, 'CONFIG_OVERLAY'],
          [/^Configuration entry is no longer available$/, 'CONFIG_ENTRY_UNAVAILABLE'],
          [/^Configuration entry changed during reload$/, 'CONFIG_ENTRY_CHANGED'],
          [/^Configuration plugin is no longer active$/, 'CONFIG_PLUGIN_INACTIVE'],
          [/^Config field .+ is not volatile$/, 'CONFIG_FIELD_NOT_VOLATILE'],
          [/^Plugin entry .+ (?:is no longer configurable|has no volatile fields)$/, 'CONFIG_ENTRY_UNAVAILABLE'],
          [/^No configurable plugin entry /, 'CONFIG_ENTRY_UNAVAILABLE'],
          [/^Profile patch must be a YAML sequence$/, 'CONFIG_DOCUMENT_INVALID'],
        ];
        const code = rules.find(([pattern]) => pattern.test(String(error?.message ?? '')))?.[1];
        if (code) throw Object.assign(new Error(code), { code });
        throw error;
      }
      return this.read();
    },
  };
}
