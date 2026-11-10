import os from 'node:os';
import path from 'node:path';
import { findDshRoot } from './auto-patch.js';
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
    state.error = null;
    state.restartRequired = false;
    ctx.logger.info('多密钥补丁由设置页手动管理；插件启动不会修改宿主文件。');
  } catch {
    state.error = 'patch-validation-failed';
    ctx.logger.error('多密钥安装校验失败，未强制覆盖未知文件。请查看维护页。');
  }
  ctx.inject(['webServer', 'connection', 'pluginManager'], child => {
    const inspect = root ? createHostInspection(child, root, home) : async () => ({ blockers: [{ code: 'HOST_UNKNOWN', message: '无法验证当前宿主安装，禁止恢复。' }], fingerprint: '' });
    const controller = root ? createMaintenance({ root, home, inspect, manager: child.pluginManager }) : {
      snapshot: async () => ({ phase: 'failed', restartRequired: false, patches: [], blockers: (await inspect()).blockers, canRestore: false, canRestoreOnly: false, canApply: false, token: null }),
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
