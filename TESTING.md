# 0.4.0-beta.1 测试记录

这是一份可安装的免宿主补丁测试版，不是旧安装器包装。目标为 DSH 0.2.2-rc.1 的 Harness Web；没有绑定手机操作系统或特定目录。

## 自动测试

2026-11-10 使用 npm 官方干净包执行：35项通过、0失败。

- 官方 Loader + Settings + ConfigEditor：空配置激活、写入、volatile更新不重挂、重载持久化、删除标记不可移除。
- 三种协议真实本地 HTTP SSE：OpenAI Chat Completions、Responses、Anthropic Messages，校验精确密钥与模型ID。
- 多配置同名模型；缺失密钥不回退；已准备请求与异步密钥读取期间更新/删除/卸载隔离；活动请求取消。
- 供应商私有历史回放状态隔离，普通历史文字保留，历史输入不改写。
- 官方 Gateway：插件私有只写密钥端点、严格参数校验、卸载撤销。
- 客户端构建产物：模块加载、远端挂载顺序、插槽注册、清理；官方 LocaleRuntime 中英文解析。
- 静态渲染/状态测试：锁定、子代理限制、pending、错误、不可用选择、重复模型ID、删除标记、中文不改写用户名称、HTTP页面UUID生成。

构建产物校验：14个发布文件，无native补丁、无旧安装器、无安装生命周期脚本。Client构建可重复。

## 范围边界

静态渲染和CSS检查不是手机触摸验收。本轮不安装到当前profile、不重启当前引擎、不访问付费端点。另一台测试手机需要实际检查首次安装、页面重载、模型选择、设置保存、窄屏滚动/软键盘/面板、禁用卸载。

模型声明目前为保守文本输入能力（32768上下文、4096最大输出）。不同服务可能有不同真实能力；图片、多模态、高级推理配置及完整端到端工具回放尚未验收。

npm registry升级/DSHMarket升级未执行；npm latest与市场申请没有改动。测试包安装采用普通bundle接口，但不能把本地安装/卸载结果称作已完成所有平台与更新通道验收。

## 复现

```sh
npm ci --ignore-scripts
npm run build
npm test
npm run check:build
npm pack --ignore-scripts
node scripts/verify-package.mjs
node test/host-packed-lifecycle.mjs /absolute/path/dsh-model-groups-0.4.0-beta.1.tgz
```

最后一项是显式隔离测试：会创建临时profile并联网下载公开依赖，只使用合成凭据，不读取当前profile。脚本输出证据路径；使用官方包操作层和Loader，不等同于完整PluginManager服务/HMR或真实浏览器验收。
