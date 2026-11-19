import { sameEditorValue } from './editor-state.js';
import { materializeCapabilityEntry, applyCapabilityBatch, mergeCapabilityModels } from '../capability-defaults.js';
import { createLegacyReorder } from './legacy-reorder.js';
import { createLegacyPrimitives } from './legacy-primitives.js';

// The previous editor's DOM and interactions, owned by this plugin.
// No host module imports, runtime code extraction, or host DOM selectors.
const LEGACY_MODELS_ZH = {
	capabilityVision: "识图",
	capabilityReasoning: "思考强度",
	multiKeyReorder: "调整密钥分组顺序",
	multiKeyReorderHelp: "长按手柄拖动，或用上下方向键调整；与其他改动一起保存。",
	modelReorderTouchHelp: "长按手柄拖动，或用上下方向键调整；与其他改动一起保存。",
	multiKeyExpand: "展开详情",
	multiKeyCollapse: "收起详情",
	multiKeyUnsaved: "未保存",
	multiKeyProtocol: "分组 API 协议",
	multiKeyProtocolInherit: "跟随供应商（{protocol}）",
	multiKeyProtocolDefault: "默认协议",
	multiKeyProtocolHelp: "仅影响此密钥分组，请按中转站支持的协议选择，不按模型名称自动切换。",
	multiKeyInvalidProtocol: "不支持此密钥分组协议。",
	multiKeyRemoveGroup: "移除此密钥分组",
	multiKeyRemoveTitle: "移除密钥分组“{name}”？",
	multiKeyRemoveHelp: "移除整个密钥分组及其模型列表，不是仅移除上方一个模型。已保存的密钥凭据会保留。",
	multiKeyRemoveDescription: "此操作从编辑草稿移除该分组及其全部模型条目，其他分组和已保存的密钥凭据不变，不会自动切换现有会话。点击“应用”后才生效；取消编辑可放弃更改。",
	multiKey: "多密钥配置",
	multiKeyHelp: "各配置共享 Provider ID、API 地址与协议，分别管理名称、API 密钥和模型。关闭后恢复原单密钥配置，已保存的配置与密钥不会删除。",
	multiKeySharedSettings: "公共设置",
	multiKeyAdd: "添加密钥配置",
	multiKeyRemove: "移除",
	multiKeyEntryName: "配置名称",
	multiKeyDefaultName: "密钥配置",
	multiKeyDisableTitle: "关闭多密钥配置？",
	multiKeyDisableDescription: "应用后，此供应商将使用原单密钥配置，已保存的密钥配置与凭据不会删除。正在使用密钥配置的会话需要重新开启，或手动选择单密钥模型；不会自动换用其他密钥。",
	multiKeyKeepEnabled: "保持开启",
	multiKeyDisableConfirm: "确认关闭（待应用）",
	multiKeyUnsavedTitle: "请先保存新输入的密钥",
	multiKeyUnsavedKeys: "当前有尚未保存的 API 密钥输入。关闭后直接应用不会保存这些输入，因此开关将保持开启。请返回密钥配置并应用保存，再重新打开此卡片关闭；当前输入与已存储的密钥均未删除。",
	multiKeyReturnToEdit: "返回密钥配置",
	multiKeyRef: "密钥引用：{ref}",
	multiKeySaved: "引用已保存，尚未检查密钥状态；输入留空可保留原密钥。",
	multiKeyNew: "尚未保存；输入留空不会创建密钥。",
	multiKeyConfigured: "已确认密钥已配置；留空可保留。",
	multiKeyMissing: "已确认此引用缺少密钥，请输入或在环境中配置。",
	multiKeyKeepCredentials: "移除密钥配置不会删除已存储的密钥。",
	multiKeyNeedsEntries: "请至少添加一个密钥配置。",
	multiKeyInvalidId: "密钥配置 ID 无效，请重新打开此卡片或修正配置。",
	multiKeyInvalidName: "每个配置名称须为 1–120 个字符。",
	multiKeyInvalidRef: "密钥引用无效。",
	multiKeyDuplicateRef: "多个密钥配置使用了相同的密钥引用；每个配置必须使用独立引用。",
	multiKeyNeedsModels: "每个密钥配置至少需要一个模型。",
	multiKeyReplaceConfirm: "确认替换 {ref} 的密钥；共用此引用的其他配置也会受到影响。",
	multiKeyConfirmRequired: "请先确认替换已引用的密钥，再应用。",
	multiKeyProbeNeedsKey: "保存前请先输入此配置的 API 密钥再获取模型；不会使用供应商原来的密钥。",
	multiKeySaveFailed: "保存尚未完成。请保留此卡片并重试；已成功写入的密钥不会重复写入。",
	nav: "模型",
	deepSeekAccount: "DeepSeek 账号",
	title: "模型",
	intro: "填入各提供商的 API 密钥即可使用其模型。",
	edit: "编辑",
	editProvider: "编辑 {provider}",
	remove: "删除",
	removeProvider: "删除 {provider}",
	deleteTitle: "删除 {provider}？",
	deleteDescription: "删除 {provider} 会移除其配置；其使用的凭证（如有）由其他位置管理，将会保留。",
	deleteDescriptionWithCredential: "删除 {provider} 会移除其配置和存储的 API 密钥。",
	deleteConfirm: "删除 {provider}",
	deleting: "正在删除 {provider}…",
	add: "添加模型提供商",
	addMode: "添加方式",
	addCatalog: "第三方模型提供商",
	addCustom: "自定义模型 API",
	addCatalogHint: "从内置目录中选择 OpenAI、Anthropic、Kimi 等提供商，填入其 API 密钥即可使用。",
	addCustomHint: "连接中转站、自部署服务或其他兼容 OpenAI / Anthropic 协议的接口，需填写 API 地址、协议和模型。",
	addCatalogExhausted: "目录中的提供商都已添加。",
	addCustomUnavailable: "没有可用的 API 协议。",
	provider: "提供商",
	close: "关闭",
	cancel: "取消",
	apply: "保存",
	applying: "保存中…",
	savedProvider: "已保存 {provider}。",
	credentialConfigured: "API 密钥已配置",
	credentialMissing: "API 密钥缺失",
	accountSignedIn: "已登录",
	readOnly: "当前部署的设置文档为只读。",
	loadFailed: "加载提供商目录失败",
	conflict: "这张卡片打开期间，这些设置已被其他地方改动。请关闭后重新打开，在当前值上编辑。",
	retry: "重试",
	keyInput: "API 密钥",
	keyReveal: "显示密钥",
	keyHide: "隐藏密钥",
	keyPlaceholder: "输入 API 密钥",
	keyPlaceholderFallback: "留空使用环境认证（{hint}）",
	keyPlaceholderSaved: "留空使用已保存凭据",
	keyFallbackMissing: "未检测到环境变量。请填写 API 密钥，或设置环境变量 {hint}。",
	keyFallbackDetected: "已检测到环境变量（{hint}）",
	keyFallbackDetectedHidden: "已检测到环境变量",
	keyFallbackUnchecked: "环境凭据状态尚未确认",
	keyHelp: "优先使用已保存的凭据。此处显示的环境后备按以下顺序排列：{env}。来源依次为启动环境、$cwd/.env、$DSH_HOME/.env。",
	authHelp: "认证说明",
	customized: "自定义设置",
	baseUrl: "API 地址",
	baseUrlDefault: "没有默认地址",
	baseUrlEnvironment: "提供方地址配置：{env}",
	baseUrlConfigured: "由提供方配置地址",
	baseUrlPlaceholder: "{url}",
	deepSeekBaseUrl: "https://api.deepseek.com/anthropic（默认使用环境 DEEPSEEK_BASE_URL）",
	deepSeekEndpointHint: "请填写兼容 Anthropic Messages 协议的 API 地址。",
	models: "模型目录",
	modelsInherited: "正在使用适配器默认模型",
	modelsCustomized: "已自定义模型目录",
	resetModels: "恢复默认模型",
	model: "模型",
	modelId: "模型 ID",
	modelName: "显示名称",
	modelNamePlaceholder: "留空时使用模型 ID",
	contextWindow: "上下文窗口",
	contextWindowPlaceholder: "使用提供商默认值",
	maxTokens: "最大输出 token 数",
	maxTokensPlaceholder: "使用提供商默认值",
	modelAdvanced: "模型选项",
	modelInputTypes: "输入类型",
	modelInputText: "文本",
	modelInputImage: "图片",
	modelReasoning: "推理等级",
	modelReasoningLevel: "档位",
	modelReasoningValue: "API 参数值",
	modelReasoningHelp: "推理等级说明",
	modelReasoningHelpText: "API 参数值会写入请求的推理强度字段（如 OpenAI 的 reasoning_effort），默认与档位名相同；如有不同，以模型提供商的 API 文档为准。Off 表示关闭思考，不需要填写参数值；配置中已写入的值会保留并发送。",
	modelReasoningNeedsLevel: "至少添加一个 Off 以外的档位；不需要思考请关闭推理等级。",
	modelReasoningValueRequired: "Off 以外的档位都需要填写 API 参数值，且参数值不能为空字符串。",
	modelReasoningAdd: "添加档位",
	modelReasoningRemove: "删除档位",
	modelReasoningOffValuePlaceholder: "关闭思考",
	addModel: "添加模型",
	removeModel: "删除模型",
	reorderModel: "调整模型顺序",
	reorderModelHelp: "拖动排序，或使用上下方向键调整顺序。",
	modelsEmpty: "模型选择器中将不显示任何模型；目录外 ID 仍可直接发送。",
	keyBlank: "请输入 API 密钥；留空则保持已存储的密钥。",
	keyBlankNew: "请输入 API 密钥；若该提供商以其他方式鉴权，可以留空。",
	keyIllegalCharacters: "该 API 密钥格式错误，请检查。",
	modelIdRequired: "模型 ID 不能为空。",
	modelIdDuplicate: "模型 ID 不能重复。",
	modelNameInvalid: "显示名称不能为空。",
	modelContextInvalid: "上下文窗口必须是正数，例如 131072、256K 或 1M。",
	modelMaxTokensInvalid: "最大输出 token 数必须是正数，例如 8192、64K 或 1M。",
	advancedHint: "其余字段在 cordis.patch.yml 中，请直接编辑对应段。",
	modelCapacityInvalid: "容量需为数字，可加 K 或 M 后缀。",
	modelDuplicate: "每个模型 ID 只能出现一次。",
	fetchModels: "获取可用模型",
	fetching: "正在询问提供商…",
	fetchNeedsBaseUrl: "请先填写 API 地址，再获取。",
	fetchEmpty: "该提供商没有列出任何模型，请手动添加。",
	fetchTitle: "选择模型",
	fetchDescription: "以下是模型提供商的可用模型，勾选的模型即为模型列表。",
	fetchSearch: "搜索模型",
	fetchNoMatches: "没有匹配的模型。",
	fetchSelectAll: "全选",
	fetchDeselectAll: "取消全选",
	fetchAdopt: "更新列表",
	fetchKeepOne: "请至少保留一个勾选的模型。",
	customTag: "自定义",
	customRoute: "Provider ID",
	customRouteHint: "以小写字母开头的标识，在请求中唯一标识该提供商，并用于派生凭据名。",
	customRouteInvalid: "需以小写字母开头，之后可用小写字母、数字和短横线。",
	customRouteTaken: "已有提供商使用了这个 ID。",
	customDisplayName: "显示名称",
	customApi: "API 协议",
	customApiUnset: "未选择",
	protocolOpenAiCompletions: "OpenAI Chat Completions",
	protocolOpenAiResponses: "OpenAI Responses",
	protocolAnthropicMessages: "Anthropic Messages",
	customNeedsBaseUrl: "自定义模型 API 需要填写 API 地址。",
	customBaseUrlInvalid: "请输入有效的 HTTP 或 HTTPS 地址。",
	customNeedsModels: "自定义模型 API 至少需要一个模型。",
	customBaseUrlPlaceholder: "https://gateway.example/v1",
	customAnthropicBaseUrlPlaceholder: "https://gateway.example",
	settingsPathUnresolvable: "无法解析设置路径",
	create: "创建提供商",
	creating: "创建中…",
	welcomeTitle: "预览版说明",
	welcomeBody: "DeepSeek Harness 目前的 0.2 版本仍处于预览阶段，还有许多地方需要持续改进和打磨，希望听取广大开发者和用户的反馈建议。现在，新的桌面端面向广泛用户，开发者相关的进阶功能可在配置中开启使用。预计 DeepSeek Harness 的产品功能以及插件 API 都会继续快速迭代、持续演化，并逐渐趋于稳定。\n\n我们期待与全球用户和开发者一起，在开源、可复用、可组合的基础设施之上，共同探索智能上限。欢迎大家用 DeepSeek Harness 将想法变成现实，与社区一起丰富插件生态。",
	welcomeContinue: "继续",
	welcomeError: "暂时无法保存确认状态，请重试。",
	onboardingTitle: "添加一个 API Key 开始使用",
	onboardingDescription: "配置 DeepSeek 官方模型，即可开始使用。",
	onboardingLater: "稍后配置",
	onboardingSave: "保存并继续",
	onboardingSaving: "保存中…",
	keyRequired: "请输入 API 密钥后继续。"
};
export const legacyModelsText = key => LEGACY_MODELS_ZH[key] ?? key;
export function createLegacyModelsUI(React, primitives = {}) {
const react = React;
const h = React.createElement;
const jsx = (type, props, key) => { const { children, ...rest } = props ?? {}; return h(type, { ...rest, ...(key === undefined ? {} : { key }) }, ...(Array.isArray(children) ? children : children === undefined ? [] : [children])); };
const react_jsx_runtime = { jsx, jsxs: jsx, Fragment: React.Fragment };
const _deepseek_ai_dsh_client_ui_primitives = createLegacyPrimitives(React, primitives);
const ModelsSection_module_css_default = {"keyInput":"dsh-mg-native-keyInput","input":"dsh-mg-native-input","keyInputFilled":"dsh-mg-native-keyInputFilled","keyToggle":"dsh-mg-native-keyToggle","modelInputTypes":"dsh-mg-native-modelInputTypes","modelFieldLabel":"dsh-mg-native-modelFieldLabel","modelInputChoices":"dsh-mg-native-modelInputChoices","modelReasoning":"dsh-mg-native-modelReasoning","modelReasoningHead":"dsh-mg-native-modelReasoningHead","modelReasoningLabel":"dsh-mg-native-modelReasoningLabel","helpButton":"dsh-mg-native-helpButton","modelReasoningRow":"dsh-mg-native-modelReasoningRow","selectInput":"dsh-mg-native-selectInput","modelReasoningValueInput":"dsh-mg-native-modelReasoningValueInput","iconButton":"dsh-mg-native-iconButton","iconButtonDanger":"dsh-mg-native-iconButtonDanger","error":"dsh-mg-native-error","addModelButton":"dsh-mg-native-addModelButton","modelField":"dsh-mg-native-modelField","modelName":"dsh-mg-native-modelName","modelNameLabel":"dsh-mg-native-modelNameLabel","modelEntry":"dsh-mg-native-modelEntry","modelRow":"dsh-mg-native-modelRow","modelDragHandle":"dsh-mg-native-modelDragHandle","modelAdvanced":"dsh-mg-native-modelAdvanced","modelCatalog":"dsh-mg-native-modelCatalog","modelListHead":"dsh-mg-native-modelListHead","modelCatalogHeading":"dsh-mg-native-modelCatalogHeading","modelCatalogTitle":"dsh-mg-native-modelCatalogTitle","modelCatalogMeta":"dsh-mg-native-modelCatalogMeta","linkButton":"dsh-mg-native-linkButton","modelEmpty":"dsh-mg-native-modelEmpty","modelList":"dsh-mg-native-modelList","fetchDialog":"dsh-mg-native-fetchDialog","candidateToolbar":"dsh-mg-native-candidateToolbar","candidateSearch":"dsh-mg-native-candidateSearch","candidateEmpty":"dsh-mg-native-candidateEmpty","candidateList":"dsh-mg-native-candidateList","candidate":"dsh-mg-native-candidate","candidateLabel":"dsh-mg-native-candidateLabel","candidateId":"dsh-mg-native-candidateId","field":"dsh-mg-native-field","fieldLabel":"dsh-mg-native-fieldLabel","advancedHint":"dsh-mg-native-advancedHint","deleteDialog":"dsh-mg-native-deleteDialog","rowCard":"dsh-mg-native-rowCard","rowHead":"dsh-mg-native-rowHead","rowName":"dsh-mg-native-rowName","rowActions":"dsh-mg-native-rowActions","rowTag":"dsh-mg-native-rowTag","secondaryButton":"dsh-mg-native-secondaryButton","dangerButton":"dsh-mg-native-dangerButton","deleteConfirm":"dsh-mg-native-deleteConfirm"};
const useSettingsReorder = createLegacyReorder(React);
const PROTOCOL_LABEL_KEYS = { 'openai-completions':'protocolOpenAiCompletions','openai-responses':'protocolOpenAiResponses','anthropic-messages':'protocolAnthropicMessages' };
function protocolLabel(t, protocol) { const key=PROTOCOL_LABEL_KEYS[protocol]; return key === undefined ? protocol : t(key); }
const LEGAL_API_KEY = /^[\x21-\x7E]+$/;
/**
* A pasted `NAME=value` environment line. Two narrowings keep real keys clear
* of it: the name must be upper-case, so `sk-` forms break at the hyphen, and
* the `=` must be followed by something other than another `=`, so base64
* padding on an all-upper-case key (`ABCD==`) is not mistaken for an
* assignment. This heuristic runs only here — a resolver applying it could
* lock a user out of a gateway whose key legitimately takes this shape, with
* the environment refusing it too and no way through.
*/
const ENV_LINE = /^[A-Z][A-Z0-9_]*=[^=]/;
/** Whether a value is wrapped in one matching pair of quotes. */
function isQuoted(value) {
	const first = value[0];
	if (first !== "\"" && first !== "'" && first !== "`") return false;
	return value.length > 1 && value.endsWith(first);
}
/**
* Judge the key input's current value.
*
* An empty field is not a failure: every card opens with it empty even when a
* key is already stored, where it means keep that one. A field holding only
* whitespace is a failure rather than an empty field, so typed input is never
* silently discarded.
* @param draft - the key input's current value, untrimmed.
* @returns the copy key for a field-level failure, or `undefined` to allow submit.
*/
function apiKeyFailure(draft) {
	if (draft.length === 0) return void 0;
	const value = draft.trim();
	if (value.length === 0) return "keyBlank";
	if (ENV_LINE.test(value) || isQuoted(value)) return "keyIllegalCharacters";
	if (!LEGAL_API_KEY.test(value)) return "keyIllegalCharacters";
}
const EYE_CONTOUR = "M1.5 8C2.9 5.25 5.25 3.5 8 3.5C10.75 3.5 13.1 5.25 14.5 8C13.1 10.75 10.75 12.5 8 12.5C5.25 12.5 2.9 10.75 1.5 8Z";
const EYE_PATH = `${EYE_CONTOUR}M10 8C10 9.1 9.1 10 8 10C6.9 10 6 9.1 6 8C6 6.9 6.9 6 8 6C9.1 6 10 6.9 10 8Z`;
const EYE_OFF_PATH = `${EYE_CONTOUR}M2.5 2.5L13.5 13.5`;
/**
* Reveal only a nonempty draft; a different value starts masked, as in SecretText.
* @param props - current draft, input attributes, and translated control labels.
* @returns a password input with an optional reveal button.
*/
function ApiKeyInput({ value, t, inputRef, ...props }) {
	const [revealedValue, setRevealedValue] = (0, react.useState)();
	const revealed = value.length > 0 && revealedValue === value;
	return (0, react_jsx_runtime.jsxs)("div", {
		className: ModelsSection_module_css_default["keyInput"],
		children: [(0, react_jsx_runtime.jsx)("input", {
			...props,
            ref: inputRef,
			className: `${ModelsSection_module_css_default["input"]} ${value.length > 0 ? ModelsSection_module_css_default["keyInputFilled"] : ""}`,
			type: revealed ? "text" : "password",
			autoComplete: "new-password",
			value,
			onChange: (event) => {
				setRevealedValue(void 0);
				props.onChange?.(event);
			}
		}), value.length === 0 ? null : (0, react_jsx_runtime.jsx)("button", {
			type: "button",
			className: ModelsSection_module_css_default["keyToggle"],
			"aria-label": t(revealed ? "keyHide" : "keyReveal"),
			"aria-pressed": revealed,
			disabled: props.disabled,
			onClick: () => {
				setRevealedValue(revealed ? void 0 : value);
			},
			children: (0, react_jsx_runtime.jsx)("svg", {
				width: "16",
				height: "16",
				viewBox: "0 0 16 16",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: 1.3,
				strokeLinecap: "round",
				"aria-hidden": "true",
				children: (0, react_jsx_runtime.jsx)("path", { d: revealed ? EYE_OFF_PATH : EYE_PATH })
			})
		})]
	});
}
//#region lib/types/client/ModelInputTypes.js
/**
* Edit a nonempty set of input types, displaying inherited types before an override exists.
* @param props - model declaration and row replacement action.
* @returns the labeled text and image checkboxes.
*/
function ModelInputTypes({ model, field, position, disabled, fallback, t, onChange }) {
	const modalities = model[field];
	const selected = Array.isArray(modalities) && modalities.length > 0 ? modalities : fallback ?? ["text"];
	return (0, react_jsx_runtime.jsxs)("fieldset", {
		className: ModelsSection_module_css_default["modelInputTypes"],
		"aria-label": `${t("modelInputTypes")} ${String(position)}`,
		children: [(0, react_jsx_runtime.jsx)("legend", {
			className: ModelsSection_module_css_default["modelFieldLabel"],
			children: t("modelInputTypes")
		}), (0, react_jsx_runtime.jsx)("div", {
			className: ModelsSection_module_css_default["modelInputChoices"],
			children: ["text", "image"].map((modality) => (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Checkbox, {
				label: t(modality === "text" ? "modelInputText" : "modelInputImage"),
				checked: selected.includes(modality),
				disabled: disabled || selected.length === 1 && selected.includes(modality),
				onChange: (checked) => {
					const nextSelected = ["text", "image"].filter((value) => value === modality ? checked : selected.includes(value));
					const next = {
						...model,
						[field]: nextSelected
					};
					if (field === "inputModalities" && !nextSelected.includes("image")) {
						Reflect.deleteProperty(next, "imagePixelBudget");
						Reflect.deleteProperty(next, "imageMaxBytes");
					}
					onChange(next);
				}
			}, modality))
		})]
	});
}
//#endregion
//#region lib/types/client/ModelReasoningEfforts.js
/** Reasoning-level declarations for a model on a hand-declared pi-ai route. */
/** Levels a model offers when the switch is turned on, where the schema lists them: Off plus the common OpenAI-compatible trio. */
const INITIAL_LEVELS = [
	"off",
	"low",
	"medium",
	"high"
];
/** The wire value a level sends unless its row says otherwise; `null` is the Off entry that sends nothing. */
function defaultValue(level) {
	return level === "off" ? null : level;
}
/**
* Whether pi-ai accepts a stored value: a non-empty string, or nothing for Off.
* @param level - the declared level.
* @param wire - the value stored for it.
* @returns whether the adapter would resolve the entry.
*/
function acceptedValue(level, wire) {
	return typeof wire === "string" ? wire.length > 0 : wire === null && level === "off";
}
/**
* Read the declared levels from a row in their stored order, including a key
* the offered levels do not name, so an edit never drops it.
* @param model - model row as drafted.
* @returns the entries; empty for a valueless field, which pi-ai refuses, and
* `undefined` when the field is absent or `false`.
*/
function readEfforts(model) {
	const value = model["reasoningEfforts"];
	if (value === null) return [];
	if (typeof value !== "object" || Array.isArray(value)) return void 0;
	return Object.entries(value);
}
/**
* Replace a row's declared levels, preserving every other field.
* @param model - model row as drafted.
* @param entries - the levels to write in row order, or `undefined` to remove the field.
* @returns the replacement row.
*/
function withEfforts(model, entries) {
	const next = { ...model };
	if (entries === void 0) {
		Reflect.deleteProperty(next, "reasoningEfforts");
		return next;
	}
	next["reasoningEfforts"] = Object.fromEntries(entries);
	return next;
}
/**
* Mirror the pi-ai refusals of a hand-declared `reasoningEfforts`, so a card
* names the row instead of failing at the write.
* @param value - drafted `models` value, or `undefined` while inherited.
* @returns the first refused row, or `undefined` when the adapter will accept every row.
*/
function validateReasoningEfforts(value) {
	for (const [index, model] of modelDrafts(value).entries()) {
		const entries = readEfforts(model);
		if (entries === void 0) continue;
		if (entries.some(([level, wire]) => !acceptedValue(level, wire))) return {
			index,
			key: "modelReasoningValueRequired"
		};
		if (!entries.some(([level]) => level !== "off")) return {
			index,
			key: "modelReasoningNeedsLevel"
		};
	}
}
/**
* Edit the `reasoningEfforts` a hand-declared pi-ai model offers: a switch,
* then one row per level pairing the level with the value sent for it. Every
* row is read from the model, so a reused instance shows its new model.
* @param props - model declaration and row replacement action.
* @returns the reasoning-level group.
*/
function ModelReasoningEfforts({ model, levels, position, disabled, t, onChange }) {
	const entries = readEfforts(model);
	const [typing, setTyping] = (0, react.useState)(void 0);
	const label = `${t("modelReasoning")} ${String(position)}`;
	const used = entries?.map(([level]) => level) ?? [];
	const write = (next) => {
		onChange(withEfforts(model, next));
	};
	const replaceAt = (current, index, entry) => current.map((existing, at) => at === index ? entry : existing);
	const changeLevel = (current, index, from, wire, to) => {
		write(replaceAt(current, index, [to, typeof wire === "string" && wire.length > 0 && wire !== from && from !== "off" && to !== "off" ? wire : defaultValue(to)]));
	};
	const addLevel = (current) => {
		const highest = Math.max(-1, ...used.map((level) => levels.indexOf(level)));
		const level = levels.find((candidate, index) => index > highest && !used.includes(candidate)) ?? levels.find((candidate) => !used.includes(candidate));
		/* v8 ignore next -- the add button is disabled once every level has a row */
		if (level === void 0) return;
		write([...current, [level, defaultValue(level)]]);
	};
	const editValue = (current, index, level, text) => {
		setTyping({
			level,
			text
		});
		const trimmed = text.trim();
		write(replaceAt(current, index, [level, trimmed.length === 0 ? defaultValue(level) : trimmed]));
	};
	const leaveValue = (current, index, level, wire) => {
		setTyping(void 0);
		if (!acceptedValue(level, wire)) write(replaceAt(current, index, [level, defaultValue(level)]));
	};
	const choicesFor = (level) => [...levels.includes(level) ? [] : [level], ...levels.filter((choice) => choice === level || !used.includes(choice))];
	const initialEntries = INITIAL_LEVELS.filter((level) => levels.includes(level)).map((level) => [level, defaultValue(level)]);
	const refused = entries?.some(([level, wire]) => !acceptedValue(level, wire)) === true;
	const missingLevel = entries !== void 0 && !used.some((level) => level !== "off");
	return (0, react_jsx_runtime.jsxs)("div", {
		className: ModelsSection_module_css_default["modelReasoning"],
		role: "group",
		"aria-label": label,
		children: [(0, react_jsx_runtime.jsxs)("div", {
			className: ModelsSection_module_css_default["modelReasoningHead"],
			children: [(0, react_jsx_runtime.jsxs)("span", {
				className: `${ModelsSection_module_css_default["modelFieldLabel"]} ${ModelsSection_module_css_default["modelReasoningLabel"]}`,
				children: [t("modelReasoning"), (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
					label: t("modelReasoningHelpText"),
					side: "right",
					delayMs: 0,
					focusDelayMs: 0,
					portal: true,
					openOnClick: true,
					children: (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: ModelsSection_module_css_default["helpButton"],
						"aria-label": t("modelReasoningHelp"),
						children: "?"
					})
				})]
			}), (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Switch, {
				checked: entries !== void 0,
				label,
				disabled,
				onChange: (on) => {
					write(on ? initialEntries : void 0);
				}
			})]
		}), entries === void 0 ? null : (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
			entries.length > 0 ? (0, react_jsx_runtime.jsxs)("div", {
				className: ModelsSection_module_css_default["modelReasoningRow"],
				"aria-hidden": "true",
				children: [(0, react_jsx_runtime.jsx)("span", {
					className: ModelsSection_module_css_default["modelFieldLabel"],
					children: t("modelReasoningLevel")
				}), (0, react_jsx_runtime.jsx)("span", {
					className: ModelsSection_module_css_default["modelFieldLabel"],
					children: t("modelReasoningValue")
				})]
			}) : null,
			entries.map(([level, wire], index) => (0, react_jsx_runtime.jsxs)("div", {
				className: ModelsSection_module_css_default["modelReasoningRow"],
				children: [
					(0, react_jsx_runtime.jsx)("select", {
						className: `${ModelsSection_module_css_default["input"]} ${ModelsSection_module_css_default["selectInput"]}`,
						value: level,
						"aria-label": `${t("modelReasoningLevel")} ${String(index + 1)}`,
						disabled,
						onChange: (event) => {
							changeLevel(entries, index, level, wire, event.target.value);
						},
						children: choicesFor(level).map((choice) => (0, react_jsx_runtime.jsx)("option", {
							value: choice,
							children: choice
						}, choice))
					}),
					(0, react_jsx_runtime.jsx)("input", {
						className: `${ModelsSection_module_css_default["input"]} ${ModelsSection_module_css_default["modelReasoningValueInput"]}`,
						type: "text",
						value: typing?.level === level ? typing.text : typeof wire === "string" ? wire : "",
						placeholder: level === "off" ? t("modelReasoningOffValuePlaceholder") : level,
						"aria-label": `${level} ${t("modelReasoningValue")}`,
						"aria-invalid": !acceptedValue(level, wire),
						disabled: disabled || level === "off",
						onChange: (event) => {
							editValue(entries, index, level, event.target.value);
						},
						onBlur: () => {
							leaveValue(entries, index, level, wire);
						}
					}),
					(0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: `${ModelsSection_module_css_default["iconButton"]} ${ModelsSection_module_css_default["iconButtonDanger"]}`,
						"aria-label": `${t("modelReasoningRemove")} ${level}`,
						title: t("modelReasoningRemove"),
						disabled,
						onClick: () => {
							write(entries.filter((_entry, at) => at !== index));
						},
						children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconTrashOutlineRegular, { size: 14 })
					})
				]
			}, index)),
			refused ? (0, react_jsx_runtime.jsx)("p", {
				className: ModelsSection_module_css_default["error"],
				children: t("modelReasoningValueRequired")
			}) : missingLevel ? (0, react_jsx_runtime.jsx)("p", {
				className: ModelsSection_module_css_default["error"],
				children: t("modelReasoningNeedsLevel")
			}) : null,
			(0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				className: ModelsSection_module_css_default["addModelButton"],
				disabled: disabled || levels.every((level) => used.includes(level)),
				onClick: () => {
					addLevel(entries);
				},
				children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPlusOutlineRegular, { size: 14 }), t("modelReasoningAdd")]
			})
		] })]
	});
}
//#endregion
//#region lib/types/client/ModelRow.js
function rowHalf(event) {
	const rect = event.currentTarget.getBoundingClientRect();
	return event.clientY < rect.top + rect.height / 2 ? "before" : "after";
}
/**
* Render model fields with the display name in the expanded area of narrow rows.
* @param props - drafted fields and their owning editor's actions.
* @returns one expandable model entry.
*/
function ModelRow(props) {
	const { model, position, t, disabled } = props;
	const reorder = useSettingsReorder({ disabled, selector: "[data-row-key]", move: (_key, offset) => props.order.onMove(offset) });
	const modelField = (field) => (0, react_jsx_runtime.jsxs)("label", {
		className: `${ModelsSection_module_css_default["modelField"]} ${field === "name" ? ModelsSection_module_css_default["modelName"] : ""}`,
		children: [field === "name" ? (0, react_jsx_runtime.jsx)("span", {
			className: `${ModelsSection_module_css_default["modelFieldLabel"]} ${ModelsSection_module_css_default["modelNameLabel"]}`,
			children: t("modelName")
		}) : null, (0, react_jsx_runtime.jsx)("input", {
			className: ModelsSection_module_css_default["input"],
			type: "text",
			value: typeof model[field] === "string" ? model[field] : "",
			placeholder: t(field === "id" ? "modelId" : "modelName"),
			"aria-label": `${t(field === "id" ? "modelId" : "modelName")} ${String(position)}`,
			disabled,
			onFocus: field === "name" && !props.expanded ? props.onToggle : void 0,
			onChange: (event) => {
				const value = event.target.value;
				props.onFieldChange(field, field === "name" && value === "" ? void 0 : value);
			},
			onBlur: field === "id" ? (event) => props.onIdBlur?.(event.target.value) : void 0
		})]
	});
	return (0, react_jsx_runtime.jsx)("div", {
		className: ModelsSection_module_css_default["modelEntry"],
		"data-row-key": props.rowKey,
		"data-dragging": props.order.dragging || void 0,
		"data-drop-target": props.order.dragging ? void 0 : props.order.target,
		// Reordering is handled by the pointer handle below.
		children: (0, react_jsx_runtime.jsxs)("div", {
			className: ModelsSection_module_css_default["modelRow"],
			"data-expanded": props.expanded || void 0,
			children: [
				(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
					label: t("modelReorderTouchHelp"),
					portal: true,
					children: (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: `${ModelsSection_module_css_default["iconButton"]} ${ModelsSection_module_css_default["modelDragHandle"]}`,
						"aria-label": `${t("reorderModel")} ${String(position)}`,
						"aria-keyshortcuts": "ArrowUp ArrowDown",
						"aria-description": t("modelReorderTouchHelp"),
						disabled,
						...reorder(props.rowKey),
						children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconDragHandleOutlineRegular, { size: 14 })
					})
				}),
				modelField("id"),
				(0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: ModelsSection_module_css_default["iconButton"],
					"aria-label": `${t("modelAdvanced")} ${String(position)}`,
					"aria-expanded": props.expanded,
					title: t("modelAdvanced"),
					onClick: (event) => {
						event.currentTarget.focus();
						props.onToggle();
					},
					children: props.expanded ? (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutlineRegular, {}) : (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronRightOutlineRegular, {})
				}),
				(0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: `${ModelsSection_module_css_default["iconButton"]} ${ModelsSection_module_css_default["iconButtonDanger"]}`,
					"aria-label": `${t("removeModel")} ${String(position)}`,
					title: t("removeModel"),
					disabled,
					onClick: props.onRemove,
					children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconTrashOutlineRegular, { size: 14 })
				}),
				modelField("name"),
				props.expanded ? (0, react_jsx_runtime.jsxs)("div", {
					className: ModelsSection_module_css_default["modelAdvanced"],
					children: [
						["contextWindow", "maxTokens"].map((field) => (0, react_jsx_runtime.jsxs)("label", {
							className: ModelsSection_module_css_default["modelField"],
							children: [(0, react_jsx_runtime.jsx)("span", {
								className: ModelsSection_module_css_default["modelFieldLabel"],
								children: t(field)
							}), (0, react_jsx_runtime.jsx)("input", {
								className: ModelsSection_module_css_default["input"],
								type: "text",
								inputMode: "numeric",
								value: props[field].value,
								placeholder: props[field].placeholder,
								"aria-label": `${t(field)} ${String(position)}`,
								disabled,
								onChange: (event) => {
									props[field].onChange(event.target.value);
								},
								onBlur: props[field].onBlur
							})]
						}, field)),
						(0, react_jsx_runtime.jsx)(ModelInputTypes, {
							model,
							field: props.inputField,
							position,
							fallback: props.inputFallback,
							disabled: disabled || props.inputLoading === true,
							t,
							onChange: props.onChange
						}),
						props.reasoningLevels !== void 0 && props.reasoningLevels.length > 0 ? (0, react_jsx_runtime.jsx)(ModelReasoningEfforts, {
							model,
							levels: props.reasoningLevels,
							position,
							disabled,
							t,
							onChange: props.onChange
						}) : null
					]
				}) : null
			]
		})
	});
}
//#endregion
//#region lib/types/client/useModelRows.js
/** Local model-row identities, disclosures, capacity text, and draft ordering. */
/** One editor-local identity; editing a model ID never replaces its controls. */
function createRow(key) {
	return {
		key,
		expanded: false,
		editing: /* @__PURE__ */ new Map()
	};
}
/**
* Keep row state with its model through draft moves and removals.
* @param models - current draft array, owned by the provider card.
* @param onChange - replaces only that card's draft array.
* @param disabled - prevents reordering while the card cannot be edited.
* @returns row state and local editing and ordering actions.
*/
function useModelRows(models, onChange, disabled) {
	const nextKey = (0, react.useRef)(0);
	const [stored, setRows] = (0, react.useState)(() => models.map(() => createRow(nextKey.current++)));
	const [dragged, setDragged] = (0, react.useState)();
	const [target, setTarget] = (0, react.useState)();
	const entries = models.map((model, index) => ({
		model,
		state: stored[index] ?? createRow(nextKey.current++)
	}));
	const rows = entries.map((entry) => entry.state);
	if (stored.length !== models.length) setRows(rows);
	const endDrag = () => {
		setDragged(void 0);
		setTarget(void 0);
	};
	const move = (from, to) => {
		if (disabled || from === to || from < 0 || to < 0 || to >= models.length) return;
		const order = [...entries];
		const moved = order.splice(from, 1);
		order.splice(to, 0, ...moved);
		setRows(order.map((entry) => entry.state));
		onChange(order.map((entry) => entry.model));
	};
	return {
		rows: entries.map(({ model, state }, index) => ({
			...state,
			model,
			order: {
				dragging: dragged === state.key,
				target: target?.key === state.key ? target.half : void 0,
				canDrop: !disabled && dragged !== void 0,
				onStart: () => {
					setDragged(state.key);
				},
				onEnd: endDrag,
				onOver: (half) => {
					setTarget((current) => current?.key === state.key && current.half === half ? current : {
						key: state.key,
						half
					});
				},
				onLeave: () => {
					setTarget((current) => current?.key === state.key ? void 0 : current);
				},
				onDrop: (half) => {
					const from = rows.findIndex((row) => row.key === dragged);
					const insertion = index + (half === "after" ? 1 : 0);
					move(from, insertion > from ? insertion - 1 : insertion);
					endDrag();
				},
				onMove: (offset) => {
					move(index, index + offset);
				}
			}
		})),
		toggle: (index) => {
			setRows(rows.map((row, at) => at === index ? {
				...row,
				expanded: !row.expanded
			} : row));
		},
		edit: (index, field, text) => {
			setRows(rows.map((row, at) => {
				if (at !== index) return row;
				const editing = new Map(row.editing);
				if (text === void 0) editing.delete(field);
				else editing.set(field, text);
				return {
					...row,
					editing
				};
			}));
		},
		forget: (removed) => {
			setRows(rows.filter((_row, index) => !removed.has(index)));
			endDrag();
		},
		reset: () => {
			setRows(models.map(() => createRow(nextKey.current++)));
			endDrag();
		}
	};
}
//#endregion
//#region lib/types/client/DeepSeekModelsEditor.js
/** Accepted capacity spellings: a decimal count with an optional K/M suffix. */
const CAPACITY_PATTERN = /^(\d+(?:\.\d+)?)([km])?$/i;
/** Decimal suffix scales — `1M` is 1000K, matching how model capacities are quoted. */
const CAPACITY_SCALE = {
	k: 1e3,
	m: 1e6
};
/**
* Read a typed capacity, so a user can write `256K` or `1M` instead of counting
* zeroes. The stored value stays a plain token count.
* @param text - raw field text.
* @returns the count; `undefined` when blank (inherit), `NaN` when unreadable
* (rejected by {@link validateDeepSeekModels} before any write).
*/
function parseCapacity(text) {
	const trimmed = text.trim();
	if (trimmed.length === 0) return void 0;
	const match = CAPACITY_PATTERN.exec(trimmed);
	if (match === null) return NaN;
	const suffix = match[2]?.toLowerCase();
	const scale = suffix === "k" || suffix === "m" ? CAPACITY_SCALE[suffix] : 1;
	const scaled = Number(match[1]) * scale;
	const rounded = Math.round(scaled);
	return Math.abs(scaled - rounded) < 1e-6 ? rounded : scaled;
}
/**
* Spell a stored count back in the shortest form that survives a round trip
* through {@link parseCapacity}; a count that is not a whole number of
* thousands stays written out.
* @param value - stored capacity.
* @returns the field text.
*/
function formatCapacity(value) {
	if (!Number.isInteger(value) || value <= 0) return String(value);
	if (value % CAPACITY_SCALE.m === 0) return `${String(value / CAPACITY_SCALE.m)}M`;
	if (value % CAPACITY_SCALE.k === 0) return `${String(value / CAPACITY_SCALE.k)}K`;
	return String(value);
}
/** Convert a schema-validated catalog value into records without dropping hidden fields. */
function modelDrafts(value) {
	if (!Array.isArray(value)) return [];
	return value.map((entry) => typeof entry === "object" && entry !== null && !Array.isArray(entry) ? entry : {});
}
/**
* Validate adapter constraints that the serialized schema cannot express.
* @param value - user-owned `models` value, or undefined while inherited.
* @returns the first invalid row, or undefined when the adapter will accept it.
*/
function validateDeepSeekModels(value) {
	if (value === void 0) return void 0;
	const models = modelDrafts(value);
	const seen = /* @__PURE__ */ new Set();
	for (const [index, model] of models.entries()) {
		const id = model["id"];
		const trimmed = typeof id === "string" ? id.trim() : void 0;
		if (trimmed === void 0 || trimmed.length === 0) return {
			index,
			key: "modelIdRequired"
		};
		if (seen.has(trimmed)) return {
			index,
			key: "modelIdDuplicate"
		};
		seen.add(trimmed);
		const name = model["name"];
		if (name !== void 0 && (typeof name !== "string" || name.length === 0)) return {
			index,
			key: "modelNameInvalid"
		};
		const contextWindow = model["contextWindow"];
		if (contextWindow !== void 0 && (typeof contextWindow !== "number" || !Number.isInteger(contextWindow) || contextWindow <= 0)) return {
			index,
			key: "modelContextInvalid"
		};
		const maxTokens = model["maxTokens"];
		if (maxTokens !== void 0 && (typeof maxTokens !== "number" || !Number.isInteger(maxTokens) || maxTokens <= 0)) return {
			index,
			key: "modelMaxTokensInvalid"
		};
	}
}
/** A row's text field, or the empty string when unset or not a string. */
function textOf(model, key) {
	const value = model[key];
	return typeof value === "string" ? value : "";
}
/** A row's numeric field, or `undefined` when unset or not a number. */
function numberOf(model, key) {
	const value = model[key];
	return typeof value === "number" ? value : void 0;
}
/**
* What an empty capacity field is worth, shown as its placeholder so a row left
* blank does not read as a model with no capacity at all.
*
* These hints match llm-pi-ai's built-in `defaultContextWindow` and
* `defaultMaxTokens` in decimal K/M notation. Provider overrides are not
* available to this component and are not reflected in the hints.
*/
const CAPACITY_HINT = {
	contextWindow: "1M",
	maxTokens: "128K"
};
/**
* Spell a stored count for a field that may be unset. The spelling itself is
* {@link formatCapacity}, shared with the DeepSeek catalog editor so both
* surfaces read and write one K/M vocabulary.
* @param value - stored capacity, or `undefined` for an unset field.
* @returns the field text, empty when unset.
*/
function capacitySpelling(value) {
	return value === void 0 ? "" : formatCapacity(value);
}
/** Adopt a candidate, preserving disclosed capacities and input types. */
function adopt(candidate) {
	return {
		id: candidate.id,
		...candidate.name === void 0 ? {} : { name: candidate.name },
		...candidate.contextWindow === void 0 ? {} : { contextWindow: candidate.contextWindow },
		...candidate.maxTokens === void 0 ? {} : { maxTokens: candidate.maxTokens },
		...candidate.inputModalities === void 0 ? {} : { input: [...candidate.inputModalities] }
	};
}
/**
* Render the model list with its fetch action.
* @param props - the drafted rows, probe target, wire face, and copy.
* @returns the model-list editor.
*/
function ModelListEditor(props) {
	const { models, onChange, probe, operations, t, disabled, onBusyChange } = props;
	const { catalogProvider } = props;
	const [busy, setBusy] = (0, react.useState)(false);
	(0, react.useEffect)(() => {
		onBusyChange(busy);
	}, [busy, onBusyChange]);
	const [failure, setFailure] = (0, react.useState)(void 0);
	const [inheritedCatalog, setInheritedCatalog] = (0, react.useState)(void 0);
	(0, react.useEffect)(() => {
		if (catalogProvider === void 0) return;
		let current = true;
		operations.discoverModels(probe.settingsNs, { provider: catalogProvider }).then((answer) => {
			if (!current) return;
			setInheritedCatalog({
				provider: catalogProvider,
				models: answer.kind === "found" ? answer.models : []
			});
			setFailure(answer.kind === "refused" ? answer.message : void 0);
		});
		return () => {
			current = false;
		};
	}, [
		catalogProvider,
		operations,
		probe.settingsNs
	]);
	const catalog = inheritedCatalog?.provider === catalogProvider ? inheritedCatalog?.models : void 0;
	const inputDefaults = (0, react.useMemo)(() => new Map(catalog?.map((model) => [model.id, model.inputModalities])), [catalog]);
	const [candidates, setCandidates] = (0, react.useState)(void 0);
    const requestScope = (0, react.useRef)({ generation: 0, mounted: true, visible: true, onBusyChange });
    requestScope.current.visible = props.editorVisible !== false;
    requestScope.current.onBusyChange = onBusyChange;
    (0, react.useEffect)(() => {
        requestScope.current.mounted = true;
        return () => { requestScope.current.mounted = false; requestScope.current.generation++; requestScope.current.onBusyChange(false); };
    }, []);
    (0, react.useEffect)(() => {
        if (props.editorVisible !== false) return;
        requestScope.current.generation++;
        setCandidates(void 0); setFailure(void 0); setBusy(false);
    }, [props.editorVisible]);
	const [flipped, setFlipped] = (0, react.useState)(/* @__PURE__ */ new Set());
	const [candidateQuery, setCandidateQuery] = (0, react.useState)("");
	const rowState = useModelRows(models, onChange, disabled);
	const editCapacity = (index, field, text) => {
		rowState.edit(index, field, text);
		patch(index, { [field]: parseCapacity(text) });
	};
	const capacityText = (model, index, field) => rowState.rows[index]?.editing.get(field) ?? capacitySpelling(numberOf(model, field));
	const patch = (index, next) => {
		onChange(models.map((model, at) => {
			if (at !== index) return model;
			const cleared = new Set(Object.entries(next).filter(([, value]) => value === void 0 || value === "").map(([key]) => key));
			return Object.fromEntries(Object.entries({
				...model,
				...next
			}).filter(([key]) => !cleared.has(key)));
		}));
	};
	const fetchModels = async () => {
        const generation = ++requestScope.current.generation;
		setBusy(true);
		setFailure(void 0);
		try {
			const answer = await operations.discoverModels(probe.settingsNs, {
				...probe.provider === void 0 ? {} : { provider: probe.provider },
			...probe.keyEntryId === void 0 ? {} : { keyEntryId: probe.keyEntryId },
				...probe.baseURL === void 0 || probe.baseURL.length === 0 ? {} : { baseURL: probe.baseURL },
				...probe.api === void 0 ? {} : { api: probe.api },
				...probe.apiKey === void 0 ? {} : { apiKey: probe.apiKey }
			});
            if (!requestScope.current.mounted || !requestScope.current.visible || requestScope.current.generation !== generation) return;
			if (answer.kind === "refused") {
				setFailure(answer.message);
				return;
			}
			const found = answer.models;
			if (catalogProvider !== void 0) setInheritedCatalog({
				provider: catalogProvider,
				models: found
			});
			if (found.length === 0) {
				setFailure(t("fetchEmpty"));
				return;
			}
			setCandidateQuery("");
			setFlipped(/* @__PURE__ */ new Set());
			setCandidates([...new Map(found.map((model) => [model.id, model])).values()]);
		} finally {
            if (requestScope.current.mounted && requestScope.current.generation === generation) setBusy(false);
		}
	};
	const closePicker = () => {
		setCandidates(void 0);
		setFlipped(/* @__PURE__ */ new Set());
		setCandidateQuery("");
	};
	const configuredIds = new Set(models.map((model) => textOf(model, "id")).filter((id) => id.length > 0));
	const pickedByDefault = (id) => configuredIds.size === 0 || configuredIds.has(id);
	const isPicked = (id) => pickedByDefault(id) !== flipped.has(id);
	const activeCandidates = candidates ?? [];
	const listed = new Set(activeCandidates.map((candidate) => candidate.id));
	const removedRows = /* @__PURE__ */ new Set();
	models.forEach((model, at) => {
		const id = textOf(model, "id");
		if (listed.has(id) && !isPicked(id)) removedRows.add(at);
	});
	const keptRows = models.filter((_model, at) => !removedRows.has(at));
	const keptIds = new Set(keptRows.map((model) => textOf(model, "id")));
	const addedRows = activeCandidates.filter((candidate) => isPicked(candidate.id) && !keptIds.has(candidate.id)).map(adopt);
	const emptiesList = models.length > 0 && keptRows.length === 0 && addedRows.length === 0;
	const adoptPicked = () => {
		onChange([...keptRows, ...addedRows]);
		rowState.forget(removedRows);
		closePicker();
	};
	const toggle = (id) => {
		setFlipped((current) => {
			const next = new Set(current);
			if (!next.delete(id)) next.add(id);
			return next;
		});
	};
	const normalizedCandidateQuery = candidateQuery.trim().toLowerCase();
	const visibleCandidates = normalizedCandidateQuery.length === 0 ? activeCandidates : activeCandidates.filter((candidate) => candidate.id.toLowerCase().includes(normalizedCandidateQuery) || candidate.name?.toLowerCase().includes(normalizedCandidateQuery) === true);
	const allVisibleCandidatesPicked = visibleCandidates.length > 0 && visibleCandidates.every((candidate) => isPicked(candidate.id));
	const toggleVisibleCandidates = () => {
		const target = !allVisibleCandidatesPicked;
		setFlipped((current) => {
			const next = new Set(current);
			for (const candidate of visibleCandidates) if (pickedByDefault(candidate.id) === target) next.delete(candidate.id);
			else next.add(candidate.id);
			return next;
		});
	};
	const askable = probe.provider !== void 0 || probe.baseURL !== void 0 && probe.baseURL.length > 0;
	return (0, react_jsx_runtime.jsxs)("section", {
		className: ModelsSection_module_css_default["modelCatalog"],
		"aria-label": t("models"),
		children: [
			(0, react_jsx_runtime.jsxs)("div", {
				className: ModelsSection_module_css_default["modelListHead"],
				children: [
					(0, react_jsx_runtime.jsxs)("div", {
						className: ModelsSection_module_css_default["modelCatalogHeading"],
						children: [(0, react_jsx_runtime.jsx)("span", {
							className: ModelsSection_module_css_default["modelCatalogTitle"],
							children: t("models")
						}), props.overridden === void 0 ? null : (0, react_jsx_runtime.jsx)("span", {
							className: ModelsSection_module_css_default["modelCatalogMeta"],
							children: props.overridden ? t("modelsCustomized") : t("modelsInherited")
						})]
					}),
					props.overridden === true && props.onReset !== void 0 ? (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: ModelsSection_module_css_default["linkButton"],
						disabled,
						onClick: () => {
							rowState.reset();
							props.onReset?.();
						},
						children: t("resetModels")
					}) : null,
					(0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: ModelsSection_module_css_default["linkButton"],
						disabled: disabled || busy || !askable || props.probeBlocked !== void 0,
						title: props.probeBlocked !== void 0 ? t(props.probeBlocked) : askable ? void 0 : t("fetchNeedsBaseUrl"),
						onClick: () => {
							fetchModels();
						},
						children: busy ? t("fetching") : t("fetchModels")
					})
				]
			}),
			models.length === 0 ? (0, react_jsx_runtime.jsx)("p", {
				className: ModelsSection_module_css_default["modelEmpty"],
				children: t("modelsEmpty")
			}) : null,
			(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.AnimatedRows, {
				className: ModelsSection_module_css_default["modelList"],
				rowKeys: rowState.rows.map((row) => String(row.key)),
				ready: true,
				resetKey: "",
				children: rowState.rows.map(({ model, key, expanded, order }, index) => (0, react_jsx_runtime.jsx)(ModelRow, {
					rowKey: key,
					order,
					model,
					position: index + 1,
					inputField: "input",
					inputFallback: inputDefaults.get(textOf(model, "id")) ?? props.defaultInput,
					inputLoading: catalogProvider !== void 0 && catalog === void 0,
					reasoningLevels: props.reasoningLevels,
					expanded,
					disabled,
					t,
					contextWindow: {
						value: capacityText(model, index, "contextWindow"),
						placeholder: CAPACITY_HINT.contextWindow,
						onChange: (text) => {
							editCapacity(index, "contextWindow", text);
						}
					},
					maxTokens: {
						value: capacityText(model, index, "maxTokens"),
						placeholder: CAPACITY_HINT.maxTokens,
						onChange: (text) => {
							editCapacity(index, "maxTokens", text);
						}
					},
					onFieldChange: (field, value) => {
						patch(index, { [field]: value });
					},
					onChange: (next) => {
						onChange(models.map((row, at) => at === index ? next : row));
					},
					onToggle: () => {
						rowState.toggle(index);
					},
					onRemove: () => {
						onChange(models.filter((_model, at) => at !== index));
						rowState.forget(new Set([index]));
					}
				}, key))
			}),
			(0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				className: ModelsSection_module_css_default["addModelButton"],
				disabled,
				onClick: () => {
					onChange([...models, { id: "" }]);
				},
				children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPlusOutlineRegular, { size: 14 }), t("addModel")]
			}),
			failure !== void 0 ? (0, react_jsx_runtime.jsx)("p", {
				className: ModelsSection_module_css_default["error"],
				children: failure
			}) : null,
			(0, react_jsx_runtime.jsxs)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
				open: candidates !== void 0 && props.editorVisible !== false,
				onClose: closePicker,
				title: t("fetchTitle"),
				closeLabel: t("close"),
				description: t("fetchDescription"),
				className: ModelsSection_module_css_default["fetchDialog"],
				footer: (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "outline",
					onClick: closePicker,
					children: t("cancel")
				}), (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "outline",
					disabled: emptiesList,
					title: emptiesList ? t("fetchKeepOne") : void 0,
					onClick: adoptPicked,
					children: t("fetchAdopt")
				})] }),
				children: [(0, react_jsx_runtime.jsxs)("div", {
					className: ModelsSection_module_css_default["candidateToolbar"],
					children: [(0, react_jsx_runtime.jsx)("input", {
						className: `${ModelsSection_module_css_default["input"]} ${ModelsSection_module_css_default["candidateSearch"]}`,
						type: "search",
						value: candidateQuery,
						placeholder: t("fetchSearch"),
						"aria-label": t("fetchSearch"),
						onChange: (event) => {
							setCandidateQuery(event.target.value);
						}
					}), (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
						variant: "ghost",
						size: "sm",
						disabled: visibleCandidates.length === 0,
						onClick: toggleVisibleCandidates,
						children: t(allVisibleCandidatesPicked ? "fetchDeselectAll" : "fetchSelectAll")
					})]
				}), visibleCandidates.length === 0 ? (0, react_jsx_runtime.jsx)("p", {
					className: ModelsSection_module_css_default["candidateEmpty"],
					role: "status",
					children: t("fetchNoMatches")
				}) : (0, react_jsx_runtime.jsx)("ul", {
					className: ModelsSection_module_css_default["candidateList"],
					children: visibleCandidates.map((candidate) => (0, react_jsx_runtime.jsx)("li", {
						className: ModelsSection_module_css_default["candidate"],
						children: (0, react_jsx_runtime.jsxs)("label", {
							className: ModelsSection_module_css_default["candidateLabel"],
							children: [(0, react_jsx_runtime.jsx)("input", {
								type: "checkbox",
								checked: isPicked(candidate.id),
								onChange: () => {
									toggle(candidate.id);
								}
							}), (0, react_jsx_runtime.jsx)("span", {
								className: ModelsSection_module_css_default["candidateId"],
								title: candidate.name ?? candidate.id,
								children: candidate.id
							})]
						})
					}, candidate.id))
				})]
			})
		]
	});
}
function GroupCapabilityBatch({ entry, onChange, disabled, t }) {
  const migrated = materializeCapabilityEntry(entry);
  const jsx = react_jsx_runtime.jsx, jsxs = react_jsx_runtime.jsxs;
  const css = ModelsSection_module_css_default;
  return jsxs('div', { 'data-group-capabilities': true, className: css.field, children: ['vision', 'reasoning'].map(key => jsxs('div', {
    className: css.modelReasoningHead,
    children: [jsx('span', { className: css.fieldLabel, children: t(key === 'vision' ? 'capabilityVision' : 'capabilityReasoning') }), jsx(_deepseek_ai_dsh_client_ui_primitives.Switch, {
      'data-capability-batch': key, label: t(key === 'vision' ? 'capabilityVision' : 'capabilityReasoning'), checked: migrated.capabilityBatch?.[key] === true, disabled,
      onChange: enabled => { if (!disabled && typeof enabled === 'boolean') onChange(applyCapabilityBatch(entry, key, enabled)); }
    })]
  }, key)) });
}
const MULTI_KEY_PROTOCOLS = new Set(["openai-completions", "openai-responses", "anthropic-messages"]);
function orderedKeyEntries(entries) {
  const rank = entry => Number.isSafeInteger(entry?.sortOrder) && entry.sortOrder >= 0 ? entry.sortOrder : Infinity;
  return Object.entries(entries ?? {}).sort(([, left], [, right]) => {
    const a = rank(left), b = rank(right);
    return a === b ? 0 : a < b ? -1 : 1;
  });
}
const MULTI_KEY_ENTRY_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const MULTI_KEY_REF = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MULTI_KEY_UNSAFE_IDS = new Set(["__proto__", "prototype", "constructor"]);
function supportsMultiKeySchema(namespace, schema, path) {
	if (!namespace || !schema) return false;
	const root = schema.rehydrate(namespace.schema);
	const profile = schema.nodeAtPath(root, path);
	return profile?.dict?.multiKey !== void 0 && profile?.dict?.keyEntries !== void 0;
}
function multiKeyRef(route, id) {
	const normalized = route.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
	const stem = /^[A-Z_]/.test(normalized) ? normalized : `DSH_${normalized}`;
	return `${stem}_MULTKEY_${id.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`;
}
function newMultiKeyEntry(route, source = {}) {
	const id = `k${crypto.randomUUID()}`;
	return [id, {
		name: source.name ?? "",
		...(source.api === void 0 ? {} : { api: source.api }),
		...(typeof source.apiKeyEnv === "string" && source.apiKeyEnv.length > 0 ? { apiKeyEnv: source.apiKeyEnv } : {}),
		models: modelDrafts(source.models).map((model) => structuredClone(model))
	}];
}
function normalizedMultiKeyEntries(route, entries) {
	return Object.fromEntries(orderedKeyEntries(entries).map(([id, rawEntry]) => {
		const entry = materializeCapabilityEntry(rawEntry);
		const { api, ...rest } = entry;
		return [id, {
			...rest,
			...(api === void 0 || api === "" ? {} : { api }),
			name: typeof entry?.name === "string" ? entry.name.trim() : "",
			apiKeyEnv: typeof entry?.apiKeyEnv === "string" && entry.apiKeyEnv.length > 0 ? entry.apiKeyEnv : multiKeyRef(route, id),
			models: modelDrafts(entry?.models).map((model) => structuredClone(model))
		}];
	}));
}
function multiKeyFailure(route, entries, drafts, confirmations, t) {
	if (!entries || typeof entries !== "object" || Array.isArray(entries) || Object.keys(entries).length === 0) return t("multiKeyNeedsEntries");
	const refs = new Set();
	for (const [id, entry] of Object.entries(entries)) {
		if (!MULTI_KEY_ENTRY_ID.test(id) || MULTI_KEY_UNSAFE_IDS.has(id)) return t("multiKeyInvalidId");
		if (!entry || typeof entry.name !== "string" || entry.name.trim().length === 0 || entry.name.trim().length > 120) return t("multiKeyInvalidName");
		if (entry.api !== void 0 && !MULTI_KEY_PROTOCOLS.has(entry.api)) return t("multiKeyInvalidProtocol");
		const ref = entry.apiKeyEnv ?? multiKeyRef(route, id);
		if (typeof ref !== "string" || !MULTI_KEY_REF.test(ref)) return t("multiKeyInvalidRef");
		if (refs.has(ref)) return t("multiKeyDuplicateRef");
		refs.add(ref);
		const keyFailure = apiKeyFailure(drafts[id] ?? "");
		if (keyFailure !== void 0) return `${entry.name}: ${t(keyFailure)}`;
		if ((drafts[id] ?? "").trim().length > 0 && ref !== multiKeyRef(route, id) && confirmations[id] !== true) return `${entry.name}: ${t("multiKeyConfirmRequired")}`;
		if (!Array.isArray(entry.models) || entry.models.length === 0) return `${entry.name}: ${t("multiKeyNeedsModels")}`;
		const modelFailure = validateDeepSeekModels(entry.models) ?? validateReasoningEfforts(entry.models);
		if (modelFailure !== void 0) return `${entry.name}: ${t("model")} ${String(modelFailure.index + 1)}: ${t(modelFailure.key)}`;
	}
}
function MultiKeyToggle({ t, checked, disabled, onChange, hasUnsavedKeys = false }) {
	const [confirmOff, setConfirmOff] = (0, react.useState)(false);
	(0, react.useEffect)(() => {
		if (!checked || disabled) setConfirmOff(false);
	}, [checked, disabled]);
	const close = () => setConfirmOff(false);
	return (0, react_jsx_runtime.jsxs)("div", {
		"data-multi-key-toggle": true,
		className: ModelsSection_module_css_default["field"],
		children: [(0, react_jsx_runtime.jsxs)("div", {
			className: ModelsSection_module_css_default["modelReasoningHead"],
			children: [(0, react_jsx_runtime.jsx)("span", {
				className: ModelsSection_module_css_default["fieldLabel"], children: t("multiKey")
			}), (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Switch, {
				checked, label: t("multiKey"), disabled,
				onChange: (enabled) => {
					if (disabled || enabled === checked) return;
					if (!enabled) setConfirmOff(true);
					else onChange(true);
				}
			})]
		}), (0, react_jsx_runtime.jsx)("p", {
			className: ModelsSection_module_css_default["advancedHint"], children: t("multiKeyHelp")
		}), (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
			open: confirmOff && checked && !disabled, onClose: close,
			title: t(hasUnsavedKeys ? "multiKeyUnsavedTitle" : "multiKeyDisableTitle"),
			closeLabel: t("close"),
			description: t(hasUnsavedKeys ? "multiKeyUnsavedKeys" : "multiKeyDisableDescription"),
			className: ModelsSection_module_css_default["deleteDialog"],
			footer: (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "outline", "data-modal-autofocus": true, onClick: close,
					children: t(hasUnsavedKeys ? "multiKeyReturnToEdit" : "multiKeyKeepEnabled")
				}), hasUnsavedKeys ? null : (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "outline", disabled,
					onClick: () => {
						if (disabled || !checked || hasUnsavedKeys) return;
						close(); onChange(false);
					}, children: t("multiKeyDisableConfirm")
				})
			] })
		})]
	});
}
function multiKeyEntryDirty(entry, saved, draft) {
	return saved === void 0 || !sameEditorValue(materializeCapabilityEntry(entry), materializeCapabilityEntry(saved)) || (draft ?? "").length > 0;
}
function MultiKeyEntriesEditor(props) {
	const { route, entries, keyDrafts, confirmations, onChange, onKeyDraftsChange, onConfirmationsChange, operations, t, disabled } = props;
	const [busyEntries, setBusyEntries] = (0, react.useState)({});
	const [expandedEntries, setExpandedEntries] = (0, react.useState)({});
	const [removeTarget, setRemoveTarget] = (0, react.useState)(void 0);
    (0, react.useEffect)(() => { if (props.editorVisible === false) setRemoveTarget(void 0); }, [props.editorVisible]);
	const detailsPrefix = (0, react.useId)();
	const previousSave = (0, react.useRef)(props.saveState);
	(0, react.useEffect)(() => {
		const save = props.saveState;
		if (save === previousSave.current) return;
		previousSave.current = save;
		if (!save) return;
		setExpandedEntries((current) => {
			const next = { ...current };
			for (const id of Object.keys(save.entries)) {
				// Only collapse the exact snapshot acknowledged by this save.
				if (!save.ok || !multiKeyEntryDirty(entries[id], save.entries[id], keyDrafts[id])) next[id] = !save.ok;
			}
			return next;
		});
	}, [props.saveState, entries, keyDrafts]);
	const invalidRows = Object.keys(entries).filter((id) => multiKeyFailure(route, { [id]: entries[id] }, keyDrafts, confirmations, t) !== void 0);
	const invalidEntries = invalidRows.length > 0 ? invalidRows : multiKeyFailure(route, entries, keyDrafts, confirmations, t) !== void 0 ? Object.keys(entries) : [];
	const invalidSignature = JSON.stringify(invalidEntries);
	(0, react.useEffect)(() => {
		if (invalidEntries.length > 0) setExpandedEntries((current) => ({ ...current, ...Object.fromEntries(invalidEntries.map((id) => [id, true])) }));
	}, [invalidSignature]);
	const anyBusy = Object.values(busyEntries).some(Boolean);
	const savedEntryOrder = orderedKeyEntries(props.savedEntries ?? props.persistedEntries ?? {}).map(([id]) => id);
	const reorder = useSettingsReorder({ disabled: disabled || anyBusy, selector: "[data-key-entry-id]", move: (id, offset) => {
		const ordered = orderedKeyEntries(entries), from = ordered.findIndex(([key]) => key === id), to = from + offset;
		if (from < 0 || to < 0 || to >= ordered.length) return;
		const [moved] = ordered.splice(from, 1); ordered.splice(to, 0, moved);
		onChange(Object.fromEntries(ordered.map(([key, entry], sortOrder) => [key, { ...entry, sortOrder }])));
	} });
	(0, react.useEffect)(() => {
		if (disabled || anyBusy || removeTarget !== void 0 && !Object.hasOwn(entries, removeTarget)) setRemoveTarget(void 0);
	}, [disabled, anyBusy, removeTarget, entries]);
	const removeName = typeof entries[removeTarget]?.name === "string" && entries[removeTarget].name.trim() ? entries[removeTarget].name.trim() : t("multiKeyDefaultName");
	const { onBusyChange } = props;
	(0, react.useEffect)(() => {
		onBusyChange?.(anyBusy);
	}, [anyBusy, onBusyChange]);
	(0, react.useEffect)(() => () => onBusyChange?.(false), [onBusyChange]);
	const update = (id, patch) => onChange({ ...entries, [id]: { ...entries[id], ...patch } });
	const remove = (id) => {
		if (disabled || anyBusy || !Object.hasOwn(entries, id)) return;
		const { [id]: removed, ...remaining } = entries;
		onChange(remaining);
		onKeyDraftsChange((current) => { const { [id]: removed, ...rest } = current; return rest; });
		onConfirmationsChange((current) => { const { [id]: removed, ...rest } = current; return rest; });
		setBusyEntries((current) => { const { [id]: removed, ...rest } = current; return rest; });
	};
	return (0, react_jsx_runtime.jsxs)("div", {
		"data-multi-key-entries": true,
		className: ModelsSection_module_css_default["modelList"],
		children: [orderedKeyEntries(entries).map(([id, candidate], index) => {
			const entry = candidate && typeof candidate === "object" && !Array.isArray(candidate) ? candidate : {};
			const ref = entry.apiKeyEnv ?? multiKeyRef(route, id);
			const draft = Object.hasOwn(keyDrafts, id) ? keyDrafts[id] : "";
			const keyFailure = apiKeyFailure(draft);
			const persisted = Object.hasOwn(props.persistedEntries ?? {}, id) && props.persistedEntries[id]?.apiKeyEnv === ref;
			const info = props.credentialChecks?.[ref];
			const status = info?.configured === true ? "multiKeyConfigured" : info?.configured === false ? "multiKeyMissing" : persisted ? "multiKeySaved" : "multiKeyNew";
			const needsConfirmation = draft.trim().length > 0 && ref !== multiKeyRef(route, id);
			const canUseStored = persisted && props.probe.provider !== void 0;
			const probe = {
				...props.probe,
				keyEntryId: id,
				...(entry.api === void 0 ? {} : { api: entry.api }),
				...(draft.trim().length > 0 ? { apiKey: draft.trim() } : {})
			};
			const dirty = savedEntryOrder.indexOf(id) !== index || multiKeyEntryDirty(entry, props.savedEntries?.[id] ?? props.persistedEntries?.[id], draft);
			const expanded = expandedEntries[id] ?? !Object.hasOwn(props.persistedEntries ?? {}, id);
			const detailsId = detailsPrefix + "-" + id;
			const heading = typeof entry.name === "string" && entry.name.trim().length > 0 ? entry.name.trim() : `${t("multiKeyDefaultName")} ${String(index + 1)}`;
			return (0, react_jsx_runtime.jsxs)("div", {
				"data-key-entry-id": id, "data-key-entry-expanded": expanded, "data-key-entry-dirty": dirty, role: "group", "aria-label": heading,
				className: ModelsSection_module_css_default["rowCard"],
				style: { minWidth: 0 },
				children: [(0, react_jsx_runtime.jsxs)("div", {
					"data-key-entry-heading": true,
					className: ModelsSection_module_css_default["rowHead"], style: { flexWrap: "wrap" },
					children: [(0, react_jsx_runtime.jsx)("button", {
						type: "button", className: ModelsSection_module_css_default["iconButton"],
						"data-key-entry-handle": id, "aria-label": t("multiKeyReorder") + " " + heading,
						"aria-keyshortcuts": "ArrowUp ArrowDown", "aria-description": t("multiKeyReorderHelp"), title: t("multiKeyReorderHelp"),
						disabled: disabled || anyBusy, ...reorder(id),
						children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconDragHandleOutlineRegular, { size: 14 })
					}), (0, react_jsx_runtime.jsx)("span", {
						className: ModelsSection_module_css_default["rowName"],
						style: { minWidth: 0, overflowWrap: "anywhere", flex: "1 1 120px" }, children: heading
					}), (0, react_jsx_runtime.jsxs)("div", {
						className: ModelsSection_module_css_default["rowActions"],
						children: [dirty ? (0, react_jsx_runtime.jsx)("span", { className: ModelsSection_module_css_default["rowTag"], "data-key-entry-unsaved": true, children: t("multiKeyUnsaved") }) : null,
						(0, react_jsx_runtime.jsx)("button", {
							type: "button", className: ModelsSection_module_css_default["secondaryButton"],
							"aria-expanded": expanded, "aria-controls": detailsId,
							onClick: () => setExpandedEntries((current) => ({ ...current, [id]: !expanded })),
							children: t(expanded ? "multiKeyCollapse" : "multiKeyExpand")
						})]
					})]
				}),
					(0, react_jsx_runtime.jsxs)("div", {
						className: ModelsSection_module_css_default["field"],
						children: [(0, react_jsx_runtime.jsx)("span", { className: ModelsSection_module_css_default["fieldLabel"], children: t("keyInput") }),
							(0, react_jsx_runtime.jsx)(ApiKeyInput, {
								t, inputRef: props.keyInputRef?.(id), value: draft, placeholder: t(persisted ? "keyPlaceholderSaved" : "keyPlaceholder"),
								"aria-label": `${t("keyInput")} ${String(index + 1)}`, "aria-invalid": keyFailure !== void 0,
								disabled: props.keyDisabled ?? disabled,
								onChange: (event) => {
									const value = event.target.value;
									onKeyDraftsChange((current) => ({ ...current, [id]: value }));
									onConfirmationsChange((current) => ({ ...current, [id]: false }));
								}
							}),
							(0, react_jsx_runtime.jsx)("p", { className: ModelsSection_module_css_default["advancedHint"], children: t(status) }),
							(0, react_jsx_runtime.jsx)("p", { className: ModelsSection_module_css_default["advancedHint"], style: { overflowWrap: "anywhere" }, children: t("multiKeyRef").replace("{ref}", () => ref) }),
							keyFailure === void 0 ? null : (0, react_jsx_runtime.jsx)("p", { className: ModelsSection_module_css_default["error"], children: t(keyFailure) })]
					}),
					needsConfirmation ? (0, react_jsx_runtime.jsxs)("label", {
						className: ModelsSection_module_css_default["fieldLabel"],
						style: { display: "flex", alignItems: "flex-start", gap: 8, overflowWrap: "anywhere" },
						children: [(0, react_jsx_runtime.jsx)("input", {
							type: "checkbox", "data-confirm-entry": id, "aria-label": t("multiKeyReplaceConfirm").replace("{ref}", () => ref),
							checked: confirmations[id] === true, disabled: props.keyDisabled ?? disabled,
							onChange: (event) => onConfirmationsChange((current) => ({ ...current, [id]: event.target.checked }))
						}), (0, react_jsx_runtime.jsx)("span", { children: t("multiKeyReplaceConfirm").replace("{ref}", () => ref) })]
					}) : null,
				(0, react_jsx_runtime.jsxs)("div", {
					id: detailsId, "data-key-entry-details": true, hidden: !expanded,
					style: { display: expanded ? "flex" : "none", flexDirection: "column", gap: 12, minWidth: 0, borderTop: "0.5px solid var(--dsw-alias-settings-card-stroke)", paddingTop: 12 },
					children: [(0, react_jsx_runtime.jsxs)("div", {
						"data-key-entry-fields": true, style: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", gap: 12, minWidth: 0 }, children: [
					(0, react_jsx_runtime.jsxs)("label", {
						className: ModelsSection_module_css_default["field"],
						children: [(0, react_jsx_runtime.jsx)("span", { className: ModelsSection_module_css_default["fieldLabel"], children: t("multiKeyEntryName") }),
							(0, react_jsx_runtime.jsx)("input", {
								className: ModelsSection_module_css_default["input"], type: "text", value: entry.name ?? "", maxLength: 120,
								"aria-label": `${t("multiKeyEntryName")} ${String(index + 1)}`, disabled,
								onChange: (event) => update(id, { name: event.target.value })
							})]
					}),
					(0, react_jsx_runtime.jsxs)("label", {
						className: ModelsSection_module_css_default["field"],
						children: [(0, react_jsx_runtime.jsx)("span", { className: ModelsSection_module_css_default["fieldLabel"], children: t("multiKeyProtocol") }),
						(0, react_jsx_runtime.jsxs)("select", {
							"data-key-entry-protocol": id, "aria-label": t("multiKeyProtocol") + " " + heading,
							className: ModelsSection_module_css_default["input"] + " " + ModelsSection_module_css_default["selectInput"],
							style: { maxWidth: "none" }, value: entry.api ?? "", disabled: disabled || anyBusy,
							onChange: (event) => {
								const value = event.target.value;
								if (disabled || anyBusy || value !== "" && !MULTI_KEY_PROTOCOLS.has(value)) return;
								const { api, ...inherited } = entries[id];
								onChange({ ...entries, [id]: value === "" ? inherited : { ...inherited, api: value } });
							},
							children: [(0, react_jsx_runtime.jsx)("option", { value: "", children: t("multiKeyProtocolInherit").replace("{protocol}", () => props.probe.api ? protocolLabel(t, props.probe.api) : t("multiKeyProtocolDefault")) }),
							...(props.protocols ?? [...MULTI_KEY_PROTOCOLS]).map((choice) => (0, react_jsx_runtime.jsx)("option", { value: choice, children: protocolLabel(t, choice) }, choice))]
						}), (0, react_jsx_runtime.jsx)("span", { className: ModelsSection_module_css_default["advancedHint"], children: t("multiKeyProtocolHelp") })]
					})]
					}),
					(0, react_jsx_runtime.jsx)(GroupCapabilityBatch, { entry, t, disabled: disabled || anyBusy, onChange: (next) => { if (!disabled && !anyBusy) onChange({ ...entries, [id]: next }); } }), (0, react_jsx_runtime.jsx)(ModelListEditor, {
                        editorVisible: props.editorVisible,
						models: modelDrafts(materializeCapabilityEntry(entry).models), onChange: (models) => { if (!disabled && !anyBusy) onChange({ ...entries, [id]: mergeCapabilityModels(entry, models) }); },
						reasoningLevels: props.reasoningLevels, probe,
						probeBlocked: keyFailure ?? props.probeBlocked ?? (!canUseStored && draft.trim().length === 0 ? "multiKeyProbeNeedsKey" : void 0),
						operations, t, disabled,
						onBusyChange: (value) => setBusyEntries((current) => current[id] === value ? current : { ...current, [id]: value })
					}),
					(0, react_jsx_runtime.jsxs)("div", {
						"data-key-entry-danger-zone": true,
						style: { display: "flex", flexDirection: "column", gap: 6, borderTop: "0.5px solid var(--dsw-alias-settings-card-stroke)", paddingTop: 12 },
						children: [(0, react_jsx_runtime.jsx)("p", { className: ModelsSection_module_css_default["advancedHint"], children: t("multiKeyRemoveHelp") }),
						(0, react_jsx_runtime.jsx)("button", {
							type: "button", "data-key-entry-remove": id,
							className: ModelsSection_module_css_default["dangerButton"], style: { alignSelf: "flex-start" }, disabled: disabled || anyBusy,
							onClick: () => { if (!disabled && !anyBusy) setRemoveTarget(id); }, children: t("multiKeyRemoveGroup")
						})]
					})]
				})]
			}, id);
		}), (0, react_jsx_runtime.jsx)("button", {
			type: "button", className: ModelsSection_module_css_default["addModelButton"], disabled,
			onClick: () => {
				let id, entry;
				do { [id, entry] = newMultiKeyEntry(route, { name: `${t("multiKeyDefaultName")} ${String(Object.keys(entries).length + 1)}` }); } while (Object.hasOwn(entries, id) || Object.values(entries).some((other) => other.apiKeyEnv === multiKeyRef(route, id)));
				onChange({ ...entries, [id]: entry });
			}, children: t("multiKeyAdd")
		}), (0, react_jsx_runtime.jsx)("p", { className: ModelsSection_module_css_default["advancedHint"], children: t("multiKeyKeepCredentials") }),
		(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
			open: removeTarget !== void 0 && Object.hasOwn(entries, removeTarget) && !disabled && !anyBusy,
			"data-key-entry-remove-dialog": true, onClose: () => setRemoveTarget(void 0),
			title: t("multiKeyRemoveTitle").replace("{name}", () => removeName), closeLabel: t("close"),
			description: t("multiKeyRemoveDescription"), className: ModelsSection_module_css_default["deleteDialog"],
			footer: (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, { variant: "outline", "data-modal-autofocus": true, onClick: () => setRemoveTarget(void 0), children: t("cancel") }),
				(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "outline", className: ModelsSection_module_css_default["deleteConfirm"], disabled: disabled || anyBusy,
					onClick: () => { if (removeTarget === void 0 || disabled || anyBusy) return; remove(removeTarget); setRemoveTarget(void 0); }, children: t("multiKeyRemoveGroup")
				})]
			})
		})]
	});
}
return { MultiKeyEntriesEditor, MultiKeyToggle, ModelListEditor, ApiKeyInput, apiKeyFailure, validateDeepSeekModels, validateReasoningEfforts, normalizedMultiKeyEntries, multiKeyFailure, multiKeyRef };
}
