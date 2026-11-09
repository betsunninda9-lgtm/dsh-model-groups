import { findDshRoot, autoPatch } from './auto-patch.js';

// Explicit patch distribution: installation/loading validates and updates the
// known DSH disk files. It never forces module reload, restart or config changes.
export function apply(ctx) {
  const key = Symbol.for('dsh-model-groups.patch-state');
  const state = globalThis[key] ??= { restartRequired: false, error: null };
  ctx.inject(['webserver'], child => {
    child.effect(() => child.webserver.register({
      kind: 'exact', path: '/dsh-model-groups/status',
      handler(req, res) {
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ restartRequired: state.restartRequired, failed: state.error !== null }));
      },
    }));
  });
  try {
    const result = autoPatch(findDshRoot());
    if (result.state === 'restart-required') {
      state.restartRequired = true;
      ctx.logger.warn(`多密钥兼容补丁已自动安装（${result.changed} 项）。请保存草稿，在 App 重启原引擎并刷新原网页；当前进程尚未验证生效。`);
    } else {
      ctx.logger.info('多密钥磁盘补丁已就绪。若本次进程尚未在打补丁后重启，请重启原引擎并刷新网页。');
    }
  } catch (error) {
    state.error = error.message;
    ctx.logger.error(`多密钥自动安装未完成：${error.message}。未强制覆盖未知文件，请运行安装诊断；不要把模型分组出现视为多密钥已就绪。`);
  }
}
