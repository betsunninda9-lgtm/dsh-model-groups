// Generated public-service backend for dsh-model-groups 0.4.0-alpha.15.

// src/hierarchy.js
var KEY_MODEL_PREFIX = "@dsh-key/";
var KEY_ENTRY_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
var forbiddenEntry = (id) => ["__proto__", "prototype", "constructor"].includes(id);
function decodeKeyModelId(model) {
  if (typeof model !== "string" || !model.startsWith(KEY_MODEL_PREFIX)) return void 0;
  const parts = model.slice(KEY_MODEL_PREFIX.length).split("/");
  if (parts.length !== 2) return void 0;
  try {
    const entryId = decodeURIComponent(parts[0]);
    const modelId = decodeURIComponent(parts[1]);
    if (!KEY_ENTRY_ID.test(entryId) || forbiddenEntry(entryId) || !modelId || modelId.startsWith(KEY_MODEL_PREFIX)) return void 0;
    if (`${KEY_MODEL_PREFIX}${encodeURIComponent(entryId)}/${encodeURIComponent(modelId)}` !== model) return void 0;
    return { entryId, modelId };
  } catch {
    return void 0;
  }
}
function orderedKeyEntries(entries) {
  const rank = (entry) => Number.isSafeInteger(entry?.sortOrder) && entry.sortOrder >= 0 ? entry.sortOrder : Infinity;
  return Object.entries(entries ?? {}).sort(([, left], [, right]) => {
    const a = rank(left), b = rank(right);
    return a === b ? 0 : a < b ? -1 : 1;
  });
}

// src/capability-defaults.js
function applyModelCapabilities(model, defaults) {
  const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  const overrides = model.capabilityOverrides;
  if (defaults !== void 0 && (!object(defaults) || Object.keys(defaults).some((key) => key !== "vision" && key !== "reasoning") || typeof defaults.vision !== "boolean" || typeof defaults.reasoning !== "boolean")) {
    throw new TypeError("capabilityDefaults must contain only boolean vision and reasoning");
  }
  if (overrides !== void 0 && (!object(overrides) || Object.keys(overrides).some((key) => key !== "vision" && key !== "reasoning") || Object.values(overrides).some((value) => typeof value !== "boolean" && value !== "original"))) {
    throw new TypeError("capabilityOverrides must contain only boolean or original vision and reasoning");
  }
  const { capabilityOverrides: ignored, ...effective } = model;
  if (defaults === void 0) return effective;
  const choice = (key) => overrides?.[key] === "original" ? void 0 : overrides?.[key] ?? defaults[key];
  const vision = choice("vision");
  if (vision !== void 0) {
    const input = Array.isArray(model.input) ? [...model.input] : ["text"];
    effective.input = [...new Set(input.filter((value) => vision || value !== "image"))];
    if (effective.input.length === 0) effective.input.push("text");
    if (vision && !effective.input.includes("image")) effective.input.push("image");
  }
  const reasoning = choice("reasoning");
  if (reasoning === false) effective.reasoningEfforts = false;
  if (reasoning === true) {
    const levels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
    const efforts = model.reasoningEfforts;
    const valid = object(efforts) && Object.keys(efforts).every((key) => levels.includes(key)) && Object.entries(efforts).every(([key, value]) => key === "off" && value === null || typeof value === "string" && value.length > 0) && Object.keys(efforts).some((key) => key !== "off");
    effective.reasoningEfforts = valid ? { ...efforts } : { off: null, low: "low", medium: "medium", high: "high" };
  }
  return effective;
}
function validateCapabilityBatch(batch) {
  if (batch !== void 0 && (batch === null || typeof batch !== "object" || Array.isArray(batch) || Object.keys(batch).some((key) => key !== "vision" && key !== "reasoning") || Object.values(batch).some((value) => typeof value !== "boolean"))) {
    throw new TypeError("capabilityBatch must contain only boolean vision and reasoning");
  }
  return batch;
}
function materializeCapabilityEntry(entry) {
  validateCapabilityBatch(entry.capabilityBatch);
  const { capabilityDefaults, ...rest } = entry;
  applyModelCapabilities({}, capabilityDefaults);
  const models = (Array.isArray(entry.models) ? entry.models : []).map((model) => applyModelCapabilities(model, capabilityDefaults));
  const capabilityBatch = capabilityDefaults === void 0 ? entry.capabilityBatch : { ...capabilityDefaults, ...entry.capabilityBatch };
  return { ...rest, models, ...capabilityBatch === void 0 ? {} : { capabilityBatch } };
}

// src/bridge/profile.js
var PROTOCOLS = /* @__PURE__ */ new Set(["openai-completions", "openai-responses", "anthropic-messages"]);
var RAW_SECRET_FIELDS = /* @__PURE__ */ new Set(["apiKey", "apiKeyValue", "password", "api_key", "accessToken", "secret"]);
var AUTH_HEADERS = /* @__PURE__ */ new Set(["authorization", "proxy-authorization", "x-api-key", "api-key", "cf-aig-authorization"]);
var hasRawSecret = (value) => value && typeof value === "object" && Object.entries(value).some(([key, child]) => RAW_SECRET_FIELDS.has(key) || hasRawSecret(child));
function publicBridgeEntries(entries) {
  const project = (value, headers = false) => Array.isArray(value) ? value.map((item) => project(item)) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).filter(([key]) => !RAW_SECRET_FIELDS.has(key) && (!headers || !AUTH_HEADERS.has(key.toLowerCase()))).map(([key, child]) => [key, project(child, key === "headers")])) : value;
  return project(entries ?? {});
}
var unsafe = (value) => ["__proto__", "prototype", "constructor"].includes(value);
var plain = (value) => value !== null && typeof value === "object" && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
var copy = (value) => structuredClone(value);
var fail = (code) => {
  const error = new Error(code);
  error.code = code;
  throw error;
};
function bridgeAlias(entryId, modelId) {
  const alias = `${KEY_MODEL_PREFIX}${encodeURIComponent(entryId)}/${encodeURIComponent(modelId)}`;
  if (!decodeKeyModelId(alias)) fail("INVALID_MODEL_IDENTITY");
  return alias;
}
function validateBridgeDraft(draft) {
  if (!plain(draft) || typeof draft.enabled !== "boolean" || !plain(draft.keyEntries)) fail("INVALID_BRIDGE_CONFIG");
  const result = { enabled: draft.enabled, keyEntries: {} };
  for (const [entryId, entry] of orderedKeyEntries(draft.keyEntries)) {
    if (unsafe(entryId) || !plain(entry)) fail("INVALID_KEY_ENTRY");
    bridgeAlias(entryId, "identity-check");
    if (entry.api !== void 0 && !PROTOCOLS.has(entry.api)) fail("INVALID_PROTOCOL");
    if (hasRawSecret(entry)) fail("USE_CREDENTIAL_REFERENCE");
    if (entry.apiKeyEnv !== void 0 && (typeof entry.apiKeyEnv !== "string" || !entry.apiKeyEnv.trim() || entry.apiKeyEnv.length > 256 || /[\r\n\0]/.test(entry.apiKeyEnv))) fail("INVALID_CREDENTIAL_REFERENCE");
    if (entry.baseURL !== void 0 && entry.baseURL !== "") {
      let url;
      try {
        url = new URL(entry.baseURL);
      } catch {
        fail("INVALID_ENDPOINT");
      }
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash) fail("INVALID_ENDPOINT");
    }
    if (!Array.isArray(entry.models)) fail("INVALID_MODELS");
    const seen = /* @__PURE__ */ new Set();
    for (const model of entry.models) {
      if (!plain(model) || typeof model.id !== "string" || !model.id.trim() || model.id !== model.id.trim() || model.id.length > 1024 || model.id.startsWith(KEY_MODEL_PREFIX) || seen.has(model.id)) fail("INVALID_MODELS");
      bridgeAlias(entryId, model.id);
      seen.add(model.id);
      for (const field of ["contextWindow", "maxTokens"]) if (model[field] !== void 0 && (!Number.isSafeInteger(model[field]) || model[field] < 1)) fail("INVALID_MODEL_CAPABILITY");
      if (model.input !== void 0 && (!Array.isArray(model.input) || !model.input.length || model.input.some((value) => !["text", "image"].includes(value)))) fail("INVALID_MODEL_CAPABILITY");
    }
    for (const headers of [entry.headers, ...entry.models.map((model) => model.headers)]) {
      if (headers !== void 0 && !plain(headers)) fail("INVALID_HEADERS");
      try {
        new Headers(headers ?? {});
      } catch {
        fail("INVALID_HEADERS");
      }
      if (Object.keys(headers ?? {}).some((name) => AUTH_HEADERS.has(name.toLowerCase()))) fail("USE_CREDENTIAL_REFERENCE");
    }
    try {
      result.keyEntries[entryId] = materializeCapabilityEntry(copy(entry));
    } catch {
      fail("INVALID_MODEL_CAPABILITY");
    }
  }
  if (draft.enabled && !Object.keys(result.keyEntries).length) fail("EMPTY_KEY_ENTRIES");
  return result;
}
function bridgeModelProjection(id, model) {
  const result = { id };
  for (const field of ["name", "contextWindow", "maxTokens", "input", "reasoningEfforts"]) {
    if (model[field] !== void 0) result[field] = copy(model[field]);
  }
  return result;
}
function createBridgeProjection(original, draft, { guardCredential, models, projectionMode = "ordinary", routing } = {}) {
  const config = validateBridgeDraft(draft);
  if (!config.enabled) fail("BRIDGE_DISABLED");
  if (typeof guardCredential !== "string" || !guardCredential) fail("GUARD_CREDENTIAL_REQUIRED");
  if (!["ordinary", "legacy"].includes(projectionMode)) fail("BRIDGE_RUNTIME_UNAVAILABLE");
  const projected = copy(original ?? {});
  delete projected.multiKey;
  delete projected.keyEntries;
  projected.api = "openai-completions";
  projected.baseURL = "http://127.0.0.1:1/dsh-model-groups-disabled";
  projected.apiKeyEnv = guardCredential;
  projected.headers = {};
  delete projected.compat;
  delete projected.modelOverrides;
  delete projected.reasoning;
  delete projected.thinkingBudgets;
  projected.models = [];
  const identities = /* @__PURE__ */ new Set();
  const push = (id, metadata) => {
    if (identities.has(id)) fail("DUPLICATE_MODEL_IDENTITY");
    identities.add(id);
    projected.models.push(bridgeModelProjection(id, metadata));
  };
  if (routing === void 0) for (const model of models?.legacy ?? original?.models ?? []) push(model.id, model);
  if (projectionMode === "legacy") {
    projected.multiKey = true;
    projected.keyEntries = {};
  }
  const routes = routing === void 0 ? Object.keys(config.keyEntries).map((id) => [id, id]) : Object.entries(routing);
  for (const [token, entryId] of routes) {
    const entry = entryId === null ? { name: "\u539F\u5355\u5BC6\u94A5\uFF08\u517C\u5BB9\u65E7\u4F1A\u8BDD\uFF09" } : config.keyEntries[entryId];
    if (!entry) fail("INVALID_KEY_ENTRY");
    const resolved = entryId === null ? models?.legacy : models?.keyEntries?.[entryId];
    if (models !== void 0 && !Array.isArray(resolved)) fail("MODEL_CAPABILITIES_REQUIRED");
    if (projectionMode === "legacy") {
      projected.keyEntries[token] = {
        name: entry.name ?? entryId,
        sortOrder: entry.sortOrder ?? 0,
        api: "openai-completions",
        apiKeyEnv: guardCredential,
        models: (resolved ?? entry.models).map((model) => bridgeModelProjection(model.id, model))
      };
    } else {
      for (const model of resolved ?? entry.models) push(bridgeAlias(token, model.id), model);
    }
  }
  return projected;
}
function sameBridgeValue(left, right) {
  const canonical2 = (value) => {
    if (Array.isArray(value)) return value.map(canonical2);
    if (plain(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical2(value[key])]));
    return value;
  };
  return JSON.stringify(canonical2(left)) === JSON.stringify(canonical2(right));
}

// src/bridge/migration.js
var entryFields = [
  "name",
  "apiKeyEnv",
  "api",
  "baseURL",
  "headers",
  "models",
  "sortOrder",
  "capabilityDefaults",
  "capabilityBatch"
];
var unsafe2 = (key) => ["__proto__", "prototype", "constructor"].includes(key);
var plain2 = (value) => value !== null && typeof value === "object" && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
function copyData(value) {
  if (Array.isArray(value)) return value.map(copyData);
  if (plain2(value)) return Object.fromEntries(Object.entries(value).filter(([key]) => !unsafe2(key)).map(([key, child]) => [key, copyData(child)]));
  if (value === void 0 || value === null || ["string", "number", "boolean"].includes(typeof value)) return value;
  throw Object.assign(new Error("INVALID_LEGACY_BRIDGE_DATA"), { code: "INVALID_LEGACY_BRIDGE_DATA" });
}
function extractLegacyBridgeDraft(profile) {
  if (!plain2(profile) || !Object.hasOwn(profile, "keyEntries") || !plain2(profile.keyEntries)) return void 0;
  const keyEntries = {};
  for (const [id, entry] of Object.entries(profile.keyEntries)) {
    if (unsafe2(id) || !plain2(entry)) continue;
    const value = {};
    for (const field of entryFields) if (Object.hasOwn(entry, field)) value[field] = copyData(entry[field]);
    Object.defineProperty(keyEntries, id, { value, enumerable: true, configurable: true, writable: true });
  }
  if (!Object.keys(keyEntries).length) return void 0;
  return { enabled: profile.multiKey === true, keyEntries };
}

// src/bridge/single-key.js
var own = (object, key) => Object.hasOwn(object ?? {}, key);
var fail2 = (code) => {
  throw Object.assign(new Error(code), { code });
};
var fields = ["id", "name", "contextWindow", "maxTokens", "input", "reasoningEfforts"];
function publicBridgeSingleKey(profile) {
  return {
    apiKeyEnv: typeof profile?.apiKeyEnv === "string" && profile.apiKeyEnv !== "DSH_MODEL_GROUPS_BRIDGE_LOCAL_GUARD" ? profile.apiKeyEnv : "",
    models: Array.isArray(profile?.models) ? profile.models.map((model) => bridgeModelProjection(model.id, model)) : []
  };
}
function validateBridgeSingleKey(patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch) || Object.keys(patch).some((key) => !["apiKeyEnv", "models"].includes(key))) fail2("INVALID_SINGLE_KEY_CONFIG");
  const result = structuredClone(patch);
  if (own(result, "apiKeyEnv") && result.apiKeyEnv !== null && (typeof result.apiKeyEnv !== "string" || !/^[A-Za-z_][A-Za-z0-9_]{0,255}$/.test(result.apiKeyEnv))) fail2("INVALID_CREDENTIAL_REFERENCE");
  if (own(result, "models")) {
    if (!Array.isArray(result.models) || result.models.some((model) => !model || typeof model !== "object" || Object.keys(model).some((key) => !fields.includes(key)))) fail2("INVALID_MODELS");
    result.models = validateBridgeDraft({ enabled: false, keyEntries: { root: { models: result.models } } }).keyEntries.root.models;
  }
  return result;
}
function applyBridgeSingleKey(original, patch) {
  const result = structuredClone(original ?? {});
  if (patch === void 0) return result;
  const value = validateBridgeSingleKey(patch);
  if (own(value, "apiKeyEnv")) {
    if (value.apiKeyEnv === null) delete result.apiKeyEnv;
    else result.apiKeyEnv = value.apiKeyEnv;
  }
  if (own(value, "models")) {
    const previous = new Map((result.models ?? []).map((model) => [model.id, model]));
    result.models = value.models.map((model) => {
      const merged = structuredClone(previous.get(model.id) ?? {});
      for (const field of fields) {
        if (own(model, field)) merged[field] = structuredClone(model[field]);
        else delete merged[field];
      }
      return merged;
    });
  }
  return result;
}

// src/bridge/shared.js
var APIS = /* @__PURE__ */ new Set(["openai-completions", "openai-responses", "anthropic-messages"]);
var PRIVATE_HEADERS = /* @__PURE__ */ new Set(["authorization", "proxy-authorization", "x-api-key", "api-key", "cf-aig-authorization"]);
var fields2 = ["displayName", "api", "baseURL", "headers"];
var plain3 = (value) => value !== null && typeof value === "object" && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
var fail3 = (code) => {
  throw Object.assign(new Error(code), { code });
};
function validateBridgeShared(patch) {
  if (!plain3(patch) || Object.keys(patch).some((key) => !fields2.includes(key))) fail3("INVALID_SHARED_CONFIG");
  const result = structuredClone(patch);
  if (result.displayName !== void 0 && result.displayName !== null) {
    if (typeof result.displayName !== "string" || result.displayName.trim().length > 160 || /[\r\n\0]/.test(result.displayName)) fail3("INVALID_SHARED_CONFIG");
    result.displayName = result.displayName.trim();
  }
  if (result.api !== void 0 && result.api !== null && !APIS.has(result.api)) fail3("INVALID_PROTOCOL");
  if (result.baseURL !== void 0 && result.baseURL !== null) {
    if (typeof result.baseURL !== "string" || result.baseURL.length > 8192) fail3("INVALID_ENDPOINT");
    result.baseURL = result.baseURL.trim();
    if (result.baseURL) {
      let url;
      try {
        url = new URL(result.baseURL);
      } catch {
        fail3("INVALID_ENDPOINT");
      }
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.hash) fail3("INVALID_ENDPOINT");
    }
  }
  if (result.headers !== void 0 && result.headers !== null) {
    if (!plain3(result.headers) || Object.values(result.headers).some((value) => typeof value !== "string")) fail3("INVALID_HEADERS");
    if (Object.keys(result.headers).some((name) => PRIVATE_HEADERS.has(name.toLowerCase()))) fail3("USE_CREDENTIAL_REFERENCE");
    try {
      new Headers(result.headers);
    } catch {
      fail3("INVALID_HEADERS");
    }
  }
  return result;
}
function applyBridgeShared(original, patch) {
  const profile = structuredClone(original ?? {});
  if (patch === void 0) return profile;
  for (const [key, value] of Object.entries(validateBridgeShared(patch))) {
    if (value === null || ["baseURL", "displayName"].includes(key) && value === "") delete profile[key];
    else profile[key] = structuredClone(value);
  }
  return profile;
}
function publicBridgeShared(profile) {
  return {
    displayName: typeof profile?.displayName === "string" ? profile.displayName : "",
    api: APIS.has(profile?.api) ? profile.api : "",
    baseURL: typeof profile?.baseURL === "string" && profile.baseURL !== "http://127.0.0.1:1/dsh-model-groups-disabled" ? profile.baseURL : "",
    headers: Object.fromEntries(Object.entries(profile?.headers ?? {}).filter(([name, value]) => !PRIVATE_HEADERS.has(name.toLowerCase()) && typeof value === "string"))
  };
}

// src/bridge/controller.js
var copy2 = (value) => value === void 0 ? void 0 : structuredClone(value);
var owns = (object, key) => Object.hasOwn(object ?? {}, key);
var failure = (code, message = code) => Object.assign(new Error(message), { code });
var projectedCaptureMatches = (actual, captured) => {
  if (Array.isArray(captured)) return Array.isArray(actual) && actual.length === captured.length && captured.every((item, index) => projectedCaptureMatches(actual[index], item));
  if (captured && typeof captured === "object") return actual && typeof actual === "object" && Object.entries(captured).every(([key, value]) => !owns(actual, key) || projectedCaptureMatches(actual[key], value));
  return sameBridgeValue(actual, captured);
};
var location = (document, route) => ({ present: owns(document.providers, route), profile: copy2(document.providers?.[route]) });
var matches = (document, route, expected) => {
  const actual = location(document, route);
  return actual.present === expected.present && sameBridgeValue(actual.profile, expected.profile);
};
function createBridgeController({ storage, native, prepare, discover, credentials, normalizeNative = (_route, profile) => profile }) {
  let busy = false;
  const exclusive = async (operation) => {
    if (busy) throw failure("BRIDGE_BUSY");
    busy = true;
    try {
      return await operation();
    } finally {
      busy = false;
    }
  };
  async function writeRecord(route, record, revision) {
    return storage.writeProvider(route, copy2(record), revision);
  }
  async function settle(route, document, nativeDocument) {
    const record = document.providers?.[route];
    const pending = record?.pending;
    if (!pending) return document;
    if (matches(nativeDocument, route, pending.after)) return writeRecord(route, pending.target, document.revision);
    if (matches(nativeDocument, route, pending.before)) return writeRecord(route, pending.previous, document.revision);
    throw failure("NATIVE_CONFIG_CONFLICT");
  }
  async function recover() {
    return exclusive(async () => {
      let document = await storage.read();
      const conflicts = [];
      const ignored = await storage.readIgnoredProviders?.();
      for (const [route, record] of Object.entries(ignored ?? {})) {
        if (owns(document.providers, route)) continue;
        let admitted = false;
        let draft;
        try {
          draft = validateBridgeDraft(record);
          const current = await native.read();
          admitted = record?.pending ? matches(current, route, record.pending.before) || matches(current, route, record.pending.after) : record?.active === true && record?.confirmed === true && typeof record.original?.present === "boolean" && sameBridgeValue(current.providers?.[route], record.projection);
        } catch {
        }
        if (!admitted) {
          conflicts.push(route);
          continue;
        }
        document = await writeRecord(route, { ...copy2(record), ...draft }, document.revision);
      }
      for (const route of Object.keys(document.providers ?? {})) {
        if (!document.providers[route]?.pending) continue;
        try {
          document = await settle(route, document, await native.read());
        } catch {
          conflicts.push(route);
          document = await storage.read();
        }
      }
      return { ...document, recoveryConflicts: conflicts };
    });
  }
  async function save(route, draft, expectedRevision) {
    return exclusive(async () => {
      if (typeof route !== "string" || !route || ["__proto__", "constructor", "prototype"].includes(route)) throw failure("INVALID_PROVIDER");
      const config = validateBridgeDraft(draft);
      const sharedPatch = draft.shared === void 0 ? void 0 : validateBridgeShared(draft.shared);
      const singlePatch = draft.singleKey === void 0 ? void 0 : validateBridgeSingleKey(draft.singleKey);
      let document = await storage.read();
      if (document.revision !== expectedRevision) throw failure("SETTINGS_CONFLICT");
      let nativeDocument = await native.read();
      if (draft.expectedNativeRevision !== void 0 && (!Number.isSafeInteger(draft.expectedNativeRevision) || draft.expectedNativeRevision !== nativeDocument.revision)) throw failure("NATIVE_CONFIG_CONFLICT");
      if (document.providers?.[route]?.pending) {
        const pending = document.providers[route].pending;
        if (!matches(nativeDocument, route, pending.after) && !matches(nativeDocument, route, pending.before) && !config.enabled) {
          const original2 = pending.target?.original ?? pending.previous?.original ?? pending.before;
          document = await writeRecord(route, {
            ...config,
            active: false,
            confirmed: false,
            original: copy2(original2),
            generation: (pending.target?.generation ?? 0) + 1
          }, document.revision);
          return { ok: true, revision: document.revision };
        }
        document = await settle(route, document, nativeDocument);
        throw failure("SETTINGS_CONFLICT");
      }
      const previous = copy2(document.providers?.[route]);
      const before = location(nativeDocument, route);
      const nativeConflict = previous?.active && !sameBridgeValue(before.profile, previous.projection);
      if (nativeConflict && config.enabled) throw failure("NATIVE_CONFIG_CONFLICT");
      if (previous?.migrationOriginal && !matches(nativeDocument, route, previous.migrationBaseline)) throw failure("NATIVE_CONFIG_CONFLICT");
      const baseOriginal = copy2(previous?.active ? previous.original : previous?.migrationOriginal ?? before);
      const original = sharedPatch === void 0 && singlePatch === void 0 ? baseOriginal : {
        ...baseOriginal,
        present: true,
        profile: applyBridgeSingleKey(applyBridgeShared(baseOriginal.profile, sharedPatch), singlePatch)
      };
      let target;
      let after;
      if (config.enabled) {
        const prepared = await prepare(route, copy2(config), copy2(original.profile));
        const projection = await normalizeNative(route, createBridgeProjection(original.profile, config, prepared));
        if (previous?.active && sameBridgeValue(previous.original, original) && sameBridgeValue(previous.projection, projection) && sameBridgeValue({ enabled: previous.enabled, keyEntries: previous.keyEntries }, config)) {
          return { ok: true, revision: document.revision };
        }
        target = {
          ...config,
          active: true,
          confirmed: true,
          original: copy2(original),
          projection,
          ...prepared.routing === void 0 ? {} : { routing: copy2(prepared.routing), rootModels: copy2(prepared.models?.legacy ?? []) },
          generation: (previous?.generation ?? 0) + 1
        };
        after = { present: true, profile: copy2(projection) };
      } else {
        target = {
          ...config,
          active: false,
          confirmed: false,
          original: copy2(original),
          generation: (previous?.generation ?? 0) + 1
        };
        after = copy2(previous?.active && !nativeConflict ? original : before);
        if (sharedPatch !== void 0 || singlePatch !== void 0) {
          after.present = true;
          after.profile = applyBridgeSingleKey(applyBridgeShared(after.profile, sharedPatch), singlePatch);
        }
        if (!nativeConflict && after.profile?.multiKey === true) after.profile.multiKey = false;
        if (after.present) after.profile = await normalizeNative(route, after.profile);
      }
      nativeDocument = await native.read();
      if (!matches(nativeDocument, route, before)) throw failure("NATIVE_CONFIG_CONFLICT");
      const staged = {
        ...previous ?? { ...config, active: false, confirmed: false },
        pending: { previous, target, before, after }
      };
      document = await writeRecord(route, staged, document.revision);
      try {
        if (!matches(nativeDocument, route, after)) {
          await native.writeProvider(route, after.present ? after.profile : void 0, nativeDocument.revision);
        }
        const verified = await native.read();
        if (!matches(verified, route, after)) throw failure("NATIVE_CONFIG_CONFLICT");
        document = await writeRecord(route, target, document.revision);
        return { ok: true, revision: document.revision };
      } catch (error) {
        const currentNative = await native.read();
        try {
          await settle(route, document, currentNative);
        } catch {
        }
        throw error;
      }
    });
  }
  async function snapshot() {
    const document = await storage.read();
    const nativeDocument = await native.read();
    const providers = {};
    for (const [route, saved] of Object.entries(document.providers ?? {})) {
      let record = saved;
      if (saved.pending) {
        if (matches(nativeDocument, route, saved.pending.after)) record = saved.pending.target;
        else if (matches(nativeDocument, route, saved.pending.before)) record = saved.pending.previous;
        else record = { ...saved, confirmed: false, conflict: true };
      }
      if (!record) continue;
      providers[route] = {
        enabled: record.enabled,
        active: record.active,
        confirmed: record.confirmed && (!record.active || sameBridgeValue(nativeDocument.providers?.[route], record.projection)),
        keyEntries: publicBridgeEntries(record.keyEntries),
        generation: record.generation,
        shared: publicBridgeShared(record.active ? record.original?.profile : record.migrationOriginal?.profile ?? nativeDocument.providers?.[route]),
        singleKey: publicBridgeSingleKey(record.active ? record.original?.profile : record.migrationOriginal?.profile ?? nativeDocument.providers?.[route]),
        ...record.routing === void 0 ? {} : { routing: copy2(record.routing), rootModels: copy2(record.rootModels ?? []) },
        conflict: record.conflict === true || record.active === true && !sameBridgeValue(nativeDocument.providers?.[route], record.projection)
      };
    }
    for (const [route, profile] of Object.entries(nativeDocument.providers ?? {})) {
      if (owns(providers, route)) continue;
      const legacy = extractLegacyBridgeDraft(profile);
      if (legacy) providers[route] = { ...legacy, singleKey: publicBridgeSingleKey(profile), shared: publicBridgeShared(profile), keyEntries: publicBridgeEntries(legacy.keyEntries), active: false, confirmed: false, migration: true };
      else providers[route] = { enabled: false, active: false, confirmed: false, keyEntries: {}, singleKey: publicBridgeSingleKey(profile), shared: publicBridgeShared(profile) };
    }
    return { status: "ready", revision: document.revision, nativeRevision: nativeDocument.revision, writable: true, providers };
  }
  async function synchronize() {
    let document = await storage.read();
    const nativeDocument = await native.read();
    const routes = /* @__PURE__ */ new Set([...Object.keys(document.providers ?? {}), ...Object.keys(nativeDocument.providers ?? {})]);
    const failures = [];
    for (const route of routes) {
      const saved = document.providers?.[route];
      const draft = saved?.active || saved?.migrationOriginal ? { enabled: saved.enabled, keyEntries: saved.keyEntries } : !saved ? extractLegacyBridgeDraft(nativeDocument.providers?.[route]) : void 0;
      if (!draft) continue;
      try {
        await save(route, draft, document.revision);
      } catch {
        failures.push(route);
      }
      document = await storage.read();
    }
    return { ok: failures.length === 0, failures };
  }
  async function importLegacy(profiles) {
    return exclusive(async () => {
      let document = await storage.read();
      const nativeDocument = await native.read();
      const imported = [], conflicts = [];
      for (const [route, profile] of Object.entries(profiles ?? {})) {
        if (owns(document.providers, route)) continue;
        const draft = extractLegacyBridgeDraft(profile);
        if (!draft) continue;
        if (!owns(nativeDocument.providers, route)) {
          conflicts.push(route);
          continue;
        }
        const current = nativeDocument.providers[route];
        if (Object.entries(profile).some(([key, value]) => !["keyEntries", "multiKey"].includes(key) && owns(current, key) && !projectedCaptureMatches(current[key], value))) {
          conflicts.push(route);
          continue;
        }
        const record = {
          ...validateBridgeDraft(draft),
          active: false,
          confirmed: false,
          migrationOriginal: { present: true, profile: copy2(profile) },
          migrationBaseline: location(nativeDocument, route)
        };
        document = await writeRecord(route, record, document.revision);
        imported.push(route);
      }
      return { imported, conflicts };
    });
  }
  async function executionSnapshot(route) {
    const document = await storage.read();
    const nativeDocument = await native.read();
    let record = document.providers?.[route];
    if (record?.pending) {
      if (matches(nativeDocument, route, record.pending.after)) record = record.pending.target;
      else if (matches(nativeDocument, route, record.pending.before)) record = record.pending.previous;
      else throw failure("NATIVE_CONFIG_CONFLICT");
    }
    if (!record?.enabled || !record.active) {
      const profile = nativeDocument.providers?.[route];
      if (profile?.multiKey === true && profile.baseURL !== "http://127.0.0.1:1/dsh-model-groups-disabled" && profile.apiKeyEnv !== "DSH_MODEL_GROUPS_BRIDGE_LOCAL_GUARD") {
        return { legacyNative: true, keyEntries: copy2(profile.keyEntries ?? {}) };
      }
      return void 0;
    }
    if (!sameBridgeValue(nativeDocument.providers?.[route], record.projection)) throw failure("NATIVE_CONFIG_CONFLICT");
    return copy2(record);
  }
  return {
    save,
    recover,
    synchronize,
    importLegacy,
    snapshot,
    executionSnapshot,
    async setCredential(ref, value) {
      if (typeof ref !== "string" || !/^[A-Za-z_][A-Za-z0-9_]{0,255}$/.test(ref)) throw failure("INVALID_CREDENTIAL_REFERENCE");
      if (typeof value !== "string" || !value.trim() || value.length > 16384 || /[\r\n\0]/.test(value)) throw failure("INVALID_CREDENTIAL_VALUE");
      if (!credentials?.set) throw failure("CREDENTIALS_UNAVAILABLE");
      await credentials.set(ref, value);
      return { ok: true };
    },
    async discover(route, entryId, entryDraft, { apiKey, shared } = {}) {
      if (apiKey !== void 0 && (typeof apiKey !== "string" || apiKey.length > 16384 || !/^[\x21-\x7E]+$/.test(apiKey))) throw failure("INVALID_CREDENTIAL_VALUE");
      const entry = { ...copy2(entryDraft), models: [] };
      if (entryId === void 0) validateBridgeSingleKey(entry);
      else validateBridgeDraft({ enabled: true, keyEntries: { [entryId]: entry } });
      if (!discover) throw failure("DISCOVERY_UNAVAILABLE");
      return { ok: true, models: await discover(route, entryId, entry, { apiKey, ...shared === void 0 ? {} : { shared: validateBridgeShared(shared) } }) };
    }
  };
}

// src/bridge/settings-store.js
var clone = (value) => value === void 0 ? void 0 : structuredClone(value);
function createBridgeSettingsStore(settings, { namespace = "model-groups", path: path4 = ["bridge", "providers"] } = {}) {
  const descriptor = () => {
    const value = settings.describe().find((item) => item.ns === namespace);
    if (!value) throw Object.assign(new Error("SETTINGS_UNAVAILABLE"), { code: "SETTINGS_UNAVAILABLE" });
    return value;
  };
  return {
    async read() {
      const current = descriptor();
      const providers = path4.reduce((value, key) => value?.[key], current.value) ?? {};
      return { revision: current.revision, providers: clone(providers) };
    },
    async readIgnoredProviders() {
      const current = descriptor();
      const live = path4.reduce((value, key) => value?.[key], current.value) ?? {};
      const configured = path4.reduce((value, key) => value?.[key], current.user) ?? {};
      return clone(Object.fromEntries(Object.entries(configured).filter(([route]) => !Object.hasOwn(live, route))));
    },
    async writeProvider(route, value, expectedRevision) {
      if (typeof route !== "string" || !route || ["__proto__", "constructor", "prototype"].includes(route)) throw new Error("INVALID_PROVIDER");
      const operation = { op: value === void 0 ? "unset" : "set", path: [...path4, route] };
      if (value !== void 0) operation.value = clone(value);
      try {
        await settings.mutate(namespace, [operation], expectedRevision);
      } catch (error) {
        const rules = [
          [/^HMR transactions cannot be nested$/, "HMR_MIGRATION_DEFERRED"],
          [/^Configuration for .+ is overridden by a home patch or command-line overlay$/, "CONFIG_OVERLAY"],
          [/^Configuration entry is no longer available$/, "CONFIG_ENTRY_UNAVAILABLE"],
          [/^Configuration entry changed during reload$/, "CONFIG_ENTRY_CHANGED"],
          [/^Configuration plugin is no longer active$/, "CONFIG_PLUGIN_INACTIVE"],
          [/^Config field .+ is not volatile$/, "CONFIG_FIELD_NOT_VOLATILE"],
          [/^Plugin entry .+ (?:is no longer configurable|has no volatile fields)$/, "CONFIG_ENTRY_UNAVAILABLE"],
          [/^No configurable plugin entry /, "CONFIG_ENTRY_UNAVAILABLE"],
          [/^Profile patch must be a YAML sequence$/, "CONFIG_DOCUMENT_INVALID"]
        ];
        const code = rules.find(([pattern]) => pattern.test(String(error?.message ?? "")))?.[1];
        if (code) throw Object.assign(new Error(code), { code });
        throw error;
      }
      return this.read();
    }
  };
}

// src/bridge/runtime.js
import { randomUUID } from "node:crypto";

// src/bridge/dispatch.js
var MESSAGES = Object.freeze({
  BRIDGE_DISABLED: "\u6B64\u6A21\u578B\u7684\u72EC\u7ACB\u5BC6\u94A5\u914D\u7F6E\u5F53\u524D\u672A\u542F\u7528\u3002",
  BRIDGE_CONFIG_CONFLICT: "\u6240\u9009\u6A21\u578B\u914D\u7F6E\u5DF2\u53D8\u5316\uFF0C\u8BF7\u5728\u539F\u6A21\u578B\u83DC\u5355\u91CD\u65B0\u9009\u62E9\u8BE5\u6A21\u578B\u3002",
  INVALID_MODEL_IDENTITY: "\u6B64\u6A21\u578B\u7684\u5BC6\u94A5\u914D\u7F6E\u6807\u8BC6\u65E0\u6548\u3002",
  UNKNOWN_KEY_ENTRY: "\u6240\u9009\u5BC6\u94A5\u914D\u7F6E\u5DF2\u4E0D\u5B58\u5728\u3002",
  UNKNOWN_MODEL: "\u6240\u9009\u6A21\u578B\u5DF2\u4E0D\u5728\u6B64\u5BC6\u94A5\u914D\u7F6E\u4E2D\u3002",
  MISSING_CREDENTIAL: "\u6240\u9009\u5BC6\u94A5\u914D\u7F6E\u7684\u51ED\u636E\u4E0D\u53EF\u7528\uFF0C\u8BF7\u68C0\u67E5\u8BE5\u914D\u7F6E\u7684\u5BC6\u94A5\u3002",
  AUTH_HEADER_CONFLICT: "\u8BA4\u8BC1\u8BF7\u6C42\u5934\u4F1A\u8986\u76D6\u6240\u9009\u5BC6\u94A5\uFF0C\u8BF7\u5728\u6A21\u578B\u8BBE\u7F6E\u4E2D\u79FB\u9664\u5B83\u3002",
  BRIDGE_RUNTIME_UNAVAILABLE: "\u5F53\u524D\u5F15\u64CE\u7F3A\u5C11\u72EC\u7ACB\u5BC6\u94A5\u8FD0\u884C\u6240\u9700\u7684\u516C\u5F00\u63A5\u53E3\u3002",
  COMPANION_RECALL_AUXILIARY_BLOCKED: "\u5F53\u524D\u5BBF\u4E3B\u4E0D\u5141\u8BB8\u628A\u53D7\u4FDD\u62A4\u56DE\u5FC6\u4F1A\u8BDD\u59D4\u6258\u7ED9\u72EC\u7ACB\u5BC6\u94A5\u8FD0\u884C\u73AF\u5883\uFF1B\u9700\u8981\u5BBF\u4E3B\u63D0\u4F9B\u516C\u5F00\u7684\u59D4\u6258\u63A5\u53E3\u3002",
  BRIDGE_EXECUTION_FAILED: "\u72EC\u7ACB\u5BC6\u94A5\u8BF7\u6C42\u672A\u80FD\u5B8C\u6210\uFF0C\u8BF7\u68C0\u67E5\u6A21\u578B\u8BBE\u7F6E\u3002"
});
function bridgeFailure(error, signal) {
  let code, abortedCode = false;
  try {
    const property = Object.getOwnPropertyDescriptor(error ?? {}, "code");
    if (property && "value" in property && typeof property.value === "string") {
      abortedCode = property.value === "ABORTED";
      if (Object.hasOwn(MESSAGES, property.value)) code = property.value;
      if (property.value === "NATIVE_CONFIG_CONFLICT") code = "BRIDGE_CONFIG_CONFLICT";
    }
  } catch {
  }
  const aborted = signal?.aborted === true || abortedCode;
  return { type: "finish", reason: { kind: aborted ? "aborted" : "error", failure: {
    code: aborted ? "ABORTED" : code ?? "BRIDGE_EXECUTION_FAILED",
    message: aborted ? "\u8BF7\u6C42\u5DF2\u53D6\u6D88\u3002" : MESSAGES[code ?? "BRIDGE_EXECUTION_FAILED"]
  } } };
}
var fail4 = (code) => {
  throw Object.assign(new Error(code), { code });
};
function remapBridgeHistory(messages, { provider, publicModel, executionProvider = provider, model }) {
  return messages.map((message) => {
    const source = message?.source;
    if (!source || typeof source !== "object") return message;
    if (source.provider === provider && source.model === publicModel) {
      return { ...message, source: { ...source, provider: executionProvider, model } };
    }
    if (source.provider === executionProvider && Object.hasOwn(source, "replayState")) {
      const { replayState: _foreignReplay, ...neutral } = source;
      return { ...message, source: neutral };
    }
    return message;
  });
}
function createBridgeDispatch(ctx, { readSnapshot, execute, projectionMatches = () => true }) {
  if (typeof readSnapshot !== "function" || typeof execute !== "function") throw new TypeError("Bridge dispatch callbacks are required");
  return ctx.on("llm/stream", (options, next) => (async function* () {
    let terminal = false, passthrough = false;
    try {
      const observed = await readSnapshot(options.provider);
      const reserved = typeof options.model === "string" && options.model.startsWith(KEY_MODEL_PREFIX);
      if (!observed?.enabled || !observed.active) {
        const legacy = decodeKeyModelId(options.model);
        const nativeModel = observed?.legacyNative === true && legacy && Object.hasOwn(observed.keyEntries ?? {}, legacy.entryId) && observed.keyEntries[legacy.entryId]?.models?.some((item) => item.id === legacy.modelId);
        if (reserved && !nativeModel) fail4("BRIDGE_DISABLED");
        passthrough = true;
        yield* next();
        return;
      }
      options.signal?.throwIfAborted();
      const snapshot = structuredClone(observed);
      const versioned = snapshot.routing !== void 0;
      if (versioned && !reserved) fail4("BRIDGE_CONFIG_CONFLICT");
      if (!snapshot.confirmed || !await projectionMatches(options.provider, snapshot)) fail4("BRIDGE_CONFIG_CONFLICT");
      const identity = decodeKeyModelId(options.model);
      let entryId = identity?.entryId;
      if (versioned) {
        if (!identity || !snapshot.routing || !Object.hasOwn(snapshot.routing, identity.entryId)) fail4("BRIDGE_CONFIG_CONFLICT");
        const routed = snapshot.routing[identity.entryId];
        if (routed !== null && (typeof routed !== "string" || !Object.hasOwn(snapshot.keyEntries ?? {}, routed))) fail4("BRIDGE_CONFIG_CONFLICT");
        entryId = routed === null ? void 0 : routed;
        const models = routed === null ? snapshot.rootModels : snapshot.keyEntries[routed].models;
        if (!Array.isArray(models) || !models.some((model) => model?.id === identity.modelId)) fail4("UNKNOWN_MODEL");
      } else {
        if (reserved && !identity) fail4("INVALID_MODEL_IDENTITY");
        if (identity) {
          if (!Object.hasOwn(snapshot.keyEntries ?? {}, entryId)) fail4("UNKNOWN_KEY_ENTRY");
          const models = snapshot.keyEntries[entryId]?.models;
          if (!Array.isArray(models) || !models.some((model) => model?.id === identity.modelId)) fail4("UNKNOWN_MODEL");
        }
      }
      const request = {
        snapshot,
        provider: options.provider,
        publicModel: options.model,
        model: identity?.modelId ?? options.model,
        entryId,
        options,
        remapHistory: (executionProvider) => remapBridgeHistory(options.messages, {
          provider: options.provider,
          publicModel: options.model,
          executionProvider,
          model: identity?.modelId ?? options.model
        })
      };
      const stream = await execute(request);
      for await (const chunk of stream) {
        if (terminal) break;
        terminal = chunk?.type === "finish";
        yield chunk;
        if (terminal) break;
      }
      if (!terminal) yield bridgeFailure(void 0, options.signal);
    } catch (error) {
      if (passthrough) throw error;
      if (!terminal) yield bridgeFailure(error, options.signal);
    }
  })());
}

// src/bridge/runtime.js
var copy3 = (value) => structuredClone(value);
var owns2 = (value, key) => Object.hasOwn(value ?? {}, key);
var fail5 = (code) => {
  throw Object.assign(new Error(code), { code });
};
var AUTH_HEADERS2 = /* @__PURE__ */ new Set(["authorization", "proxy-authorization", "x-api-key", "api-key", "cf-aig-authorization"]);
var originalProfile = (value) => value && owns2(value, "present") ? value.profile : value;
function bridgeExecutionProfile(original, entry) {
  const root = copy3(originalProfile(original) ?? {});
  delete root.multiKey;
  delete root.keyEntries;
  if (entry === void 0) return root;
  entry = materializeCapabilityEntry(copy3(entry));
  if (typeof entry.apiKeyEnv !== "string" || !entry.apiKeyEnv.trim()) fail5("MISSING_CREDENTIAL");
  const profile = { ...root, ...copy3(entry), apiKeyEnv: entry.apiKeyEnv, models: copy3(entry.models ?? []) };
  if (!entry.baseURL) {
    if (root.baseURL) profile.baseURL = root.baseURL;
    else delete profile.baseURL;
  }
  if (profile.api === "anthropic-messages" && typeof profile.baseURL === "string") {
    try {
      const url = new URL(profile.baseURL);
      if (/\/v1\/?$/.test(url.pathname)) {
        url.pathname = url.pathname.replace(/\/v1\/?$/, "") || "/";
        profile.baseURL = url.toString();
      }
    } catch {
    }
  }
  profile.headers = { ...root.headers, ...entry.headers };
  delete profile.modelOverrides;
  for (const headers of [root.headers, entry.headers, ...profile.models.map((model) => model.headers)]) {
    for (const name of Object.keys(headers ?? {})) if (AUTH_HEADERS2.has(name.toLowerCase())) fail5("AUTH_HEADER_CONFLICT");
  }
  for (const field of ["name", "sortOrder", "capabilityDefaults", "capabilityBatch", "multiKey", "keyEntries"]) delete profile[field];
  if (entry.name) profile.displayName = entry.name;
  return profile;
}
function bridgeDirectoryModel(info, declared = {}, profile = {}) {
  const model = { id: info.id, name: info.name ?? declared.name ?? info.id };
  const contextWindow = info.context?.contextWindow ?? declared.contextWindow ?? profile.defaultContextWindow;
  if (Number.isSafeInteger(contextWindow) && contextWindow > 0) model.contextWindow = contextWindow;
  const maxTokens = info.defaultMaxTokens ?? declared.maxTokens;
  if (Number.isSafeInteger(maxTokens) && maxTokens > 0) model.maxTokens = maxTokens;
  if (Array.isArray(info.inputModalities)) model.input = [...info.inputModalities];
  else if (Array.isArray(declared.input)) model.input = [...declared.input];
  const efforts = info.reasoning?.efforts;
  model.reasoningEfforts = Array.isArray(efforts) && efforts.length ? Object.fromEntries(efforts.map((effort) => [effort.id, effort.id === "off" ? null : effort.id])) : false;
  return model;
}
function createBridgeRuntime(ctx, { loadModule, discoverEndpoint, maxIdle = 24 } = {}) {
  const load = loadModule ?? ((specifier) => {
    const loader = ctx.get?.("loader");
    return typeof loader?.import === "function" ? loader.import(specifier) : import(specifier);
  });
  const lifetime = new AbortController();
  const slots = /* @__PURE__ */ new Map();
  let modules;
  let disposed = false;
  let disposing;
  async function dependencies() {
    if (!modules) modules = Promise.all([load("@deepseek-ai/dsh-llm"), load("@deepseek-ai/dsh-llm-pi-ai")]).then(([llm, pi]) => {
      if (typeof ctx.isolate !== "function" || typeof llm.LlmRuntime !== "function" || typeof pi.apply !== "function" || typeof pi.Config !== "function") fail5("BRIDGE_RUNTIME_UNAVAILABLE");
      return { LlmRuntime: llm.LlmRuntime, pi };
    });
    return modules;
  }
  async function open(provider, profile) {
    const { LlmRuntime, pi } = await dependencies();
    if (disposed) fail5("BRIDGE_RUNTIME_UNAVAILABLE");
    const scope = ctx.isolate("llm").isolate("settings").isolate("authorization");
    let llm;
    const fiber = scope.plugin({ name: "model-groups-private-runtime", apply(child) {
      llm = new LlmRuntime(child);
      pi.apply(child, pi.Config({ providers: { [provider]: profile } }));
    } });
    try {
      await fiber;
      if (!llm || disposed) fail5("BRIDGE_RUNTIME_UNAVAILABLE");
      return { llm, fiber };
    } catch (error) {
      await fiber.dispose();
      throw error;
    }
  }
  async function trim() {
    let idle = [...slots.values()].filter((slot) => slot.refs === 0);
    while (idle.length > maxIdle) {
      const slot = idle.shift();
      slots.delete(slot.key);
      try {
        await (await slot.promise).fiber.dispose();
      } catch {
      }
    }
  }
  async function acquire2(provider, profile) {
    if (disposed) fail5("BRIDGE_RUNTIME_UNAVAILABLE");
    const key = JSON.stringify([provider, profile]);
    let slot = slots.get(key);
    if (!slot) {
      slot = { key, refs: 0, promise: open(provider, copy3(profile)) };
      slots.set(key, slot);
    } else {
      slots.delete(key);
      slots.set(key, slot);
    }
    slot.refs += 1;
    try {
      const runtime = await slot.promise;
      return { ...runtime, release: async () => {
        slot.refs -= 1;
        await trim();
      } };
    } catch (error) {
      slot.refs -= 1;
      if (slots.get(key) === slot) slots.delete(key);
      throw error;
    }
  }
  async function models(provider, profile) {
    const held = await acquire2(provider, profile);
    try {
      const listed = profile.models?.length ? profile.models : await held.llm.listModels(provider);
      const result = [];
      for (const listedModel of listed) {
        const info = await held.llm.resolveModelInfo(provider, listedModel.id);
        result.push(bridgeDirectoryModel(info, listedModel, profile));
      }
      return result;
    } finally {
      await held.release();
    }
  }
  async function prepare(provider, draft, original) {
    let legacy = [];
    if (original !== void 0) {
      try {
        legacy = await models(provider, bridgeExecutionProfile(original));
      } catch (error) {
        const root = originalProfile(original);
        const entryOnly = Array.isArray(root?.models) && root.models.length === 0 && Object.values(draft.keyEntries ?? {}).some((entry) => Array.isArray(entry?.models) && entry.models.length > 0);
        if (!entryOnly) throw error;
      }
    }
    const keyEntries = {};
    for (const [entryId, entry] of Object.entries(draft.keyEntries ?? {})) {
      keyEntries[entryId] = entry.models?.length ? await models(provider, bridgeExecutionProfile(original, entry)) : [];
    }
    return { models: { legacy, keyEntries } };
  }
  async function normalizeProfile(provider, profile) {
    const { pi } = await dependencies();
    const configured = pi.Config({ providers: { [provider]: copy3(profile) } });
    const providers = typeof configured.providers?.get === "function" ? configured.providers.get() : configured.providers;
    return JSON.parse(JSON.stringify(providers[provider]));
  }
  async function probeProjection(provider, profile, modelId) {
    let held;
    try {
      held = await acquire2(provider, profile);
      const info = await held.llm.resolveModelInfo(provider, modelId);
      if (info?.id !== modelId || info?.provider !== provider) fail5("BRIDGE_PROJECTION_UNSUPPORTED");
      return true;
    } catch {
      fail5("BRIDGE_PROJECTION_UNSUPPORTED");
    } finally {
      await held?.release();
    }
  }
  async function* execute({ snapshot, provider, entryId, model, publicModel, options }) {
    if (entryId !== void 0 && !owns2(snapshot.keyEntries, entryId)) fail5("UNKNOWN_KEY_ENTRY");
    const entry = entryId === void 0 ? void 0 : snapshot.keyEntries[entryId];
    if (entry && !entry.models?.some((item) => item.id === model)) fail5("UNKNOWN_MODEL");
    const profile = bridgeExecutionProfile(snapshot.original, entry);
    const held = await acquire2(provider, profile);
    const signal = options.signal ? AbortSignal.any([options.signal, lifetime.signal]) : lifetime.signal;
    try {
      signal.throwIfAborted();
      const config = { provider, model };
      for (const field of ["reasoningEffort", "temperature", "maxTokens", "stop"]) if (options[field] !== void 0) config[field] = options[field];
      const prepared = await held.llm.prepareCall(config, signal);
      const messages = remapBridgeHistory(options.messages, { provider, publicModel, executionProvider: provider, model });
      const request = Object.create(Object.getPrototypeOf(options), {
        ...Object.getOwnPropertyDescriptors(options),
        ...Object.getOwnPropertyDescriptors({ ...prepared.config, messages, signal })
      });
      yield* prepared.stream(request);
    } finally {
      await held.release();
    }
  }
  async function discover(provider, entryId, entry, original, signal, { apiKey } = {}) {
    if (disposed) fail5("BRIDGE_RUNTIME_UNAVAILABLE");
    signal = signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal;
    signal.throwIfAborted();
    const profile = bridgeExecutionProfile(original, entry);
    if (!profile.api) fail5("DISCOVERY_PROTOCOL_REQUIRED");
    if (!profile.baseURL) {
      profile.baseURL = ctx.get?.("llm")?.listConfigurableProviders?.().find((row) => row.provider === provider)?.defaultBaseURL;
    }
    if (!profile.baseURL) fail5("DISCOVERY_ENDPOINT_REQUIRED");
    if (typeof discoverEndpoint === "function") return discoverEndpoint({ provider, entryId, profile, signal, ctx, ...apiKey === void 0 ? {} : { apiKey } });
    if (apiKey !== void 0) fail5("DISCOVERY_UNSUPPORTED");
    if (profile.api === "anthropic-messages") fail5("DISCOVERY_UNSUPPORTED");
    const route = `@dsh-model-groups/discovery/${randomUUID()}`;
    const held = await acquire2(route, { ...profile, models: [{ id: "__discovery_only__" }] });
    try {
      const settingsNs = held.llm.listConfigurableProviders().find((row) => row.provider === route)?.settingsNs;
      if (!settingsNs || typeof held.llm.discoverModels !== "function") fail5("BRIDGE_RUNTIME_UNAVAILABLE");
      return await held.llm.discoverModels(settingsNs, { provider: route, api: profile.api, baseURL: profile.baseURL }, signal);
    } finally {
      await held.release();
    }
  }
  async function dispose() {
    if (disposing) return disposing;
    disposed = true;
    lifetime.abort();
    const pending = [...slots.values()];
    slots.clear();
    disposing = Promise.allSettled(pending.map(async (slot) => (await slot.promise).fiber.dispose())).then(() => void 0);
    return disposing;
  }
  ctx.effect?.(() => () => dispose());
  return { prepare, normalizeProfile, probeProjection, execute, discover, dispose };
}

// src/bridge/http.js
var MESSAGES2 = Object.freeze({
  MIGRATION_NOT_READY: "\u914D\u7F6E\u5207\u6362\u5C1A\u672A\u5B8C\u6210\uFF0C\u8BF7\u91CD\u65B0\u6253\u5F00\u539F\u6A21\u578B\u9875\u9762\u540E\u91CD\u8BD5\u3002",
  INVALID_SHARED_CONFIG: "\u4F9B\u5E94\u5546\u914D\u7F6E\u53EA\u5141\u8BB8\u4FEE\u6539\u540D\u79F0\u3001\u5730\u5740\u3001\u9ED8\u8BA4\u534F\u8BAE\u548C\u8BF7\u6C42\u5934\u3002",
  INVALID_SINGLE_KEY_CONFIG: "\u5355\u5BC6\u94A5\u914D\u7F6E\u53EA\u5141\u8BB8\u4FEE\u6539\u51ED\u636E\u5F15\u7528\u548C\u6A21\u578B\u5217\u8868\u3002",
  SETTINGS_CONFLICT: "\u914D\u7F6E\u5DF2\u53D8\u5316\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5\u3002",
  NATIVE_CONFIG_CONFLICT: "\u539F\u4F9B\u5E94\u5546\u914D\u7F6E\u5DF2\u88AB\u4FEE\u6539\uFF0C\u8BF7\u5148\u5904\u7406\u5361\u7247\u4E2D\u7684\u914D\u7F6E\u51B2\u7A81\u3002",
  BRIDGE_BUSY: "\u6B63\u5728\u4FDD\u5B58\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002",
  LEGACY_PATCH_MIGRATION_REQUIRED: "\u9700\u8981\u5148\u8FC1\u79FB\u73B0\u6709\u591A\u5BC6\u94A5\u8865\u4E01\uFF0C\u539F\u914D\u7F6E\u4F1A\u4FDD\u7559\u3002",
  EMPTY_KEY_ENTRIES: "\u8BF7\u5148\u6DFB\u52A0\u81F3\u5C11\u4E00\u7EC4\u5BC6\u94A5\u3002",
  INVALID_BRIDGE_CONFIG: "\u591A\u5BC6\u94A5\u914D\u7F6E\u683C\u5F0F\u65E0\u6548\u3002",
  INVALID_KEY_ENTRY: "\u5BC6\u94A5\u7EC4\u6807\u8BC6\u65E0\u6548\u3002",
  INVALID_PROTOCOL: "\u8BF7\u9009\u62E9\u652F\u6301\u7684\u534F\u8BAE\u3002",
  USE_CREDENTIAL_REFERENCE: "\u8BF7\u4F7F\u7528\u51ED\u636E\u5F15\u7528\u3002",
  INVALID_CREDENTIAL_REFERENCE: "\u51ED\u636E\u5F15\u7528\u65E0\u6548\u3002",
  INVALID_CREDENTIAL_VALUE: "\u8BF7\u8F93\u5165\u6709\u6548\u7684\u5BC6\u94A5\u3002",
  CREDENTIALS_UNAVAILABLE: "\u4E3B\u673A\u51ED\u636E\u670D\u52A1\u5C1A\u672A\u5C31\u7EEA\u3002",
  INVALID_ENDPOINT: "\u63A5\u53E3\u5730\u5740\u65E0\u6548\u3002",
  INVALID_MODELS: "\u6A21\u578B\u5217\u8868\u5305\u542B\u65E0\u6548\u6216\u91CD\u590D\u7684\u6807\u8BC6\u3002",
  INVALID_MODEL_IDENTITY: "\u6A21\u578B\u6807\u8BC6\u65E0\u6548\u3002",
  INVALID_MODEL_CAPABILITY: "\u6A21\u578B\u80FD\u529B\u914D\u7F6E\u65E0\u6548\u3002",
  INVALID_HEADERS: "\u8BF7\u6C42\u5934\u914D\u7F6E\u65E0\u6548\u3002",
  DISCOVERY_UNAVAILABLE: "\u5F53\u524D\u65E0\u6CD5\u83B7\u53D6\u6A21\u578B\u5217\u8868\u3002",
  MISSING_CREDENTIAL: "\u8BF7\u4E3A\u5BC6\u94A5\u7EC4\u586B\u5199\u6709\u6548\u7684\u51ED\u636E\u5F15\u7528\u6216\u5148\u4FDD\u5B58\u5BC6\u94A5\u3002",
  AUTH_HEADER_CONFLICT: "\u8BA4\u8BC1\u8BF7\u6C42\u5934\u4F1A\u8986\u76D6\u6240\u9009\u5BC6\u94A5\uFF0C\u8BF7\u5148\u5728\u539F\u4F9B\u5E94\u5546\u8BBE\u7F6E\u4E2D\u79FB\u9664\u5B83\u3002",
  BRIDGE_RUNTIME_UNAVAILABLE: "\u5F53\u524D\u5BBF\u4E3B\u7F3A\u5C11\u72EC\u7ACB\u5BC6\u94A5\u8FD0\u884C\u6240\u9700\u7684\u516C\u5171\u63A5\u53E3\u3002",
  BRIDGE_PROJECTION_UNSUPPORTED: "\u5F53\u524D\u5BBF\u4E3B\u4E0D\u80FD\u901A\u8FC7\u516C\u5171\u6A21\u578B\u914D\u7F6E\u63D0\u4F9B\u6B64\u8DEF\u7531\uFF0C\u8BF7\u4FDD\u7559\u539F\u914D\u7F6E\u5E76\u53CD\u9988\u5BBF\u4E3B\u80FD\u529B\u3002",
  DISCOVERY_PROTOCOL_REQUIRED: "\u8BF7\u5148\u9009\u62E9\u5BC6\u94A5\u7EC4\u7684 API \u534F\u8BAE\u3002",
  DISCOVERY_ENDPOINT_REQUIRED: "\u8BF7\u5148\u586B\u5199\u5BC6\u94A5\u7EC4\u6216\u539F\u4F9B\u5E94\u5546\u7684\u63A5\u53E3\u5730\u5740\u3002",
  GUARD_CREDENTIAL_REQUIRED: "\u672C\u673A\u8DEF\u7531\u51ED\u636E\u5C1A\u672A\u5C31\u7EEA\u3002"
});
function bridgeHttpHandler(controller, connection) {
  return async (req, res) => {
    const send = (status, value) => {
      res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
      res.end(JSON.stringify(value));
    };
    try {
      const admission = connection.admit(req);
      if (!admission?.peer || admission.peer.principal?.kind !== "owner") return send(admission?.rejection || 403, { ok: false, error: { code: "FORBIDDEN", message: "\u9700\u8981\u5DF2\u767B\u5F55\u7684\u4E3B\u673A\u6240\u6709\u8005\u3002" } });
      if (req.method === "GET") return send(200, { ok: true, value: { ...await controller.snapshot(), ...controller.needsInitialization?.() ? { initializationRequired: true } : {} } });
      if (req.method !== "POST") return send(405, { ok: false, error: { code: "METHOD", message: "\u4E0D\u652F\u6301\u6B64\u64CD\u4F5C\u3002" } });
      if (!/^application\/json(?:;|$)/i.test(req.headers["content-type"] ?? "")) return send(415, { ok: false, error: { code: "CONTENT_TYPE", message: "\u53EA\u63A5\u53D7 JSON\u3002" } });
      let length = 0;
      const chunks = [];
      for await (const chunk of req) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        length += buffer.length;
        if (length > 1024 * 1024) return send(413, { ok: false, error: { code: "BODY_LIMIT", message: "\u8BF7\u6C42\u8FC7\u5927\u3002" } });
        chunks.push(buffer);
      }
      let input;
      try {
        input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        return send(400, { ok: false, error: { code: "JSON", message: "\u8BF7\u6C42\u683C\u5F0F\u9519\u8BEF\u3002" } });
      }
      if (input?.action === "initialize" && controller.initialize) {
        await controller.initialize();
        return send(200, { ok: true, value: await controller.snapshot() });
      }
      if (input?.action === "save") {
        await controller.save(input.provider, input.draft, input.expectedRevision);
        return send(200, { ok: true, value: await controller.snapshot() });
      }
      if (input?.action === "credential") return send(200, { ok: true, value: await controller.setCredential(input.ref, input.value) });
      if (input?.action === "discover") return send(200, { ok: true, value: await controller.discover(input.provider, input.entryId, input.draft, { apiKey: input.apiKey, shared: input.shared }) });
      return send(400, { ok: false, error: { code: "ACTION", message: "\u4E0D\u652F\u6301\u6B64\u64CD\u4F5C\u3002" } });
    } catch (error) {
      const code = Object.hasOwn(MESSAGES2, error?.code ?? "") ? error.code : "FAILED";
      return send(409, { ok: false, error: { code, message: MESSAGES2[code] ?? "\u64CD\u4F5C\u672A\u5B8C\u6210\uFF0C\u8BF7\u68C0\u67E5\u540E\u91CD\u8BD5\u3002" } });
    }
  };
}

// src/bridge/discovery.js
var failure2 = (code) => Object.assign(new Error(code), { code });
async function discoverBridgeModels({ profile, signal, ctx, apiKey }, { fetch: request = globalThis.fetch, timeoutMs = 15e3 } = {}) {
  if (!["openai-completions", "openai-responses", "anthropic-messages"].includes(profile.api)) throw failure2("DISCOVERY_PROTOCOL_REQUIRED");
  let url;
  try {
    url = new URL(profile.baseURL);
  } catch {
    throw failure2("DISCOVERY_ENDPOINT_REQUIRED");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash) throw failure2("INVALID_ENDPOINT");
  if (apiKey !== void 0 && (typeof apiKey !== "string" || apiKey.length > 16384 || !/^[\x21-\x7E]+$/.test(apiKey))) throw failure2("INVALID_CREDENTIAL_VALUE");
  const key = apiKey === void 0 ? await ctx.credentials.resolve(profile.apiKeyEnv) : { value: apiKey };
  if (typeof key?.value !== "string" || !key.value) throw failure2("MISSING_CREDENTIAL");
  const headers = new Headers(profile.headers ?? {});
  for (const name of ["authorization", "proxy-authorization", "x-api-key", "api-key"]) if (headers.has(name)) throw failure2("AUTH_HEADER_CONFLICT");
  const path4 = url.pathname.replace(/\/+$/, "");
  if (profile.api === "anthropic-messages") {
    url.pathname = `${path4.endsWith("/v1") ? path4.slice(0, -3) : path4}/v1/models`;
    headers.set("x-api-key", key.value);
    if (!headers.has("anthropic-version")) headers.set("anthropic-version", "2023-06-01");
  } else {
    url.pathname = `${path4}/models`;
    headers.set("authorization", `Bearer ${key.value}`);
  }
  headers.set("accept", "application/json");
  const cancellation = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
  const response = await request(url, { method: "GET", headers, signal: cancellation, redirect: "error" });
  if (!response.ok) {
    await response.body?.cancel?.();
    throw failure2("DISCOVERY_REQUEST_FAILED");
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body ?? []) {
    bytes += chunk.byteLength;
    if (bytes > 1024 * 1024) throw failure2("DISCOVERY_RESPONSE_TOO_LARGE");
    chunks.push(chunk);
  }
  let document;
  try {
    document = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw failure2("DISCOVERY_RESPONSE_INVALID");
  }
  const rows = Array.isArray(document) ? document : document?.data;
  if (!Array.isArray(rows)) throw failure2("DISCOVERY_RESPONSE_INVALID");
  const seen = /* @__PURE__ */ new Set();
  const models = [];
  for (const row of rows) {
    const id = typeof row === "string" ? row : row?.id;
    if (typeof id !== "string" || !id.trim() || id !== id.trim() || seen.has(id)) continue;
    seen.add(id);
    const model = { id };
    const name = row?.name ?? row?.display_name;
    if (typeof name === "string" && name.trim()) model.name = name;
    models.push(model);
  }
  return models;
}

// src/bridge/routing.js
import { createHash } from "node:crypto";
var canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
var semanticModels = (models) => models.map(({ name: _name, sortOrder: _order, ...model }) => model).sort((left, right) => left.id.localeCompare(right.id));
function createBridgeRouting(provider, draft, original, models) {
  const routing = {};
  const add = (entryId, resolved) => {
    if (!resolved?.length) return;
    const profile = bridgeExecutionProfile(original, entryId === null ? void 0 : draft.keyEntries[entryId]);
    delete profile.displayName;
    if (Array.isArray(profile.models)) profile.models = semanticModels(profile.models);
    const digest = createHash("sha256").update(JSON.stringify(canonical([provider, entryId, profile, semanticModels(resolved)]))).digest("hex");
    routing[`g_${digest}`] = entryId;
  };
  for (const entryId of Object.keys(draft.keyEntries)) add(entryId, models.keyEntries[entryId]);
  add(null, models.legacy);
  return routing;
}

// src/bridge/startup.js
function startBridgeWhenSettingsReady(ctx, namespace, initialize) {
  let stopped = false, checking = false, running, complete = false;
  const removers = [];
  const ready = () => ctx.settings.describe().some((item) => item.ns === namespace);
  function attempt() {
    if (stopped || complete || running || checking) return running;
    let visible = false;
    checking = true;
    try {
      visible = ready();
    } catch {
      return;
    } finally {
      checking = false;
    }
    if (!visible) return;
    running = Promise.resolve().then(initialize).then((value) => {
      complete = true;
      return value;
    }).catch(() => {
      ctx.logger?.warn("\u6A21\u578B\u5206\u7EC4\u521D\u59CB\u5316\u672A\u5B8C\u6210\uFF0C\u914D\u7F6E\u4FDD\u6301\u539F\u6837\uFF1B\u91CD\u65B0\u6253\u5F00\u6A21\u578B\u8BBE\u7F6E\u540E\u53EF\u91CD\u8BD5\u3002");
    }).finally(() => {
      running = void 0;
    });
    return running;
  }
  if (typeof ctx.on === "function") {
    removers.push(ctx.on("internal/status", attempt));
    removers.push(ctx.on("settings/document-updated", attempt));
  }
  queueMicrotask(attempt);
  ctx.effect(() => () => {
    stopped = true;
    for (const remove of removers) remove?.();
  });
  return { attempt, get complete() {
    return complete;
  } };
}

// src/bridge/import.js
import fs from "node:fs";
import path from "node:path";
function readBridgeImport(documentPath, home = process.env.DSH_HOME) {
  if (!home || !documentPath) return void 0;
  const file = path.join(home, "dsh-model-groups", "pending-bridge-import.json");
  if (!fs.existsSync(file)) return void 0;
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4 * 1024 * 1024) throw new Error("INVALID_BRIDGE_IMPORT");
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  if (value.schema !== 1 || path.resolve(value.documentPath) !== path.resolve(documentPath)) return void 0;
  if (!value.providers || typeof value.providers !== "object" || Array.isArray(value.providers)) throw new Error("INVALID_BRIDGE_IMPORT");
  return value.providers;
}

// src/bridge/migration-report.js
import fs2 from "node:fs";
import path2 from "node:path";
var STAGES = /* @__PURE__ */ new Set(["waiting", "recover", "import", "synchronize", "complete", "failed"]);
var CODES = /* @__PURE__ */ new Set(["SETTINGS_UNAVAILABLE", "NATIVE_CONFIG_CONFLICT", "REVISION_MISMATCH", "INVALID_BRIDGE_IMPORT", "BRIDGE_PROJECTION_UNSUPPORTED", "UNKNOWN_MODEL", "UNKNOWN_PROVIDER", "INVALID_MODEL_CAPABILITY", "CONFIG_OVERLAY", "CONFIG_ENTRY_UNAVAILABLE", "CONFIG_ENTRY_CHANGED", "CONFIG_PLUGIN_INACTIVE", "CONFIG_FIELD_NOT_VOLATILE", "CONFIG_DOCUMENT_INVALID", "HMR_MIGRATION_DEFERRED"]);
function reportBridgeImport(documentPath, result, home = process.env.DSH_HOME) {
  try {
    if (!readBridgeImport(documentPath, home) || !STAGES.has(result.stage)) return;
    const file = path2.join(home, "dsh-model-groups", "bridge-import-result.json");
    if (fs2.existsSync(file)) {
      const stat = fs2.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink()) return;
    }
    const report = { schema: 1, stage: result.stage, updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
    if (result.stage === "failed") {
      report.code = CODES.has(result.code) ? result.code : "INITIALIZATION_FAILED";
      if (STAGES.has(result.step)) report.step = result.step;
      if (["Error", "TypeError", "DataCloneError", "SyntaxError", "SettingsError"].includes(result.errorType)) report.errorType = result.errorType;
      if (["dsh-config-editor", "dsh-settings", "schemastery"].includes(result.origin)) report.origin = result.origin;
      if (Number.isSafeInteger(result.originLine) && result.originLine > 0) report.originLine = result.originLine;
      if (Array.isArray(result.frames)) report.frames = result.frames.filter((line) => Number.isSafeInteger(line) && line > 0 && line < 1e6).slice(0, 4);
    }
    if (typeof result.clientRegistered === "boolean") report.clientRegistered = result.clientRegistered;
    for (const key of ["imported", "conflicts", "activated"]) if (Number.isSafeInteger(result[key]) && result[key] >= 0) report[key] = result[key];
    fs2.writeFileSync(file, JSON.stringify(report), { mode: 384 });
  } catch {
  }
}

// src/bridge/editor-interface.js
import fs3 from "node:fs";
import path3 from "node:path";
import os from "node:os";
import { createHash as createHash2, randomUUID as randomUUID2 } from "node:crypto";

// src/bridge/editor-interface-transform.js
import { parse } from "acorn";
var EDITOR_SLOT = "settings.models.provider-editor";
var prop = (node, name) => node?.type === "ObjectExpression" ? node.properties.find((p) => p.type === "Property" && (p.key.name ?? p.key.value) === name)?.value : void 0;
var text = (source, node) => source.slice(node.start, node.end);
var fail6 = (code) => {
  throw Object.assign(new Error(code), { code });
};
function collect(tree) {
  const items = [];
  function walk(node, parents = []) {
    if (!node || typeof node !== "object") return;
    if (typeof node.type === "string") items.push({ node, parents });
    for (const [key, value] of Object.entries(node)) {
      if (key === "start" || key === "end") continue;
      if (Array.isArray(value)) for (const child of value) walk(child, [...parents, node]);
      else if (value && typeof value === "object") walk(value, [...parents, node]);
    }
  }
  walk(tree);
  return items;
}
var owner = (item) => [...item.parents].reverse().find((n) => /^(?:Function|ArrowFunction)/.test(n.type));
var jsx = (node) => node?.type === "CallExpression" && (node.callee.type === "SequenceExpression" ? node.callee.expressions.at(-1) : node.callee)?.type === "MemberExpression" && ["jsx", "jsxs"].includes((node.callee.type === "SequenceExpression" ? node.callee.expressions.at(-1) : node.callee).property.name);
function prepareEditorInterface(source) {
  let items;
  try {
    items = collect(parse(source, { ecmaVersion: "latest", sourceType: "script" }));
  } catch {
    fail6("EDITOR_SOURCE_INVALID");
  }
  const registrations = items.filter(({ node }) => node.type === "CallExpression" && node.callee.type === "MemberExpression" && node.callee.property.name === "register" && prop(node.arguments[0], "name")?.value === "settings.section" && prop(node.arguments[0], "id")?.value === "models");
  if (registrations.length !== 1) fail6("EDITOR_STRUCTURE_UNSUPPORTED");
  const children = prop(registrations[0].node.arguments[0], "children");
  if (!prop(children, "settings.models.provider-card") || !prop(children, "settings.models.footer")) fail6("EDITOR_STRUCTURE_UNSUPPORTED");
  const declaration = prop(children, EDITOR_SLOT);
  const calls = items.filter(({ node }) => node.type === "CallExpression" && node.arguments[0]?.value === EDITOR_SLOT);
  if (declaration) {
    if (prop(declaration, "kind")?.value !== "keyed" || prop(declaration, "scope")?.value !== "root" || !calls.some(({ node }) => prop(node.arguments[1], "provider") && prop(node.arguments[1], "open") && prop(node.arguments[1], "onClose") && prop(node.arguments[2], "entryKey"))) fail6("EDITOR_INTERFACE_INCOMPLETE");
    return { source, changed: false };
  }
  if (calls.length) fail6("EDITOR_INTERFACE_INCOMPLETE");
  const cards = items.filter(({ node }) => node.type === "CallExpression" && node.callee.type === "Identifier" && node.arguments[0]?.value === "settings.models.provider-card" && prop(node.arguments[1], "provider") && prop(node.arguments[1], "configured") && prop(node.arguments[1], "keyConfigured") && prop(node.arguments[2], "entryKey"));
  const branches = items.filter(({ node }) => node.type === "ConditionalExpression" && node.test.type === "Identifier" && node.alternate.type === "Literal" && node.alternate.value === null && node.consequent.type === "CallExpression" && node.consequent.callee.type === "Identifier" && prop(node.consequent.arguments[0], "row") && prop(node.consequent.arguments[0], "readOnly") && prop(node.consequent.arguments[0], "onClose"));
  const candidates = branches.flatMap((branch2) => {
    const row = prop(branch2.node.consequent.arguments[0], "row");
    const container = [...branch2.parents].reverse().find((node) => node.type === "ArrayExpression");
    const matches2 = cards.filter((card2) => container && card2.parents.includes(container) && owner(card2) === owner(branch2) && prop(card2.node.arguments[1], "provider")?.type === "MemberExpression" && prop(card2.node.arguments[1], "provider").property.name === "entry" && text(source, prop(card2.node.arguments[1], "provider").object) === text(source, row));
    return matches2.length === 1 ? [{ branch: branch2, card: matches2[0] }] : [];
  });
  if (candidates.length !== 1) fail6("EDITOR_STRUCTURE_UNSUPPORTED");
  const { branch, card } = candidates[0];
  const ancestorJSX = [...branch.parents].reverse().find(jsx);
  if (!ancestorJSX) fail6("EDITOR_STRUCTURE_UNSUPPORTED");
  const factory = `(${text(source, ancestorJSX.callee)})`;
  const render = text(source, card.node.callee), attributes = card.node.arguments[1], options = card.node.arguments[2];
  const provider = text(source, prop(attributes, "provider")), configured = text(source, prop(attributes, "configured"));
  const keyConfigured = text(source, prop(attributes, "keyConfigured")), entryKey = text(source, prop(options, "entryKey"));
  const wrap = (node, call, open) => {
    const args = call.arguments[0], fallback = text(source, node);
    return `/* dsh-model-groups/editor-interface@1 */ ((defaultEditor) => ${factory}("div", {
      hidden: !(${open}), "data-models-provider-editor": ${provider}.provider,
      children: ${render}(${JSON.stringify(EDITOR_SLOT)}, {
        provider: ${provider}, configured: ${configured}, keyConfigured: ${keyConfigured}, open: (${open}),
        readOnly: ${text(source, prop(args, "readOnly"))}, defaultEditor,
        onClose: ${text(source, prop(args, "onClose"))}
      }, { entryKey: ${entryKey}, fallback: defaultEditor })
    }))(${fallback})`;
  };
  const edits = [
    { start: branch.node.start, end: branch.node.end, value: wrap(branch.node, branch.node.consequent, text(source, branch.node.test)) },
    { start: children.start + 1, end: children.start + 1, value: `
${JSON.stringify(EDITOR_SLOT)}: { kind: "keyed", scope: "root" },` }
  ];
  const setup = items.filter((item) => item.node.type === "CallExpression" && item.node.callee.type === "Identifier" && item.node.callee.name === branch.node.consequent.callee.name && owner(item) === owner(branch) && prop(item.node.arguments[0], "row") && text(source, prop(item.node.arguments[0], "row")) === text(source, prop(branch.node.consequent.arguments[0], "row")) && item.node !== branch.node.consequent);
  if (setup.length > 1) fail6("EDITOR_STRUCTURE_UNSUPPORTED");
  for (const item of setup) {
    if (!prop(item.node.arguments[0], "onClose") || !prop(item.node.arguments[0], "readOnly")) fail6("EDITOR_STRUCTURE_UNSUPPORTED");
    edits.push({ start: item.node.start, end: item.node.end, value: wrap(item.node, item.node, "true") });
  }
  let result = source;
  for (const edit of edits.sort((a, b) => b.start - a.start)) result = result.slice(0, edit.start) + edit.value + result.slice(edit.end);
  try {
    parse(result, { ecmaVersion: "latest", sourceType: "script" });
  } catch {
    fail6("EDITOR_SOURCE_INVALID");
  }
  return { source: result, changed: true };
}

// src/bridge/editor-interface.js
var MODELS_CLIENT_ID = "@deepseek-ai/dsh-client-ui-settings-models";
var hash = (value) => createHash2("sha256").update(value).digest("hex");
var problem = (code) => Object.assign(new Error(code), { code });
var CODES2 = /* @__PURE__ */ new Set(["EDITOR_SOURCE_INVALID", "EDITOR_STRUCTURE_UNSUPPORTED", "EDITOR_INTERFACE_INCOMPLETE", "EDITOR_TARGET_INVALID", "EDITOR_BACKUP_CONFLICT", "EDITOR_CONCURRENT_CHANGE", "EDITOR_BUSY", "EDITOR_READ_ONLY", "EDITOR_PUBLISH_FAILED"]);
var failed = (error) => ({ state: "failed", code: CODES2.has(error?.code) ? error.code : ["EACCES", "EPERM", "EROFS"].includes(error?.code) ? "EDITOR_READ_ONLY" : "EDITOR_INSTALL_FAILED", changed: false });
function targetOf(registry) {
  const advertised = registry.clientPath(MODELS_CLIENT_ID);
  if (typeof advertised !== "string" || !path3.isAbsolute(advertised)) throw problem("EDITOR_TARGET_INVALID");
  const target = fs3.realpathSync(advertised);
  if (!fs3.lstatSync(advertised).isFile() || !fs3.lstatSync(target).isFile()) throw problem("EDITOR_TARGET_INVALID");
  let directory = path3.dirname(target);
  for (let depth = 0; depth < 6; depth++) {
    const manifest = path3.join(directory, "package.json");
    if (fs3.existsSync(manifest)) {
      const metadata = JSON.parse(fs3.readFileSync(manifest, "utf8"));
      let client = metadata.exports?.["./client"];
      if (client && typeof client === "object") client = client.default;
      if (metadata.name !== MODELS_CLIENT_ID || typeof client !== "string" || !client.startsWith("./") || fs3.realpathSync(path3.resolve(directory, client)) !== target) throw problem("EDITOR_TARGET_INVALID");
      return target;
    }
    directory = path3.dirname(directory);
  }
  throw problem("EDITOR_TARGET_INVALID");
}
function sourceOf(target) {
  const stat = fs3.statSync(target);
  if (!stat.isFile() || stat.size > 8 * 1024 * 1024) throw problem("EDITOR_TARGET_INVALID");
  return { source: fs3.readFileSync(target, "utf8"), mode: stat.mode & 511 };
}
function stage(target, source, mode) {
  const filename = path3.join(path3.dirname(target), `.dsh-model-groups-${randomUUID2()}.tmp`);
  const descriptor = fs3.openSync(filename, "wx", mode);
  try {
    fs3.writeFileSync(descriptor, source);
    fs3.fsyncSync(descriptor);
  } finally {
    fs3.closeSync(descriptor);
  }
  return filename;
}
function exclusiveBackup(filename, source) {
  try {
    fs3.writeFileSync(filename, source, { flag: "wx", mode: 384 });
  } catch (error) {
    if (error.code !== "EEXIST" || !fs3.lstatSync(filename).isFile() || fs3.readFileSync(filename, "utf8") !== source) throw problem("EDITOR_BACKUP_CONFLICT");
  }
}
function acquire(filename) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs3.openSync(filename, "wx", 384);
      fs3.writeFileSync(fd, JSON.stringify({ pid: process.pid }));
      fs3.closeSync(fd);
      return;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let previous;
      try {
        previous = JSON.parse(fs3.readFileSync(filename, "utf8"));
      } catch {
        throw problem("EDITOR_BUSY");
      }
      if (!Number.isSafeInteger(previous.pid) || previous.pid < 1) throw problem("EDITOR_BUSY");
      try {
        process.kill(previous.pid, 0);
        throw problem("EDITOR_BUSY");
      } catch (reason) {
        if (reason.code !== "ESRCH") throw problem("EDITOR_BUSY");
      }
      fs3.unlinkSync(filename);
    }
  }
  throw problem("EDITOR_BUSY");
}
function ensureEditorInterface(registry, { home = process.env.DSH_HOME || path3.join(os.homedir(), ".dsh") } = {}) {
  if (typeof registry?.clientPath !== "function" || typeof registry?.rebuilt !== "function") return { state: "pending", code: "EDITOR_REGISTRY_UNAVAILABLE", changed: false };
  let target, directory, lock, locked = false, staged;
  try {
    if (!registry.clientPath(MODELS_CLIENT_ID)) return { state: "pending", code: "EDITOR_MODULE_PENDING", changed: false };
    target = targetOf(registry);
    let current = sourceOf(target), prepared = prepareEditorInterface(current.source);
    if (!prepared.changed) {
      if (!registry.rebuilt(MODELS_CLIENT_ID)) throw problem("EDITOR_PUBLISH_FAILED");
      return { state: "ready", code: "EDITOR_AVAILABLE", changed: false };
    }
    if (!(current.mode & 146)) throw problem("EDITOR_READ_ONLY");
    directory = path3.join(path3.resolve(home), "dsh-model-groups", "editor-interface", hash(target).slice(0, 20));
    fs3.mkdirSync(directory, { recursive: true, mode: 448 });
    lock = path3.join(directory, "write.lock");
    acquire(lock);
    locked = true;
    current = sourceOf(target);
    prepared = prepareEditorInterface(current.source);
    if (!prepared.changed) {
      if (!registry.rebuilt(MODELS_CLIENT_ID)) throw problem("EDITOR_PUBLISH_FAILED");
      return { state: "ready", code: "EDITOR_AVAILABLE", changed: false };
    }
    const before = hash(current.source), after = hash(prepared.source);
    exclusiveBackup(path3.join(directory, `${before}.before.js`), current.source);
    exclusiveBackup(path3.join(directory, `${after}.receipt.json`), JSON.stringify({ schema: 1, target, before, after }) + "\n");
    staged = stage(target, prepared.source, current.mode);
    if (fs3.realpathSync(registry.clientPath(MODELS_CLIENT_ID)) !== target || hash(sourceOf(target).source) !== before) throw problem("EDITOR_CONCURRENT_CHANGE");
    fs3.renameSync(staged, target);
    staged = void 0;
    try {
      if (hash(sourceOf(target).source) !== after || !registry.rebuilt(MODELS_CLIENT_ID)) throw problem("EDITOR_PUBLISH_FAILED");
    } catch {
      if (hash(sourceOf(target).source) === after) {
        staged = stage(target, current.source, current.mode);
        fs3.renameSync(staged, target);
        staged = void 0;
        try {
          registry.rebuilt(MODELS_CLIENT_ID);
        } catch {
        }
      }
      throw problem("EDITOR_PUBLISH_FAILED");
    }
    return { state: "ready", code: "EDITOR_INSTALLED", changed: true };
  } catch (error) {
    return failed(error);
  } finally {
    if (staged) {
      const absolute = path3.resolve(staged);
      if (path3.dirname(absolute) === path3.dirname(target) && path3.basename(absolute).startsWith(".dsh-model-groups-")) fs3.unlinkSync(absolute);
    }
    if (locked) fs3.unlinkSync(lock);
  }
}
function createEditorInterfaceManager(ctx, options) {
  let status = { state: "pending", code: "EDITOR_MODULE_PENDING", changed: false }, stopped = false, working = false;
  let registry, injectedRegistry, unsubscribe;
  function ensure() {
    if (stopped || working) return status;
    working = true;
    try {
      const available = injectedRegistry ?? (typeof ctx.get === "function" ? ctx.get("clientModules") : ctx.clientModules);
      if (registry !== available) {
        unsubscribe?.();
        registry = available;
        unsubscribe = registry?.onGraphChanged?.(() => {
          if (!working && !stopped) ensure();
        });
      }
      status = ensureEditorInterface(registry, options);
      return status;
    } finally {
      working = false;
    }
  }
  ctx.inject?.(["clientModules"], (child) => {
    injectedRegistry = child.clientModules;
    ensure();
    return () => {
      injectedRegistry = void 0;
      unsubscribe?.();
      unsubscribe = void 0;
      registry = void 0;
      status = { state: "pending", code: "EDITOR_REGISTRY_UNAVAILABLE", changed: false };
    };
  });
  ctx.effect?.(() => () => {
    stopped = true;
    unsubscribe?.();
  });
  return { ensure, snapshot: () => ({ ...status }) };
}

// src/bridge/config.js
import z from "@deepseek-ai/schemastery";
var Config = z.object({
  // Internal recovery copies can contain legacy authentication fields. Ordinary
  // Settings reads must redact the whole tree; trusted backend reads stay intact.
  bridge: z.object({ providers: z.dict(z.any()).default({}) }).default({}).volatile().role("secret")
});

// src/bridge/host.js
var GUARD_REF = "DSH_MODEL_GROUPS_BRIDGE_LOCAL_GUARD";
var GUARD_VALUE = "dsh-model-groups-local-routing-only";
function setupBridgeHost(ctx, { namespace = "model-groups", runtime = createBridgeRuntime(ctx, { discoverEndpoint: discoverBridgeModels }), storage, native } = {}) {
  storage ??= createBridgeSettingsStore(ctx.settings, { namespace });
  native ??= createBridgeSettingsStore(ctx.settings, { namespace: "llm-pi-ai", path: ["providers"] });
  const controller = createBridgeController({
    storage,
    native,
    normalizeNative: (provider, profile) => runtime.normalizeProfile ? runtime.normalizeProfile(provider, profile) : profile,
    credentials: ctx.credentials,
    async prepare(provider, draft, original) {
      const prepared = await runtime.prepare(provider, draft, original);
      if (!(await ctx.credentials.describe(GUARD_REF))?.configured) await ctx.credentials.set(GUARD_REF, GUARD_VALUE);
      const admission = { ...prepared, guardCredential: GUARD_REF };
      const probe = { enabled: true, keyEntries: { probe: { api: "openai-completions", models: [{ id: "dsh-model-groups-capability-probe", input: ["text"], contextWindow: 4096, maxTokens: 256 }] } } };
      let projectionMode;
      for (const mode of ["ordinary", "legacy"]) {
        try {
          const candidate = createBridgeProjection({}, probe, { guardCredential: GUARD_REF, projectionMode: mode });
          await runtime.probeProjection(provider, candidate, bridgeAlias("probe", "dsh-model-groups-capability-probe"));
          projectionMode = mode;
          break;
        } catch {
        }
      }
      if (!projectionMode) throw Object.assign(new Error("BRIDGE_PROJECTION_UNSUPPORTED"), { code: "BRIDGE_PROJECTION_UNSUPPORTED" });
      return { ...admission, projectionMode, routing: createBridgeRouting(provider, draft, original, prepared.models) };
    },
    async discover(provider, entryId, entry, { apiKey, shared } = {}) {
      const document = await storage.read();
      const saved = document.providers?.[provider];
      const original = saved?.active ? saved.original?.profile : (await native.read()).providers?.[provider];
      const root = applyBridgeShared(original, shared);
      return entryId === void 0 ? runtime.discover(provider, void 0, void 0, applyBridgeSingleKey(root, entry), void 0, { apiKey }) : runtime.discover(provider, entryId, entry, root, void 0, { apiKey });
    }
  });
  createBridgeDispatch(ctx, {
    readSnapshot: (provider) => controller.executionSnapshot(provider),
    // executionSnapshot verifies the native projection at the same read.
    projectionMatches: () => true,
    execute: (request) => runtime.execute(request)
  });
  let initialized = false, initializing;
  async function initialize() {
    editorInterface.ensure();
    if (initialized) return true;
    if (initializing) return initializing;
    initializing = runInitialization().finally(() => {
      initializing = void 0;
    });
    return initializing;
  }
  const editorInterface = createEditorInterfaceManager(ctx);
  const api = { ...controller, async snapshot() {
    return { ...await controller.snapshot(), editorInterface: editorInterface.snapshot() };
  }, needsInitialization: () => !initialized, async initialize() {
    await initialize();
    if (!initialized) throw Object.assign(new Error("MIGRATION_NOT_READY"), { code: "MIGRATION_NOT_READY" });
  } };
  ctx.effect(() => ctx.webServer.register({ kind: "exact", path: "/dsh-model-groups/bridge", handler: bridgeHttpHandler(api, ctx.connection) }));
  ctx.effect(() => () => runtime.dispose());
  async function runInitialization() {
    let migrationStep = "recover";
    reportBridgeImport(ctx.settings?.documentPath, { stage: "recover" });
    return controller.recover().then(async (recovered) => {
      if (recovered.recoveryConflicts?.length) throw Object.assign(new Error("NATIVE_CONFIG_CONFLICT"), { code: "NATIVE_CONFIG_CONFLICT" });
      const profiles = readBridgeImport(ctx.settings.documentPath);
      migrationStep = "import";
      reportBridgeImport(ctx.settings.documentPath, { stage: "import" });
      const imported = profiles ? await controller.importLegacy(profiles) : void 0;
      migrationStep = "synchronize";
      reportBridgeImport(ctx.settings.documentPath, { stage: "synchronize", imported: imported?.imported.length, conflicts: imported?.conflicts.length });
      return controller.synchronize();
    }).then(async (result) => {
      initialized = result.ok;
      const snapshot = await controller.snapshot();
      let clientRegistered;
      try {
        const graph = ctx.get?.("clientModules")?.graph?.();
        if (Array.isArray(graph?.entries)) clientRegistered = graph.entries.some((entry) => entry.id === "dsh-model-groups");
      } catch {
      }
      reportBridgeImport(ctx.settings.documentPath, { stage: "complete", activated: Object.values(snapshot.providers).filter((profile) => profile.active && profile.confirmed).length, conflicts: result.failures.length, clientRegistered });
      if (!result.ok) ctx.logger?.warn("\u90E8\u5206\u591A\u5BC6\u94A5\u914D\u7F6E\u9700\u8981\u5728\u539F\u6A21\u578B\u5361\u7247\u4E2D\u68C0\u67E5\u540E\u4FDD\u5B58\u3002");
    }).catch((error) => {
      const origin = String(error?.stack ?? "").match(/\/(dsh-config-editor|dsh-settings|schemastery)\/lib\/[^\s:]+:(\d+):\d+/);
      reportBridgeImport(ctx.settings.documentPath, {
        stage: "failed",
        code: error?.code,
        step: migrationStep,
        errorType: error?.name,
        origin: origin?.[1],
        originLine: origin ? Number(origin[2]) : void 0,
        frames: String(error?.stack ?? "").split("\n").filter((line) => /bridge-host-[^/]*\.js:\d+:\d+/.test(line)).slice(0, 4).map((line) => Number(line.match(/\.js:(\d+):\d+/)?.[1]))
      });
      ctx.logger?.warn("\u6A21\u578B\u5206\u7EC4\u914D\u7F6E\u5207\u6362\u5C1A\u672A\u5B8C\u6210\uFF0C\u8BF7\u68C0\u67E5\u539F\u6A21\u578B\u5361\u7247\u4E2D\u7684\u4FDD\u5B58\u72B6\u6001\u3002");
    });
  }
  const ready = initialize();
  return { controller, runtime, ready, initialize };
}
function apply(ctx) {
  const namespace = ctx.fiber?.entry?.options?.id ?? "model-groups";
  const ownerFiber = ctx.fiber;
  ctx.inject(["llm", "settings", "webServer", "connection", "credentials"], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ownerFiber));
    reportBridgeImport(child.settings.documentPath, { stage: "waiting" });
    startBridgeWhenSettingsReady(child, namespace, () => setupBridgeHost(child, { namespace }).ready);
  });
}
export {
  Config,
  apply,
  setupBridgeHost
};
