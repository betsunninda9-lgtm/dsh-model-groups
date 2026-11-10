import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { createReact } from './helpers/picker-harness.mjs';
import { planNativeSave } from '../src/native-save.js';

const source = readFileSync(new URL('../src/native-create-page.js', import.meta.url), 'utf8');
const copy = value => JSON.parse(JSON.stringify(value));
function mount(overrides = {}) {
  const calls = { preview: [], save: [] };
  const operations = {
    preview: async group => { calls.preview.push(copy(group)); return { status: 'preview', revision: 7, fingerprint: 'opaque-token' }; },
    save: async (...args) => { calls.save.push(copy(args)); return { status: 'saved', nativeStatus: 'saved' }; },
    ...overrides,
  };
  const hooks = createReact(() => {}), frame = { cells: [] };
  const context = vm.createContext({ react: hooks.react, URL, structuredClone });
  vm.runInContext(source.replace(/^export /gm, '') + '\nthis.Page = NativeModelGroupCreatePage;', context);
  let nodes;
  const props = { operations };
  const render = () => {
    const tree = hooks.render(frame, context.Page, props);
    nodes = [];
    const walk = node => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (node && typeof node === 'object') { nodes.push(node); walk(node.props?.children); }
    };
    walk(tree);
    return nodes;
  };
  const button = label => nodes.find(node => node.type === 'button' && node.props.children[0] === label);
  const field = (label, index = 0) => nodes.filter(node => node.type === 'label' && node.props.children[0] === label)[index]?.props.children[1];
  const change = (label, value, index = 0) => { field(label, index).props.onChange({ target: { value } }); render(); };
  const click = async label => { const node = button(label); assert.ok(node); if (!node.props.disabled) await node.props.onClick(); render(); };
  const fill = () => {
    change('分组名称', 'Team'); change('Base URL', 'https://example.invalid/v1');
    change('条目名称', 'First'); change('apiKeyEnv（现有凭据引用，不是密钥）', 'FIRST_KEY');
    change('模型 ID', 'chat/model'); change('模型名称', 'Chat');
  };
  render();
  return { calls, operations, props, render, button, field, change, click, fill,
    text: () => nodes.filter(node => node.type === 'p').map(node => node.props.children.join('')).join('\n'),
    nodes: () => nodes };
}
const previewLabel = '预览创建';
const saveLabel = '确认保存原生供应商与显示分组';

test('form is injected only, defaults explicit, preview read-only and exact confirmed payload supports multiple entries/models', async () => {
  const app = mount(); app.fill();
  assert.equal(app.button(saveLabel).props.disabled, true);
  await app.click(saveLabel); assert.equal(app.calls.save.length, 0);
  await app.click('添加条目');
  app.change('条目名称', 'Second', 1); app.change('apiKeyEnv（现有凭据引用，不是密钥）', 'SECOND_KEY', 1);
  await app.click('添加模型'); app.change('模型 ID', 'vision', 1); app.change('模型名称', 'Vision', 1);
  app.change('上下文窗口', '64000', 1); app.change('最大输出 tokens', '8192', 1);
  const checks = app.nodes().filter(node => node.type === 'input' && node.props.type === 'checkbox');
  checks[1].props.onChange({ target: { checked: true } }); app.render();
  assert.equal(app.calls.preview.length, 0); assert.equal(app.calls.save.length, 0);
  await app.click(previewLabel);
  const group = app.calls.preview[0];
  assert.match(group.id, /^g-[A-Za-z0-9_-]+$/);
  const ids = group.entries.map(entry => entry.id); assert.equal(new Set(ids).size, 2);
  assert.deepEqual(group, { id: group.id,
    shared: { displayName: 'Team', api: 'openai-completions', baseURL: 'https://example.invalid/v1' },
    entries: ids.map((id, i) => ({ id, name: i ? 'Second' : 'First', apiKeyEnv: i ? 'SECOND_KEY' : 'FIRST_KEY', models: [
      { id: 'chat/model', name: 'Chat', contextWindow: 128000, maxTokens: 4096, input: ['text'], reasoningEfforts: false },
      { id: 'vision', name: 'Vision', contextWindow: 64000, maxTokens: 8192, input: ['text', 'image'], reasoningEfforts: false },
    ] })) });
  assert.equal(planNativeSave(group).routes.length, 2, 'payload accepted by the real pure native contract');
  assert.equal(app.calls.save.length, 0); assert.match(app.text(), /尚未写入/);
  await app.click(saveLabel);
  assert.deepEqual(app.calls.save, [[group, 7, 'opaque-token']]);
  assert.match(app.text(), /元数据均已确认保存/);
  await app.click(saveLabel); await app.click(previewLabel);
  assert.equal(app.calls.save.length, 1, 'confirmed form cannot accidentally recreate');
  assert.match(app.text(), /不是密钥/);
  assert.doesNotMatch(source, /fetch\(|XMLHttpRequest|localStorage|process\.env|\/api\//);
});

test('every editable field invalidates preview and identities survive labels and repeated previews', async () => {
  const app = mount(); app.fill(); await app.click(previewLabel);
  const original = app.calls.preview[0];
  for (const [label, value] of [
    ['分组名称', 'Renamed'], ['Base URL', 'https://other.invalid'], ['条目名称', 'Renamed entry'],
    ['apiKeyEnv（现有凭据引用，不是密钥）', 'OTHER_KEY'], ['模型 ID', 'other-model'],
    ['模型名称', 'Other'], ['上下文窗口', '32000'], ['最大输出 tokens', '2048'],
  ]) {
    const staleSave = app.button(saveLabel).props.onClick;
    app.change(label, value); assert.equal(app.button(saveLabel).props.disabled, true);
    await staleSave(); assert.equal(app.calls.save.length, 0, 'stale handler cannot save');
    await app.click(previewLabel);
    assert.equal(app.calls.preview.at(-1).id, original.id);
    assert.equal(app.calls.preview.at(-1).entries[0].id, original.entries[0].id);
  }
  const select = app.nodes().find(node => node.type === 'select');
  select.props.onChange({ target: { value: 'anthropic-messages' } }); app.render();
  assert.equal(app.button(saveLabel).props.disabled, true); await app.click(previewLabel);
  app.nodes().find(node => node.type === 'input' && node.props.type === 'checkbox').props.onChange({ target: { checked: true } }); app.render();
  assert.equal(app.button(saveLabel).props.disabled, true); await app.click(previewLabel);
  await app.click('添加条目'); assert.equal(app.button(saveLabel).props.disabled, true);
  await app.click('移除条目'); await app.click(previewLabel);
  await app.click('添加模型'); assert.equal(app.button(saveLabel).props.disabled, true);
});

test('invalid data never reaches injected operations and raw errors cannot be displayed', async () => {
  const app = mount(); await app.click(previewLabel); assert.equal(app.calls.preview.length, 0);
  app.fill();
  for (const [label, bad, good] of [
    ['Base URL', 'https://user:secret@example.invalid', 'https://example.invalid'],
    ['apiKeyEnv（现有凭据引用，不是密钥）', 'sk-not-a-reference!', 'GOOD_KEY'],
    ['上下文窗口', '-1', '128000'], ['最大输出 tokens', '1.5', '4096'],
    ['模型 ID', '@dsh-key/alias/model', 'model'],
  ]) {
    app.change(label, bad); await app.click(previewLabel); assert.equal(app.calls.preview.length, 0);
    app.change(label, good);
  }
  app.operations.preview = async () => { throw new Error('secret /private/config'); };
  await app.click(previewLabel);
  assert.match(app.text(), /预览失败/); assert.doesNotMatch(app.text(), /secret|private/);
  assert.equal(app.button(saveLabel).props.disabled, true);
});

test('pending preview edited programmatically cannot authorize stale save; duplicate clicks are guarded', async () => {
  let resolve;
  const app = mount({ preview: () => new Promise(done => { resolve = done; }) }); app.fill();
  const handler = app.button(previewLabel).props.onClick;
  const pending = handler(); app.render();
  assert.equal(app.button(saveLabel).props.disabled, true);
  await handler();
  app.change('分组名称', 'Edited while pending');
  resolve({ status: 'preview', revision: 1, fingerprint: 'token' }); await pending; app.render();
  assert.equal(app.button(saveLabel).props.disabled, true); assert.equal(app.calls.save.length, 0);
});

test('native-only, partial metadata, verified group success, unknown status and save errors stay distinct and safe', async () => {
  for (const [result, pattern] of [
    [{ status: 'native-saved-metadata-pending', nativeStatus: 'saved' }, /原生供应商已保存，但显示元数据未确认/],
    [{ status: 'saved', metadata: { groups: {} } }, /仅原生供应商已确认保存/],
    [{ status: 'saved', nativeStatus: 'unchanged' }, /元数据均已确认保存/],
    [{ status: 'unverified', message: 'secret' }, /保存未获完整确认/],
  ]) {
    const app = mount({ save: async () => result }); app.fill(); await app.click(previewLabel); await app.click(saveLabel);
    assert.match(app.text(), pattern); assert.doesNotMatch(app.text(), /secret/);
    assert.equal(app.button(saveLabel).props.disabled, true);
  }
  const app = mount({ save: async () => { throw new Error('secret /private/path'); } });
  app.fill(); await app.click(previewLabel); await app.click(saveLabel);
  assert.match(app.text(), /可能已有原生写入/); assert.doesNotMatch(app.text(), /secret|private/);
});

test('changed or absent adapters cannot reuse a prior confirmation', async () => {
  const app = mount(); app.fill(); await app.click(previewLabel);
  const oldSave = app.button(saveLabel).props.onClick;
  app.props.operations = {}; app.render();
  assert.equal(app.button(saveLabel).props.disabled, true);
  await app.button(saveLabel).props.onClick(); assert.equal(app.calls.save.length, 0);
  await oldSave(); assert.equal(app.calls.save.length, 0, 'old adapter closure is rejected too');
  app.change('分组名称', 'Invalidate'); await oldSave(); assert.equal(app.calls.save.length, 0);
  assert.match(app.text(), /父级尚未提供/);
});
