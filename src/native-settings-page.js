// Strict display-only editor gate. The tolerant picker projection is not a save validator.
export function validateNativeEditorMetadata(value, directoryGroups) {
  const plain = item => item !== null && typeof item === 'object' &&
    (Object.getPrototypeOf(item) === Object.prototype || Object.getPrototypeOf(item) === null);
  const reject = message => { throw new Error(message); };
  const fields = (item, allowed) => {
    if (!plain(item) || Object.keys(item).some(key => !allowed.includes(key))) reject('仅允许分组名称、条目名称及原生供应商 ID；不能保存密钥或供应商配置。');
  };
  const safe = (id, provider = false) => typeof id === 'string' &&
    (provider ? /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/ : /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/).test(id) &&
    !['__proto__', 'prototype', 'constructor'].includes(id);
  const name = item => {
    if (Object.hasOwn(item, 'name') && (typeof item.name !== 'string' || !item.name.trim() || item.name.length > 120)) reject('显示名称必须是 1–120 字符的非空文本。');
  };
  fields(value, ['groups']);
  if (!Object.hasOwn(value, 'groups') || !plain(value.groups)) reject('必须包含 groups 对象。');
  if (!Array.isArray(directoryGroups)) reject('请先加载原生供应商目录。');
  const counts = new Map();
  for (const group of directoryGroups) counts.set(group.id, (counts.get(group.id) ?? 0) + 1);
  const claimed = new Set();
  for (const [groupId, group] of Object.entries(value.groups)) {
    if (!safe(groupId)) reject('不安全的分组 ID。');
    fields(group, ['name', 'entries']); name(group);
    if (!Object.hasOwn(group, 'entries') || !plain(group.entries)) reject('分组必须包含 entries 对象。');
    for (const [entryId, entry] of Object.entries(group.entries)) {
      if (!safe(entryId)) reject('不安全的条目 ID。');
      fields(entry, ['name', 'provider']); name(entry);
      if (!safe(entry.provider, true)) reject('不安全的原生供应商 ID。');
      if (claimed.has(entry.provider)) reject('同一原生供应商不能被重复关联。');
      if (counts.get(entry.provider) !== 1) reject('只能关联当前目录中唯一存在的原生供应商。');
      claimed.add(entry.provider);
    }
  }
  return value;
}

export async function saveNativeMetadata(form, text, revision, directoryGroups) {
  const value = validateNativeEditorMetadata(JSON.parse(text), directoryGroups);
  const snapshot = form?.getSnapshot();
  if (snapshot?.status !== 'ready' || !snapshot.writable || revision === undefined || snapshot.revision !== revision) {
    throw new Error('配置已变化或不可写；请重新载入后再保存。');
  }
  const accepted = await form.mutate([{ op: 'set', path: ['groups'], value: value.groups }], revision);
  if (!accepted) throw new Error('保存未获确认（可能有版本冲突）；请重新载入。');
  return true;
}

export function NativeModelGroupsSettingsPage({ metadataForm, loadNativeCatalog }) {
  const h = react.createElement;
  const snapshot = react.useSyncExternalStore(
    listener => metadataForm?.subscribe(listener) ?? (() => {}),
    () => metadataForm?.getSnapshot() ?? EMPTY_NATIVE_FORM,
    () => EMPTY_NATIVE_FORM,
  );
  const [draft, setDraft] = react.useState('');
  const [revision, setRevision] = react.useState(undefined);
  const [dirty, setDirty] = react.useState(false);
  const [catalog, setCatalog] = react.useState(null);
  const [busy, setBusy] = react.useState(false);
  const [message, setMessage] = react.useState('');
  const editorId = react.useId();
  const [newGroupName, setNewGroupName] = react.useState('');
  const nextId = react.useRef(0);
  const generatedId = prefix => {
    let id;
    do { id = `${prefix}-${editorId.replace(/[^A-Za-z0-9_-]/g, '')}-${++nextId.current}`; }
    while (draft.includes(JSON.stringify(id)));
    return id;
  };
  let editableGroups = null;
  try { editableGroups = validateNativeEditorMetadata(JSON.parse(draft), catalog).groups; } catch { /* Advanced editor remains available for invalid metadata. */ }
  const updateGroups = callback => {
    const value = JSON.parse(draft);
    callback(value.groups);
    setDraft(JSON.stringify(value, null, 2)); setDirty(true); setMessage('');
  };
  const claimedProviders = new Set(Object.values(editableGroups ?? {}).flatMap(group => Object.values(group?.entries ?? {}).map(entry => entry.provider)));
  react.useEffect(() => {
    let active = true;
    Promise.resolve().then(() => loadNativeCatalog()).then(response => {
      if (!response.ok || !Array.isArray(response.value?.groups)) throw new Error('catalog unavailable');
      if (active) setCatalog(response.value.groups);
    }).catch(() => { if (active) setMessage('原生目录不可用；暂不能保存关联。'); });
    return () => { active = false; };
  }, [loadNativeCatalog]);
  react.useEffect(() => {
    if (snapshot.status === 'ready' && !dirty) {
      setDraft(JSON.stringify(snapshot.value ?? EMPTY_NATIVE_METADATA, null, 2));
      setRevision(snapshot.revision);
    }
  }, [snapshot, dirty]);
  const reload = () => {
    if (snapshot.status !== 'ready') return;
    setDraft(JSON.stringify(snapshot.value ?? EMPTY_NATIVE_METADATA, null, 2));
    setRevision(snapshot.revision); setDirty(false); setMessage('');
  };
  const save = async () => {
    if (busy) return;
    setBusy(true); setMessage('');
    try {
      await saveNativeMetadata(metadataForm, draft, revision, catalog);
      setDirty(false); setMessage('显示元数据已保存；原生供应商和模型路由未修改。');
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  };
  return h('section', { className: 'mg-maintenance', 'aria-label': '原生模型分组设置', 'aria-busy': busy },
    h('h2', null, '模型分组 · 原生预览'),
    h('p', null, '原生分组预览：只编辑显示分组及名称，关联已有的独立原生供应商。不读取或保存密钥，不创建或修改供应商。尚不支持一页完成供应商及凭据创建，不代表最终体验已完成。'),
    h('section', { className: 'mg-maintenance-card' },
      h('h3', null, '显示元数据'),
      h('p', null, '卸载本插件后，独立原生供应商、模型与凭据仍然保留，仍可通过原生设置管理。仅分组显示依赖本插件。'),
      h('p', null, '为已有供应商添加显示分组。同一供应商仅可关联一次；移除分组或关联不会删除供应商。'),
      h('fieldset', { disabled: busy || snapshot.status !== 'ready' || !snapshot.writable || !editableGroups },
        h('legend', null, '分组与关联'),
        ...Object.entries(editableGroups ?? {}).map(([groupId, group]) => h('section', { key: groupId, className: 'mg-maintenance-card', 'aria-label': `分组 ${group.name ?? groupId}` },
          h('label', null, '分组名称', h('input', { type: 'text', maxLength: 120, value: group.name ?? groupId, onChange: event => updateGroups(groups => { groups[groupId].name = event.target.value; }) })),
          h('button', { type: 'button', onClick: () => updateGroups(groups => { delete groups[groupId]; }) }, '移除分组（保留供应商）'),
          ...Object.entries(group.entries ?? {}).map(([entryId, entry]) => h('div', { key: entryId, className: 'mg-maintenance-row' },
            h('label', null, '关联名称', h('input', { type: 'text', maxLength: 120, value: entry.name ?? entryId, onChange: event => updateGroups(groups => { groups[groupId].entries[entryId].name = event.target.value; }) })),
            h('span', null, entry.provider),
            h('button', { type: 'button', onClick: () => updateGroups(groups => { delete groups[groupId].entries[entryId]; }) }, '移除关联'))),
          h('label', null, '关联已有供应商', h('select', { value: '', disabled: !catalog, onChange: event => {
            const provider = event.target.value;
            if (!provider || claimedProviders.has(provider)) return;
            const native = catalog?.find(item => item.id === provider);
            if (!native) return;
            const entryId = generatedId('e');
            updateGroups(groups => { groups[groupId].entries[entryId] = { name: native.provider?.name ?? native.name ?? provider, provider }; });
          } }, h('option', { value: '' }, '选择已有原生供应商…'), ...(catalog ?? []).filter(item => !claimedProviders.has(item.id)).map(item => h('option', { key: item.id, value: item.id }, `${item.provider?.name ?? item.name ?? item.id} (${item.id})`)))))),
        h('label', null, '新分组名称', h('input', { type: 'text', maxLength: 120, value: newGroupName, onChange: event => setNewGroupName(event.target.value) })),
        h('button', { type: 'button', disabled: !newGroupName.trim(), onClick: () => {
          const groupId = generatedId('g');
          updateGroups(groups => { groups[groupId] = { name: newGroupName.trim(), entries: {} }; });
          setNewGroupName('');
        } }, '添加显示分组')),
      h('details', null, h('summary', null, '高级：显示元数据 JSON（开发者预览）'),
        h('label', { htmlFor: editorId }, '分组显示元数据 JSON'),
        h('textarea', { id: editorId, rows: 16, value: draft, spellCheck: false, disabled: busy || snapshot.status !== 'ready', style: { width: '100%', boxSizing: 'border-box', fontFamily: 'monospace' }, onChange: event => { setDraft(event.target.value); setDirty(true); } })), 
      h('div', { className: 'mg-maintenance-row' },
        h('button', { type: 'button', disabled: busy || snapshot.status !== 'ready', onClick: reload }, '重新载入（丢弃草稿）'),
        h('button', { type: 'button', disabled: busy || !dirty || snapshot.status !== 'ready' || !snapshot.writable || !catalog || revision === undefined || snapshot.revision !== revision, onClick: save }, '保存显示元数据')),
      snapshot.status !== 'ready' && h('p', { role: 'status' }, '显示元数据尚未就绪；模型选择仍使用原生目录。'),
      dirty && snapshot.revision !== revision && h('p', { role: 'alert' }, '元数据版本已变化；保留草稿但禁止覆盖，请重新载入。'),
      message && h('p', { role: 'status', 'aria-live': 'polite' }, message)));
}
