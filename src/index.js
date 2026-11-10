import os from 'node:os';
import path from 'node:path';
import { findDshRoot, autoPatch } from './auto-patch.js';
import { createMaintenance, maintenanceHandler } from './maintenance.js';
import { createHostInspection } from './maintenance-host.js';

// Neither disposal nor ordinary package removal restores patches: HMR and updates
// also dispose plugins. Only the explicitly confirmed maintenance transaction does.
export function apply(ctx) {
  const key = Symbol.for('dsh-model-groups.patch-state');
  const state = globalThis[key] ??= { restartRequired: false, error: null };
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  let root;
  try {
    root = findDshRoot();
    const result = autoPatch(root, home);
    state.error = null;
    if (result.state === 'restore-pending') {
      state.restartRequired = true;
      ctx.logger.warn('已记录恢复原版意图，已禁止自动打补丁。请在维护页完成卸载并重启。');
    } else if (result.state === 'restart-required') {
      state.restartRequired = true;
      ctx.logger.warn(`兼容补丁已安装（${result.changed} 项）；请重启原引擎并刷新网页。`);
    } else ctx.logger.info('磁盘补丁已就绪；当前进程是否已重新加载仍需重启确认。');
  } catch {
    state.error = 'patch-validation-failed';
    ctx.logger.error('多密钥安装校验失败，未强制覆盖未知文件。请查看维护页。');
  }
  ctx.inject(['webServer', 'connection', 'pluginManager'], child => {
    const inspect = root ? createHostInspection(child, root, home) : async () => ({ blockers: [{ code: 'HOST_UNKNOWN', message: '无法验证当前宿主安装，禁止恢复。' }], fingerprint: '' });
    const controller = root ? createMaintenance({ root, home, inspect, manager: child.pluginManager }) : {
      snapshot: async () => ({ phase: 'failed', restartRequired: false, patches: [], blockers: (await inspect()).blockers, canRestore: false }),
      restore: async () => { throw { code: 'HOST_UNKNOWN', message: '无法验证当前宿主安装。' }; },
    };
    child.effect(() => child.webServer.register({ kind: 'exact', path: '/dsh-model-groups/maintenance', handler: maintenanceHandler(controller, child.connection) }));
    child.effect(() => child.webServer.register({ kind: 'exact', path: '/dsh-model-groups/status', handler(req, res) {
      const admission = child.connection.admit(req);
      if (!admission?.peer || admission.peer.principal?.kind !== 'owner') { res.writeHead(admission?.rejection || 403); res.end(); return; }
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ restartRequired: state.restartRequired, failed: state.error !== null }));
    } }));
  });
}
