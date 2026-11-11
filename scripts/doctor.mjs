import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { inspectPatches } from './native-patches.mjs';
import { compatibilityGuidance } from '../src/compatibility.js';

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('Usage: node scripts/doctor.mjs --dsh-root <DSH installation directory> [--json]\nRead-only program compatibility check. No credentials, paths, or source text in diagnostics.');
} else {
  try {
    const i = args.indexOf('--dsh-root');
    if (i < 0 || !args[i + 1] || args.some((arg, index) => index !== i + 1 && !['--dsh-root', '--json'].includes(arg))) throw new Error('arguments');
    const pkg = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'));
    const compatibility = inspectPatches(args[i + 1]);
    const conflict = compatibility.files.some(file => file.state === 'conflict');
    const ready = compatibility.files.every(file => file.code === 'ready');
    const report = { plugin: pkg.name, version: pkg.version, supportedDsh: pkg.engines.dsh,
      diskPatchesReady: ready, runtimeVerified: false, compatibility,
      files: compatibility.files.map(file => ({ ...file, updateAvailable: file.code === 'update_available',
        applySupported: ['ready', 'update_available', 'not_applied'].includes(file.code) })),
      next: compatibilityGuidance(compatibility) || (ready
        ? '磁盘补丁齐全。请确认原 DSH 服务已在应用补丁后重启，并刷新网页；本检查不能证明运行中的模块已刷新。'
        : '请在设置 → 模型分组中确认启用，再重启原 DSH 服务并刷新网页。') };
    if (args.includes('--json')) console.log(JSON.stringify(report, null, 2));
    else {
      console.log(`${report.plugin} ${report.version} · DSH ${compatibility.hostVersion ?? 'unknown'}`);
      for (const item of report.files) console.log(`${item.id}: ${item.state} / ${item.code} · SHA-256 ${item.observedSha256 ?? 'unavailable'}`);
      console.log(report.next);
    }
    process.exitCode = conflict ? 1 : ready ? 0 : 2;
  } catch {
    const report = { diskPatchesReady: false, runtimeVerified: false, error: 'diagnostic_unavailable',
      next: '请用 --dsh-root 指定正在使用的 DSH 安装目录；诊断失败不代表补丁已就绪，未修改任何文件。' };
    if (args.includes('--json')) console.log(JSON.stringify(report, null, 2));
    else console.error(report.next);
    process.exitCode = 1;
  }
}
