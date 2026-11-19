import test from 'node:test';
import assert from 'node:assert/strict';
import { registerBridgeProviderCard } from '../src/bridge/provider-card.js';
import { mountLegacyCard as mount, cardSnapshot as initial } from './helpers/bridge-card-harness.mjs';

// Render the complete original component tree, including its own hook frames,
// instead of testing a flattened lookalike. Browser geometry is checked separately.
test('shared connection defaults stay in the original card and save with the key groups', async () => {
  const snapshot = initial(); snapshot.providers.sample.shared = { api: 'openai-completions', baseURL: 'https://old.invalid/v1', headers: { 'X-Owner': 'old' } };
  const app = mount({ snapshot });
  assert.match(app.text(), /公共设置/); assert.equal(app.input('共用 API 地址').props.value, 'https://old.invalid/v1');
  app.change('共用 API 地址', 'https://new.invalid/v1'); app.change('共用 API 协议', 'openai-responses');
  app.change('共用请求头 JSON', '{"X-Owner":"new"}'); app.click('保存'); await app.settle();
  assert.deepEqual(app.calls.save[0].draft.shared, { api: 'openai-responses', baseURL: 'https://new.invalid/v1', headers: { 'X-Owner': 'new' } });
  assert.equal(app.calls.save[0].draft.keyEntries.work.apiKeyEnv, 'SAMPLE_MULTKEY_WORK_API_KEY'); app.dispose();
});

test('only the original provider-card slot is registered with the explicit store', () => {
  const registrations = [], store = {}, Component = () => null;
  registerBridgeProviderCard({ slots: { inject(name, callback) { assert.equal(name, 'settings.models.provider-card'); return callback(); }, register(options, component) { registrations.push({ options, component }); } } }, Component, store);
  assert.equal(registrations[0].component, Component);
  assert.equal(registrations[0].options.key, 'llm-pi-ai');
  assert.deepEqual(registrations[0].options.inject(), { bridgeStore: store });
});

test('original saved cards, password status, details, switches and model rows are restored', () => {
  const app = mount();
  assert.deepEqual(app.nodes().filter(node => node.props?.['data-key-entry-id']).map(node => node.props['data-key-entry-expanded']), [false, false]);
  assert.equal(app.input('API 密钥 1').props.type, 'password');
  assert.equal(app.input('API 密钥 1').props.autoComplete, 'new-password');
  assert.match(app.text(), /引用已保存，尚未检查密钥状态；输入留空可保留原密钥/);
  assert.equal(app.button('保存密钥'), undefined);
  app.click('展开详情');
  assert.equal(app.input('配置名称 1').props.value, '工作');
  assert.equal(app.input('分组 API 协议 工作').props.value, 'openai-completions');
  assert.equal(app.input('识图').props.role, 'switch');
  assert.match(app.text(), /仅影响此密钥分组/);
  assert.ok(app.button('调整密钥分组顺序 工作').props.onPointerDown);
  assert.equal(app.button('调整密钥分组顺序 工作').props.style.minHeight, 44);
  assert.ok(app.button('模型选项 1'));
  assert.equal(app.calls.save.length, 0); app.dispose();
});

test('editing, protocol inheritance, capabilities and keyboard order save once with the original CAS revision', async () => {
  const app = mount(); app.click('展开详情');
  app.change('配置名称 1', '工作账户');
  app.change('分组 API 协议 工作账户', '');
  app.change('识图', true);
  app.key('调整密钥分组顺序 工作账户', 'ArrowDown');
  app.click('保存'); await app.settle();
  assert.equal(app.calls.save.length, 1);
  const saved = app.calls.save[0];
  assert.equal(saved.route, 'sample'); assert.equal(saved.revision, 7);
  assert.equal(saved.draft.keyEntries.work.name, '工作账户');
  assert.equal(Object.hasOwn(saved.draft.keyEntries.work, 'api'), false);
  assert.deepEqual(saved.draft.keyEntries.work.headers, { 'X-Tenant': 'retained' });
  assert.equal(saved.draft.keyEntries.home.sortOrder, 0);
  assert.deepEqual(saved.draft.keyEntries.work.models[0].input, ['text', 'image']);
  assert.equal(app.button('保存').props.disabled, true);
  app.dispose(); assert.equal(app.store.subscriberCount, 0);
});

test('key drafts stay masked and one Save writes credentials first, then secret-free config', async () => {
  const app = mount(); app.change('API 密钥 1', 'synthetic-fixture-key');
  const dom = app.inputNode('API 密钥 1');
  assert.equal(app.calls.credentials.length, 0);
  app.click('显示密钥'); assert.equal(app.input('API 密钥 1').props.type, 'text');
  app.change('API 密钥 1', 'synthetic-replaced-key');
  assert.equal(app.input('API 密钥 1').props.type, 'password');
  app.click('保存'); await app.settle();
  assert.deepEqual(app.calls.credentials, [{ reference: 'SAMPLE_MULTKEY_WORK_API_KEY', value: 'synthetic-replaced-key' }]);
  assert.equal(app.calls.save.length, 1);
  assert.doesNotMatch(JSON.stringify(app.calls.save), /synthetic-/);
  assert.equal(dom.value, ''); assert.equal(app.input('API 密钥 1').props.value, '');
  app.dispose();
});

test('expanded model options restore individual reasoning-level rows and save their wire values', async () => {
  const app = mount(); app.click('展开详情'); app.click('模型选项 1');
  app.change('推理等级 1', true);
  assert.ok(app.input('推理等级 1'));
  app.click('保存'); await app.settle();
  const effort = app.calls.save[0].draft.keyEntries.work.models[0].reasoningEfforts;
  assert.equal(effort.off, null); assert.equal(effort.low, 'low'); assert.equal(effort.high, 'high');
  app.dispose();
});

test('discovery uses the selected draft key transiently and opens the original selection dialog before adopting', async () => {
  const app = mount(); app.click('展开详情');
  app.change('API 密钥 1', 'synthetic-discovery-key');
  app.click('获取可用模型'); await app.settle();
  assert.equal(app.calls.discover[0].id, 'work');
  assert.deepEqual(app.calls.discover[0].options, { apiKey: 'synthetic-discovery-key' });
  assert.equal(app.calls.credentials.length, 0); assert.equal(app.calls.save.length, 0);
  assert.equal(app.nodes().filter(node => node.props?.['data-row-key'] !== undefined).length, 2, 'fetch alone must not merge models');
  assert.ok(app.input('搜索模型'));
  app.change('gamma', true);
  app.click('更新列表');
  assert.equal(app.nodes().filter(node => node.props?.['data-row-key'] !== undefined).length, 3);
  app.click('保存'); await app.settle();
  assert.deepEqual(app.calls.save[0].draft.keyEntries.work.models.map(model => model.id), ['alpha', 'gamma']);
  assert.equal(app.calls.save[0].draft.keyEntries.work.models[0].name, 'Alpha');
  app.dispose();
});

test('original removal and disable confirmation keep changes local until Save', async () => {
  const app = mount(); app.click('展开详情'); app.click('移除此密钥分组');
  assert.equal(app.nodes().filter(node => node.props?.['data-key-entry-id']).length, 2);
  app.click('移除此密钥分组', -1);
  assert.equal(app.nodes().filter(node => node.props?.['data-key-entry-id']).length, 1);
  assert.equal(app.calls.save.length, 0);
  app.change('多密钥配置', false); app.click('确认关闭');
  assert.equal(app.calls.save.length, 0);
  app.click('保存'); await app.settle();
  assert.equal(app.calls.save[0].draft.enabled, false);
  assert.deepEqual(Object.keys(app.calls.save[0].draft.keyEntries), ['home']); app.dispose();
});

test('disable with an unsaved raw key returns to editing without dropping the input', () => {
  const app = mount(); app.change('API 密钥 1', 'synthetic-unsaved');
  app.change('多密钥配置', false);
  assert.match(app.text(), /请先保存新输入的密钥/);
  assert.equal(app.button('确认关闭'), undefined);
  app.click('返回密钥配置');
  assert.equal(app.input('多密钥配置').props.checked, true);
  assert.equal(app.input('API 密钥 1').props.value, 'synthetic-unsaved');
  assert.equal(app.calls.credentials.length, 0); app.dispose();
});

test('background revisions preserve dirty state, reject stale CAS, and Cancel loads the current data', async () => {
  const app = mount(); app.click('展开详情'); app.change('配置名称 1', '本地草稿');
  const other = initial(); other.revision++; other.providers.sample.keyEntries.work.name = '远端修改';
  app.update(other); assert.equal(app.input('配置名称 1').props.value, '本地草稿');
  app.click('保存'); await app.settle();
  assert.equal(app.calls.save[0].revision, 7); assert.match(app.text(), /草稿已保留/);
  app.click('取消'); assert.equal(app.input('配置名称 1').props.value, '远端修改'); app.dispose();
});

test('failures preserve retry input, redact backend details, and serialize the Save operation', async () => {
  let finish;
  const app = mount({ setCredential: () => new Promise(resolve => { finish = resolve; }) });
  app.change('API 密钥 1', 'synthetic-private');
  const submit = app.button('保存').props.onClick; submit(); submit(); app.flush();
  assert.equal(app.calls.credentials.length, 1);
  assert.equal(app.input('API 密钥 1').props.disabled, true);
  finish({ ok: false, error: '/private/path synthetic-private' }); await app.settle();
  assert.equal(app.input('API 密钥 1').props.value, 'synthetic-private');
  assert.match(app.text(), /密钥保存失败/); assert.doesNotMatch(app.text(), /private\/path|synthetic-private/);
  assert.equal(app.calls.save.length, 0); app.dispose();
});

test('unmount clears actual input nodes and ignores a late credential completion', async () => {
  let finish; const app = mount({ setCredential: () => new Promise(resolve => { finish = resolve; }) });
  app.change('API 密钥 1', 'synthetic-late'); const dom = app.inputNode('API 密钥 1');
  app.click('保存'); app.dispose(); assert.equal(dom.value, '');
  finish({ ok: true }); await app.settle(); assert.equal(app.calls.save.length, 0);
});

test('new entries expand with original controls and invalid models never write credentials or config', async () => {
  const app = mount(); app.click('添加密钥配置');
  const entries = app.nodes().filter(node => node.props?.['data-key-entry-id']);
  assert.deepEqual(entries.map(node => node.props['data-key-entry-expanded']), [false, false, true]);
  assert.match(entries[2].props['data-key-entry-id'], /^k/);
  app.click('保存'); await app.settle();
  assert.equal(app.calls.save.length, 0); assert.equal(app.calls.credentials.length, 0);
  assert.match(app.text(), /模型/); app.dispose();
});

for (const status of ['loading', 'forbidden', 'error', 'unavailable']) test(`${status} renders an explicit state without writable controls`, () => {
  const snapshot = initial(); snapshot.status = status;
  const app = mount({ snapshot });
  assert.equal(app.button('保存'), undefined); assert.equal(app.input('多密钥配置'), undefined);
  assert.equal(app.calls.save.length, 0); assert.match(app.text(), status === 'loading' ? /正在读取/ : status === 'forbidden' ? /无权/ : /暂不可用/); app.dispose();
});
