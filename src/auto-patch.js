import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { planPatches, applyPlan, sha256 } from '../scripts/native-patches.mjs';

export function findDshRoot(entry = process.argv[1]) {
  if (!entry) throw new Error('无法确定 DSH 进程入口。');
  const require = createRequire(fs.realpathSync(entry));
  const pkg = require.resolve('@deepseek-ai/dsh-llm-pi-ai/package.json');
  const resolved = fs.realpathSync(pkg);
  let dir = path.dirname(resolved);
  while (true) {
    const candidate = path.join(dir, 'node_modules/@deepseek-ai/dsh-llm-pi-ai/package.json');
    if (fs.existsSync(candidate) && fs.realpathSync(candidate) === resolved) {
      // Full patch planning validates the DSH package/version and every target.
      planPatches(dir, 'check');
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('未找到与当前 DSH 进程一致且可安全修改的安装目录。');
}

export function autoPatch(root, home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')) {
  const plans = planPatches(root, 'apply');
  const pending = plans.some(plan => plan.source !== plan.result);
  if (!pending) return { state: 'disk-ready', changed: 0, runtimeVerified: false };
  const storage = path.join(home, 'dsh-model-groups', sha256(fs.realpathSync(root)).slice(0, 16));
  fs.mkdirSync(storage, { recursive: true, mode: 0o700 });
  const lock = path.join(storage, 'patch.lock');
  try { fs.mkdirSync(lock, { mode: 0o700 }); }
  catch { throw new Error('补丁安装已被锁定；可能有另一进程正在安装。确认没有安装任务后再处理锁目录，勿并发重试。'); }
  try {
    const changed = applyPlan(planPatches(root, 'apply'), path.join(storage, 'backups'));
    if (!planPatches(root, 'check').every(plan => plan.state === 'patched')) throw new Error('自动补丁复查失败。');
    return { state: changed ? 'restart-required' : 'disk-ready', changed, runtimeVerified: false };
  } finally {
    if (path.dirname(lock) !== storage || fs.realpathSync(lock) !== lock || !fs.lstatSync(lock).isDirectory()) throw new Error('补丁锁路径异常。');
    fs.rmdirSync(lock);
  }
}
