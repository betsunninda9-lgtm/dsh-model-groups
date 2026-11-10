import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { planPatches, applyPlan, sha256 } from '../scripts/native-patches.mjs';

export const BUNDLE_NAME = 'dsh-model-groups';
export function maintenanceStorage(root, home) {
  return path.join(home, BUNDLE_NAME, sha256(fs.realpathSync(root)).slice(0, 16));
}
export function restorationPending(root, home) {
  return fs.existsSync(path.join(maintenanceStorage(root, home), 'restore-pending.json'));
}

/** Local-only transaction. Inspection and removal are injected to keep tests off the live host. */
export function createMaintenance({ root, home, inspect, manager, artifacts, now = Date.now }) {
  let phase = 'idle', restartRequired = false, busy = false, ticket;
  const storage = maintenanceStorage(root, home);
  const marker = path.join(storage, 'restore-pending.json');
  if (fs.existsSync(marker)) { phase = 'restored'; restartRequired = true; }
  const patchPlans = () => planPatches(root, 'revert', artifacts);
  const generic = (code, message) => ({ code, message });
  async function assessment() {
    const blockers = [];
    let plans = [], fingerprint = '';
    try { plans = patchPlans(); }
    catch { blockers.push(generic('PATCH_CONFLICT', '宿主版本或文件校验不匹配；未修改任何宿主文件，请先处理冲突。')); }
    try {
      const report = await inspect();
      if (!report || !Array.isArray(report.blockers) || typeof report.fingerprint !== 'string') throw new Error('inspection');
      blockers.push(...report.blockers);
      fingerprint = report.fingerprint;
    } catch { blockers.push(generic('INSPECTION_FAILED', '无法完整检查配置和会话，已禁止恢复。')); }
    try {
      const bundles = await manager.listBundles();
      const bundle = bundles.find(item => item.name === BUNDLE_NAME);
      if (!bundle?.removable) blockers.push(generic('NOT_REMOVABLE', '当前插件不属于可卸载的 profile 依赖，请使用安装它的原 profile 管理器。'));
    } catch { blockers.push(generic('MANAGER_UNAVAILABLE', '插件管理器不可用，无法安全卸载。')); }
    return { plans, blockers, stamp: sha256(JSON.stringify([fingerprint, plans.map(p => [p.name, sha256(p.source)])])) };
  }
  function view(report) {
    return { phase, restartRequired, patches: report.plans.map(p => ({ name: p.name, state: p.state })), blockers: report.blockers,
      token: null, canRestore: !busy && phase !== 'removed' && report.blockers.length === 0,
      notice: '只还原本插件已知补丁并卸载本插件。密钥、会话历史及安全备份保留；完成后须重启原引擎并刷新页面。失败时保留恢复标记，防止自动重新打补丁。' };
  }
  async function snapshot() {
    const report = await assessment();
    const value = view(report);
    if (value.canRestore) {
      ticket = { token: crypto.randomBytes(32).toString('hex'), stamp: report.stamp, expires: now() + 120000 };
      value.token = ticket.token;
    }
    return value;
  }
  async function restore(input) {
    if (busy) throw generic('BUSY', '已有维护任务正在执行。');
    if (input?.action !== 'restore-and-uninstall' || input?.confirmation !== 'RESTORE AND UNINSTALL' ||
      !ticket || typeof input.token !== 'string' || input.token !== ticket.token || ticket.expires < now()) {
      throw generic('CONFIRMATION_REQUIRED', '确认已失效，请重新检查并明确确认。');
    }
    const expected = ticket; ticket = undefined; busy = true;
    let locked = false;
    const lock = path.join(storage, 'patch.lock');
    try {
      fs.mkdirSync(storage, { recursive: true, mode: 0o700 });
      // Same inter-process lock as automatic installation. Never remove somebody else's lock.
      fs.mkdirSync(lock, { mode: 0o700 }); locked = true;
      const report = await assessment();
      if (report.blockers.length || report.stamp !== expected.stamp) throw generic('STATE_CHANGED', '检查结果发生变化或仍有依赖，请重新检查后处理。');
      fs.writeFileSync(marker, JSON.stringify({ version: 1, purpose: 'explicit-restore-and-uninstall' }), { mode: 0o600 });
      // Fresh synchronous planning checks concurrent target edits again; applyPlan performs an additional check.
      applyPlan(patchPlans(), path.join(storage, 'backups'));
      if (!patchPlans().every(p => p.state === 'pristine')) throw generic('VERIFY_FAILED', '原版文件复查失败，未宣告卸载成功。');
      phase = 'restored'; restartRequired = true;
      phase = 'removing';
      const result = await manager.removeBundle(BUNDLE_NAME);
      if (!result || result.application !== 'applied' || result.error || (result.packageResult && (result.packageResult.exitCode !== 0 || result.packageResult.timedOut))) throw generic('REMOVE_FAILED', '补丁已还原，但插件卸载失败。请保留恢复标记并在插件列表中重试卸载，然后重启。');
      const remaining = (await manager.listBundles()).find(item => item.name === BUNDLE_NAME);
      if (remaining?.installed || remaining?.removable || remaining?.enabled) throw generic('REMOVE_UNVERIFIED', '尚未确认插件依赖已移除，请检查插件列表；补丁不会自动重新安装。');
      if (!patchPlans().every(p => p.state === 'pristine')) throw generic('VERIFY_FAILED', '卸载后宿主文件再次变化，不能确认完整恢复。');
      phase = 'removed';
      return { phase, restartRequired: true, patches: patchPlans().map(p => ({ name: p.name, state: p.state })), blockers: [], canRestore: false, token: null,
        notice: '已还原原版文件并确认插件依赖移除。请重启原引擎并刷新。密钥、历史和安全备份未删除；其他浏览器的本插件显示偏好可自行清除。' };
    } catch (error) {
      phase = 'failed';
      throw ['STATE_CHANGED', 'VERIFY_FAILED', 'REMOVE_FAILED', 'REMOVE_UNVERIFIED'].includes(error?.code) ? error : generic('MAINTENANCE_FAILED', '维护未完成。未宣告成功；如已还原文件，恢复标记会阻止自动重新打补丁。请检查后重试。');
    } finally {
      busy = false;
      if (locked) fs.rmdirSync(lock);
    }
  }
  return { snapshot, restore, isBusy: () => busy };
}

/** Every request requires the host's authenticated owner admission, even on stock DSH. */
export function maintenanceHandler(controller, connection) {
  return async (req, res) => {
    const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(JSON.stringify(body)); };
    try {
      const admission = connection.admit(req);
      if (!admission?.peer || admission.peer.principal?.kind !== 'owner') return send(admission?.rejection || 403, { ok: false, error: { code: 'FORBIDDEN', message: '需要已登录的主机所有者。' } });
      if (req.method === 'GET') return send(200, { ok: true, value: await controller.snapshot() });
      if (req.method !== 'POST') return send(405, { ok: false, error: { code: 'METHOD', message: '不支持此操作。' } });
      if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) return send(415, { ok: false, error: { code: 'CONTENT_TYPE', message: '只接受 JSON。' } });
      let body = '', length = 0;
      for await (const chunk of req) { length += Buffer.byteLength(chunk); if (length > 4096) return send(413, { ok: false, error: { code: 'BODY_LIMIT', message: '请求过大。' } }); body += chunk; }
      let input;
      try { input = JSON.parse(body); } catch { return send(400, { ok: false, error: { code: 'JSON', message: '请求格式错误。' } }); }
      return send(200, { ok: true, value: await controller.restore(input) });
    } catch (error) {
      return send(409, { ok: false, error: { code: error?.code || 'FAILED', message: error?.code ? error.message : '检查或维护失败，请重新检查。' } });
    }
  };
}
