# Native-first 分组改造（开发中，未发布）

## 用户体验目标

保存配置时，每个密钥条目就对应一个 DSH 原生 provider，使用原始 model ID 和原有 apiKeyEnv 引用。插件只保存分组元数据并呈现「总组 → 密钥 → 模型」。普通卸载后，原版自然显示各个 provider，无需在卸载时运行代码。

这不是当前 beta.3 已具备的行为。当前发布版仍会修改宿主文件。未迁移旧配置并验证补丁还原前，不得声称普通卸载已安全闭环。

## 身份与数据

- child provider 的不可变 ID 基于原 provider + entryId，而非可改名的显示标签。
- model 选择使用真实 child provider + 上游 model ID，不生成新的 @dsh-key/ 别名。
- apiKeyEnv 仅复用引用；转换器不读取、导出或复制密钥值。
- 分组元数据放在插件独立 namespace，不往原生 provider schema 塞不受支持字段。
- 保留旧普通 provider，不把第一把密钥擅自当成旧普通路由。

## 旧版本迁移顺序

1. 明确确认、停止并发修改和任务，完整读取配置层、默认模型、会话当前选择、子智能体及其他持久路由。
2. 构建转换计划，校验所有原生 provider 可完整表达原行为，检查 ID 冲突。
3. 先一次性新增原生 providers，保留旧 providers/keyEntries/补丁。此阶段失败不删除任何旧路由。
4. 可恢复日志记录每个会话迁移进度，采用新增 model/selection 事件，不重写历史正文或 request/header。
5. 独立迁移默认模型，不能批量调用会修改全局默认的 remote selectModel。
6. 完整验证无当前/持久配置依赖旧别名后，才考虑清理旧字段并严格还原补丁。
7. 任何部分失败保留旧路由和补丁，可重试；不能伪装全局原子事务。

## 不可忽略的兼容限制

- 新 provider ID 不再命中旧供应商的内置模型目录。api/baseURL、模型上下文、输出上限、输入模态、reasoningEfforts/compat 等必须显式且语义等价。
- 本宿主自定义 provider 仅支持 openai-completions/openai-responses/anthropic-messages，其他专用协议不能泛化迁移。
- 目录模型的成本、供应商特定逻辑、header 等不一定能用自定义 profile 表达；不能承诺完整复制。
- 共享/继承/禁用配置可能在 unset 后重新出现，不能只扫描当前生效表单。
- 历史别名保留为历史记录；从旧历史位置创建分支的行为仍需单独验证，不能靠改写历史掩盖问题。

## 新安装与旧版必须分开

- 新安装使用独立 native-index/native-client 入口，普通卸载仅撤去显示，不触发还原钩子；不能自动用于已存在旧别名的环境。
- 开发中的 fresh 预览首先支持把宿主已有独立 provider 合并显示；这与完整的一屏新增多密钥配置不是同一个交付项。
- 原发布入口、维护页和补丁行为保持不变；不会在未完整迁移旧会话时偷偷切换。
- scripts/native-manifest.mjs 仅生成隔离打包用的清单，排除旧入口、宿主补丁和安装脚本；不自动改动主清单或发布。

## 当前实现边界

- native-downgrade 是纯内存保守规划器，生成真实 child provider、严格路由映射以及不含凭据引用/地址的分组元数据，不自行执行迁移。
- native-groups 是纯界面投影，现有选择器正在接入可选 nativeMetadata；缺少元数据仍保留现有发布版行为。
- native-stage 仅预备新增 providers，要求外部提供受信任宿主验证器；重复运行只复用完全相等的已有子项，不覆盖已修改项。preview 的 planFingerprint 绑定路由映射，防止会话迁移拿错计划。
- native-migration 是注入式日志/CAS 核心：先新增配置，再逐项迁移当前选择；失败可重试，但需要真实宿主的完整静止清单、全选择原子 CAS 和私有日志独占适配器。它不删除旧字段、不还原补丁、不宣称卸载安全。
- 宿主 AgentModel.select 本身同步追加 model/selection，没有 expected 参数。真实适配器需在同一同步执行段核对 current() 后 select，并覆盖持久会话写入租约；不能把 inspect 后异步调用 remote.selectModel 冒充 CAS。默认模型的 saveSelection 支持 ifCurrent，但固定默认会跳过，必须单独走修订保护的配置写入。
- native-save 已提供仅新增原生子 provider 的修订保护保存核心；native-group-save 明确先保存原生路由再保存显示元数据，第二步失败报告局部成功、不删除已保存路由。尚未接到真实页面/API。
- 实际宿主配置编辑、元数据持久化、完整会话/默认/子智能体适配及旧补丁还原尚未接通。已有维护页仍按旧规则阻止 keyEntries 依赖，避免不完整功能破坏用户数据。
- native-journal 提供私有目录下的排他、原子替换及 fsync 日志；写入不确定时停止，遗留锁不自动抢占。同 UID 恶意写入与最终核对/rename 的微小竞态不是 Node 文件 API 能完全隔离的边界。
- native-host-resolver 只在内存中加载已校验哈希的原版/补丁版 resolveProfiles，严格限制宿主版本，不改磁盘、不调用凭据解析或网络。
- native-validation 是真实解析结果的保守语义闸门：比较旧 entry 与新 provider 的完整模型/成本/compat/输出限额及路由设置，只允许 provider/displayName/keyEntry 标识变化和 undefined 字段省略差异。目录默认、成本等有差异即拒绝迁移，不悄悄忽略。
- 本地测试已在内存中逆向得到哈希匹配的原版 pi-ai 源码，并比较补丁版 entry 与原版 provider 在三种支持协议下的实际解析结果，不调用密钥服务或网络。此测试证明显式自定义模型的解析可行，不等于全部供应商和历史迁移已证明等价。
