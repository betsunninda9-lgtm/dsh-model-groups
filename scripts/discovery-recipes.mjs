import { parse } from 'acorn';

const plainGuard = 'if (request.provider !== void 0) {';
const entryGuard = 'if (!entryProtocol && request.provider !== void 0) {';
const entryPrefix = '!entryProtocol && (';
const providerMember = node => node?.type === 'MemberExpression' && !node.computed
  && node.object?.type === 'Identifier' && node.object.name === 'request' && node.property?.name === 'provider';
function visit(node, callback) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const item of node) visit(item, callback); return; }
  if (typeof node.type === 'string') callback(node);
  for (const [key, value] of Object.entries(node)) if (!['start', 'end', 'loc'].includes(key)) visit(value, callback);
}

// Catalog selection is an additive restriction: retain a host's existing test,
// while preventing a selected key protocol from taking the catalog shortcut.
// Scope by function/call identity, never a mobile build name or whole-file hash.
export function discoveryRecipes(source, candidates) {
  if (candidates[0]?.target !== 'node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js') return candidates;
  try {
    const functions = [];
    visit(parse(source, { ecmaVersion: 'latest', sourceType: 'module' }), node => {
      if (node.type === 'FunctionDeclaration' && node.id?.name === 'discoverModels') functions.push(node);
    });
    if (functions.length !== 1) return candidates;
    const shortcuts = functions[0].body.body.filter(node => node.type === 'IfStatement' && node.consequent.type === 'BlockStatement'
      && node.consequent.body.some(statement => statement.type === 'VariableDeclaration' && statement.declarations.some(declaration =>
        declaration.init?.type === 'CallExpression' && declaration.init.callee?.name === 'catalogModels'
        && declaration.init.arguments.length === 1 && providerMember(declaration.init.arguments[0]))));
    if (shortcuts.length !== 1) return candidates;
    const shortcut = shortcuts[0];
    const header = source.slice(shortcut.start, shortcut.consequent.start + 1);
    const open = header.indexOf('('), close = header.lastIndexOf(')');
    if (open < 0 || close <= open) return candidates;
    const observed = header.slice(open + 1, close);
    // Ordinary pristine/current recipes already describe these two predicates.
    if (observed === 'request.provider !== void 0' || observed === '!entryProtocol && request.provider !== void 0') return candidates;
    const patched = observed.startsWith(entryPrefix) && observed.endsWith(')');
    const original = patched ? observed.slice(entryPrefix.length, -1) : observed;
    const originalHeader = header.slice(0, open + 1) + original + header.slice(close);
    const targetHeader = header.slice(0, open + 1) + entryPrefix + original + ')' + header.slice(close);
    if (source.split(patched ? targetHeader : originalHeader).length !== 2) return candidates;
    let hasProviderTest = false, foreignEntry = false;
    const test = parse(`if (${original}) {}`, { ecmaVersion: 'latest' }).body[0].test;
    visit(test, node => {
      if (node.type === 'BinaryExpression' && node.operator === '!==' && providerMember(node.left)
        && node.right.type === 'UnaryExpression' && node.right.operator === 'void' && node.right.argument?.value === 0) hasProviderTest = true;
      if (node.type === 'Identifier' && node.name === 'entryProtocol') foreignEntry = true;
    });
    if (!hasProviderTest || foreignEntry) return candidates;
    return candidates.map(candidate => ({ ...candidate, replacements: candidate.replacements.flatMap(replacement => {
      if (!replacement.before.endsWith(plainGuard) || !replacement.after.endsWith(entryGuard)) return [replacement];
      const before = replacement.before.slice(0, -plainGuard.length).trimEnd();
      const after = replacement.after.slice(0, -entryGuard.length).trimEnd();
      if (!before || !after.startsWith(before + '\n')) return [replacement];
      return [{ ...replacement, before, after }, { ...replacement, before: originalHeader, after: targetHeader }];
    }) }));
  } catch { return candidates; }
}
