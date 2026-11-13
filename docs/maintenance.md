# 开发与维护指南

日常安装和使用见 [README](../README.md)。

## GitHub 自动检查

向 `main` 提交代码或创建以 `main` 为目标的修改申请后，GitHub 的 **Actions → Automatic checks** 会自动检查：

- 已提交的网页产物是否与源码一致（先检查，再打包，避免打包自动修复后漏报）。
- 仓库现有的自动测试是否通过；完整获取 Git 历史，以运行历史补丁清单验证。
- 能否正常预览生成安装包，以及打包后网页产物是否仍与提交一致。

使用 Node.js 22 和只读仓库权限，不发布 npm、不安装 DSH、不应用补丁。当前项目没有依赖和锁文件，因此无需安装依赖，也不使用 `npm ci`。以后新增依赖时，须提交锁文件并同步增加依赖安装步骤。

检查详情中的红色步骤表示失败，可展开查看原因；绿色表示本次配置的检查通过。没有真实 DSH 程序文件的集成测试会明确跳过，不能视为已经通过。宿主补丁的真实升级、还原和手机窄屏触摸仍按下文单独验证。首次检查流程合并后，也可在 Actions 页点击 **Run workflow** 手动运行。

## 本地验证

需要 Node.js 22 或更新版本。修改网页端源码后，重新生成并提交客户端产物：

```bash
npm run build
npm test
npm run check:build
```

`npm run check:build` 只比对产物，不会覆盖它。历史版本升级测试读取 Git 历史，建议使用完整克隆。部分集成测试需要指定受支持的 DSH 安装目录；未指定时会跳过相应场景。需要覆盖其他已知构建时，可通过 `PI_AI_SOURCES` 传入只包含程序代码的文件，多个路径用系统路径分隔符隔开。集成测试在临时副本中写入，不要提供用户配置或凭据。

```bash
DSH_ROOT=/path/to/dsh npm test
```

## 两类网页代码

- 插件自己的网页界面位于 `src/`，由 `npm run build` 生成 `lib/client.js`。
- DSH 的「设置 → 模型」由宿主提供，发布包中的 `native/*.patch.json` 为已验证的程序文件补丁，不随客户端构建重新生成。若修改模型设置页补丁生成器，必须提供哈希匹配的原始程序文件，并验证相关构建的启用、升级及还原，不要直接编辑分发补丁或用其他构建的文件替换。

```bash
node scripts/settings-models-collapse.mjs --source /path/to/pristine-client.js
node scripts/settings-models-collapse.mjs --source /path/to/pristine-client.js --check
```

## 诊断与恢复

只读诊断（请替换实际安装路径）：

```bash
node scripts/doctor.mjs --dsh-root /path/to/dsh --json
```

遇到文件校验冲突或无法更新时，先保留现场并收集脱敏诊断。不要强制覆盖程序文件、删除配置或重建密钥。若此前从测试分支安装，可在原 DSH 配置中使用 README 的正式版本命令直接替换插件包，再按更新流程检查补丁。

若插件已误卸载或无法打开网页设置，在处理多密钥模型引用后，先停止正在使用的 DSH 引擎，再从保留的插件目录执行：

```bash
node scripts/native-patches.mjs --dsh-root /path/to/dsh --revert
```

确认恢复完成后，重新启动同一个 DSH 引擎并刷新网页。备份存放在 `DSH_HOME/dsh-model-groups/<安装目录指纹>/backups`。若因异常中断遗留同目录下的 `patch.lock`，请先确认没有补丁维护进程正在运行，切勿并发重试。原版 DSH 可能无法识别 `@dsh-key/` 路由以及 `multiKey`、`keyEntries` 等设置；恢复前请按 README 处理相关模型引用和配置，避免影响启动。
