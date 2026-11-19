import assert from 'node:assert/strict';
import { parse } from 'acorn';

// An isolated upstream-interface proposal, NOT an installer or a runtime patch.
// The caller supplies a copy of the inspected host client module. This module
// neither reads nor writes any host path and is not imported by the plugin.
function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (typeof node.type === 'string') visit(node);
  for (const [key, value] of Object.entries(node)) {
    if (key === 'start' || key === 'end') continue;
    if (Array.isArray(value)) value.forEach(item => walk(item, visit));
    else if (value && typeof value === 'object') walk(value, visit);
  }
}
const keyOf = property => property.key?.name ?? property.key?.value;
const prop = (object, key) => object?.properties?.find(item => keyOf(item) === key)?.value;

export function proposeProviderEditorSeam(source) {
  const tree = parse(source, { ecmaVersion: 'latest', sourceType: 'script' });
  const editors = [], registrations = [];
  walk(tree, node => {
    if (node.type === 'ConditionalExpression' && node.test.type === 'Identifier' && node.test.name === 'open'
      && node.consequent.type === 'CallExpression' && node.consequent.callee.name === 'renderProviderEditor'
      && node.alternate.type === 'Literal' && node.alternate.value === null) editors.push(node);
    if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression' && node.callee.property.name === 'register') {
      const options = node.arguments[0];
      if (prop(options, 'name')?.value === 'settings.section' && prop(options, 'id')?.value === 'models') registrations.push(options);
    }
  });
  assert.equal(editors.length, 1, 'proposal requires one inspected native Edit branch');
  assert.equal(registrations.length, 1, 'proposal requires the native Models registration');
  const children = prop(registrations[0], 'children');
  assert.equal(children?.type, 'ObjectExpression');
  assert.equal(prop(children, 'settings.models.provider-editor'), undefined);
  const editor = editors[0];
  const fallback = source.slice(editor.start, editor.end);
  const replacement = `((defaultEditor) => (0, react_jsx_runtime.jsx)("div", {
    hidden: !open,
    "data-models-provider-editor": row.entry.provider,
    children: renderSlot("settings.models.provider-editor", {
      provider: row.entry, configured: row.configured,
      keyConfigured: keyConfiguredOf(row), open, readOnly: !state.writable,
      defaultEditor,
      onClose: (changed) => closeEditor(changed, target)
    }, { entryKey: row.entry.settingsNs, fallback: defaultEditor })
  }))(${fallback})`;
  const edits = [
    { start: editor.start, end: editor.end, text: replacement },
    { start: children.start + 1, end: children.start + 1, text: '\n"settings.models.provider-editor": { kind: "keyed", scope: "root" },' },
  ].sort((a, b) => b.start - a.start);
  let result = source;
  for (const edit of edits) result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  parse(result, { ecmaVersion: 'latest', sourceType: 'script' });
  return result;
}
