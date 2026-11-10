// Injected form only. The parent owns trusted local adapters and later wiring.
// No config, credential resolution, network, or metadata writes live here.
export function NativeModelGroupCreatePage({ operations }) {
  const h = react.createElement;
  const formId = react.useId().replace(/[^A-Za-z0-9_-]/g, '');
  const sequence = react.useRef(0);
  const makeId = prefix => `${prefix}-${formId}-${++sequence.current}`;
  const [draft, setDraft] = react.useState(() => ({
    id: makeId('g'), name: '', api: 'openai-completions', baseURL: '',
    entries: [{ id: makeId('e'), name: '', apiKeyEnv: '' }],
    models: [{ key: makeId('m'), id: '', name: '', contextWindow: '128000', maxTokens: '4096', image: false }],
  }));
  const version = react.useRef(0);
  const pending = react.useRef(false);
  const accepted = react.useRef(null);
  const finished = react.useRef(false);
  const currentOperations = react.useRef(operations);
  currentOperations.current = operations;
  const [preview, setPreview] = react.useState(null);
  const [busy, setBusy] = react.useState(false);
  const [message, setMessage] = react.useState('');
  const available = typeof operations?.preview === 'function' && typeof operations?.save === 'function';
  const invalidate = () => { version.current++; accepted.current = null; setPreview(null); setMessage(''); };
  const edit = callback => {
    if (finished.current) return;
    invalidate();
    setDraft(previous => callback(previous));
  };
  const shared = (field, value) => edit(valueBefore => ({ ...valueBefore, [field]: value }));
  const updateRow = (collection, key, field, value) => edit(previous => ({ ...previous,
    [collection]: previous[collection].map(row => (row.id === key && collection === 'entries') || row.key === key ? { ...row, [field]: value } : row),
  }));
  const payload = () => {
    const label = value => !!value.trim() && value.length <= 120;
    let url;
    try { url = new URL(draft.baseURL.trim()); } catch { throw new Error('invalid'); }
    if (!label(draft.name) || !['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      !draft.entries.length || draft.entries.some(row => !label(row.name) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(row.apiKeyEnv.trim())) ||
      !draft.models.length || new Set(draft.models.map(row => row.id.trim())).size !== draft.models.length) throw new Error('invalid');
    const models = draft.models.map(row => {
      const contextWindow = Number(row.contextWindow), maxTokens = Number(row.maxTokens);
      if (!row.id.trim() || row.id.trim().startsWith('@dsh-key/') || !label(row.name) ||
        !Number.isSafeInteger(contextWindow) || contextWindow <= 0 || !Number.isSafeInteger(maxTokens) || maxTokens <= 0) throw new Error('invalid');
      return { id: row.id.trim(), name: row.name.trim(), contextWindow, maxTokens,
        input: row.image ? ['text', 'image'] : ['text'], reasoningEfforts: false };
    });
    return { id: draft.id, shared: { displayName: draft.name.trim(), api: draft.api, baseURL: draft.baseURL.trim() },
      entries: draft.entries.map(row => ({ id: row.id, name: row.name.trim(), apiKeyEnv: row.apiKeyEnv.trim(),
        models: models.map(model => ({ ...model, input: [...model.input] })) })) };
  };
  const runPreview = async () => {
    if (pending.current || finished.current || !available) return;
    invalidate();
    let group;
    try { group = payload(); } catch { setMessage('请填写分组、条目、现有凭据引用及有效的显式模型参数。'); return; }
    const generation = version.current;
    pending.current = true; setBusy(true);
    try {
      const result = await operations.preview(structuredClone(group));
      if (generation !== version.current || currentOperations.current !== operations) return;
      if (result?.status !== 'preview' || !Number.isSafeInteger(result.revision) || result.revision < 0 ||
        typeof result.fingerprint !== 'string' || !result.fingerprint) throw new Error('invalid');
      accepted.current = { group, revision: result.revision, fingerprint: result.fingerprint, operations, generation };
      setPreview({ providers: group.entries.length, models: group.entries.length * group.entries[0].models.length });
      setMessage('预览完成；尚未写入。请检查后明确确认保存。');
    } catch { if (generation === version.current) setMessage('预览失败；未确认保存，请检查输入或重新预览。'); }
    finally { pending.current = false; setBusy(false); }
  };
  const save = async () => {
    const receipt = accepted.current;
    if (pending.current || finished.current || !receipt || receipt.generation !== version.current || receipt.operations !== currentOperations.current) return;
    accepted.current = null; setPreview(null);
    pending.current = true; setBusy(true);
    try {
      const result = await operations.save(structuredClone(receipt.group), receipt.revision, receipt.fingerprint);
      if (result?.status === 'native-saved-metadata-pending' && ['saved', 'unchanged'].includes(result.nativeStatus)) {
        finished.current = true;
        setMessage('原生供应商已保存，但显示元数据未确认保存。原生路由可用；分组显示待处理。不要重复创建。');
      } else if (result?.status === 'saved' && ['saved', 'unchanged'].includes(result.nativeStatus)) {
        finished.current = true;
        setMessage('原生供应商与分组显示元数据均已确认保存。凭据引用未进行验证或创建。');
      } else if (['saved', 'unchanged'].includes(result?.status) && result.metadata?.groups) {
        finished.current = true;
        setMessage('仅原生供应商已确认保存；显示元数据尚未保存。原生路由可用，需由父级继续处理显示分组。不要重复创建。');
      } else { throw new Error('unverified'); }
    } catch { setMessage('保存未获完整确认；可能已有原生写入。请检查原生设置后重新预览，不要盲目重试。'); }
    finally { pending.current = false; setBusy(false); }
  };
  const text = (label, value, onChange, props = {}) => h('label', null, label,
    h('input', { type: 'text', value, onChange: event => onChange(event.target.value), ...props }));
  return h('section', { className: 'mg-maintenance', 'aria-label': '创建原生模型分组', 'aria-busy': busy },
    h('h2', null, '创建原生模型分组'),
    h('p', null, '前提：先在原生凭据设置中配置对应的现有凭据引用。此处 apiKeyEnv 只是引用名称，不是密钥，也不代表已完成凭据配置；本表单不读取、验证或保存实际密钥。'),
    h('p', null, '共享连接与模型参数会为每个条目创建独立原生供应商；预览不会写入，只有明确确认保存才调用父级保存操作。'),
    h('fieldset', { disabled: busy || finished.current || !available, className: 'mg-maintenance-card' },
      h('legend', null, '共享连接'),
      text('分组名称', draft.name, value => shared('name', value), { maxLength: 120 }),
      h('label', null, 'API 类型', h('select', { value: draft.api, onChange: event => shared('api', event.target.value) },
        ...['openai-completions', 'openai-responses', 'anthropic-messages'].map(api => h('option', { key: api, value: api }, api)))),
      text('Base URL', draft.baseURL, value => shared('baseURL', value), { type: 'url' }),
      h('h3', null, '条目 · 现有凭据引用'),
      ...draft.entries.map(row => h('section', { key: row.id, className: 'mg-maintenance-card' },
        text('条目名称', row.name, value => updateRow('entries', row.id, 'name', value), { maxLength: 120 }),
        text('apiKeyEnv（现有凭据引用，不是密钥）', row.apiKeyEnv, value => updateRow('entries', row.id, 'apiKeyEnv', value), { autoComplete: 'off', spellCheck: false }),
        h('button', { type: 'button', disabled: draft.entries.length <= 1, onClick: () => edit(previous => ({ ...previous, entries: previous.entries.filter(entry => entry.id !== row.id) })) }, '移除条目'))),
      h('button', { type: 'button', onClick: () => { const id = makeId('e'); edit(previous => ({ ...previous, entries: [...previous.entries, { id, name: '', apiKeyEnv: '' }] })); } }, '添加条目'),
      h('h3', null, '显式模型（所有条目共享）'),
      ...draft.models.map(row => h('section', { key: row.key, className: 'mg-maintenance-card' },
        text('模型 ID', row.id, value => updateRow('models', row.key, 'id', value), { spellCheck: false }),
        text('模型名称', row.name, value => updateRow('models', row.key, 'name', value), { maxLength: 120 }),
        text('上下文窗口', row.contextWindow, value => updateRow('models', row.key, 'contextWindow', value), { type: 'number', min: 1, step: 1 }),
        text('最大输出 tokens', row.maxTokens, value => updateRow('models', row.key, 'maxTokens', value), { type: 'number', min: 1, step: 1 }),
        h('label', null, h('input', { type: 'checkbox', checked: row.image, onChange: event => updateRow('models', row.key, 'image', event.target.checked) }), '支持图像输入（默认仅 text）'),
        h('p', null, 'reasoningEfforts: false（不声明推理档位）'),
        h('button', { type: 'button', disabled: draft.models.length <= 1, onClick: () => edit(previous => ({ ...previous, models: previous.models.filter(model => model.key !== row.key) })) }, '移除模型'))),
      h('button', { type: 'button', onClick: () => { const key = makeId('m'); edit(previous => ({ ...previous, models: [...previous.models, { key, id: '', name: '', contextWindow: '128000', maxTokens: '4096', image: false }] })); } }, '添加模型')),
    h('div', { className: 'mg-maintenance-row' },
      h('button', { type: 'button', disabled: busy || finished.current || !available, onClick: runPreview }, '预览创建'),
      h('button', { type: 'button', disabled: busy || finished.current || !preview || accepted.current?.operations !== operations, onClick: save }, '确认保存原生供应商与显示分组')),
    preview && h('p', { role: 'status' }, `预览：${preview.providers} 个原生供应商，${preview.models} 条模型路由；任意编辑都会使本预览失效。`),
    !available && h('p', { role: 'status' }, '父级尚未提供本地预览与保存操作；当前不能创建。'),
    message && h('p', { role: 'status', 'aria-live': 'polite' }, message));
}
