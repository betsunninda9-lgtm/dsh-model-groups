import React, { useEffect, useSyncExternalStore } from 'react';
import { SettingsEditor, ModelPicker, PickerLauncher } from './components.js';
import { dictionaries, phraseTranslator, identity } from './locale.js';
export { SettingsEditor, ModelPicker } from './components.js';
export const inject = ['slots', 'configForms', 'modelDirectories', 'sessions', 'locale'];
const h = React.createElement;
function observable(initial) {
  let value = initial;
  const listeners = new Set();
  return { getSnapshot: () => value, subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); }, set: next => { if (Object.is(next, value)) return; value = next; for (const fn of listeners) fn(); }, dispose: () => listeners.clear() };
}
function LocalizedSettings(props) { return h(SettingsEditor, { ...props, t: phraseTranslator(props.t || identity) }); }
function Seat({ locked, control, available, directory, t: translate = identity }) {
  const t = phraseTranslator(translate);
  const state = useSyncExternalStore(fn => directory.store.subscribe(fn), () => directory.store.getSnapshot(), () => directory.store.getSnapshot());
  const label = state.current ? `${state.current.model}${state.current.reasoningEffort === undefined ? '' : ` · ${state.current.reasoningEffort}`}` : t('Model groups');
  useEffect(() => { control.locked.set(locked || !available); return () => control.locked.set(true); }, [locked, available, control]);
  return h(PickerLauncher, { label, panelStore: control.open, locked: locked || !available, toggle: () => control.open.set(!control.open.getSnapshot()) });
}
function Dock({ control, ...props }) {
  const open = useSyncExternalStore(control.open.subscribe, control.open.getSnapshot, control.open.getSnapshot);
  const locked = useSyncExternalStore(control.locked.subscribe, control.locked.getSnapshot, control.locked.getSnapshot);
  return open ? h(ModelPicker, { ...props, t: phraseTranslator(props.t || identity), locked, onClose: () => control.open.set(false) }) : null;
}
/** Hostless Web contribution. The parent supplies write-only operations; no secret RPC is guessed here. */
export function apply(ctx, options = {}) {
  ctx.effect(() => ctx.locale.register('model-groups', dictionaries), 'model-groups: dictionaries');
  const t = phraseTranslator(ctx.locale.bind('model-groups'));
  const controls = new Map();
  const form = ctx.configForms.get('model-groups');
  const controlFor = sessionId => {
    if (!controls.has(sessionId)) {
      const control = { open: observable(false), locked: observable(true) };
      controls.set(sessionId, control);
      ctx.sessions.scope(sessionId).effect(() => () => { control.open.dispose(); control.locked.dispose(); controls.delete(sessionId); }, 'model-groups: session UI cleanup');
    }
    return controls.get(sessionId);
  };
  ctx.effect(() => () => { for (const control of controls.values()) { control.open.dispose(); control.locked.dispose(); } controls.clear(); }, 'model-groups: UI cleanup');
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'model-groups', locale: 'model-groups', order: 12, label: () => t('Model groups'),
    inject: () => ({ form, operations: options.operations })
  }, LocalizedSettings));
  // Public slot ledger elects the lowest priority; stock uses default priority 0.
  ctx.slots.inject('conversation.input.model', () => ctx.slots.register({
    name: 'conversation.input.model', locale: 'model-groups', priority: -10,
    inject: sessionId => ({ control: controlFor(sessionId), directory: ctx.modelDirectories.directoryFor(sessionId), available: ctx.sessions.subagentAddress(sessionId) === undefined })
  }, Seat));
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock', id: 'model-groups', locale: 'model-groups', order: 10,
    inject: sessionId => ({
      control: controlFor(sessionId), form,
      directory: ctx.modelDirectories.directoryFor(sessionId),
      available: ctx.sessions.subagentAddress(sessionId) === undefined,
      resolveText: text => ctx.locale?.resolveText ? ctx.locale.resolveText(text) : typeof text === 'string' ? text : ''
    })
  }, Dock));
}
