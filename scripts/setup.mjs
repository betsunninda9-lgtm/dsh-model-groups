import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { planPatches, applyPlan } from './native-patches.mjs';

const args = process.argv.slice(2);
try {
  if (args.includes('--help')) {
    console.log('Usage: node scripts/setup.mjs --dsh-root <directory> --profile <profile> [--apply --service-stopped]\nDefault: read-only compatibility check. Apply registers the plugin and patches DSH. Stop the original DSH service first; restart it afterwards.');
  } else {
    const values = {};
    let apply = false, stopped = false;
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === '--apply') apply = true;
      else if (arg === '--service-stopped') stopped = true;
      else if (['--dsh-root', '--profile'].includes(arg) && args[i + 1] && !args[i + 1].startsWith('--')) values[arg] = args[++i];
      else throw new Error(`未知或不完整的参数：${arg}`);
    }
    const root = values['--dsh-root'];
    const profile = values['--profile'];
    if (!root || !profile || !/^[A-Za-z0-9_-]+$/.test(profile)) throw new Error('请提供 --dsh-root 和有效的 --profile。');
    if (apply && !stopped) throw new Error('应用前请停止原 DSH 服务，再提供 --apply --service-stopped。该参数由你确认停机，不会自动检测或停止服务。');
    const plans = planPatches(root, 'check');
    for (const plan of plans) console.log(`${plan.state}: ${plan.artifact.target}`);
    if (!apply) {
      console.log('兼容检查通过，尚未注册插件或应用补丁。停止原服务后，用相同命令加 --apply --service-stopped 完成安装。');
    } else {
      const pluginRoot = fileURLToPath(new URL('../', import.meta.url));
      const registered = spawnSync('dsh', ['plugin', '--profile', profile, 'add', path.resolve(pluginRoot)], { stdio: 'inherit' });
      if (registered.error || registered.status !== 0) throw new Error('插件注册失败，未应用补丁。请检查上方安装输出。');
      const count = applyPlan(planPatches(root, 'apply'));
      if (!planPatches(root, 'check').every(plan => plan.state === 'patched')) throw new Error('补丁复查未通过。插件可能已注册，请检查磁盘状态后再启动服务。');
      console.log(`插件已注册，${count} 个宿主文件已更新，五项磁盘补丁全部就绪。请启动原 DSH 服务并刷新原网页；当前尚未验证运行中的功能。`);
    }
  }
} catch (error) {
  console.error(`安装停止：${error.message}`);
  process.exitCode = 1;
}
