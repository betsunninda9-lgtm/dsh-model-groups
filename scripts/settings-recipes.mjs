import { parse } from 'acorn';

const TARGET = 'node_modules/@deepseek-ai/dsh-client-ui-settings-models/lib/client.js';
const MODELS_STATE = 'const [models, setModels] = (0, react.useState)([]);';
export class SettingsRecipeAmbiguity extends Error {
  constructor() { super('Settings hook scope is ambiguous'); }
}

function walk(node, visit) {
  if (!node || typeof node.type !== 'string') return;
  visit(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) for (const child of value) walk(child, visit);
    else if (value && typeof value === 'object') walk(value, visit);
  }
}
function identifier(node, name) { return node?.type === 'Identifier' && node.name === name; }
function member(node, object, property) {
  return node?.type === 'MemberExpression' && !node.computed && identifier(node.object, object) && identifier(node.property, property);
}
function hook(statement, names) {
  if (statement.type !== 'VariableDeclaration' || statement.kind !== 'const' || statement.declarations.length !== 1) return false;
  const declaration = statement.declarations[0];
  if (declaration.id.type !== 'ArrayPattern' || declaration.id.elements.length !== names.length || !names.every((name, index) => identifier(declaration.id.elements[index], name))) return false;
  if (declaration.init?.type !== 'CallExpression' || declaration.init.arguments.length !== 1) return false;
  const callee = declaration.init.callee.type === 'SequenceExpression' ? declaration.init.callee.expressions.at(-1) : declaration.init.callee;
  return member(callee, 'react', 'useState');
}
function filteredModels(node) {
  if (identifier(node, 'models')) return true;
  return node?.type === 'CallExpression' && node.arguments.length === 1 && node.callee.type === 'MemberExpression' && !node.callee.computed
    && identifier(node.callee.property, 'filter') && filteredModels(node.callee.object);
}
function modelReceiver(source, owner) {
  const profiles = [];
  walk(owner.body, node => { if (node.type === 'VariableDeclarator' && identifier(node.id, 'profile') && node.init?.type === 'ObjectExpression') profiles.push(node.init); });
  if (profiles.length !== 1) return null;
  const values = profiles[0].properties.filter(node => node.type === 'Property' && !node.computed && (identifier(node.key, 'models') || node.key.type === 'Literal' && node.key.value === 'models'));
  if (values.length !== 1) return null;
  const value = values[0].value;
  if (value?.type !== 'CallExpression' || value.callee.type !== 'MemberExpression' || value.callee.computed || !identifier(value.callee.property, 'map')) return null;
  let receiver = value.callee.object;
  if (receiver.type === 'ConditionalExpression' && identifier(receiver.test, 'multiKey') && member(receiver.consequent, 'firstEntry', 'models')) receiver = receiver.alternate;
  return filteredModels(receiver) ? source.slice(receiver.start, receiver.end) : null;
}

// Adapt only the host-owned state initializer and single-key filtering context.
// Neither expression is copied over the host: both sides of each known recipe
// retain the observed bytes, so the existing structural roundtrip checks apply.
export function settingsRecipes(source, candidates) {
  if (candidates[0]?.target !== TARGET || !candidates.some(candidate => candidate.replacements?.some(replacement => replacement.before?.includes(MODELS_STATE)))) return candidates;
  let tree;
  try { tree = parse(source, { ecmaVersion: 'latest', sourceType: 'module' }); }
  catch { return candidates; }
  const owners = [];
  walk(tree, node => { if (node.type === 'FunctionDeclaration' && identifier(node.id, 'CustomProviderCard')) owners.push(node); });
  if (!owners.length) return candidates;
  if (owners.length !== 1) throw new SettingsRecipeAmbiguity();
  const owner = owners[0];
  const models = owner.body.body.filter(statement => hook(statement, ['models', 'setModels']));
  const busy = owner.body.body.filter(statement => hook(statement, ['busy', 'setBusy']));
  if (!models.length || !busy.length) return candidates;
  if (models.length !== 1 || busy.length !== 1 || models[0].end >= busy[0].start) throw new SettingsRecipeAmbiguity();
  const state = source.slice(models[0].start, models[0].end);
  const receiver = modelReceiver(source, owner);
  const rewrite = text => {
    let result = text.split(MODELS_STATE).join(state);
    if (receiver && receiver !== 'models') {
      result = result.split('models: models.map(').join(`models: ${receiver}.map(`);
      result = result.split('models: (multiKey ? firstEntry.models : models).map(').join(`models: (multiKey ? firstEntry.models : ${receiver}).map(`);
    }
    return result;
  };
  return candidates.map(candidate => ({ ...candidate, replacements: candidate.replacements.map(replacement => ({ ...replacement, before: rewrite(replacement.before), after: rewrite(replacement.after) })) }));
}
