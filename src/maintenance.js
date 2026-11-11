import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { planPatches, applyPlan, sha256 } from '../scripts/native-patches.mjs';

export const BUNDLE_NAME = 'dsh-model-groups';
// Process-local evidence survives controller replacement and module HMR, but not an
// engine restart. The restoration marker only suppresses automatic patching: it is
// not evidence that this process has loaded old code. A new process's runtime
// remains unverified; checking disk must never create persistent restart state.
const processChangesKey = Symbol.for('dsh-model-groups.maintenance.process-changes.v1');
const processChanges = globalThis[processChangesKey] ??= new Map();
export function maintenanceStorage(root, home) {
  return path.join(home, BUNDLE_NAME, sha256(fs.realpathSync(root)).slice(0, 16));
}
export function restorationPending(root, home) {
  return fs.existsSync(path.join(maintenanceStorage(root, home), 'restore-pending.json'));
}

/** Local-only transaction. Inspection and removal are injected to keep tests off the live host. */
export function createMaintenance({ root, home, inspect, manager, artifacts, now = Date.now }) {
  let phase = 'idle', busy = false, ticket;
  const rootKey = fs.realpathSync(root);
  const storage = maintenanceStorage(root, home);
  const marker = path.join(storage, 'restore-pending.json');
  const restartRequired = () => (processChanges.get(rootKey)?.length ?? 0) > 0;
  function changeFiles(plans) {
    try { applyPlan(plans, path.join(storage, 'backups')); }
    finally {
      // Record actual observed disk changes, not an attempted/no-op operation.
      // Also retain evidence if verification later fails or a partial write survives.
      const changes = plans.flatMap(plan => {
        try {
          const current = fs.readFileSync(plan.file, 'utf8');
          return plan.source !== plan.result && current === plan.result
            ? [{ file: plan.file, before: sha256(plan.source), after: sha256(current) }] : [];
        } catch { return []; }
      });
      if (changes.length) processChanges.set(rootKey, [...(processChanges.get(rootKey) ?? []), ...changes]);
    }
  }
  const patchPlans = () => planPatches(root, 'revert', artifacts);
  const generic = (code, message) => ({ code, message });
  async function assessment() {
    const blockers = [];
    let plans = [], removable = false;
    try {
      plans = patchPlans();
      if (plans.some(plan => plan.applySupported === false)) blockers.push(generic('UNSUPPORTED_PATCH_BUILD', '此宿主构建仅能识别旧补丁，尚无经过验证的新版协议补丁；不会执行不完整更新。仍可关闭或卸载。'));
    }
    catch { blockers.push(generic('PATCH_CONFLICT', '宿主版本或文件校验不匹配；未修改任何宿主文件，请先处理冲突。')); }
    try {
      const report = await inspect();
      if (!report || !Array.isArray(report.blockers) || typeof report.fingerprint !== 'string') throw new Error('inspection');
      blockers.push(...report.blockers);
    } catch { blockers.push(generic('INSPECTION_FAILED', '部分配置和会话使用情况未能检查；关闭后可能需要重新配置普通模型。')); }
    try {
      const bundles = await manager.listBundles();
      const bundle = bundles.find(item => item.name === BUNDLE_NAME);
      removable = !!bundle?.removable;
       if (!removable) blockers.push(generic('NOT_REMOVABLE', '当前插件不属于可卸载的 profile 依赖，请使用安装它的原 profile 管理器。'));
    } catch { blockers.push(generic('MANAGER_UNAVAILABLE', '插件管理器不可用，无法安全卸载。')); }
    // Dependency observations describe consequences, not permission to overwrite files.
    // Only proven activity, other engines sharing the installation and file conflicts
    // stop patch changes. Unknown observations remain visible for explicit consent.
    const hardCodes = new Set(['patch_conflict', 'unsupported_patch_build', 'active_turns', 'other_process', 'not_removable', 'manager_unavailable']);
    const warnings = blockers.filter(b => !hardCodes.has(b.code.toLowerCase()));
    const hard = blockers.filter(b => hardCodes.has(b.code.toLowerCase()));
    return { plans, blockers: hard, warnings, removable, stamp: sha256(JSON.stringify([hard, removable, plans.map(p => [p.name, sha256(p.source), !!p.updateAvailable, p.applySupported, sha256(JSON.stringify(p.artifact))])])) };
  }
  function view(report, executing = false) {
    const valid = report.plans.length > 0 && !report.blockers.some(b => b.code.toLowerCase() === 'patch_conflict');
    const restoreBlockers = report.blockers.filter(b => b.code.toLowerCase() !== 'unsupported_patch_build');
    const dependencies = restoreBlockers.filter(b => !['not_removable', 'manager_unavailable'].includes(b.code.toLowerCase()));
    const installBlockers = report.blockers.filter(b => !['not_removable', 'manager_unavailable'].includes(b.code.toLowerCase()));
    const available = (!busy || executing) && phase !== 'removed';
    return { phase, restartRequired: restartRequired(), patches: report.plans.map(p => ({ name: p.name, state: p.state, updateAvailable: !!p.updateAvailable, applySupported: p.applySupported !== false })), blockers: report.blockers, warnings: report.warnings,
      token: null, canApply: available && valid && installBlockers.length === 0 && report.plans.some(p => p.state === 'pristine' || p.updateAvailable),
      canRestoreOnly: available && valid && dependencies.length === 0 && report.plans.some(p => p.state === 'patched'),
      canRestore: available && valid && restoreBlockers.length === 0,
      notice: '关闭会保留密钥和聊天记录，不自动更换服务。旧多密钥选择可能失效，旧配置可能影响重启；使用情况未完整检查时仍可确认继续。普通插件列表卸载不会还原补丁。' };
  }
  async function snapshot() {
    const report = await assessment();
    const value = view(report);
    if (value.canRestore || value.canRestoreOnly || value.canApply) {
      if (!ticket || ticket.stamp !== report.stamp || ticket.expires < now()) ticket = { token: crypto.randomBytes(32).toString('hex'), stamp: report.stamp, expires: now() + 120000 };
      value.token = ticket.token;
    }
    return value;
  }
  async function restore(input) {
    if (busy) throw generic('BUSY', '已有维护任务正在执行。');
    if (!['apply', 'restore-only', 'restore-and-uninstall'].includes(input?.action) || input?.confirmation !== 'CONFIRM PATCH OPERATION' ||
      !ticket || typeof input.token !== 'string' || input.token !== ticket.token || ticket.expires < now()) {
      throw generic('CONFIRMATION_REQUIRED', '确认已失效，请重新检查并明确确认。');
    }
    const expected = ticket; ticket = undefined;
    const action = input.action;
    busy = true;
    let locked = false;
    const lock = path.join(storage, 'patch.lock');
    try {
      fs.mkdirSync(storage, { recursive: true, mode: 0o700 });
      // Same inter-process lock as automatic installation. Never remove somebody else's lock.
      fs.mkdirSync(lock, { mode: 0o700 }); locked = true;
      const report = await assessment();
      const permissions = view(report, true);
       const permitted = action === 'apply' ? permissions.canApply : action === 'restore-only' ? permissions.canRestoreOnly : permissions.canRestore;
       if (!permitted || report.stamp !== expected.stamp) throw generic('STATE_CHANGED', '文件或任务状态发生变化，请确认没有任务运行后重试。');
      if (action === 'apply') {
        changeFiles(planPatches(root, 'apply', artifacts));
        if (!patchPlans().every(p => p.state === 'patched' && !p.updateAvailable && p.applySupported !== false)) throw generic('VERIFY_FAILED', '补丁验证失败。');
        // Never delete a computed or unverified path; only this exact owned marker.
        if (fs.existsSync(marker)) {
          const stat = fs.lstatSync(marker);
          if (!stat.isFile() || stat.isSymbolicLink()) throw generic('VERIFY_FAILED', '恢复标记异常。');
          fs.unlinkSync(marker);
        }
        phase = 'applied';
        return view(await assessment());
      }
      fs.writeFileSync(marker, JSON.stringify({ version: 1, purpose: 'explicit-restore-and-uninstall' }), { mode: 0o600 });
      // Fresh synchronous planning checks concurrent target edits again; applyPlan performs an additional check.
      changeFiles(patchPlans());
      if (!patchPlans().every(p => p.state === 'pristine')) throw generic('VERIFY_FAILED', '原版文件复查失败，未宣告卸载成功。');
      phase = 'restored';
      if (action === 'restore-only') return view(await assessment());
      phase = 'removing';
      const result = await manager.removeBundle(BUNDLE_NAME);
      if (!result || result.application !== 'applied' || result.error || (result.packageResult && (result.packageResult.exitCode !== 0 || result.packageResult.timedOut))) throw generic('REMOVE_FAILED', '已确认原版文件，但插件卸载失败。请保留恢复标记并在插件列表中重试卸载；是否需要重启以文件修改记录为准。');
      const remaining = (await manager.listBundles()).find(item => item.name === BUNDLE_NAME);
      if (remaining?.installed || remaining?.removable || remaining?.enabled) throw generic('REMOVE_UNVERIFIED', '尚未确认插件依赖已移除，请检查插件列表；补丁不会自动重新安装。');
      if (!patchPlans().every(p => p.state === 'pristine')) throw generic('VERIFY_FAILED', '卸载后宿主文件再次变化，不能确认完整恢复。');
      phase = 'removed';
      return { phase, restartRequired: restartRequired(), patches: patchPlans().map(p => ({ name: p.name, state: p.state, updateAvailable: !!p.updateAvailable, applySupported: p.applySupported !== false })), blockers: [], canRestore: false, canRestoreOnly: false, canApply: false, token: null,
        notice: '已确认原版文件和插件依赖移除状态。密钥、历史和安全备份未删除；运行时状态未验证，是否需要重启以本进程实际文件修改记录为准。' };
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
