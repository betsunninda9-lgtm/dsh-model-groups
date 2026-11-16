import os from 'node:os';
import path from 'node:path';
import { autoPatch, findDshRoot, startupActivity } from './auto-patch.js';
import { createMaintenance, createUnavailableMaintenance, maintenanceHandler, patchStatus } from './maintenance.js';
import { createHostInspection } from './maintenance-host.js';
import { readPatchPreferences } from './patch-preferences.js';

// Neither disposal nor ordinary package removal restores patches: HMR and updates
// also dispose plugins. Only the explicitly confirmed maintenance transaction does.
export function recoverOnStartup(ctx, root, home, options = {}) {
  try {
    const result = autoPatch(root, home, { activity: () => startupActivity(ctx, root), ...options });
    if (result.state === 'restart-required') ctx.logger.info('多密钥补丁已自动恢复。请重启原 DSH 引擎并刷新网页。');
    else if (result.state === 'deferred') ctx.logger.warn('当前仍有任务或其他引擎，已暂缓自动恢复多密钥，将在空闲时重试。');
    return result;
  } catch {
    ctx.logger.error('多密钥自动恢复未完成，请打开「设置 → 模型分组」查看兼容性详情。');
    return { state: 'failed', changed: 0, runtimeVerified: false };
  }
}

// Cordis timers are disposed with the plugin. Stop as soon as restoration is
// complete, explicitly disabled, or failed; GET status requests never perform writes.
export function retryDeferredRecovery(ctx, recover, onResult) {
  const interval = ctx.interval ?? ctx.setInterval;
  if (typeof interval !== 'function') return () => {};
  let disposed = false, cancel;
  const stop = () => { if (disposed) return; disposed = true; cancel?.(); };
  cancel = interval.call(ctx, () => {
    if (disposed) return;
    const result = recover();
    if (!result) return;
    onResult(result);
    if (result.state !== 'deferred') stop();
  }, 5000);
  ctx.on?.('dispose', stop);
  return stop;
}

export function apply(ctx) {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  let root, recovery;
  try {
    root = findDshRoot();
    recovery = recoverOnStartup(ctx, root, home);
    if (recovery.state === 'deferred') retryDeferredRecovery(ctx, () => {
      const preferences = readPatchPreferences(root, home);
      if (!preferences.enabled || !preferences.autoMaintenance) return { state: 'manual-maintenance', changed: 0, runtimeVerified: false };
      if (startupActivity(ctx, root)) return null;
      return recoverOnStartup(ctx, root, home);
    }, result => { recovery = result; });
  } catch {
    ctx.logger.error('无法定位当前 DSH 安装，请查看模型分组维护页。');
  }
  ctx.inject(['webServer', 'connection', 'pluginManager'], child => {
    const controller = root ? createMaintenance({ root, home, inspect: createHostInspection(child, root, home), manager: child.pluginManager }) : createUnavailableMaintenance();
    child.effect(() => child.webServer.register({ kind: 'exact', path: '/dsh-model-groups/maintenance', handler: maintenanceHandler(controller, child.connection) }));
    child.effect(() => child.webServer.register({ kind: 'exact', path: '/dsh-model-groups/status', handler(req, res) {
      const admission = child.connection.admit(req);
      if (!admission?.peer || admission.peer.principal?.kind !== 'owner') { res.writeHead(admission?.rejection || 403); res.end(); return; }
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      let status;
      try { status = root ? patchStatus(root, home) : { restartRequired: false, failed: true, state: 'unavailable' }; }
      catch { status = { restartRequired: false, failed: true, state: 'unavailable' }; }
      if (status.state === 'needs-repair' && recovery?.state === 'deferred') status.state = 'deferred';
      res.end(JSON.stringify(status));
    } }));
  });
}
