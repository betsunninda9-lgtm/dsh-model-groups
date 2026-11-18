// Public program metadata only. Never include paths, source text, configuration,
// credentials, environment variables, or arbitrary exception messages.
export const PATCH_IDS = ['pi-ai.patch.json', 'settings-models.patch.json', 'llm-typert.host.patch.json', 'llm-typert.remote-client.patch.json', 'api-remotes.patch.json'];
export const COMPATIBILITY_CODES = ['ready', 'update_available', 'not_applied', 'unsupported_patch_build', 'host_identity', 'package_identity', 'host_version', 'package_version', 'unrecognized_content', 'target_unavailable', 'patch_manifest'];
// Versions are bounded diagnostic data, including prerelease and build labels;
// they never decide whether a program transformation is compatible.
export const publicVersion = value => typeof value === 'string' && value.length <= 128 && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(value) ? value : null;
export const publicHash = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value) ? value : null;
export function compatibilitySnapshot(value) {
  if (!value || value.schema !== 1 || !Array.isArray(value.files) || value.files.length > PATCH_IDS.length) return null;
  return { schema: 1, pluginVersion: publicVersion(value.pluginVersion), hostVersion: publicVersion(value.hostVersion), supportedDsh: publicVersion(value.supportedDsh),
    compatibilityPolicy: value.compatibilityPolicy === 'code' ? 'code' : null,
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
  if (codes.includes('host_identity') || codes.includes('package_identity')) return '目标宿主或程序包身份不匹配，已停止多密钥维护。请核对当前 DSH 安装；不会用其他构建的程序覆盖。';
  if (codes.includes('host_version') || codes.includes('package_version')) return '这是旧版插件按版本号拒绝的诊断。当前版本按实际代码判断兼容；请更新原 profile 中的插件并重新检查，无需降级 DSH 或删除配置。';
  if (codes.includes('unrecognized_content') || codes.includes('target_unavailable') || codes.includes('patch_manifest') || codes.includes('unsupported_patch_build')) return '所需关键代码、目标文件或补丁配方无法完整匹配，已停止多密钥维护；版本号不同本身不会触发拒绝。分组与折叠可继续使用。请保留配置并复制脱敏诊断反馈，不要先卸载、还原补丁或删除密钥、配置。';
  if (codes.includes('update_available')) return '已识别旧补丁，可直接更新，不需要逐版安装或先关闭多密钥。更新后按提示重启原引擎并刷新网页。';
  return '';
}
