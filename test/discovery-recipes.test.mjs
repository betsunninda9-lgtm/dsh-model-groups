import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { discoveryRecipes } from '../scripts/discovery-recipes.mjs';
import { transformFragments, structuralRevision } from '../scripts/structural-patches.mjs';

const target = 'node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js';
const replacement = JSON.parse(fs.readFileSync(new URL('../native/pi-ai.patch.json', import.meta.url))).replacements.find(r =>
  r.before.endsWith('if (request.provider !== void 0) {') && r.after.endsWith('if (!entryProtocol && request.provider !== void 0) {'));
const recipe = { target, current: true, replacements: [replacement] };
const validation = replacement.before.slice(0, replacement.before.lastIndexOf('\n'));
function source(condition = '!endpointGiven && request.provider !== void 0') {
  return `async function discoverModels(request, storedProfile) {
  const selectedStored = request.keyEntryId === void 0 ? void 0 : storedProfile?.();
${validation}
  // The host chooses whether a catalog shortcut is applicable.
  const endpointGiven = typeof request.baseURL === "string" && request.baseURL.length > 0;
  if (${condition}) {
    const installed = catalogModels(request.provider);
    if (installed.size > 0) return 'catalog';
  }
  return 'endpoint';
}\n`;
}

test('discovery composes protocol restriction with host predicate and reverses byte-for-byte', async () => {
  const original = source();
  const recipes = discoveryRecipes(original, [recipe]);
  assert.equal(recipes[0].replacements.length, 2);
  const result = transformFragments(original, recipes[0]);
  assert.ok(result.includes('if (!entryProtocol && (!endpointGiven && request.provider !== void 0)) {'));
  assert.ok(result.includes('// The host chooses'));
  assert.equal(transformFragments(result, discoveryRecipes(result, [recipe])[0], true), original);
  assert.equal(structuralRevision(result, discoveryRecipes(result, [recipe])).latest, result);
  const fn = new Function('supportedProtocols', 'catalogModels', 'LlmError', result + '\nreturn discoverModels;')(
    () => ['openai-completions', 'anthropic-messages'], () => new Map([['model', {}]]), Error);
  assert.equal(await fn({ provider: 'catalog' }), 'catalog');
  assert.equal(await fn({ provider: 'catalog', baseURL: 'https://endpoint.invalid' }), 'endpoint');
  assert.equal(await fn({ provider: 'catalog', keyEntryId: 'selected' }, () => ({ api: 'anthropic-messages' })), 'endpoint');
  await assert.rejects(fn({ provider: 'catalog', keyEntryId: 'missing' }), /existing provider key entry/);
});

test('predicate comments, grouping and independent host restrictions survive composition', () => {
  for (const condition of [
    'request.provider !== void 0 && request.useCatalog === true',
    '(!endpointGiven) && /* retain host comment */ request.provider !== void 0',
    '!endpointGiven && (request.provider !== void 0)',
  ]) {
    const original = source(condition), candidates = discoveryRecipes(original, [recipe]);
    const output = transformFragments(original, candidates[0]);
    assert.equal(transformFragments(output, discoveryRecipes(output, [recipe])[0], true), original);
    assert.ok(output.includes(condition));
  }
});

test('ambiguous scope, native entry guard and unrelated packages retain original recipes', () => {
  const original = source();
  for (const changed of [original + original, source('!entryProtocol && !endpointGiven && request.provider !== void 0'), original.replace('catalogModels(request.provider)', 'otherCatalog(request.provider)')]) {
    assert.equal(discoveryRecipes(changed, [recipe])[0], recipe);
  }
  const other = { ...recipe, target: 'node_modules/other/lib/index.js' };
  assert.equal(discoveryRecipes(original, [other])[0], other);
});

test('partly applied composition is not repaired by adding duplicate declarations', () => {
  const original = source(), recipes = discoveryRecipes(original, [recipe]);
  const partial = transformFragments(original, { replacements: [recipes[0].replacements[0]] });
  assert.equal(structuralRevision(partial, discoveryRecipes(partial, [recipe])), undefined);
});
