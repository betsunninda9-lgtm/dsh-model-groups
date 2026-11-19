import { decodeKeyModelId, KEY_MODEL_PREFIX } from '../hierarchy.js';

const MESSAGES = Object.freeze({
  BRIDGE_DISABLED: '此模型的独立密钥配置当前未启用。',
  BRIDGE_CONFIG_CONFLICT: '所选模型配置已变化，请在原模型菜单重新选择该模型。',
  INVALID_MODEL_IDENTITY: '此模型的密钥配置标识无效。',
  UNKNOWN_KEY_ENTRY: '所选密钥配置已不存在。',
  UNKNOWN_MODEL: '所选模型已不在此密钥配置中。',
  MISSING_CREDENTIAL: '所选密钥配置的凭据不可用，请检查该配置的密钥。',
  AUTH_HEADER_CONFLICT: '认证请求头会覆盖所选密钥，请在模型设置中移除它。',
  BRIDGE_RUNTIME_UNAVAILABLE: '当前引擎缺少独立密钥运行所需的公开接口。',
  COMPANION_RECALL_AUXILIARY_BLOCKED: '当前宿主不允许把受保护回忆会话委托给独立密钥运行环境；需要宿主提供公开的委托接口。',
  BRIDGE_EXECUTION_FAILED: '独立密钥请求未能完成，请检查模型设置。',
});

/** A closed failure projection: thrown credentials, headers and endpoints never enter the UI. */
export function bridgeFailure(error, signal) {
  let code, abortedCode = false;
  try {
    const property = Object.getOwnPropertyDescriptor(error ?? {}, 'code');
    if (property && 'value' in property && typeof property.value === 'string') {
      abortedCode = property.value === 'ABORTED';
      if (Object.hasOwn(MESSAGES, property.value)) code = property.value;
      if (property.value === 'NATIVE_CONFIG_CONFLICT') code = 'BRIDGE_CONFIG_CONFLICT';
    }
  } catch { /* Foreign error getters/proxies must not escape stream normalization. */ }
  const aborted = signal?.aborted === true || abortedCode;
  return { type: 'finish', reason: { kind: aborted ? 'aborted' : 'error', failure: {
    code: aborted ? 'ABORTED' : code ?? 'BRIDGE_EXECUTION_FAILED',
    message: aborted ? '请求已取消。' : MESSAGES[code ?? 'BRIDGE_EXECUTION_FAILED'],
  } } };
}
const fail = code => { throw Object.assign(new Error(code), { code }); };

/**
 * Preserve replay only for the selected public identity. The execution runtime
 * may keep the original provider name in a separate Cordis scope, so another
 * key with that provider name must lose replay before core ownership checks.
 * Neither message content (including tool/image blocks) nor callers are mutated.
 */
export function remapBridgeHistory(messages, { provider, publicModel, executionProvider = provider, model }) {
  return messages.map(message => {
    const source = message?.source;
    if (!source || typeof source !== 'object') return message;
    if (source.provider === provider && source.model === publicModel) {
      return { ...message, source: { ...source, provider: executionProvider, model } };
    }
    if (source.provider === executionProvider && Object.hasOwn(source, 'replayState')) {
      const { replayState: _foreignReplay, ...neutral } = source;
      return { ...message, source: neutral };
    }
    return message;
  });
}

/**
 * Intercept managed aliases. Versioned routes bind directory admission to an
 * immutable execution profile; unbound raw selections require reselection.
 * readSnapshot/provider and projectionMatches may be asynchronous; capture one
 * detached generation and pass it to execute instead of consulting live config
 * again while dispatching. The original provider/model remain on the outer call.
 * Returns the ordinary Cordis event disposer.
 */
export function createBridgeDispatch(ctx, { readSnapshot, execute, projectionMatches = () => true }) {
  if (typeof readSnapshot !== 'function' || typeof execute !== 'function') throw new TypeError('Bridge dispatch callbacks are required');
  return ctx.on('llm/stream', (options, next) => (async function* () {
    let terminal = false, passthrough = false;
    try {
      const observed = await readSnapshot(options.provider);
      const reserved = typeof options.model === 'string' && options.model.startsWith(KEY_MODEL_PREFIX);
      if (!observed?.enabled || !observed.active) {
        const legacy = decodeKeyModelId(options.model);
        const nativeModel = observed?.legacyNative === true && legacy
          && Object.hasOwn(observed.keyEntries ?? {}, legacy.entryId)
          && observed.keyEntries[legacy.entryId]?.models?.some(item => item.id === legacy.modelId);
        if (reserved && !nativeModel) fail('BRIDGE_DISABLED');
        passthrough = true;
        yield* next();
        return;
      }
      options.signal?.throwIfAborted();
      const snapshot = structuredClone(observed);
      const versioned = snapshot.routing !== undefined;
      // A raw identity carries no execution-generation binding. Require the
      // visible original-key compatibility group to select its versioned alias.
      if (versioned && !reserved) fail('BRIDGE_CONFIG_CONFLICT');
      if (!snapshot.confirmed || !await projectionMatches(options.provider, snapshot)) fail('BRIDGE_CONFIG_CONFLICT');
      const identity = decodeKeyModelId(options.model);
      let entryId = identity?.entryId;
      if (versioned) {
        if (!identity || !snapshot.routing || !Object.hasOwn(snapshot.routing, identity.entryId)) fail('BRIDGE_CONFIG_CONFLICT');
        const routed = snapshot.routing[identity.entryId];
        if (routed !== null && (typeof routed !== 'string' || !Object.hasOwn(snapshot.keyEntries ?? {}, routed))) fail('BRIDGE_CONFIG_CONFLICT');
        entryId = routed === null ? undefined : routed;
        const models = routed === null ? snapshot.rootModels : snapshot.keyEntries[routed].models;
        if (!Array.isArray(models) || !models.some(model => model?.id === identity.modelId)) fail('UNKNOWN_MODEL');
      } else {
        if (reserved && !identity) fail('INVALID_MODEL_IDENTITY');
        if (identity) {
          if (!Object.hasOwn(snapshot.keyEntries ?? {}, entryId)) fail('UNKNOWN_KEY_ENTRY');
          const models = snapshot.keyEntries[entryId]?.models;
          if (!Array.isArray(models) || !models.some(model => model?.id === identity.modelId)) fail('UNKNOWN_MODEL');
        }
      }
      const request = { snapshot, provider: options.provider, publicModel: options.model,
        model: identity?.modelId ?? options.model, entryId, options,
        remapHistory: executionProvider => remapBridgeHistory(options.messages, {
          provider: options.provider, publicModel: options.model,
          executionProvider, model: identity?.modelId ?? options.model,
        }),
      };
      const stream = await execute(request);
      for await (const chunk of stream) {
        if (terminal) break;
        terminal = chunk?.type === 'finish';
        yield chunk;
        if (terminal) break;
      }
      if (!terminal) yield bridgeFailure(undefined, options.signal);
    } catch (error) {
      if (passthrough) throw error;
      if (!terminal) yield bridgeFailure(error, options.signal);
    }
  })());
}
