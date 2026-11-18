import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { planPatches, sha256 } from '../scripts/native-patches.mjs';
import { changePatchFiles, restorationPending } from './maintenance.js';
import { readPatchPreferences, writePatchPreferences } from './patch-preferences.js';

export function findDshRoot(entry = process.argv[1]) {
  if (!entry) throw new Error('无法确定 DSH 进程入口。');
  const require = createRequire(fs.realpathSync(entry));
  const pkg = require.resolve('@deepseek-ai/dsh-llm-pi-ai/package.json');
  const resolved = fs.realpathSync(pkg);
  let dir = path.dirname(resolved);
  while (true) {
    const candidate = path.join(dir, 'node_modules/@deepseek-ai/dsh-llm-pi-ai/package.json');
    if (fs.existsSync(candidate) && fs.realpathSync(candidate) === resolved) {
      // Discovery must survive unknown program hashes so maintenance can explain
      // the conflict. The planner still validates every target before any write.
      const inner = path.join(dir, 'node_modules/@deepseek-ai/dsh/package.json');
      const host = JSON.parse(fs.readFileSync(fs.existsSync(inner) ? inner : path.join(dir, 'package.json'), 'utf8'));
      if (host.name === '@deepseek-ai/dsh') return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('未找到与当前 DSH 进程一致且可安全修改的安装目录。');
}

export function startupActivity(ctx, root, processDirectory = '/proc', { includeTasks = true } = {}) {
  try {
    if (includeTasks && ctx.agents?.list) for (const agent of ctx.agents.list()) {
      if (agent.status !== 'idle' || (agent.phase && agent.phase.kind !== 'idle')) return 'active-tasks';
    }
    for (const entry of fs.readdirSync(processDirectory, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^\d+$/.test(entry.name) || Number(entry.name) === process.pid) continue;
      let command;
      try { command = fs.readFileSync(path.join(processDirectory, entry.name, 'cmdline'), 'utf8').split('\0'); }
      catch (error) { if (['ENOENT', 'ESRCH'].includes(error.code)) continue; throw error; }
      if (!/(?:^|\/)node(?:js)?$/.test(command[0] || '')) continue;
      if (command.slice(1).some(arg => {
        if (!path.isAbsolute(arg)) return /^(?:dsh|@deepseek-ai\/dsh)(?:\/|$)/.test(arg);
        const relative = path.relative(root, arg);
        return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
          && /(?:^|\/)dsh(?:\/|$)|@deepseek-ai\/dsh/.test(arg);
      })) return 'other-engine';
    }
    return null;
  } catch { return 'activity-unverified'; }
}

export function autoPatch(root, home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), { artifacts, activity = () => null } = {}) {
  if (restorationPending(root, home)) return { state: 'restore-pending', changed: 0, runtimeVerified: false };
  const preferences = readPatchPreferences(root, home, artifacts);
  if (!preferences.enabled) {
    writePatchPreferences(root, home, preferences);
    return { state: 'fold-only', changed: 0, runtimeVerified: false };
  }
  if (!preferences.autoMaintenance) return { state: 'manual-maintenance', changed: 0, runtimeVerified: false };
  const plans = planPatches(root, 'apply', artifacts);
  writePatchPreferences(root, home, preferences);
  const pending = plans.some(plan => plan.source !== plan.result);
  if (!pending) return { state: 'disk-ready', changed: 0, runtimeVerified: false };
  const blocked = activity();
  if (blocked) return { state: 'deferred', reason: blocked, changed: 0, runtimeVerified: false };
  const storage = path.join(home, 'dsh-model-groups', sha256(fs.realpathSync(root)).slice(0, 16));
  fs.mkdirSync(storage, { recursive: true, mode: 0o700 });
  const lock = path.join(storage, 'patch.lock');
  try { fs.mkdirSync(lock, { mode: 0o700 }); }
  catch { throw new Error('补丁安装已被锁定；可能有另一进程正在安装。确认没有安装任务后再处理锁目录，勿并发重试。'); }
  try {
    if (restorationPending(root, home)) return { state: 'restore-pending', changed: 0, runtimeVerified: false };
    const preferences = readPatchPreferences(root, home, artifacts);
    if (!preferences.enabled || !preferences.autoMaintenance) return { state: 'manual-maintenance', changed: 0, runtimeVerified: false };
    const blocked = activity();
    if (blocked) return { state: 'deferred', reason: blocked, changed: 0, runtimeVerified: false };
    const changed = changePatchFiles(root, planPatches(root, 'apply', artifacts), path.join(storage, 'backups'));
    if (!planPatches(root, 'check', artifacts).every(plan => plan.state === 'patched' && !plan.updateAvailable)) throw new Error('自动补丁复查失败。');
    return { state: changed ? 'restart-required' : 'disk-ready', changed, runtimeVerified: false };
  } finally {
    if (path.dirname(lock) !== storage || fs.realpathSync(lock) !== lock || !fs.lstatSync(lock).isDirectory()) throw new Error('补丁锁路径异常。');
    fs.rmdirSync(lock);
  }
}
