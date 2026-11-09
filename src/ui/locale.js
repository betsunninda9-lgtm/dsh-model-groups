import React from 'react';
// Stable phrase keys are private to this plugin's namespace.
export const zh = {
 'Model groups':'模型分组', 'Models':'模型', 'Close':'关闭',
 'Search suppliers, configurations, and models':'搜索供应商、配置和模型',
 'Inline groups':'内联折叠', 'Separate panel':'独立面板', 'Refresh':'刷新',
 'No model selected':'尚未选择模型', 'Loading models…':'正在加载模型…',
 'No matching models.':'没有匹配的模型。', 'No models available.':'暂无可用模型。',
 'Configuration models':'配置中的模型', 'Choose a configuration above or alongside this panel.':'请从上方或旁边选择一个配置。',
 'Reasoning effort':'推理强度', 'Provider default':'供应商默认',
 'Model changes are locked for this session.':'当前会话已锁定模型选择。',
 'Model selection is unavailable for addressed subagents.':'不能更改被寻址子代理的模型。',
 'The saved selection is unavailable. It has not been replaced.':'已保存的模型当前不可用，原选择仍然保留。',
 'Selection failed. Your previous selection is retained.':'选择失败，已保留原模型。',
 'Selection failed. Retry when the session is available.':'选择失败，请在会话可用时重试。',
 'Suppliers share an endpoint and protocol. Each configuration has its own stable route, model list, and write-only API key.':'同一供应商共享接口地址与协议；每个配置有独立的固定路由、模型列表和只写 API 密钥。',
 'Loading configuration…':'正在加载配置…', 'The model-groups host namespace is unavailable.':'主机尚未提供模型分组配置。',
 'This configuration is read-only.':'此配置为只读。', 'Add supplier':'添加供应商', 'Saving…':'正在保存…',
 'Save changes':'保存修改', 'Reload / discard draft':'重新加载 / 放弃草稿',
 'Supplier name':'供应商名称', 'Shared endpoint':'共享接口地址', 'Shared protocol':'共享协议',
 'Configuration name':'配置名称', 'Model IDs (one per line)':'模型 ID（每行一个）',
 'Replace API key (write-only)':'替换 API 密钥（只写）', 'Save key':'保存密钥', 'Saving key…':'正在保存密钥…',
 'Remove saved key':'删除已保存的密钥', 'Remove this configuration’s saved key?':'删除此配置已保存的密钥？',
 'Confirm key removal':'确认删除密钥', 'Cancel':'取消', 'Key status unavailable':'密钥状态暂不可用',
 'Key configured':'已配置密钥', 'No key configured':'未配置密钥',
 'Key writes are unavailable until the host provides the secure operation.':'主机提供安全写入接口后才能保存密钥。',
 'Save configuration changes before changing keys.':'请先保存配置修改，再更改密钥。',
 'Delete configuration':'删除配置', 'Add configuration':'添加配置', 'Delete supplier':'删除供应商',
 'Confirm deletion':'确认删除',
 'Delete this configuration or supplier? Its stable routes will be retired when you save. Saved session selections will not be silently changed.':'确定删除此配置或供应商？保存后其路由将停用，已有会话的选择不会被自动更改。请先删除不再需要的密钥。',
 'Anthropic: use the API origin; the SDK appends /v1/messages.':'Anthropic：填写 API 根地址，SDK 会追加 /v1/messages。',
 'OpenAI: usually include /v1; the SDK appends /chat/completions or /responses.':'OpenAI：通常应包含 /v1，SDK 会追加 /chat/completions 或 /responses。',
 'Changes saved.':'修改已保存。', 'Draft discarded.':'草稿已放弃。',
 'Key saved. Existing keys cannot be displayed.':'密钥已保存。已有密钥不可回显。', 'Key removed.':'密钥已删除。',
 'Key could not be removed.':'无法删除密钥。', 'Key removal failed. Retry when connected.':'密钥删除失败，请在连接恢复后重试。',
 'Key was not accepted. Enter it again to retry.':'密钥未被接受，请重新输入后重试。',
 'Key write failed. Enter it again to retry.':'密钥写入失败，请重新输入后重试。',
 'The host configuration changed while you were editing. Your draft remains here; reload to discard it and read the latest revision.':'编辑期间主机配置已变更。草稿仍保留；重新加载将放弃草稿并读取最新版本。',
 'Changes were refused or the configuration changed elsewhere. Your draft is retained. Reload the latest configuration before editing again.':'修改被拒绝或配置已在别处变更。草稿已保留，请重新加载最新配置后再编辑。',
 'Save failed. Your draft is retained. Retry or reload the latest configuration.':'保存失败，草稿已保留。请重试或重新加载最新配置。'
};
export const en = Object.fromEntries(Object.keys(zh).map(key => [key, key]));
export const phraseKeys = Object.fromEntries(Object.keys(en).map((phrase, index) => [phrase, `p${index}`]));
export const dictionaries = Object.fromEntries(Object.entries({ zh, en }).map(([language, phrases]) => [language, Object.fromEntries(Object.entries(phrases).map(([phrase, value]) => [phraseKeys[phrase], value]))]));
export const phraseTranslator = translate => phrase => Object.hasOwn(phraseKeys, phrase) ? translate(phraseKeys[phrase]) : phrase;
export const identity = x => x;
export function translateTree(node, t = identity) {
 if (typeof node === 'string') return Object.hasOwn(en, node) ? t(node) : node;
 if (Array.isArray(node)) return node.map(child => translateTree(child, t));
 if (React.isValidElement(node) && typeof node.type === 'string' && node.type !== 'style') {
   const children = translateTree(node.props.children, t);
   return Array.isArray(children) ? React.cloneElement(node, {}, ...children) : React.cloneElement(node, {}, children);
 }
 return node;
}
