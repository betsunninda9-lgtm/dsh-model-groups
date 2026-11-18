import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'acorn';
import { settingsRecipes } from '../scripts/settings-recipes.mjs';
import { structuralRevision, transformFragments } from '../scripts/structural-patches.mjs';

const shipped = JSON.parse(fs.readFileSync(new URL('../native/settings-models.patch.json', import.meta.url), 'utf8'));
const state = 'const [models, setModels] = (0, react.useState)([]);';
const stateIndex = shipped.replacements.findIndex(value => value.before.startsWith(state + '\n') && value.after.includes('const [multiKey, setMultiKey]'));
const profileIndex = shipped.replacements.findIndex(value => value.before.includes('models: models.map('));
assert.ok(stateIndex >= 0 && profileIndex >= 0);
const original = `function CustomProviderCard(props) {\n\t\t\t${state}\n\t\t\tconst [busy, setBusy] = (0, react.useState)(false);\n\t\t\tconst createOnce = () => {\n\t\t\t\tconst profile = {\n\t\t\t\t\t\t...storesKey ? { apiKeyEnv: keyRef } : {},\n\t\t\t\t\t\tapi: protocol,\n\t\t\t\t\t\tbaseURL: normalizedBaseURL,\n\t\t\t\t\t\tmodels: models.map((model) => ({ ...model }))\n\t\t\t\t};\n\t\t\t\treturn profile;\n\t\t\t};\n\t\t\treturn createOnce;\n}\n`;
const initial = { ...shipped, current: true, extraMetadata: { kept: true }, replacements: [stateIndex, profileIndex].map(index => ({ ...shipped.replacements[index], recipeReplacementIndex: index })) };
const middle = transformFragments(original, initial);
const saveState = { before: middle, after: middle.replace('const saving =', 'const [entrySaveState, setEntrySaveState] = (0, react.useState)(void 0);\n\t\t\tconst saving ='), extraField: 'whole-owner-save-state' };
const candidate = { ...initial, replacements: [...initial.replacements, saveState] };
function fixture(initializer = '[{ id: "" }]', receiver = 'models.filter((model) => model.id.trim().length > 0)') {
  return original.replace('(0, react.useState)([]);', `(0, react.useState)(${initializer});`).replace('models: models.map(', `models: ${receiver}.map(`);
}
function roundtrip(source) {
  const adapted = settingsRecipes(source, [candidate]);
  const revision = structuralRevision(source, adapted);
  assert.ok(revision);
  assert.equal(revision.original, source);
  assert.equal(transformFragments(revision.latest, adapted[0], true), source);
  const fresh = settingsRecipes(revision.latest, [candidate]);
  assert.deepEqual(fresh, adapted, 'patched recognition derives the same private recipe context');
  const checked = structuralRevision(revision.latest, fresh);
  assert.equal(checked?.state, 'patched');
  assert.equal(checked?.latest, revision.latest);
  assert.equal(checked?.original, source);
  return { revision, adapted };
}

test('state initializer and single-key filters survive all overlapping owner recipes exactly', () => {
  const source = fixture();
  assert.equal(structuralRevision(source, [candidate]), undefined, 'the unchanged baseline recipe fails on overlapping host changes');
  const { revision, adapted } = roundtrip(source);
  assert.ok(revision.latest.includes('(0, react.useState)([{ id: "" }]);'));
  assert.ok(revision.latest.includes('(multiKey ? firstEntry.models : models.filter((model) => model.id.trim().length > 0)).map('));
  assert.ok(revision.latest.includes('const [entrySaveState, setEntrySaveState]'));
  assert.equal(adapted[0].extraMetadata, candidate.extraMetadata);
  assert.equal(adapted[0].baseSha256, candidate.baseSha256);
  assert.equal(adapted[0].resultSha256, candidate.resultSha256);
  assert.equal(adapted[0].replacements[0].recipeReplacementIndex, stateIndex);
  assert.equal(adapted[0].replacements[2].extraField, 'whole-owner-save-state');
  assert.ok(candidate.replacements[0].before.includes(state), 'input recipes are unchanged');
});

test('lazy initializers and arbitrary filtered callbacks remain host-owned bytes', () => {
  const source = fixture('() => createInitialModels(props)', 'models.filter((entry) => { /* retained callback */ return entry.enabled; }).filter(Boolean)');
  const { revision } = roundtrip(source);
  assert.ok(revision.latest.includes('() => createInitialModels(props)'));
  assert.ok(revision.latest.includes('models.filter((entry) => { /* retained callback */ return entry.enabled; }).filter(Boolean)'));
});

test('unchanged baseline source retains identical replacement text and full roundtrip', () => {
  const { adapted } = roundtrip(original);
  assert.deepEqual(adapted[0].replacements, candidate.replacements);
});

test('partly inserted hook groups cannot yield a syntactically applicable duplicate layer', () => {
  const source = fixture().replace('const [busy, setBusy]', 'const [multiKey, setMultiKey] = (0, react.useState)(false);\n\t\t\tconst [busy, setBusy]');
  const adapted = settingsRecipes(source, [candidate]);
  const revision = structuralRevision(source, adapted);
  // The native planner syntax-checks every structural result before any write.
  // Do not reject older, complete hook groups merely for lacking today's hooks.
  if (revision) assert.throws(() => parse(revision.latest, { ecmaVersion: 'latest', sourceType: 'module' }), SyntaxError);
});

test('hook selection uses the owning function, excluding strings and nested hook declarations', () => {
  const source = 'const decoy = ' + JSON.stringify(state) + ';\n' + fixture().replace('return createOnce;', 'function unrelated() { const [models, setModels] = (0, react.useState)([]); }\n\t\t\treturn createOnce;');
  const adapted = settingsRecipes(source, [initial]);
  assert.ok(adapted[0].replacements[0].before.includes('(0, react.useState)([{ id: "" }]);'));
  const changed = transformFragments(source, adapted[0]);
  assert.ok(changed.includes('const decoy = ' + JSON.stringify(state)));
  assert.ok(changed.includes('function unrelated() { ' + state));
  assert.equal(transformFragments(changed, adapted[0], true), source);
});

test('multiple matching function scopes are rejected without a port-specific allowlist', () => {
  const source = 'function first() {\n' + fixture() + '}\nfunction second() {\n' + fixture('initialModels()') + '}\n';
  assert.throws(() => settingsRecipes(source, [candidate]), /^Error: Settings hook scope is ambiguous$/);
});

test('other targets and absent native model hooks do not gain an invented adaptation', () => {
  const unrelated = [{ ...candidate, target: 'node_modules/other/lib/client.js' }];
  assert.equal(settingsRecipes(fixture(), unrelated), unrelated);
  const source = fixture().replace('const [models, setModels]', 'const [rows, setRows]');
  const values = [candidate];
  assert.equal(settingsRecipes(source, values), values);
});

test('supplied real settings programs apply, recognize and reverse without copying them into the repository', t => {
  const root = process.env.SETTINGS_RECIPES_DSH_ROOT;
  if (!root) return t.skip('Set SETTINGS_RECIPES_DSH_ROOT to a read-only real host fixture');
  const source = fs.readFileSync(path.join(root, shipped.target), 'utf8');
  const candidates = [shipped, ...(shipped.variants ?? []).map(variant => ({ ...shipped, ...variant, current: variant.current === true }))];
  const adapted = settingsRecipes(source, candidates);
  const revision = structuralRevision(source, adapted);
  assert.ok(revision);
  assert.equal(revision.original, source);
  const fresh = settingsRecipes(revision.latest, candidates);
  const checked = structuralRevision(revision.latest, fresh);
  assert.equal(checked?.state, 'patched');
  assert.equal(checked?.latest, revision.latest);
  assert.equal(checked?.original, source);
});
