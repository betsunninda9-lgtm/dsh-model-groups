import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sha256, transformSource } from './native-patches.mjs';

const root = new URL('../', import.meta.url);
const legacy = JSON.parse(fs.readFileSync(new URL('test/fixtures/settings-models/beta5.json', root), 'utf8'));
const sourceArg = process.argv.indexOf('--source');
const sourcePath = sourceArg >= 0 ? process.argv[sourceArg + 1] : undefined;
const fullSource = sourcePath !== undefined;
if (sourceArg >= 0 && !sourcePath) throw new Error('--source requires a pristine host file path');
// No implicit installed-host access. Tests use only a focused source fixture.
// Generation requires an explicitly selected read-only pristine host input.
const base = fullSource ? fs.readFileSync(sourcePath, 'utf8') : undefined;
if (fullSource && sha256(base) !== legacy.baseSha256) throw new Error('Pristine settings host hash mismatch');
const previous = fullSource ? transformSource(base, legacy) : fs.readFileSync(new URL('test/fixtures/settings-models/editor-beta5.js.txt', root), 'utf8');
const delta = [];
let current = previous;
function replace(before, after) {
  if (current.split(before).length !== 2) throw new Error(`Expected unique settings anchor: ${before.slice(0, 100)}`);
  delta.push({ before, after }); current = current.replace(before, after);
}
// Acknowledged profile snapshots are independent of credential-write success. A
// partially failed save must not mark the whole card saved or collapse its rows.
replace('\t\tfunction MultiKeyEntriesEditor(props) {', `\t\tfunction multiKeyEntryDirty(entry, saved, draft) {
\t\t\treturn saved === void 0 || JSON.stringify(entry) !== JSON.stringify(saved) || (draft ?? "").length > 0;
\t\t}
\t\tfunction MultiKeyEntriesEditor(props) {`);
replace('const [busyEntries, setBusyEntries] = (0, react.useState)({});', `const [busyEntries, setBusyEntries] = (0, react.useState)({});
\t\t\tconst [expandedEntries, setExpandedEntries] = (0, react.useState)({});
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
\t\t\t\t\t\t\t}), dirty ? (0, react_jsx_runtime.jsx)("span", { "data-key-entry-unsaved": true, children: t("multiKeyUnsaved") }) : null,
\t\t\t\t\t\t\t(0, react_jsx_runtime.jsx)("button", {
\t\t\t\t\t\t\t\ttype: "button", className: ModelsSection_module_css_default["secondaryButton"],
\t\t\t\t\t\t\t\t"aria-expanded": expanded, "aria-controls": detailsId,
\t\t\t\t\t\t\t\tonClick: () => setExpandedEntries((current) => ({ ...current, [id]: !expanded })),
\t\t\t\t\t\t\t\tchildren: t(expanded ? "multiKeyCollapse" : "multiKeyExpand")
\t\t\t\t\t\t\t})]
\t\t\t\t\t\t}),`;
// Keep the original key control in the same keyed card, and ALWAYS mount details.
// display:none avoids CSS module display:flex overriding the native hidden attr.
replace(oldHead + name + key + current.slice(modelStart, modelEnd), head + key + `
\t\t\t\t\t\t(0, react_jsx_runtime.jsxs)("div", {
\t\t\t\t\t\t\tid: detailsId, "data-key-entry-details": true, hidden: !expanded,
\t\t\t\t\t\t\tstyle: { display: expanded ? "contents" : "none" }, children: [` + name + model + `,
\t\t\t\t\t\t\t(0, react_jsx_runtime.jsx)("button", {
\t\t\t\t\t\t\t\ttype: "button", className: ModelsSection_module_css_default["secondaryButton"], disabled,
\t\t\t\t\t\t\t\tonClick: () => remove(id), children: t("multiKeyRemove")
\t\t\t\t\t\t\t})]
\t\t\t\t\t\t})]`);
// Both owning cards report outcomes through their existing save implementation.
for (const owner of ['CustomProviderCard', 'ProviderEditor']) {
  const start = current.indexOf(`function ${owner}(props) {`);
  const end = current.indexOf('\n\t\t//#endregion', start);
  const old = current.slice(start, end);
  let next = old.replace('const saving = (0, react.useRef)(false);', 'const [entrySaveState, setEntrySaveState] = (0, react.useState)(void 0);\n\t\t\tconst saving = (0, react.useRef)(false);');
  next = next.replace('route: props.provider, entries: keyEntries,', 'route: props.provider, entries: keyEntries, saveState: entrySaveState, savedEntries: entrySaveState?.ok ? entrySaveState.entries : void 0,');
  next = next.replace('route, entries: keyEntries,', 'route, entries: keyEntries, saveState: entrySaveState, savedEntries: entrySaveState?.ok ? entrySaveState.entries : void 0,');
  const action = owner === 'ProviderEditor' ? 'apply' : 'create';
  next = next.replace(`const ${action} = async () => {`, `const ${action} = async () => {`);
  const tryAnchor = owner === 'ProviderEditor' ? 'const failure = await applyOnce();' : 'const outcome = await createOnce();';
  const outcomeName = owner === 'ProviderEditor' ? 'failure' : 'outcome';
  const routeName = owner === 'ProviderEditor' ? 'props.provider' : 'route';
  next = next.replace(tryAnchor, tryAnchor + '\n\t\t\t\t\tif (multiKey) setEntrySaveState({ ok: ' + outcomeName + ' === void 0, entries: structuredClone(' + outcomeName + ' === void 0 ? normalizedMultiKeyEntries(' + routeName + ', keyEntries) : keyEntries) });');
  next = next.replace('} catch {\n\t\t\t\t\tsetFailure(t("multiKeySaveFailed"));', '} catch {\n\t\t\t\t\tif (multiKey) setEntrySaveState({ ok: false, entries: structuredClone(keyEntries) });\n\t\t\t\t\tsetFailure(t("multiKeySaveFailed"));');
  // Multi-key stays open on success: the existing action saves the provider and
  // lets the editor collapse only its acknowledged entries. Single-key unchanged.
  if (owner === 'ProviderEditor') next = next.replace('props.onClose(true);', 'if (!multiKey) props.onClose(true);');
  replace(old, next);
}
replace('className: ModelsSection_module_css_default["editorActions"],', `className: ModelsSection_module_css_default["editorActions"],
\t\t\t\t"data-model-save-actions": true,
\t\t\t\tstyle: { position: "sticky", bottom: "calc(var(--dsh-model-save-offset, 0px) + env(safe-area-inset-bottom, 0px))", zIndex: 2, padding: "10px 0", background: "var(--dsw-alias-bg-module-platform)", flexWrap: "wrap" },`);
replace('const en = {\n', 'const en = {\n\t\t\tmultiKeyExpand: "Expand details",\n\t\t\tmultiKeyCollapse: "Collapse details",\n\t\t\tmultiKeyUnsaved: "Not saved",\n');
replace('const zh = {\n', 'const zh = {\n\t\t\tmultiKeyExpand: "展开详情",\n\t\t\tmultiKeyCollapse: "收起详情",\n\t\t\tmultiKeyUnsaved: "未保存",\n');
const shipped = JSON.parse(fs.readFileSync(new URL('native/settings-models.patch.json', root), 'utf8'));
const artifact = { ...legacy, resultSha256: fullSource ? sha256(current) : shipped.resultSha256, replacements: [...legacy.replacements, ...delta], variants: [{ baseSha256: legacy.baseSha256, resultSha256: legacy.resultSha256, replacements: legacy.replacements }, ...(legacy.variants ?? [])] };
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
