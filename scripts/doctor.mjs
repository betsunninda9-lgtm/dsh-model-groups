import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { planPatches } from './native-patches.mjs';

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('Usage: node scripts/doctor.mjs --dsh-root <DSH installation directory> [--json]\nRead-only installation check. Does not read credentials or change DSH.');
} else {
  try {
    const i = args.indexOf('--dsh-root');
    if (i < 0 || !args[i + 1] || args.some((arg, index) => index !== i + 1 && !['--dsh-root', '--json'].includes(arg))) {
      throw new Error('请用 --dsh-root 指定正在使用的 DSH 安装目录。');
    }
    const pkg = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'));
    const plans = planPatches(args[i + 1], 'check');
    const missing = plans.filter(plan => plan.state !== 'patched' || plan.updateAvailable || plan.applySupported === false);
    const unsupported = plans.some(plan => plan.applySupported === false);
    const report = {
      plugin: pkg.name,
      version: pkg.version,
      supportedDsh: pkg.engines.dsh,
      diskPatchesReady: missing.length === 0,
      runtimeVerified: false,
      files: plans.map(plan => ({ target: plan.artifact.target, state: plan.state, updateAvailable: plan.updateAvailable, applySupported: plan.applySupported })),
      next: unsupported
        ? '旧补丁可识别和还原，但此宿主构建尚无经过验证的新版协议补丁，已禁止不完整升级。请核对兼容版本；未修改任何文件。'
        : missing.length > 0
        ? '新版多密钥补丁尚未就绪：请在设置 → 模型分组中确认更新/启用，再重启原 DSH 服务并刷新网页。'
        : '磁盘补丁齐全。请确认原 DSH 服务已在应用补丁后重启，并刷新网页；本检查不能确认运行中的模块或浏览器缓存。',
    };
    if (args.includes('--json')) console.log(JSON.stringify(report, null, 2));
    else {
      console.log(`${report.plugin} ${report.version} · DSH ${report.supportedDsh}`);
      for (const item of report.files) console.log(`${item.state}: ${item.target}`);
      console.log(report.next);
    }
    if (missing.length) process.exitCode = 2;
  } catch (error) {
    console.error(`无法确认多密钥安装状态：${error.message}`);
    process.exitCode = 1;
  }
}
