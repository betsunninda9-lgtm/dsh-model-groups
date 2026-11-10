import { randomBytes } from 'node:crypto';

const alias = value => typeof value === 'string' && value.startsWith('@dsh-key/');
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 512;
const selection = value => {
  if (!value || !validId(value.provider) || !validId(value.model) ||
      (value.reasoningEffort !== undefined && !validId(value.reasoningEffort))) throw new Error('INVALID_SELECTION');
  return { provider: value.provider, model: value.model,
    ...(value.reasoningEffort === undefined ? {} : { reasoningEffort: value.reasoningEffort }) };
};
const equal = (a, b) => !!a && !!b && a.provider === b.provider && a.model === b.model && a.reasoningEffort === b.reasoningEffort;
const fail = code => Object.assign(new Error(code), { code });
const clone = value => JSON.parse(JSON.stringify(value));
const unsupported = () => [
  { code: 'COLD_SESSIONS_UNSUPPORTED', message: 'Cold sessions cannot be safely changed by this adapter.' },
  { code: 'HISTORICAL_REFERENCES_UNSUPPORTED', message: 'Historical request headers and replay/fork references are not rewritten.' },
  { code: 'OTHER_REFERENCES_UNSUPPORTED', message: 'Agent options, subagent descriptors, presets, other profiles and processes are not migrated.' },
];

/** Verified installed service spellings. Descriptive only: this module imports no host code. */
export const FALLBACK_HOST_APIS = Object.freeze({
  live: 'ctx.agents.get(sessionId); agent.model.current(); agent.model.select(selection)',
  durability: 'await ctx.sessions.flush(agent.session); await ctx.sessionQuery.readSession(sessionId)',
  defaults: 'ctx.agentDefaultModel.currentSelection(); ctx.agentDefaultModel.remembersLastSelection(); await ctx.agentDefaultModel.saveSelection(next, { ifCurrent: previous })',
  catalog: 'session.modelCatalog() uses ctx.llm.listProviders/listModels/resolveModelInfo; NOT called here because discovery may perform network I/O',
  limitation: 'No host session-selection CAS or cross-service transaction exists; synchronous local check+select is not a process-wide maintenance lock.',
});

/**
 * UNWIRED, local-only injected adapter. No discovery, inference, credential access, file
 * writes, cold-agent creation, automatic default update or native patch operations.
 *
 * `catalog` is a detached ALREADY OBTAINED ordinary catalog: { groups: [{ id, models:
 * [{ id, reasoning?: { efforts: [{id}] } }] }] }. `ordinaryProviders` is an explicit
 * allowlist verified by the future caller from local configuration: the catalog alone
 * cannot establish that a provider has no multi-key routing. Never derive it by merely
 * excluding alias IDs. No provider discovery or settings/secret reads occur here.
 *
 * Inject formal services `agents`, `sessions`, `defaultModel`, and optional
 * `readPersistedSelection(id)` (read-only; return the effective current selection).
 * The future reader must fold model/selection and request/header events, not old
 * request headers alone. `sessions.flush` must return true (a durability listener).
 *
 * Session CAS is a synchronous identity + full selection + seq + idle check immediately
 * followed by the synchronous AgentModel.select. No await is permitted between them.
 * This is same-process CAS only; it does NOT lock out a later prompt or other process.
 * Defaults use the host's lock-held ifCurrent CAS and reject fixed-default mode.
 * Each ticket changes exactly ONE explicitly chosen target. Partial failures are
 * reported, never rolled back or represented as successful migration/removal safety.
 */
export function createFallbackSelection({ catalog, ordinaryProviders = [], agents, sessions,
  defaultModel, readPersistedSelection, now = Date.now, token = () => randomBytes(24).toString('hex'), ttlMs = 120000 } = {}) {
  const allowed = new Set(ordinaryProviders);
  const choices = [];
  for (const group of catalog?.groups ?? []) {
    if (!validId(group.id) || alias(group.id) || !allowed.has(group.id)) continue;
    for (const model of group.models ?? []) {
      if (!validId(model.id) || alias(model.id)) continue;
      const efforts = (model.reasoning?.efforts ?? []).map(effort => effort.id).filter(validId);
      if (choices.some(item => item.provider === group.id && item.model === model.id)) throw fail('AMBIGUOUS_CATALOG');
      choices.push({ provider: group.id, model: model.id, efforts });
    }
  }
  const tickets = new Map();
  let busy = false;
  const choice = input => {
    const next = selection(input);
    if (Object.keys(input).some(key => !['provider', 'model', 'reasoningEffort'].includes(key))) throw fail('INVALID_SELECTION');
    const item = choices.find(item => item.provider === next.provider && item.model === next.model);
    if (!item || alias(next.provider) || alias(next.model) ||
        (next.reasoningEffort !== undefined && !item.efforts.includes(next.reasoningEffort))) throw fail('NOT_ORDINARY_CATALOG_SELECTION');
    return next;
  };
  const readLive = id => {
    const agent = agents?.get?.(id);
    if (!agent || agent.id !== id || !agent.session || typeof agent.model?.current !== 'function' || typeof agent.model?.select !== 'function') throw fail('LIVE_SESSION_UNSUPPORTED');
    if (agent.status !== 'idle' || (agent.phase && agent.phase.kind !== 'idle')) throw fail('SESSION_BUSY');
    if (!Number.isSafeInteger(agent.session.seq) || agent.session.seq < 0) throw fail('SESSION_REVISION_UNAVAILABLE');
    return { agent, session: agent.session, seq: agent.session.seq, current: selection(agent.model.current()) };
  };
  const readDefault = () => {
    if (typeof defaultModel?.currentSelection !== 'function' || typeof defaultModel?.remembersLastSelection !== 'function' || typeof defaultModel?.saveSelection !== 'function') throw fail('DEFAULT_API_UNAVAILABLE');
    if (defaultModel.remembersLastSelection() !== true) throw fail('FIXED_DEFAULT_UNSUPPORTED');
    return selection(defaultModel.currentSelection());
  };
  function preview({ target, next } = {}) {
    const blockers = [];
    let selected, previous, observation, cleanTarget;
    try {
      selected = choice(next);
      if (target?.kind === 'session' && validId(target.sessionId) && Object.keys(target).every(key => ['kind', 'sessionId'].includes(key))) {
        cleanTarget = { kind: 'session', sessionId: target.sessionId };
        if (typeof sessions?.flush !== 'function' || typeof readPersistedSelection !== 'function') throw fail('DURABILITY_VERIFICATION_UNAVAILABLE');
        observation = readLive(target.sessionId);
        previous = observation.current;
      } else if (target?.kind === 'default' && Object.keys(target).length === 1) {
        cleanTarget = { kind: 'default' };
        previous = readDefault();
      } else throw fail('TARGET_UNSUPPORTED');
      if (!alias(previous.model) && !alias(previous.provider)) throw fail('NOT_ALIAS_SELECTION');
    } catch (error) { blockers.push({ code: error.code || 'INVALID_SELECTION' }); }
    let ticket = null;
    if (!blockers.length) {
      // Bound memory and invalidate expired confirmations without exposing observations.
      for (const [key, value] of tickets) if (value.expires <= now()) tickets.delete(key);
      if (tickets.size >= 128) tickets.delete(tickets.keys().next().value);
      ticket = token();
      if (typeof ticket !== 'string' || !ticket || tickets.has(ticket)) throw fail('TOKEN_UNAVAILABLE');
      tickets.set(ticket, { target: cleanTarget, next: selected, previous, observation, expires: now() + ttlMs });
    }
    return { canApply: blockers.length === 0 && !busy, token: ticket,
      target: cleanTarget ? { ...cleanTarget } : null, previous: previous ? { ...previous } : null, next: selected ? { ...selected } : null,
      blockers, removalBlockers: unsupported(), safeToRemovePatches: false,
      scope: 'one-current-selection-only', catalogFreshness: 'caller-supplied-snapshot' };
  }
  async function apply(input) {
    if (busy) throw fail('BUSY');
    const ticket = tickets.get(input?.token);
    if (!ticket || ticket.expires <= now() || input?.confirmation !== 'CONFIRM FALLBACK SELECTION' ||
        Object.keys(input).some(key => !['token', 'confirmation'].includes(key))) throw fail('CONFIRMATION_REQUIRED');
    tickets.delete(input.token);
    busy = true;
    let changed = false;
    try {
      if (ticket.target.kind === 'session') {
        const live = readLive(ticket.target.sessionId);
        const old = ticket.observation;
        if (live.agent !== old.agent || live.session !== old.session || live.seq !== old.seq || !equal(live.current, ticket.previous)) throw fail('STATE_CHANGED');
        // The only live write: synchronous check+select with no intervening await.
        changed = true; // A throwing host operation may already have appended.
        const result = live.agent.model.select({ ...ticket.next });
        if (result && typeof result.then === 'function') throw fail('ASYNC_SELECTION_UNSUPPORTED');
        if (await sessions.flush(live.session) !== true) throw fail('DURABILITY_UNCONFIRMED');
        const persisted = selection(await readPersistedSelection(ticket.target.sessionId));
        const after = readLive(ticket.target.sessionId);
        if (after.agent !== live.agent || after.session !== live.session || !equal(after.current, ticket.next) || !equal(persisted, ticket.next)) throw fail('POSTCHECK_FAILED');
      } else {
        if (!equal(readDefault(), ticket.previous)) throw fail('STATE_CHANGED');
        const receipt = await defaultModel.saveSelection({ ...ticket.next }, { ifCurrent: { ...ticket.previous } });
        if (receipt?.status !== 'saved') throw fail('DEFAULT_CAS_REJECTED');
        changed = true;
        if (!equal(readDefault(), ticket.next)) throw fail('POSTCHECK_FAILED');
      }
      return { status: 'applied', target: clone(ticket.target), selected: { ...ticket.next },
        safeToRemovePatches: false, removalBlockers: unsupported() };
    } catch (error) {
      // Host errors can include secrets: do not propagate messages or causes.
      return { status: changed ? 'changed-unverified' : 'not-applied', code: knownCode(error),
        mayHaveChanged: changed || ticket.target.kind === 'default', safeToRemovePatches: false,
        removalBlockers: unsupported() };
    } finally { busy = false; }
  }
  return { preview, apply, catalog: () => choices.map(({ provider, model, efforts }) => ({ provider, model, efforts: [...efforts] })) };
}

function knownCode(error) {
  return ['LIVE_SESSION_UNSUPPORTED', 'SESSION_BUSY', 'SESSION_REVISION_UNAVAILABLE', 'STATE_CHANGED',
    'FIXED_DEFAULT_UNSUPPORTED', 'DEFAULT_API_UNAVAILABLE', 'DEFAULT_CAS_REJECTED', 'ASYNC_SELECTION_UNSUPPORTED',
    'DURABILITY_UNCONFIRMED', 'POSTCHECK_FAILED'].includes(error?.code) ? error.code : 'OPERATION_FAILED';
}
