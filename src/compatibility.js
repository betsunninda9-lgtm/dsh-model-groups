// Public program metadata only. Never include paths, source text, configuration,
// credentials, environment variables, or arbitrary exception messages.
export const PATCH_IDS = ['pi-ai.patch.json', 'settings-models.patch.json', 'llm-typert.host.patch.json', 'llm-typert.remote-client.patch.json', 'api-remotes.patch.json'];
export const COMPATIBILITY_CODES = ['ready', 'update_available', 'not_applied', 'unsupported_patch_build', 'host_version', 'package_version', 'unrecognized_content', 'target_unavailable', 'patch_manifest'];
export const publicVersion = value => typeof value === 'string' && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]{1,40})?$/.test(value) ? value : null;
export const publicHash = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value) ? value : null;
export function compatibilitySnapshot(value) {
  if (!value || value.schema !== 1 || !Array.isArray(value.files) || value.files.length > PATCH_IDS.length) return null;
  return { schema: 1, pluginVersion: publicVersion(value.pluginVersion), hostVersion: publicVersion(value.hostVersion), supportedDsh: publicVersion(value.supportedDsh),
    files: value.files.filter(item => item && PATCH_IDS.includes(item.id)).map(item => ({ id: item.id,
      state: ['patched', 'pristine', 'conflict'].includes(item.state) ? item.state : 'conflict',
      code: COMPATIBILITY_CODES.includes(item.code) ? item.code : 'patch_manifest',
      installedVersion: publicVersion(item.installedVersion), observedSha256: publicHash(item.observedSha256),
      baseSha256: publicHash(item.baseSha256), targetSha256: publicHash(item.targetSha256) })) };
}
export function patchStatusMessage(status) {
  if (status?.restartRequired) return '多密钥程序文件已更新。请保存草稿，重启 DSH 引擎并刷新网页后使用。';
  if (status?.state === 'disabled' || status?.state === 'ready') return '';
  if (status?.state === 'deferred') {
    if (status.reason === 'other-engine') return '发现另一个使用同一安装目录的 DSH 引擎，退出该引擎后自动重试。';
    if (status.reason === 'activity-unverified') return '无法确认任务或进程状态，自动恢复暂缓；请在「设置 → 模型分组」查看详情。';
    return '正在等待运行中的任务结束，之后自动恢复多密钥补丁。';
  }
  if (status?.state === 'conflict') return '当前宿主的相关代码无法自动适配。请打开「设置 → 模型分组」查看详情。';
  if (status?.state === 'needs-repair') return '多密钥程序需要恢复。请打开「设置 → 模型分组」修复。';
  if (status?.failed) return '暂时无法检查多密钥状态，请在「设置 → 模型分组」重试。';
  return '';
}
export function compatibilityGuidance(snapshot) {
  const codes = snapshot?.files.map(item => item.code) ?? [];
  if (codes.includes('host_version') || codes.includes('package_version')) return '宿主程序版本不在本版支持范围。先核对插件与 DSH 的兼容版本；不要强行降级、覆盖文件或删除配置。';
  if (codes.includes('unrecognized_content') || codes.includes('target_unavailable') || codes.includes('patch_manifest') || codes.includes('unsupported_patch_build')) return '已停止整批更新，未覆盖未知文件。先在原 profile 更新最新版插件，重启原引擎并刷新网页后复查；仍不支持时，复制脱敏诊断反馈。不要先卸载、还原补丁或删除配置；如需进一步适配，只提供被标记的程序文件，不提供密钥、配置或聊天记录。';
  if (codes.includes('update_available')) return '已识别历史补丁，可直接更新到最新版，不需要逐版安装或先关闭多密钥。请保存草稿、停止任务，确认更新后重启原引擎并刷新网页。';
  return '';
}
