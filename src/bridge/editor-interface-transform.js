import { parse } from 'acorn';

export const EDITOR_SLOT = 'settings.models.provider-editor';
const prop = (node, name) => node?.type === 'ObjectExpression' ? node.properties.find(p => p.type === 'Property' && (p.key.name ?? p.key.value) === name)?.value : undefined;
const text = (source, node) => source.slice(node.start, node.end);
const fail = code => { throw Object.assign(new Error(code), { code }); };
function collect(tree) {
  const items = [];
  function walk(node, parents = []) {
    if (!node || typeof node !== 'object') return;
    if (typeof node.type === 'string') items.push({ node, parents });
    for (const [key, value] of Object.entries(node)) {
      if (key === 'start' || key === 'end') continue;
      if (Array.isArray(value)) for (const child of value) walk(child, [...parents, node]);
      else if (value && typeof value === 'object') walk(value, [...parents, node]);
    }
  }
  walk(tree);
  return items;
}
const owner = item => [...item.parents].reverse().find(n => /^(?:Function|ArrowFunction)/.test(n.type));
const jsx = node => node?.type === 'CallExpression' && (node.callee.type === 'SequenceExpression' ? node.callee.expressions.at(-1) : node.callee)?.type === 'MemberExpression'
  && ['jsx', 'jsxs'].includes((node.callee.type === 'SequenceExpression' ? node.callee.expressions.at(-1) : node.callee).property.name);

/** Byte splices only at the native editor seat. No version/hash admission. */
export function prepareEditorInterface(source) {
  let items;
  try { items = collect(parse(source, { ecmaVersion: 'latest', sourceType: 'script' })); }
  catch { fail('EDITOR_SOURCE_INVALID'); }
  const registrations = items.filter(({ node }) => node.type === 'CallExpression' && node.callee.type === 'MemberExpression'
    && node.callee.property.name === 'register' && prop(node.arguments[0], 'name')?.value === 'settings.section'
    && prop(node.arguments[0], 'id')?.value === 'models');
  if (registrations.length !== 1) fail('EDITOR_STRUCTURE_UNSUPPORTED');
  const children = prop(registrations[0].node.arguments[0], 'children');
  if (!prop(children, 'settings.models.provider-card') || !prop(children, 'settings.models.footer')) fail('EDITOR_STRUCTURE_UNSUPPORTED');
  const declaration = prop(children, EDITOR_SLOT);
  const calls = items.filter(({ node }) => node.type === 'CallExpression' && node.arguments[0]?.value === EDITOR_SLOT);
  if (declaration) {
    if (prop(declaration, 'kind')?.value !== 'keyed' || prop(declaration, 'scope')?.value !== 'root' || !calls.some(({ node }) =>
      prop(node.arguments[1], 'provider') && prop(node.arguments[1], 'open') && prop(node.arguments[1], 'onClose') && prop(node.arguments[2], 'entryKey'))) fail('EDITOR_INTERFACE_INCOMPLETE');
    return { source, changed: false };
  }
  if (calls.length) fail('EDITOR_INTERFACE_INCOMPLETE');
  const cards = items.filter(({ node }) => node.type === 'CallExpression' && node.callee.type === 'Identifier'
    && node.arguments[0]?.value === 'settings.models.provider-card' && prop(node.arguments[1], 'provider') && prop(node.arguments[1], 'configured')
    && prop(node.arguments[1], 'keyConfigured') && prop(node.arguments[2], 'entryKey'));
  const branches = items.filter(({ node }) => node.type === 'ConditionalExpression' && node.test.type === 'Identifier'
    && node.alternate.type === 'Literal' && node.alternate.value === null && node.consequent.type === 'CallExpression'
    && node.consequent.callee.type === 'Identifier' && prop(node.consequent.arguments[0], 'row')
    && prop(node.consequent.arguments[0], 'readOnly') && prop(node.consequent.arguments[0], 'onClose'));
  const candidates = branches.flatMap(branch => {
    const row = prop(branch.node.consequent.arguments[0], 'row');
    const container = [...branch.parents].reverse().find(node => node.type === 'ArrayExpression');
    const matches = cards.filter(card => container && card.parents.includes(container) && owner(card) === owner(branch) && prop(card.node.arguments[1], 'provider')?.type === 'MemberExpression'
      && prop(card.node.arguments[1], 'provider').property.name === 'entry'
      && text(source, prop(card.node.arguments[1], 'provider').object) === text(source, row));
    return matches.length === 1 ? [{ branch, card: matches[0] }] : [];
  });
  if (candidates.length !== 1) fail('EDITOR_STRUCTURE_UNSUPPORTED');
  const { branch, card } = candidates[0];
  const ancestorJSX = [...branch.parents].reverse().find(jsx);
  if (!ancestorJSX) fail('EDITOR_STRUCTURE_UNSUPPORTED');
  const factory = `(${text(source, ancestorJSX.callee)})`;
  const render = text(source, card.node.callee), attributes = card.node.arguments[1], options = card.node.arguments[2];
  const provider = text(source, prop(attributes, 'provider')), configured = text(source, prop(attributes, 'configured'));
  const keyConfigured = text(source, prop(attributes, 'keyConfigured')), entryKey = text(source, prop(options, 'entryKey'));
  const wrap = (node, call, open) => {
    const args = call.arguments[0], fallback = text(source, node);
    return `/* dsh-model-groups/editor-interface@1 */ ((defaultEditor) => ${factory}("div", {
      hidden: !(${open}), "data-models-provider-editor": ${provider}.provider,
      children: ${render}(${JSON.stringify(EDITOR_SLOT)}, {
        provider: ${provider}, configured: ${configured}, keyConfigured: ${keyConfigured}, open: (${open}),
        readOnly: ${text(source, prop(args, 'readOnly'))}, defaultEditor,
        onClose: ${text(source, prop(args, 'onClose'))}
      }, { entryKey: ${entryKey}, fallback: defaultEditor })
    }))(${fallback})`;
  };
  const edits = [{ start: branch.node.start, end: branch.node.end, value: wrap(branch.node, branch.node.consequent, text(source, branch.node.test)) },
    { start: children.start + 1, end: children.start + 1, value: `\n${JSON.stringify(EDITOR_SLOT)}: { kind: "keyed", scope: "root" },` }];
  // The native first-time setup card owns the same row and its own close callback.
  const setup = items.filter(item => item.node.type === 'CallExpression' && item.node.callee.type === 'Identifier'
    && item.node.callee.name === branch.node.consequent.callee.name && owner(item) === owner(branch)
    && prop(item.node.arguments[0], 'row') && text(source, prop(item.node.arguments[0], 'row')) === text(source, prop(branch.node.consequent.arguments[0], 'row'))
    && item.node !== branch.node.consequent);
  if (setup.length > 1) fail('EDITOR_STRUCTURE_UNSUPPORTED');
  for (const item of setup) {
    if (!prop(item.node.arguments[0], 'onClose') || !prop(item.node.arguments[0], 'readOnly')) fail('EDITOR_STRUCTURE_UNSUPPORTED');
    edits.push({ start: item.node.start, end: item.node.end, value: wrap(item.node, item.node, 'true') });
  }
  let result = source;
  for (const edit of edits.sort((a, b) => b.start - a.start)) result = result.slice(0, edit.start) + edit.value + result.slice(edit.end);
  try { parse(result, { ecmaVersion: 'latest', sourceType: 'script' }); }
  catch { fail('EDITOR_SOURCE_INVALID'); }
  return { source: result, changed: true };
}
