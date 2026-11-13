import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sha256, transformSource } from './native-patches.mjs';
import { addSettingsReorder } from './settings-reorder-patch.mjs';
import { addSettingsCapabilities } from './settings-capabilities.mjs';

const root = new URL('../', import.meta.url);
const readArtifact = file => JSON.parse(fs.readFileSync(new URL(file, root), 'utf8'));
const legacy = readArtifact('test/fixtures/settings-models/beta5.json');
const stable = readArtifact('test/fixtures/settings-models/v0.3.5.json');
const sourceArg = process.argv.indexOf('--source');
const sourcePath = sourceArg >= 0 ? process.argv[sourceArg + 1] : undefined;
const fullSource = sourcePath !== undefined;
if (sourceArg >= 0 && !sourcePath) throw new Error('--source requires a pristine host file path');
// This generates the HOST settings bundle patch, NOT the plugin's lib/client.js.
// No implicit installed-host access or mutation. Without --source, tests evaluate
// a focused legacy fixture; generation/check requires a read-only pristine input.
const base = fullSource ? fs.readFileSync(sourcePath, 'utf8') : undefined;
if (fullSource && sha256(base) !== legacy.baseSha256) throw new Error('Pristine settings host hash mismatch');
const previous = fullSource ? transformSource(base, legacy) : fs.readFileSync(new URL('test/fixtures/settings-models/model-rows.js.txt', root), 'utf8') + fs.readFileSync(new URL('test/fixtures/settings-models/editor-beta5.js.txt', root), 'utf8');
const delta = [];
let current = previous;
function replace(before, after) {
  if (current.split(before).length !== 2) throw new Error(`Expected unique settings anchor: ${before.slice(0, 100)}`);
  delta.push({ before, after }); current = current.replace(before, after);
}
// Omit an override to inherit the provider's protocol; never force Claude to
// Messages (many relays only support Chat Completions for their Claude models).
replace('const MULTI_KEY_ENTRY_ID =', 'const MULTI_KEY_PROTOCOLS = new Set(["openai-completions", "openai-responses", "anthropic-messages"]);\n\t\tconst MULTI_KEY_ENTRY_ID =');
replace('name: source.name ?? "",', 'name: source.name ?? "",\n\t\t\t\t...(source.api === void 0 ? {} : { api: source.api }),');
replace(`return Object.fromEntries(Object.entries(entries).map(([id, entry]) => [id, {
\t\t\t\t...entry,
\t\t\t\tname: typeof entry?.name === "string" ? entry.name.trim() : "",
\t\t\t\tapiKeyEnv: typeof entry?.apiKeyEnv === "string" && entry.apiKeyEnv.length > 0 ? entry.apiKeyEnv : multiKeyRef(route, id),
\t\t\t\tmodels: modelDrafts(entry?.models).map((model) => structuredClone(model))
\t\t\t}]));`, `return Object.fromEntries(Object.entries(entries).map(([id, entry]) => {
\t\t\t\tconst { api, ...rest } = entry;
\t\t\t\treturn [id, {
\t\t\t\t\t...rest,
\t\t\t\t\t...(api === void 0 || api === "" ? {} : { api }),
\t\t\t\t\tname: typeof entry?.name === "string" ? entry.name.trim() : "",
\t\t\t\t\tapiKeyEnv: typeof entry?.apiKeyEnv === "string" && entry.apiKeyEnv.length > 0 ? entry.apiKeyEnv : multiKeyRef(route, id),
\t\t\t\t\tmodels: modelDrafts(entry?.models).map((model) => structuredClone(model))
\t\t\t\t}];
\t\t\t}));`);
replace('return t("multiKeyInvalidName");\n\t\t\t\tconst ref = entry.apiKeyEnv ?? multiKeyRef(route, id);', 'return t("multiKeyInvalidName");\n\t\t\t\tif (entry.api !== void 0 && !MULTI_KEY_PROTOCOLS.has(entry.api)) return t("multiKeyInvalidProtocol");\n\t\t\t\tconst ref = entry.apiKeyEnv ?? multiKeyRef(route, id);');
replace('...(canUseStored ? { keyEntryId: id } : {}),', '...(canUseStored ? { keyEntryId: id } : {}),\n\t\t\t\t\t\t...(entry.api === void 0 ? {} : { api: entry.api }),');
// Acknowledged profile snapshots are independent of credential-write success. A
// partially failed save must not mark the whole card saved or collapse its rows.
replace('\t\tfunction MultiKeyEntriesEditor(props) {', `\t\tfunction multiKeyEntryDirty(entry, saved, draft) {
\t\t\treturn saved === void 0 || JSON.stringify(entry) !== JSON.stringify(saved) || (draft ?? "").length > 0;
\t\t}
\t\tfunction MultiKeyEntriesEditor(props) {`);
replace('const [busyEntries, setBusyEntries] = (0, react.useState)({});', `const [busyEntries, setBusyEntries] = (0, react.useState)({});
\t\t\tconst [expandedEntries, setExpandedEntries] = (0, react.useState)({});
\t\t\tconst [removeTarget, setRemoveTarget] = (0, react.useState)(void 0);
\t\t\tconst detailsPrefix = (0, react.useId)();
\t\t\tconst previousSave = (0, react.useRef)(props.saveState);
\t\t\t(0, react.useEffect)(() => {
\t\t\t\tconst save = props.saveState;
\t\t\t\tif (save === previousSave.current) return;
\t\t\t\tpreviousSave.current = save;
\t\t\t\tif (!save) return;
\t\t\t\tsetExpandedEntries((current) => {
\t\t\t\t\tconst next = { ...current };
\t\t\t\t\tfor (const id of Object.keys(save.entries)) {
\t\t\t\t\t\t// Only collapse the exact snapshot acknowledged by this save.
\t\t\t\t\t\tif (!save.ok || !multiKeyEntryDirty(entries[id], save.entries[id], keyDrafts[id])) next[id] = !save.ok;
\t\t\t\t\t}
\t\t\t\t\treturn next;
\t\t\t\t});
\t\t\t}, [props.saveState, entries, keyDrafts]);
\t\t\tconst invalidRows = Object.keys(entries).filter((id) => multiKeyFailure(route, { [id]: entries[id] }, keyDrafts, confirmations, t) !== void 0);
\t\t\tconst invalidEntries = invalidRows.length > 0 ? invalidRows : multiKeyFailure(route, entries, keyDrafts, confirmations, t) !== void 0 ? Object.keys(entries) : [];
\t\t\tconst invalidSignature = JSON.stringify(invalidEntries);
\t\t\t(0, react.useEffect)(() => {
\t\t\t\tif (invalidEntries.length > 0) setExpandedEntries((current) => ({ ...current, ...Object.fromEntries(invalidEntries.map((id) => [id, true])) }));
\t\t\t}, [invalidSignature]);`);
replace('const anyBusy = Object.values(busyEntries).some(Boolean);', `const anyBusy = Object.values(busyEntries).some(Boolean);
\t\t\t(0, react.useEffect)(() => {
\t\t\t\tif (disabled || anyBusy || removeTarget !== void 0 && !Object.hasOwn(entries, removeTarget)) setRemoveTarget(void 0);
\t\t\t}, [disabled, anyBusy, removeTarget, entries]);
\t\t\tconst removeName = typeof entries[removeTarget]?.name === "string" && entries[removeTarget].name.trim() ? entries[removeTarget].name.trim() : t("multiKeyDefaultName");`);
replace('const remove = (id) => {', 'const remove = (id) => {\n\t\t\t\tif (disabled || anyBusy || !Object.hasOwn(entries, id)) return;');
replace('const heading = typeof entry.name === "string"', `const dirty = multiKeyEntryDirty(entry, props.savedEntries?.[id] ?? props.persistedEntries?.[id], draft);
\t\t\t\t\tconst expanded = expandedEntries[id] ?? !Object.hasOwn(props.persistedEntries ?? {}, id);
\t\t\t\t\tconst detailsId = detailsPrefix + "-" + id;
\t\t\t\t\tconst heading = typeof entry.name === "string"`);
replace('"data-key-entry-id": id, role: "group", "aria-label": heading,', '"data-key-entry-id": id, "data-key-entry-expanded": expanded, "data-key-entry-dirty": dirty, role: "group", "aria-label": heading,');
const headingStart = current.indexOf('\t\t\t\t\t\tchildren: [(0, react_jsx_runtime.jsxs)("div", {\n\t\t\t\t\t\t\t"data-key-entry-heading"');
const nameStart = current.indexOf('\n\t\t\t\t\t\t\t(0, react_jsx_runtime.jsxs)("label", {', headingStart);
const keyStart = current.indexOf('\n\t\t\t\t\t\t\t(0, react_jsx_runtime.jsxs)("div", {', nameStart);
const modelStart = current.indexOf('\n\t\t\t\t\t\t\t(0, react_jsx_runtime.jsx)(ModelListEditor, {', keyStart);
const modelEnd = current.indexOf('\n\t\t\t\t\t}, id);', modelStart);
if ([headingStart, nameStart, keyStart, modelStart, modelEnd].some(i => i < 0)) throw new Error('Missing key entry layout anchor');
const oldHead = current.slice(headingStart, nameStart);
const name = current.slice(nameStart, keyStart);
const key = current.slice(keyStart, modelStart);
const model = current.slice(modelStart, modelEnd).replace(/\}\)\]$/, '})');
const head = `\t\t\t\t\t\tchildren: [(0, react_jsx_runtime.jsxs)("div", {
\t\t\t\t\t\t\t"data-key-entry-heading": true,
\t\t\t\t\t\t\tclassName: ModelsSection_module_css_default["rowHead"], style: { flexWrap: "wrap" },
\t\t\t\t\t\t\tchildren: [(0, react_jsx_runtime.jsx)("span", {
\t\t\t\t\t\t\t\tclassName: ModelsSection_module_css_default["rowName"],
\t\t\t\t\t\t\t\tstyle: { minWidth: 0, overflowWrap: "anywhere", flex: "1 1 120px" }, children: heading
\t\t\t\t\t\t\t}), (0, react_jsx_runtime.jsxs)("div", {
\t\t\t\t\t\t\t\tclassName: ModelsSection_module_css_default["rowActions"],
\t\t\t\t\t\t\t\tchildren: [dirty ? (0, react_jsx_runtime.jsx)("span", { className: ModelsSection_module_css_default["rowTag"], "data-key-entry-unsaved": true, children: t("multiKeyUnsaved") }) : null,
\t\t\t\t\t\t\t\t(0, react_jsx_runtime.jsx)("button", {
\t\t\t\t\t\t\t\t\ttype: "button", className: ModelsSection_module_css_default["secondaryButton"],
\t\t\t\t\t\t\t\t\t"aria-expanded": expanded, "aria-controls": detailsId,
\t\t\t\t\t\t\t\t\tonClick: () => setExpandedEntries((current) => ({ ...current, [id]: !expanded })),
\t\t\t\t\t\t\t\t\tchildren: t(expanded ? "multiKeyCollapse" : "multiKeyExpand")
\t\t\t\t\t\t\t\t})]
\t\t\t\t\t\t\t})]
\t\t\t\t\t\t}),`;
const protocol = `
\t\t\t\t\t\t\t(0, react_jsx_runtime.jsxs)("label", {
\t\t\t\t\t\t\t\tclassName: ModelsSection_module_css_default["field"],
\t\t\t\t\t\t\t\tchildren: [(0, react_jsx_runtime.jsx)("span", { className: ModelsSection_module_css_default["fieldLabel"], children: t("multiKeyProtocol") }),
\t\t\t\t\t\t\t\t(0, react_jsx_runtime.jsxs)("select", {
\t\t\t\t\t\t\t\t\t"data-key-entry-protocol": id, "aria-label": t("multiKeyProtocol") + " " + heading,
\t\t\t\t\t\t\t\t\tclassName: ModelsSection_module_css_default["input"] + " " + ModelsSection_module_css_default["selectInput"],
\t\t\t\t\t\t\t\t\tstyle: { maxWidth: "none" }, value: entry.api ?? "", disabled: disabled || anyBusy,
\t\t\t\t\t\t\t\t\tonChange: (event) => {
\t\t\t\t\t\t\t\t\t\tconst value = event.target.value;
\t\t\t\t\t\t\t\t\t\tif (disabled || anyBusy || value !== "" && !MULTI_KEY_PROTOCOLS.has(value)) return;
\t\t\t\t\t\t\t\t\t\tconst { api, ...inherited } = entries[id];
\t\t\t\t\t\t\t\t\t\tonChange({ ...entries, [id]: value === "" ? inherited : { ...inherited, api: value } });
\t\t\t\t\t\t\t\t\t},
\t\t\t\t\t\t\t\t\tchildren: [(0, react_jsx_runtime.jsx)("option", { value: "", children: t("multiKeyProtocolInherit").replace("{protocol}", () => props.probe.api ? protocolLabel(t, props.probe.api) : t("multiKeyProtocolDefault")) }),
\t\t\t\t\t\t\t\t\t...(props.protocols ?? [...MULTI_KEY_PROTOCOLS]).map((choice) => (0, react_jsx_runtime.jsx)("option", { value: choice, children: protocolLabel(t, choice) }, choice))]
\t\t\t\t\t\t\t\t}), (0, react_jsx_runtime.jsx)("span", { className: ModelsSection_module_css_default["advancedHint"], children: t("multiKeyProtocolHelp") })]
\t\t\t\t\t\t\t})`;
// Keep key input and model editor mounted in the same keyed card. display:none
// preserves child drafts; native fields/tokens give both themes the host styling.
replace(oldHead + name + key + current.slice(modelStart, modelEnd), head + key + `
\t\t\t\t\t\t(0, react_jsx_runtime.jsxs)("div", {
\t\t\t\t\t\t\tid: detailsId, "data-key-entry-details": true, hidden: !expanded,
\t\t\t\t\t\t\tstyle: { display: expanded ? "flex" : "none", flexDirection: "column", gap: 12, minWidth: 0, borderTop: "0.5px solid var(--dsw-alias-settings-card-stroke)", paddingTop: 12 },
\t\t\t\t\t\t\tchildren: [(0, react_jsx_runtime.jsxs)("div", {
\t\t\t\t\t\t\t\t"data-key-entry-fields": true, style: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", gap: 12, minWidth: 0 }, children: [` + name.replace(/,\s*$/, '') + ',' + protocol + `]
\t\t\t\t\t\t\t}),` + model + `,
\t\t\t\t\t\t\t(0, react_jsx_runtime.jsxs)("div", {
\t\t\t\t\t\t\t\t"data-key-entry-danger-zone": true,
\t\t\t\t\t\t\t\tstyle: { display: "flex", flexDirection: "column", gap: 6, borderTop: "0.5px solid var(--dsw-alias-settings-card-stroke)", paddingTop: 12 },
\t\t\t\t\t\t\t\tchildren: [(0, react_jsx_runtime.jsx)("p", { className: ModelsSection_module_css_default["advancedHint"], children: t("multiKeyRemoveHelp") }),
\t\t\t\t\t\t\t\t(0, react_jsx_runtime.jsx)("button", {
\t\t\t\t\t\t\t\t\ttype: "button", "data-key-entry-remove": id,
\t\t\t\t\t\t\t\t\tclassName: ModelsSection_module_css_default["dangerButton"], style: { alignSelf: "flex-start" }, disabled: disabled || anyBusy,
\t\t\t\t\t\t\t\t\tonClick: () => { if (!disabled && !anyBusy) setRemoveTarget(id); }, children: t("multiKeyRemoveGroup")
\t\t\t\t\t\t\t\t})]
\t\t\t\t\t\t\t})]
\t\t\t\t\t\t})]`);
replace('}), (0, react_jsx_runtime.jsx)("p", { className: ModelsSection_module_css_default["advancedHint"], children: t("multiKeyKeepCredentials") })]', `}), (0, react_jsx_runtime.jsx)("p", { className: ModelsSection_module_css_default["advancedHint"], children: t("multiKeyKeepCredentials") }),
\t\t\t\t(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
\t\t\t\t\topen: removeTarget !== void 0 && Object.hasOwn(entries, removeTarget) && !disabled && !anyBusy,
\t\t\t\t\t"data-key-entry-remove-dialog": true, onClose: () => setRemoveTarget(void 0),
\t\t\t\t\ttitle: t("multiKeyRemoveTitle").replace("{name}", () => removeName), closeLabel: t("close"),
\t\t\t\t\tdescription: t("multiKeyRemoveDescription"), className: ModelsSection_module_css_default["deleteDialog"],
\t\t\t\t\tfooter: (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
\t\t\t\t\t\t(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, { variant: "outline", "data-modal-autofocus": true, onClick: () => setRemoveTarget(void 0), children: t("cancel") }),
\t\t\t\t\t\t(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
\t\t\t\t\t\t\tvariant: "outline", className: ModelsSection_module_css_default["deleteConfirm"], disabled: disabled || anyBusy,
\t\t\t\t\t\t\tonClick: () => { if (removeTarget === void 0 || disabled || anyBusy) return; remove(removeTarget); setRemoveTarget(void 0); }, children: t("multiKeyRemoveGroup")
\t\t\t\t\t\t})]
\t\t\t\t\t})
\t\t\t\t})]`);
// Both owning cards supply native protocol labels and retain their existing save.
for (const owner of ['CustomProviderCard', 'ProviderEditor']) {
  const start = current.indexOf(`function ${owner}(props) {`);
  const end = current.indexOf('\n\t\t//#endregion', start);
  const old = current.slice(start, end);
  let next = old.replace('const saving = (0, react.useRef)(false);', 'const [entrySaveState, setEntrySaveState] = (0, react.useState)(void 0);\n\t\t\tconst saving = (0, react.useRef)(false);');
  next = next.replace('route: props.provider, entries: keyEntries,', 'route: props.provider, entries: keyEntries, protocols, saveState: entrySaveState, savedEntries: entrySaveState?.ok ? entrySaveState.entries : void 0,');
  next = next.replace('route, entries: keyEntries,', 'route, entries: keyEntries, protocols, saveState: entrySaveState, savedEntries: entrySaveState?.ok ? entrySaveState.entries : void 0,');
  const tryAnchor = owner === 'ProviderEditor' ? 'const failure = await applyOnce();' : 'const outcome = await createOnce();';
  const outcomeName = owner === 'ProviderEditor' ? 'failure' : 'outcome';
  const routeName = owner === 'ProviderEditor' ? 'props.provider' : 'route';
  next = next.replace(tryAnchor, tryAnchor + '\n\t\t\t\t\tif (multiKey) setEntrySaveState({ ok: ' + outcomeName + ' === void 0, entries: structuredClone(' + outcomeName + ' === void 0 ? normalizedMultiKeyEntries(' + routeName + ', keyEntries) : keyEntries) });');
  next = next.replace('} catch {\n\t\t\t\t\tsetFailure(t("multiKeySaveFailed"));', '} catch {\n\t\t\t\t\tif (multiKey) setEntrySaveState({ ok: false, entries: structuredClone(keyEntries) });\n\t\t\t\t\tsetFailure(t("multiKeySaveFailed"));');
  if (owner === 'ProviderEditor') next = next.replace('props.onClose(true);', 'if (!multiKey) props.onClose(true);');
  replace(old, next);
}
replace('className: ModelsSection_module_css_default["editorActions"],', `className: ModelsSection_module_css_default["editorActions"],
\t\t\t\t"data-model-save-actions": true,
\t\t\t\tstyle: { position: "sticky", bottom: "calc(var(--dsh-model-save-offset, 0px) + env(safe-area-inset-bottom, 0px))", zIndex: 2, padding: "10px 0", background: "var(--dsw-alias-bg-module-platform)", flexWrap: "wrap" },`);
const translations = {
  en: {
    multiKeyExpand: 'Expand details', multiKeyCollapse: 'Collapse details', multiKeyUnsaved: 'Not saved',
    multiKeyProtocol: 'Group API protocol', multiKeyProtocolInherit: 'Inherit provider ({protocol})', multiKeyProtocolDefault: 'default protocol',
    multiKeyProtocolHelp: 'Only this key group is affected. Choose the protocol supported by your relay, not just the model name.', multiKeyInvalidProtocol: 'Unsupported key-group protocol.',
    multiKeyRemoveGroup: 'Remove this key group', multiKeyRemoveTitle: 'Remove key group “{name}”?',
    multiKeyRemoveHelp: 'Removes the entire key group and its model list, not just one model above. Stored credentials are retained.',
    multiKeyRemoveDescription: 'This removes the selected group and all of its model entries from the draft. Other groups and stored credentials are retained. Existing conversations are not switched automatically. Changes take effect after Apply; Cancel editing to discard them.'
  },
  zh: {
    multiKeyExpand: '展开详情', multiKeyCollapse: '收起详情', multiKeyUnsaved: '未保存',
    multiKeyProtocol: '分组 API 协议', multiKeyProtocolInherit: '跟随供应商（{protocol}）', multiKeyProtocolDefault: '默认协议',
    multiKeyProtocolHelp: '仅影响此密钥分组，请按中转站支持的协议选择，不按模型名称自动切换。', multiKeyInvalidProtocol: '不支持此密钥分组协议。',
    multiKeyRemoveGroup: '移除此密钥分组', multiKeyRemoveTitle: '移除密钥分组“{name}”？',
    multiKeyRemoveHelp: '移除整个密钥分组及其模型列表，不是仅移除上方一个模型。已保存的密钥凭据会保留。',
    multiKeyRemoveDescription: '此操作从编辑草稿移除该分组及其全部模型条目，其他分组和已保存的密钥凭据不变，不会自动切换现有会话。点击“应用”后才生效；取消编辑可放弃更改。'
  }
};
for (const [locale, values] of Object.entries(translations)) {
  const lines = Object.entries(values).map(([key, value]) => `\t\t\t${key}: ${JSON.stringify(value)},\n`).join('');
  replace(`const ${locale} = {\n`, `const ${locale} = {\n${lines}`);
}
addSettingsReorder(current, replace);
addSettingsCapabilities(current, replace, { fullSource });
const shipped = readArtifact('native/settings-models.patch.json');
const previousTouch = readArtifact('test/fixtures/settings-models/v0.3.9-beta.1.json');
const previousRelease = readArtifact('test/fixtures/settings-models/v0.3.9.json');
const previousStable = readArtifact('test/fixtures/settings-models/v0.3.8.json');
const variant = item => ({ baseSha256: item.baseSha256, resultSha256: item.resultSha256, replacements: item.replacements });
const artifact = { ...legacy, current: true, resultSha256: fullSource ? sha256(current) : shipped.resultSha256, replacements: [...legacy.replacements, ...delta], variants: [variant(stable), variant(legacy), variant(previousStable), variant(previousTouch), variant(previousRelease), ...(legacy.variants ?? [])] };
// Validate full generated JavaScript BEFORE writing the distributable patch.
new Function(current);
if (fullSource && (transformSource(base, artifact) !== current || transformSource(current, artifact, true) !== base)) throw new Error('Settings patch roundtrip mismatch');
export { artifact, base, current as source, previous };
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!fullSource) throw new Error('Generation/check requires --source <pristine-host-file>; no installed files are read implicitly');
  const target = new URL('native/settings-models.patch.json', root);
  const output = JSON.stringify(artifact, null, 2) + '\n';
  if (process.argv.includes('--check')) {
    if (fs.readFileSync(target, 'utf8') !== output) throw new Error('Settings collapse artifact is stale');
  } else fs.writeFileSync(target, output);
  console.log(`settings-models: ${artifact.resultSha256}`);
}
